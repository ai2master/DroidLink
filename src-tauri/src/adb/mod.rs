// ADB 管理模块 - 设备管理、文件操作、设备监控
// ADB management module - device management, file operations, device monitoring
//
// 安全约束 / Security constraints:
// - 禁止调用 adb forward (Never call adb forward)
// - 禁止建立到 Android 设备的网络连接 (No network connections to Android device)
// - TcpStream 仅用于检测桌面本机 ADB 守护进程是否运行 (TcpStream only for local ADB daemon check)
// - 所有设备通信仅通过 adb shell / adb push / adb pull (All device comms via adb shell/push/pull)

use crossbeam_channel::Sender;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use thiserror::Error;

/// 全局 ADB 路径缓存 (解析后不再变化)
/// Global ADB path cache (resolved once, then immutable)
static ADB_PATH: OnceLock<PathBuf> = OnceLock::new();

/// ADB 服务器端口 (默认 5037，若系统已占用则使用备用端口)
/// ADB server port (default 5037, fallback to alternate if system already occupies it)
static ADB_PORT: OnceLock<u16> = OnceLock::new();

#[derive(Error, Debug)]
pub enum AdbError {
    #[error("ADB binary not found")]
    AdbNotFound,

    #[error("ADB command failed: {0}")]
    CommandFailed(String),

    #[error("Failed to parse ADB output: {0}")]
    ParseError(String),

