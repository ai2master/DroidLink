use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::adb;

#[derive(Error, Debug)]
pub enum ClipboardError {
    #[error("ADB error: {0}")]
    Adb(#[from] adb::AdbError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Encoding error: {0}")]
    Encoding(String),
    #[error("Content too large: {0} bytes (max {1} bytes)")]
    TooLarge(usize, usize),
    #[error("Failed to read clipboard from device")]
    ReadFailed,
}

pub type ClipResult<T> = Result<T, ClipboardError>;

/// Length limits for transfer methods (all pure ADB over USB, no TCP):
///
/// | Method                    | Max Length  | Unicode Support | Notes                         |
/// |---------------------------|------------|-----------------|-------------------------------|
/// | am broadcast intent extra | ~100 KB    | Via base64      | Binder transaction limit      |
/// | File-based (adb push)     | ~10 MB     | Full UTF-8      | Temp file on device           |
///
/// Strategy:
/// 1. For text <= 100KB: use am broadcast with base64 encoding
/// 2. For text > 100KB: use file-based transfer (adb push temp file + broadcast to read it)
///
/// All communication is pure ADB over USB. No TCP, no HTTP, no adb forward.
const DEFAULT_MAX_CLIPBOARD_SIZE: usize = 10 * 1024 * 1024; // 10 MB
const BROADCAST_MAX_SIZE: usize = 100 * 1024; // 100 KB - safe limit for intent extras
const TEMP_CLIPBOARD_PATH: &str = "/data/local/tmp/.droidlink_clipboard";
const TEMP_CLIPBOARD_OUT_PATH: &str = "/data/local/tmp/.droidlink_clipboard_out";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardContent {
    pub text: String,
    pub source: String,
    pub timestamp: String,
    pub length: usize,
    pub byte_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardInfo {
    pub max_size: usize,
    pub method: String, // "broadcast" or "file_transfer"
    pub companion_installed: bool,
}

/// Manual clipboard bridge between desktop and Android device over pure ADB USB.
///
/// This is NOT automatic - the user manually triggers send/receive operations.
/// Supports full Unicode including Chinese, Japanese, Korean, emoji etc.
/// All communication goes through `adb shell` and `adb push/pull` - zero TCP.
pub struct ClipboardBridge {
    max_size: usize,
}

impl ClipboardBridge {
    pub fn new() -> Self {
        Self {
            max_size: DEFAULT_MAX_CLIPBOARD_SIZE,
        }
    }

    /// Check if companion app is installed on device (pure ADB, no TCP)
    pub fn check_companion_installed(&self, serial: &str) -> bool {
        match adb::shell(serial, "pm list packages com.droidlink.companion 2>/dev/null") {
            Ok(output) => output.contains("com.droidlink.companion"),
            Err(_) => false,
        }
    }

    /// Get info about available transfer methods and limits
    pub fn get_info(&self, serial: &str) -> ClipboardInfo {
        let companion = self.check_companion_installed(serial);
        ClipboardInfo {
            max_size: self.max_size,
            method: "file_transfer".to_string(),
            companion_installed: companion,
        }
    }

    // ========================
    // Desktop -> Device (Send)
    // ========================

    /// Send clipboard content from desktop to device (manual operation).
    /// Supports full Unicode/Chinese and long text.
    /// All communication is pure ADB over USB.
    ///
    /// Multi-tier approach:
    /// Tier 1: Activity-based SET (most reliable, works on all Android versions)
    /// Tier 2: Broadcast with base64 (for small text <=100KB, faster but less reliable)
    /// Tier 3: File-based broadcast transfer
    ///
    /// 优先使用 Activity 方式，因为广播在以下情况下会静默失败:
    /// - 应用被强制停止
    /// - Android 10+ 后台限制
    /// - SELinux 策略阻止
    /// Prefer Activity method because broadcasts silently fail when:
    /// - App is force-stopped
    /// - Android 10+ background restrictions
    /// - SELinux policy blocks delivery
    pub fn send_to_device(&self, serial: &str, content: &str) -> ClipResult<String> {
        let byte_size = content.len();
        if byte_size > self.max_size {
            return Err(ClipboardError::TooLarge(byte_size, self.max_size));
        }

        if byte_size == 0 {
            return Err(ClipboardError::Encoding("Empty content".into()));
        }

        log::info!(
            "Sending clipboard to device: {} chars, {} bytes",
            content.chars().count(),
            byte_size
        );

        // Tier 1: Activity-based SET (最可靠 / most reliable)
        // am start 可以启动被强制停止的应用，不受后台限制
        // am start can launch force-stopped apps, not affected by background restrictions
        match send_via_activity(serial, content) {
            Ok(()) => {
                log::info!("Clipboard sent via Activity (most reliable method)");
                return Ok("activity".to_string());
            }
            Err(e) => {
                log::debug!("Activity method failed: {}, trying broadcast", e);
            }
        }

        // Tier 2: For small content, try broadcast with base64 (faster)
        if byte_size <= BROADCAST_MAX_SIZE {
            match send_via_broadcast(serial, content) {
                Ok(()) => {
                    log::info!("Clipboard sent via broadcast");
                    return Ok("broadcast".to_string());
                }
                Err(e) => {
                    log::debug!("Broadcast method failed: {}, trying file transfer", e);
                }
            }
        }

        // Tier 3: File-based transfer (for large content or when others fail)
        send_via_file_transfer(serial, content)?;
        log::info!("Clipboard sent via file transfer");
        Ok("file_transfer".to_string())
    }

    // ========================
    // Device -> Desktop (Receive)
    // ========================

    /// Get current clipboard content from device (manual operation).
    /// All communication is pure ADB over USB.
    ///
    /// Multi-tier approach (同 send 一样优先使用 Activity / same as send, prefer Activity):
    /// Tier 1: Activity-based GET (most reliable, works on Android 10+)
    /// Tier 2: Broadcast + file (works on Android <10)
    /// Tier 3: Direct Binder call (unreliable, last resort)
    ///
    /// 不再优先使用 Binder 调用，因为:
    /// - service call clipboard 的事务码在不同 Android 版本不一致
    /// - 错误响应的 Parcel 会被解析为乱码
    /// - Android 10+ 后台限制
    /// No longer prefer Binder call because:
    /// - service call clipboard transaction codes vary across Android versions
    /// - Error Parcel responses get parsed as garbled text
    /// - Android 10+ background restrictions
    pub fn get_from_device(&self, serial: &str) -> ClipResult<(String, String)> {
        log::info!("Getting clipboard from device");

        // Tier 1: Activity-based GET (最可靠 / most reliable)
        // Activity 在前台运行，不受 Android 10+ 剪贴板后台限制
        // Activity runs in foreground, not affected by Android 10+ clipboard bg restrictions
        match receive_via_activity(serial) {
            Ok(content) => {
                if content == "CLIPBOARD_ACCESS_DENIED" {
                    log::warn!("Activity returned CLIPBOARD_ACCESS_DENIED, trying other methods");
                } else if !content.is_empty() {
                    log::info!("Clipboard received via Activity: {} bytes", content.len());
                    return Ok((content, "activity".to_string()));
                }
            }
            Err(e) => {
                log::debug!("Activity method failed: {}, trying broadcast", e);
            }
        }

        // Tier 2: Broadcast + file (works on older Android versions)
        match receive_via_broadcast(serial) {
            Ok(content) => {
                if content == "CLIPBOARD_ACCESS_DENIED" {
                    log::warn!("Broadcast method blocked by Android 10+ restrictions");
                } else if !content.is_empty() {
                    log::info!("Clipboard received via broadcast: {} bytes", content.len());
                    return Ok((content, "broadcast".to_string()));
                }
            }
            Err(e) => {
                log::debug!("Broadcast method failed: {}", e);
            }
        }

        // Tier 3: Direct Binder call (last resort, unreliable across Android versions)
        if let Ok(content) = receive_via_binder(serial) {
            if !content.is_empty() {
                log::info!("Clipboard received via Binder call: {} bytes", content.len());
                return Ok((content, "binder".to_string()));
            }
        }

        Err(ClipboardError::ReadFailed)
    }
}

// ========================
// Tier 1: Direct Binder Call (fastest, no companion needed)
// ========================

/// Try to read clipboard via direct Binder call.
/// This uses the shell UID privileges to call the clipboard service directly.
///
/// 警告: 此方法不可靠! Binder 事务码在不同 Android 版本上不同。
/// WARNING: This method is unreliable! Binder transaction codes differ across Android versions.
/// 已知问题: 某些设备上 code 2 不是 getPrimaryClip 而是 setPrimaryClipAsPackage。
/// Known issue: On some devices, code 2 is setPrimaryClipAsPackage instead of getPrimaryClip.
fn receive_via_binder(serial: &str) -> ClipResult<String> {
    // 先查询 Android API 版本，选择可能正确的事务码
    // Query Android API level first to select likely correct transaction code
    let api_str = adb::shell(serial, "getprop ro.build.version.sdk 2>/dev/null")
        .unwrap_or_default();
    let api_level: u32 = api_str.trim().parse().unwrap_or(0);

    // 根据 API 级别选择事务码 / Select transaction code based on API level
    // AIDL 接口的事务码在不同版本可能不同，这里使用最常见的:
    // - Android 10 (API 29) 之前: code 1 = getPrimaryClip
    // - Android 10+ (API 29+): code 2 在某些 OEM 上可能是 setPrimaryClip
    // 为安全起见，尝试多个 code 并验证结果
    let transaction_codes = if api_level >= 29 { vec![1, 2] } else { vec![2, 1] };

    for code in transaction_codes {
        let cmd = format!(
            "service call clipboard {} s16 com.android.shell 2>/dev/null",
            code
        );
        let output = match adb::shell(serial, &cmd) {
            Ok(o) => o,
            Err(_) => continue,
        };

        // 检查是否有错误响应 / Check for error responses
        if !output.contains("Result: Parcel") {
            continue;
        }

        // 检查 Parcel 是否为错误/异常 / Check if Parcel is an error/exception
        // 错误 Parcel 通常只有 1-2 行 hex 数据且第一个值是 ffffffff (error flag)
        // Error Parcels typically have 1-2 hex lines with first value ffffffff
        let hex_lines: Vec<&str> = output.lines()
            .filter(|l| l.trim().starts_with("0x"))
            .collect();

        if hex_lines.is_empty() {
            continue;
        }

        // 检查第一个 hex 值是否为错误标志 / Check first hex value for error flag
        if let Some(first_line) = hex_lines.first() {
            if let Some(hex_part) = first_line.split(':').nth(1) {
                let first_hex = hex_part.split_whitespace().next().unwrap_or("");
                // ffffffff = error response, 只有很少数据 = 空剪贴板
                // ffffffff = error response, very few data = empty clipboard
                if first_hex == "ffffffff" || (hex_lines.len() <= 1 && first_hex == "00000000") {
                    log::debug!("Binder code {} returned error/empty parcel", code);
                    continue;
                }
            }
        }

        // 解析 hex 数据为 UTF-16 / Parse hex data to UTF-16
        let mut text_chars = Vec::new();
        let mut is_first_word = true;
        for line in &hex_lines {
            if let Some(hex_part) = line.split(':').nth(1) {
                let hex_data = if let Some(ascii_start) = hex_part.find('\'') {
                    &hex_part[..ascii_start]
                } else {
                    hex_part
                };

                for hex_value in hex_data.split_whitespace() {
                    if hex_value.len() == 8 {
                        // 跳过 Parcel 头部（第一个 word 是状态码）
                        // Skip Parcel header (first word is status code)
                        if is_first_word {
                            is_first_word = false;
                            continue;
                        }

                        if let Ok(val) = u32::from_str_radix(hex_value, 16) {
                            let b0 = (val & 0xFF) as u8;
                            let b1 = ((val >> 8) & 0xFF) as u8;
                            let b2 = ((val >> 16) & 0xFF) as u8;
                            let b3 = ((val >> 24) & 0xFF) as u8;

                            if b1 != 0 || b0 != 0 {
                                let c1 = u16::from_le_bytes([b0, b1]);
                                if c1 != 0 { text_chars.push(c1); }
                            }
                            if b3 != 0 || b2 != 0 {
                                let c2 = u16::from_le_bytes([b2, b3]);
                                if c2 != 0 { text_chars.push(c2); }
                            }
                        }
                    }
                }
            }
        }

        let text = String::from_utf16_lossy(&text_chars);
        let cleaned = text.trim_start_matches(|c: char| c.is_control() && c != '\n' && c != '\r' && c != '\t')
                          .trim_end_matches('\0')
                          .to_string();

        if cleaned.is_empty() {
            continue;
        }

        // 验证结果看起来像正常文本而不是乱码 / Validate result looks like normal text, not garbled
        // 如果超过 30% 是替换字符 (U+FFFD)，说明是解析错误
        // If >30% are replacement chars (U+FFFD), it's a parsing error
        let replacement_count = cleaned.chars().filter(|&c| c == '\u{FFFD}').count();
        let total_chars = cleaned.chars().count();
        if total_chars > 0 && replacement_count as f64 / total_chars as f64 > 0.3 {
            log::warn!("Binder code {} returned garbled data ({}% replacement chars), skipping",
                code, replacement_count * 100 / total_chars);
            continue;
        }

        // 检查是否包含 Java 异常堆栈 / Check for Java exception stack trace
        if cleaned.contains("Exception") || cleaned.contains("at com.android") || cleaned.contains("at android.os") {
            log::warn!("Binder code {} returned exception data, skipping", code);
            continue;
        }

        log::info!("Binder code {} succeeded: {} chars", code, cleaned.len());
        return Ok(cleaned);
    }

    Err(ClipboardError::ReadFailed)
}

// ========================
// Tier 2: Broadcast Methods (works on Android <10)
// All through `adb shell`, no TCP
// ========================

fn send_via_broadcast(serial: &str, content: &str) -> ClipResult<()> {
    let encoded = base64_encode(content.as_bytes());

    if encoded.len() > 500_000 {
        return Err(ClipboardError::TooLarge(encoded.len(), 500_000));
    }

    let cmd = format!(
        "am broadcast -a com.droidlink.SET_CLIPBOARD \
         --es content_b64 '{}' \
         -n com.droidlink.companion/.clipboard.ClipboardReceiver",
        encoded
    );
    let output = adb::shell(serial, &cmd)?;

    // 验证广播是否被接收 / Verify broadcast was actually received
    // 成功时输出: "Broadcast completed: result=0"
    // 失败时: "Error" 或无 "Broadcast completed"
    if !output.contains("Broadcast completed") {
        log::warn!("Broadcast not delivered: {}", output.trim());
        return Err(ClipboardError::Encoding(
            "Broadcast not delivered - companion app may not be running".into()
        ));
    }
    if output.contains("result=-1") || output.contains("Error") {
        log::warn!("Broadcast delivery error: {}", output.trim());
        return Err(ClipboardError::Encoding(
            "Broadcast delivery failed".into()
        ));
    }

    Ok(())
}

fn receive_via_broadcast(serial: &str) -> ClipResult<String> {
    let cmd = "am broadcast -a com.droidlink.GET_CLIPBOARD \
               --es output_path /data/local/tmp/.droidlink_clipboard_out \
               -n com.droidlink.companion/.clipboard.ClipboardReceiver";
    let output = adb::shell(serial, cmd)?;

    // 验证广播送达 / Verify broadcast delivered
    if !output.contains("Broadcast completed") || output.contains("Error") {
        log::warn!("GET_CLIPBOARD broadcast not delivered: {}", output.trim());
        return Err(ClipboardError::ReadFailed);
    }

    std::thread::sleep(std::time::Duration::from_millis(300));

    // Read the output file directly via adb shell cat (pure ADB)
    let content = adb::shell(serial, "cat /data/local/tmp/.droidlink_clipboard_out 2>/dev/null")?;
    let _ = adb::shell(serial, "rm -f /data/local/tmp/.droidlink_clipboard_out 2>/dev/null");

    // Check for Android 10+ access denied marker
    // If present, the BroadcastReceiver couldn't read clipboard (background restriction)
    Ok(content.trim().to_string())
}

// ========================
// Tier 3: Activity-based Method (works on Android 10+)
// ========================

/// Receive clipboard via transparent Activity (Android 10+ workaround).
/// BroadcastReceivers can't read clipboard on Android 10+ when in background.
/// Activities can read clipboard when in foreground (even briefly).
fn receive_via_activity(serial: &str) -> ClipResult<String> {
    let output_path = "/data/local/tmp/.droidlink_clipboard_out";

    // Clean up any existing output file
    let _ = adb::shell(serial, &format!("rm -f '{}' 2>/dev/null", output_path));

    // Launch the transparent ClipboardActivity with GET action
    let cmd = format!(
        "am start -n com.droidlink.companion/.clipboard.ClipboardActivity \
         --es action GET \
         --es output_path '{}' \
         2>/dev/null",
        output_path
    );
    adb::shell(serial, &cmd)?;

    // Wait for the Activity to launch, read clipboard, write file, and finish
    // The Activity finishes immediately after writing the file
    std::thread::sleep(std::time::Duration::from_millis(500));

    // Read the output file
    let content = adb::shell(serial, &format!("cat '{}' 2>/dev/null", output_path))?;
    let _ = adb::shell(serial, &format!("rm -f '{}' 2>/dev/null", output_path));

    Ok(content.trim().to_string())
}

// ========================
// File-based Transfer for SET operations (any size, most reliable, pure ADB)
// ========================

fn send_via_file_transfer(serial: &str, content: &str) -> ClipResult<()> {
    let temp_dir = std::env::temp_dir();
    // 使用唯一文件名防止竞争条件 / Use unique filename to prevent race conditions
    let unique_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let local_temp = temp_dir.join(format!(".droidlink_clip_send_{}", unique_id));
    std::fs::write(&local_temp, content.as_bytes())?;

    // Push to device via adb push (pure USB transfer)
    adb::push(serial, &local_temp.to_string_lossy(), TEMP_CLIPBOARD_PATH)?;

    // Tell companion app to read from the file and set clipboard
    let cmd = format!(
        "am broadcast -a com.droidlink.SET_CLIPBOARD_FILE \
         --es file_path '{}' \
         -n com.droidlink.companion/.clipboard.ClipboardReceiver",
        TEMP_CLIPBOARD_PATH
    );
    let output = adb::shell(serial, &cmd)?;

    let _ = std::fs::remove_file(&local_temp);

    // 验证广播结果 / Verify broadcast result
    if !output.contains("Broadcast completed") || output.contains("Error") {
        log::warn!("File transfer broadcast not delivered: {}", output.trim());
        return Err(ClipboardError::Encoding(
            "File transfer broadcast not delivered".into()
        ));
    }

    Ok(())
}

fn receive_via_file_transfer(serial: &str) -> ClipResult<String> {
    let cmd = format!(
        "am broadcast -a com.droidlink.GET_CLIPBOARD_FILE \
         --es file_path '{}' \
         -n com.droidlink.companion/.clipboard.ClipboardReceiver 2>/dev/null",
        TEMP_CLIPBOARD_OUT_PATH
    );
    adb::shell(serial, &cmd)?;

    std::thread::sleep(std::time::Duration::from_millis(300));

    // Pull the file from device via adb pull (pure USB transfer)
    let temp_dir = std::env::temp_dir();
    // 使用唯一文件名防止竞争条件 / Use unique filename to prevent race conditions
    let unique_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let local_temp = temp_dir.join(format!(".droidlink_clip_recv_{}", unique_id));
    adb::pull(serial, TEMP_CLIPBOARD_OUT_PATH, &local_temp.to_string_lossy())?;

    let content = std::fs::read_to_string(&local_temp)?;

    let _ = std::fs::remove_file(&local_temp);
    let _ = adb::shell(serial, &format!("rm -f '{}' 2>/dev/null", TEMP_CLIPBOARD_OUT_PATH));

    Ok(content)
}

/// Send clipboard via transparent Activity (最可靠的方法 / most reliable method).
/// am start 可以启动被强制停止的应用，Activity 在前台运行不受后台限制。
/// am start can launch force-stopped apps, Activity runs in foreground without restrictions.
fn send_via_activity(serial: &str, content: &str) -> ClipResult<()> {
    let temp_dir = std::env::temp_dir();
    // 使用唯一文件名防止竞争条件 / Use unique filename to prevent race conditions
    let unique_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let local_temp = temp_dir.join(format!(".droidlink_clip_act_{}", unique_id));
    std::fs::write(&local_temp, content.as_bytes())?;

    // Push to device via adb push (pure USB transfer)
    adb::push(serial, &local_temp.to_string_lossy(), TEMP_CLIPBOARD_PATH)?;

    // Launch the transparent ClipboardActivity with SET action
    let cmd = format!(
        "am start -n com.droidlink.companion/.clipboard.ClipboardActivity \
         --es action SET \
         --es input_path '{}'",
        TEMP_CLIPBOARD_PATH
    );
    let output = adb::shell(serial, &cmd)?;

    // 验证 Activity 启动成功 / Verify Activity started successfully
    // 成功时: "Starting: Intent { ... }"
    // 失败时: "Error" 或 "does not exist" 等
    if output.contains("Error") || output.contains("does not exist") {
        log::warn!("Activity launch failed: {}", output.trim());
        let _ = std::fs::remove_file(&local_temp);
        return Err(ClipboardError::Encoding(
            "Failed to launch ClipboardActivity - companion app may not be installed".into()
        ));
    }

    // Wait for the Activity to launch, read file, set clipboard, and finish
    // Activity 启动、读文件、设剪贴板、关闭需要一点时间
    std::thread::sleep(std::time::Duration::from_millis(800));

    let _ = std::fs::remove_file(&local_temp);
    let _ = adb::shell(serial, &format!("rm -f '{}' 2>/dev/null", TEMP_CLIPBOARD_PATH));

    Ok(())
}

// ========================
// Base64 Utilities
// ========================

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}