    #[error("Device not found: {0}")]
    DeviceNotFound(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("UTF-8 conversion error: {0}")]
    Utf8Error(#[from] std::string::FromUtf8Error),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("File operation failed: {0}")]
    FileOperationFailed(String),
}

pub type Result<T> = std::result::Result<T, AdbError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub serial: String,
    pub model: String,
    pub manufacturer: String,
    pub android_version: String,
    pub sdk_version: String,
    pub battery_level: i32,
    pub storage_total: u64,
    pub storage_used: u64,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceBasic {
    pub serial: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub file_type: String, // "file", "directory", "link"
    pub size: u64,
    pub modified: String,
    pub permissions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DeviceEvent {
    Connected(DeviceInfo),
    Disconnected(String),
}

/// ADB 路径信息 (供前端显示)
/// ADB path info (for frontend display)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdbPathInfo {
    /// 实际使用的 ADB 二进制路径
    /// The actual ADB binary path in use
    pub adb_path: String,
    /// 是否使用内置 ADB
    /// Whether the bundled ADB is being used
    pub is_bundled: bool,
    /// ADB 服务器端口
    /// ADB server port
    pub port: u16,
    /// 是否检测到系统已有 ADB 服务器
    /// Whether an existing system ADB server was detected
    pub reused_server: bool,
    /// ADB 版本号
    /// ADB version string
    pub version: String,
    /// 当前使用的来源 (bundled / system / custom)
    /// Current source in use
    pub source: String,
}

// ========== ADB 路径解析与冲突避免 ==========
// ========== ADB path resolution and conflict avoidance ==========
//
// 解析策略 / Resolution strategy:
// 1. 检测系统是否已有 ADB 服务器运行在 5037 端口
//    Check if a system ADB server is already running on port 5037
// 2. 若已运行：使用内置 ADB 客户端连接到现有服务器 (不启动新服务器)
//    If running: use bundled ADB client connecting to existing server (don't start new server)
// 3. 若未运行：
//    If not running:
//    a. 使用内置 ADB 启动服务器
//       Start server with bundled ADB
//    b. 若端口被其他程序占用，使用备用端口 5038
//       If port occupied by other program, use alternate port 5038
//
// 核心原则：多个 ADB 客户端可以安全连接同一个 ADB 服务器。
//           冲突只在两个 ADB 服务器尝试使用同一端口时发生。
// Key principle: Multiple ADB clients can safely connect to the same ADB server.
//               Conflict only occurs when two ADB servers try to use the same port.

const DEFAULT_ADB_PORT: u16 = 5037;
const FALLBACK_ADB_PORT: u16 = 5038;

/// 初始化 ADB：根据设置解析路径、处理端口冲突、确保服务器运行
/// Initialize ADB: resolve path from settings, handle port conflicts, ensure server is running
///
/// adb_source: "bundled" | "system" | "custom"
/// custom_path: 自定义 ADB 路径 (仅 adb_source="custom" 时使用)
pub fn init_adb(bundled_adb_dir: &Path, adb_source: &str, custom_path: &str) -> Result<AdbPathInfo> {
    let bundled = bundled_adb_binary(bundled_adb_dir);
    let system_adb = find_system_adb();

    // 根据设置决定使用哪个 ADB
    // Resolve ADB binary based on settings
    let (adb_path, source) = match adb_source {
        "system" => {
            if let Some(ref sys) = system_adb {
                (sys.clone(), "system".to_string())
            } else {
                log::warn!("系统 ADB 未找到，回退到内置 / System ADB not found, falling back to bundled");
                if bundled.exists() {
                    (bundled.clone(), "bundled".to_string())
                } else {
                    return Err(AdbError::AdbNotFound);
                }
            }
        }
        "custom" => {
            if !custom_path.is_empty() {
                let custom = PathBuf::from(custom_path);
                if custom.exists() {
                    (custom, "custom".to_string())
                } else {
                    log::warn!("自定义 ADB 路径不存在: {}，回退到内置 / Custom ADB path not found: {}, falling back", custom_path, custom_path);
                    if bundled.exists() {
                        (bundled.clone(), "bundled".to_string())
                    } else if let Some(ref sys) = system_adb {
                        (sys.clone(), "system".to_string())
                    } else {
                        return Err(AdbError::AdbNotFound);
                    }
                }
            } else {
                log::warn!("自定义 ADB 路径为空，回退到内置 / Custom ADB path empty, falling back to bundled");
                if bundled.exists() {
                    (bundled.clone(), "bundled".to_string())
                } else if let Some(ref sys) = system_adb {
                    (sys.clone(), "system".to_string())
                } else {
                    return Err(AdbError::AdbNotFound);
                }
            }
        }
        _ => {
            // "bundled" 或默认: 内置优先，回退到系统
            // "bundled" or default: bundled first, fallback to system
            if bundled.exists() {
                (bundled.clone(), "bundled".to_string())
            } else if let Some(ref sys) = system_adb {
                log::info!("内置 ADB 未找到，使用系统 ADB / Bundled ADB not found, using system ADB");
                (sys.clone(), "system".to_string())
            } else {
                return Err(AdbError::AdbNotFound);
            }
        }
    };

    // 优先检测系统 ADB 服务器是否已运行
    // First check if a system ADB server is already running
    let (port, reused) = if is_adb_server_running(DEFAULT_ADB_PORT) {
        log::info!("检测到系统 ADB 服务器已在端口 {} 运行 / Detected existing ADB server on port {}", DEFAULT_ADB_PORT, DEFAULT_ADB_PORT);
        (DEFAULT_ADB_PORT, true)
    } else {
        match start_adb_server(&adb_path, DEFAULT_ADB_PORT) {
            Ok(()) => (DEFAULT_ADB_PORT, false),
            Err(_) => {
                log::warn!("端口 {} 被占用，尝试备用端口 {} / Port {} occupied, trying fallback port {}",
                    DEFAULT_ADB_PORT, FALLBACK_ADB_PORT, DEFAULT_ADB_PORT, FALLBACK_ADB_PORT);
                start_adb_server(&adb_path, FALLBACK_ADB_PORT)?;
                (FALLBACK_ADB_PORT, false)
            }
        }
    };

    // 缓存到全局变量
    // Cache in global variables
    let _ = ADB_PATH.set(adb_path.clone());
    let _ = ADB_PORT.set(port);

    let is_bundled = source == "bundled";

    // 获取版本号
    // Get version string
    let version = get_adb_version(&adb_path, port).unwrap_or_else(|_| "unknown".to_string());

    log::info!("ADB 初始化完成 / ADB initialized: path={:?}, port={}, source={}, reused_server={}",
        adb_path, port, source, reused);

    Ok(AdbPathInfo {
        adb_path: adb_path.to_string_lossy().to_string(),
        is_bundled,
        port,
        reused_server: reused,
        version,
        source,
    })
}

/// 验证 ADB 二进制是否可用
/// Validate an ADB binary path is usable
pub fn validate_adb_path(path: &str) -> bool {
    let p = Path::new(path);
    if !p.exists() {
        return false;
    }
    Command::new(p)
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 获取可用的 ADB 来源列表
/// Get list of available ADB sources
pub fn get_available_sources(bundled_adb_dir: &Path) -> Vec<String> {
    let mut sources = Vec::new();
    if bundled_adb_binary(bundled_adb_dir).exists() {
        sources.push("bundled".to_string());
    }
    if find_system_adb().is_some() {
        sources.push("system".to_string());
    }
    sources.push("custom".to_string()); // custom 始终可选 / always available
    sources
}

/// 获取内置 ADB 二进制路径
/// Get bundled ADB binary path
/// tauri.conf.json 配置 "resources/adb/*" → 运行时在 $RESOURCE_DIR/resources/adb/
/// tauri.conf.json bundles "resources/adb/*" → at runtime they're at $RESOURCE_DIR/resources/adb/
fn bundled_adb_binary(base_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        base_dir.join("resources").join("adb").join("adb.exe")
    } else {
        base_dir.join("resources").join("adb").join("adb")
    }
}

/// 在系统 PATH 中查找 ADB
/// Find ADB in system PATH
fn find_system_adb() -> Option<PathBuf> {
    let name = if cfg!(target_os = "windows") { "adb.exe" } else { "adb" };
    which::which(name).ok()
}

/// 检测 ADB 服务器是否已在指定端口运行 (桌面本机，非 Android 设备)
/// Check if ADB server is already running on the specified port (desktop-local, NOT Android device)
///
/// 注意: 这是连接桌面本机的 ADB 守护进程 (127.0.0.1:5037)，不是连接 Android 设备。
/// NOTE: This connects to the local ADB daemon on the desktop (127.0.0.1:5037), NOT to the Android device.
/// This is the only TcpStream usage in the entire codebase and does not violate the no-network constraint.
fn is_adb_server_running(port: u16) -> bool {
    // 连接桌面本机 ADB 守护进程端口 (不是 Android 设备)
    // Connect to desktop-local ADB daemon port (NOT the Android device)
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(500),
    ).is_ok()
}

/// 启动 ADB 服务器 (指定端口)
/// Start ADB server on specified port
fn start_adb_server(adb_path: &Path, port: u16) -> Result<()> {
    let output = Command::new(adb_path)
        .args(["-P", &port.to_string(), "start-server"])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AdbError::AdbNotFound
            } else {
                AdbError::IoError(e)
            }
        })?;

    if output.status.success() {
        // 等待服务器就绪
        // Wait for server to be ready
        std::thread::sleep(Duration::from_millis(300));
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(AdbError::CommandFailed(format!("Failed to start ADB server: {}", stderr)))
    }
}

/// 获取 ADB 版本号
/// Get ADB version string
fn get_adb_version(adb_path: &Path, port: u16) -> Result<String> {
    let output = Command::new(adb_path)
        .args(["-P", &port.to_string(), "version"])
        .output()
        .map_err(|e| AdbError::IoError(e))?;

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        // 解析第一行版本信息
        // Parse first line version info
        Ok(text.lines().next().unwrap_or("unknown").trim().to_string())
    } else {
        Ok("unknown".to_string())
    }
}

/// 获取当前使用的 ADB 命令 (已解析路径 + 端口参数)
/// Get current ADB command (resolved path + port args)
fn get_adb_command() -> PathBuf {
    ADB_PATH.get().cloned().unwrap_or_else(|| {
        // 回退到 PATH 中的 adb
        // Fallback to adb in PATH
        PathBuf::from(if cfg!(target_os = "windows") { "adb.exe" } else { "adb" })
    })
}

/// 获取 ADB 可执行文件路径 (公开方法，供 companion 安装使用)
/// Get ADB executable path (public, used by companion install)
pub fn get_adb_path() -> String {
    get_adb_command().to_string_lossy().to_string()
}

/// 获取当前 ADB 端口
/// Get current ADB port
fn get_adb_port() -> u16 {
    ADB_PORT.get().copied().unwrap_or(DEFAULT_ADB_PORT)
}

/// 获取 ADB 路径信息 (供前端查询)
/// Get ADB path info (for frontend query)
pub fn get_adb_path_info() -> AdbPathInfo {
    let adb_path = get_adb_command();
    let port = get_adb_port();
    let version = get_adb_version(&adb_path, port).unwrap_or_else(|_| "unknown".to_string());
    let path_str = adb_path.to_string_lossy().to_string();
    // 通过路径判断来源 / Determine source from path
    let is_bundled = path_str.contains("resources") && path_str.contains("adb");
    let source = if is_bundled { "bundled" } else { "system" }.to_string();
    AdbPathInfo {
        adb_path: path_str,
        is_bundled,
        port,
        reused_server: false,
        version,
        source,
    }
}

// ========== 安全：路径消毒 ==========
// ========== Security: Path sanitization ==========

/// 验证并转义设备上的文件路径，防止 shell 注入
/// Validate and escape device file paths to prevent shell injection.
/// Rejects paths containing shell metacharacters that could break out of single-quoted strings.
pub fn sanitize_device_path(path: &str) -> Result<String> {
    // 禁止空路径 / Reject empty path
    if path.is_empty() {
        return Err(AdbError::InvalidPath("Path is empty".to_string()));
    }

    // 禁止路径穿越 / Reject path traversal
    if path.contains("..") {
        return Err(AdbError::InvalidPath("Path traversal (..) not allowed".to_string()));
    }

    // 禁止 shell 危险字符 / Reject dangerous shell characters
    // 允许常见文件名字符: 字母、数字、/、.、-、_、空格、中文等 Unicode
    // Allow common filename chars: alphanumeric, /, ., -, _, space, CJK Unicode
    for ch in path.chars() {
        match ch {
            // 允许 / Allow
            'a'..='z' | 'A'..='Z' | '0'..='9' => {}
            '/' | '.' | '-' | '_' | ' ' | '+' | ',' | '=' | '@' | '(' | ')' | '[' | ']' => {}
            // 允许 Unicode (中日韩等) / Allow CJK and other Unicode
            c if c as u32 > 127 => {}
            // 禁止所有其他字符 / Reject all others (;|&$`'"!\{}#<>^~*?)
            other => {
                return Err(AdbError::InvalidPath(
                    format!("Path contains forbidden character: {:?}", other)
                ));
            }
        }
    }

    // 单引号转义 (用于 shell 命令) / Escape single quotes for shell commands
    Ok(path.replace('\'', "'\\''"))
}

// ========== 公共 API ==========
// ========== Public API ==========

/// 检查 ADB 是否可用
/// Check if ADB binary is available
pub fn check_adb() -> Result<bool> {
    let adb_cmd = get_adb_command();
    let port = get_adb_port();
    let output = Command::new(&adb_cmd)
        .args(["-P", &port.to_string(), "version"])
        .output();

    match output {
        Ok(out) => Ok(out.status.success()),
        Err(_) => Ok(false),
    }
}

/// 获取已连接设备列表
/// Get list of connected devices
pub fn get_devices() -> Result<Vec<DeviceBasic>> {
    let output = run_adb_command(&["devices"])?;
    parse_devices(&output)
}

/// 获取指定设备的详细信息
/// Get detailed information about a specific device
pub fn get_device_info(serial: &str) -> Result<DeviceInfo> {
    // 验证设备存在 / Verify device exists
    let devices = get_devices()?;
    if !devices.iter().any(|d| d.serial == serial) {
        return Err(AdbError::DeviceNotFound(serial.to_string()));
    }

    let model = get_prop(serial, "ro.product.model")?;
    let manufacturer = get_prop(serial, "ro.product.manufacturer")?;
    let android_version = get_prop(serial, "ro.build.version.release")?;
    let sdk_version = get_prop(serial, "ro.build.version.sdk")?;

    let battery_output = shell(serial, "dumpsys battery | grep level")?;
    let battery_level = parse_battery_level(&battery_output);

    let (storage_total, storage_used) = get_storage_info(serial)?;

    let display_name = format!("{} {}", manufacturer, model);

    Ok(DeviceInfo {
        serial: serial.to_string(),
        model,
        manufacturer,
        android_version,
        sdk_version,
        battery_level,
        storage_total,
        storage_used,
        display_name,
    })
}

/// 在设备上执行 shell 命令
/// Execute a shell command on the device
pub fn shell(serial: &str, command: &str) -> Result<String> {
    run_adb_command(&["-s", serial, "shell", command])
}

/// 推送文件到设备 (电脑 -> 手机)
/// Push a file from local to device (PC -> phone)
pub fn push(serial: &str, local: &str, remote: &str) -> Result<()> {
    let local_path = Path::new(local);
    if !local_path.exists() {
        return Err(AdbError::InvalidPath(format!("Local path does not exist: {}", local)));
    }

    // 验证本地路径无路径穿越 / Validate local path has no path traversal
    let canonical = local_path.canonicalize()
        .map_err(|e| AdbError::InvalidPath(format!("Cannot resolve local path: {}", e)))?;
    if canonical.to_string_lossy().contains("..") {
        return Err(AdbError::InvalidPath("Local path traversal not allowed".to_string()));
    }

    // 验证远程路径安全 / Validate remote path is safe
    let _ = sanitize_device_path(remote)?;

    let output = run_adb_command(&["-s", serial, "push", local, remote])?;

    if output.contains("error") || output.contains("failed") {
        return Err(AdbError::FileOperationFailed(output));
    }

    Ok(())
}

/// 递归拉取目录 (手机 -> 电脑)
/// Recursively pull a directory from device to local (phone -> PC)
pub fn pull_directory(serial: &str, remote: &str, local: &str) -> Result<()> {
    let _ = sanitize_device_path(remote)?;
    let local_path = Path::new(local);
    if local_path.to_string_lossy().contains("..") {
        return Err(AdbError::InvalidPath("Local path traversal not allowed".to_string()));
    }
    // adb pull supports recursive directory pull natively
    let output = run_adb_command(&["-s", serial, "pull", remote, local])?;
    if output.contains("error") && !output.contains("pulled") {
        return Err(AdbError::FileOperationFailed(output));
    }
    Ok(())
}

/// 从设备拉取文件 (手机 -> 电脑)
/// Pull a file from device to local (phone -> PC)
pub fn pull(serial: &str, remote: &str, local: &str) -> Result<()> {
    // 验证远程路径安全 / Validate remote path is safe
    let _ = sanitize_device_path(remote)?;

    // 验证本地路径无路径穿越 / Validate local path has no path traversal
    if local.contains("..") {
        return Err(AdbError::InvalidPath("Local path traversal not allowed".to_string()));
    }

    let output = run_adb_command(&["-s", serial, "pull", remote, local])?;

    if output.contains("error") || output.contains("failed") {
        return Err(AdbError::FileOperationFailed(output));
    }

    Ok(())
}

/// 列出设备上指定目录的文件 (路径已消毒)
/// List files in a directory on the device (path sanitized)
pub fn list_files(serial: &str, path: &str) -> Result<Vec<FileEntry>> {
    let safe_path = sanitize_device_path(path)?;
    // Trailing slash ensures we list directory contents, not the directory entry itself
    let trailing = if safe_path.ends_with('/') { "" } else { "/" };
    let output = shell(serial, &format!("ls -la '{}{}'", safe_path, trailing))?;
    parse_file_list(&output, path)
}

/// 删除设备上的文件或目录 (路径已消毒)
/// Delete a file or directory on the device (path sanitized)
pub fn delete_path(serial: &str, path: &str) -> Result<()> {
    let safe_path = sanitize_device_path(path)?;
    let output = shell(serial, &format!("rm -rf '{}'", safe_path))?;

    if output.contains("error") || output.contains("failed") || output.contains("No such file") {
        return Err(AdbError::FileOperationFailed(format!("Failed to delete: {}", path)));
    }

    Ok(())
}

/// 在设备上创建目录 (路径已消毒)
/// Create a directory on the device (path sanitized)
pub fn create_dir(serial: &str, path: &str) -> Result<()> {
    let safe_path = sanitize_device_path(path)?;
    let output = shell(serial, &format!("mkdir -p '{}'", safe_path))?;

    if output.contains("error") || output.contains("failed") {
        return Err(AdbError::FileOperationFailed(format!("Failed to create directory: {}", path)));
    }

    Ok(())
}

/// 获取存储信息 (总量, 已用) 单位字节
/// Get storage information (total, used) in bytes
pub fn get_storage_info(serial: &str) -> Result<(u64, u64)> {
    let output = shell(serial, "df /sdcard | tail -n 1")?;
    parse_storage_info(&output)
}

/// 检查设备上的文件或目录是否存在 (路径已消毒)
/// Check if a file or directory exists on the device (path sanitized)
pub fn file_exists(serial: &str, path: &str) -> Result<bool> {
    let safe_path = sanitize_device_path(path)?;
    let output = shell(serial, &format!("[ -e '{}' ] && echo 'exists' || echo 'not_exists'", safe_path))?;
    Ok(output.trim() == "exists")
}

/// 获取设备上文件的 MD5 哈希 (路径已消毒)
/// Get MD5 hash of a file on the device (path sanitized)
pub fn get_file_hash(serial: &str, path: &str) -> Result<String> {
    let safe_path = sanitize_device_path(path)?;
    let output = shell(serial, &format!("md5sum '{}'", safe_path))?;

    if output.contains("No such file") || output.contains("not found") {
        return Err(AdbError::FileOperationFailed(format!("File not found: {}", path)));
    }

    let hash = output.split_whitespace().next()
        .ok_or_else(|| AdbError::ParseError("Failed to parse md5sum output".to_string()))?;

    Ok(hash.to_string())
}

/// 递归推送文件夹到设备
/// Recursively push a folder from local to device
pub fn push_folder(serial: &str, local: &str, remote: &str) -> Result<()> {
    let local_path = Path::new(local);
    if !local_path.exists() {
        return Err(AdbError::InvalidPath(format!("Local path does not exist: {}", local)));
    }
    if !local_path.is_dir() {
        return Err(AdbError::InvalidPath(format!("Local path is not a directory: {}", local)));
    }

    create_dir(serial, remote)?;

    let output = run_adb_command(&["-s", serial, "push", local, remote])?;

    if output.contains("error") || output.contains("failed") {
        return Err(AdbError::FileOperationFailed(output));
    }

    Ok(())
}

// ========== 设备监控 ==========
// ========== Device monitor ==========

/// 设备连接/断开事件监控器
/// Device connect/disconnect event monitor
pub struct DeviceMonitor {
    running: Arc<AtomicBool>,
    known_devices: Arc<Mutex<HashSet<String>>>,
}

impl DeviceMonitor {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            known_devices: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// 在后台线程中开始监控设备
    /// Start monitoring devices in a background thread
    pub fn start(&self, tx: Sender<DeviceEvent>) {
        if self.running.load(Ordering::SeqCst) {
            return;
        }

        self.running.store(true, Ordering::SeqCst);

        let running = Arc::clone(&self.running);
        let known_devices = Arc::clone(&self.known_devices);

        std::thread::spawn(move || {
            while running.load(Ordering::SeqCst) {
                if let Err(e) = Self::check_devices(&known_devices, &tx) {
                    eprintln!("Device monitor error: {}", e);
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        });
    }

    /// 停止监控
    /// Stop monitoring
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    fn check_devices(
        known_devices: &Arc<Mutex<HashSet<String>>>,
        tx: &Sender<DeviceEvent>,
    ) -> Result<()> {
        let current_devices = get_devices()?;
        let current_serials: HashSet<String> = current_devices
            .iter()
            .filter(|d| d.state == "device")
            .map(|d| d.serial.clone())
            .collect();

        let mut known = known_devices.lock().unwrap();

        // 检测新连接的设备 / Check for newly connected devices
        for serial in current_serials.iter() {
            if !known.contains(serial) {
                if let Ok(info) = get_device_info(serial) {
                    let _ = tx.send(DeviceEvent::Connected(info));
                }
            }
        }

        // 检测已断开的设备 / Check for disconnected devices
        let disconnected: Vec<String> = known
            .iter()
            .filter(|serial| !current_serials.contains(*serial))
            .cloned()
            .collect();

        for serial in disconnected {
            let _ = tx.send(DeviceEvent::Disconnected(serial.clone()));
            known.remove(&serial);
        }

        *known = current_serials;

        Ok(())
    }
}

impl Default for DeviceMonitor {
    fn default() -> Self {
        Self::new()
    }
}

// ========== 内部辅助函数 ==========
// ========== Internal helper functions ==========

/// 执行 ADB 命令 (自动带端口参数)
/// Run ADB command (automatically includes port argument)
fn run_adb_command(args: &[&str]) -> Result<String> {
    let adb_cmd = get_adb_command();
    let port = get_adb_port().to_string();

    let output = Command::new(&adb_cmd)
        .arg("-P").arg(&port)
        .args(args)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AdbError::AdbNotFound
            } else {
                AdbError::IoError(e)
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AdbError::CommandFailed(stderr.to_string()));
    }

    Ok(String::from_utf8(output.stdout)?)
}

fn parse_devices(output: &str) -> Result<Vec<DeviceBasic>> {
    let mut devices = Vec::new();

    for line in output.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            devices.push(DeviceBasic {
                serial: parts[0].to_string(),
                state: parts[1].to_string(),
            });
        }
    }

    Ok(devices)
}

fn get_prop(serial: &str, prop_name: &str) -> Result<String> {
    let output = shell(serial, &format!("getprop {}", prop_name))?;
    Ok(output.trim().to_string())
}

fn parse_battery_level(output: &str) -> i32 {
    for line in output.lines() {
        if line.contains("level:") {
            if let Some(level_str) = line.split(':').nth(1) {
                if let Ok(level) = level_str.trim().parse::<i32>() {
                    return level;
                }
            }
        }
    }
    -1
}

fn parse_storage_info(output: &str) -> Result<(u64, u64)> {
    let parts: Vec<&str> = output.split_whitespace().collect();

    if parts.len() < 6 {
        return Err(AdbError::ParseError("Invalid df output".to_string()));
    }

    let total_kb = parts[1].parse::<u64>()
        .map_err(|_| AdbError::ParseError("Failed to parse total storage".to_string()))?;
    let used_kb = parts[2].parse::<u64>()
        .map_err(|_| AdbError::ParseError("Failed to parse used storage".to_string()))?;

    Ok((total_kb * 1024, used_kb * 1024))
}

fn parse_file_list(output: &str, base_path: &str) -> Result<Vec<FileEntry>> {
    let mut entries = Vec::new();
    // Android ls -la format varies across versions. Common formats:
    //   drwxrwx--x  5 root sdcard_rw      4096 2024-01-15 10:30 Download
    //   -rw-rw----  1 root sdcard_rw     12345 2024-01-15 10:30 photo.jpg
    //   drwxrwx--x  5 root     sdcard_rw      4096 2024-01-15 10:30 Download
    // Strategy: find the date pattern (YYYY-MM-DD) to anchor column positions,
    // then extract size (before date), time (after date), and name (after time).
    let date_re = Regex::new(r"\d{4}-\d{2}-\d{2}").unwrap();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("total") {
            continue;
        }

        let permissions = match line.split_whitespace().next() {
            Some(p) if p.len() >= 9 && (p.starts_with('-') || p.starts_with('d') || p.starts_with('l') || p.starts_with('c') || p.starts_with('b') || p.starts_with('s') || p.starts_with('p')) => p,
            _ => continue,
        };

        // Find date pattern position to anchor parsing
        let date_match = match date_re.find(line) {
            Some(m) => m,
            None => continue,
        };

        let before_date = &line[..date_match.start()].trim_end();
        let after_date = &line[date_match.end()..];

        // Size is the last whitespace-separated token before the date
        let size = before_date
            .split_whitespace()
            .last()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);

        // Time is right after the date (e.g. " 10:30")
        let after_date_trimmed = after_date.trim_start();
        let (modified, name_part) = if let Some(space_pos) = after_date_trimmed.find(' ') {
            let time = &after_date_trimmed[..space_pos];
            let name = after_date_trimmed[space_pos..].trim_start();
            (format!("{} {}", date_match.as_str(), time), name.to_string())
        } else {
            // No time found, just date
            (date_match.as_str().to_string(), after_date_trimmed.to_string())
        };

        // Handle symlinks: "name -> target"
        let name = if permissions.starts_with('l') {
            name_part.split(" -> ").next().unwrap_or(&name_part).to_string()
        } else {
            name_part
        };

        if name.is_empty() || name == "." || name == ".." {
            continue;
        }

        let file_type = match permissions.chars().next() {
            Some('d') => "directory",
            Some('l') => "link",
            _ => "file",
        };

        let path = if base_path.ends_with('/') {
            format!("{}{}", base_path, name)
        } else {
            format!("{}/{}", base_path, name)
        };

        entries.push(FileEntry {
            name,
            path,
            file_type: file_type.to_string(),
            size,
            modified,
            permissions: permissions.to_string(),
        });
    }

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_devices() {
        let output = "List of devices attached\nABCD1234\tdevice\nEFGH5678\toffline\n";
        let devices = parse_devices(output).unwrap();

        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].serial, "ABCD1234");
        assert_eq!(devices[0].state, "device");
        assert_eq!(devices[1].serial, "EFGH5678");
        assert_eq!(devices[1].state, "offline");
    }

    #[test]
    fn test_parse_battery_level() {
        let output = "  level: 85";
        let level = parse_battery_level(output);
        assert_eq!(level, 85);
    }

    #[test]
    fn test_parse_storage_info() {
        let output = "/dev/block/dm-0  12345678  8901234  3444444  73% /data";
        let (total, used) = parse_storage_info(output).unwrap();
        assert_eq!(total, 12345678 * 1024);
        assert_eq!(used, 8901234 * 1024);
    }
}
