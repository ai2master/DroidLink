// scrcpy 屏幕投射管理模块 - 投射控制、触摸传递、输入法
// scrcpy screen mirroring module - mirroring control, touch passthrough, input methods

use std::collections::HashMap;
use std::process::{Child, Command};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ScrcpyError {
    #[error("scrcpy not found in PATH. Please install scrcpy.")]
    NotFound,
    #[error("Failed to start scrcpy: {0}")]
    StartFailed(String),
    #[error("scrcpy process error: {0}")]
    ProcessError(#[from] std::io::Error),
    #[error("scrcpy already running for device {0}")]
    AlreadyRunning(String),
}

pub type ScrcpyResult<T> = Result<T, ScrcpyError>;

/// 输入模式 / Input mode
/// - DroidLinkIME: 使用 DroidLink 输入法发送完整文本 (适合中日韩等 CJK 输入)
///   Uses DroidLink IME to send full text (suitable for CJK input)
/// - KeyboardPassthrough: 传递原始按键事件，相当于实体键盘 (使用手机自带输入法)
///   Passes raw key events like a physical keyboard (uses phone's native IME)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum InputMode {
    DroidLinkIME,
    KeyboardPassthrough,
}

impl Default for InputMode {
    fn default() -> Self { InputMode::DroidLinkIME }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrcpyOptions {
    pub max_size: u32,         // 最大分辨率 (0=不限) / Max dimension (0=no limit)
    pub bit_rate: u32,         // 视频码率 bps / Video bit rate in bps
    pub max_fps: u32,          // 最大帧率 (0=不限) / Max FPS (0=no limit)
    pub borderless: bool,      // 无边框窗口 / Borderless window
    pub always_on_top: bool,   // 窗口置顶 / Keep window on top
    pub fullscreen: bool,      // 全屏启动 / Start in fullscreen
    pub no_audio: bool,        // 禁用音频转发 / Disable audio forwarding
    pub show_touches: bool,    // 显示触摸点 / Show touches on device
    pub stay_awake: bool,      // 保持唤醒 / Keep device awake
    pub turn_screen_off: bool, // 关闭设备屏幕 / Turn off device screen
    pub no_control: bool,      // 仅查看模式 / View only (no control)
    pub record_file: Option<String>, // 录制文件路径 / Record to file
    pub window_title: Option<String>,
    pub crop: Option<String>,  // 裁剪 "width:height:x:y" / Crop format
    pub display_id: Option<u32>,
    pub rotation: Option<u32>, // 旋转 0/1/2/3

    // ========== 触摸屏传递选项 ==========
    // ========== Touch screen passthrough options ==========
    //
    // scrcpy 2.x 原生支持将桌面触摸事件转发为 Android 多点触控。
    // 当桌面有触摸屏时，在 scrcpy 窗口上的触摸操作会自动映射到手机。
    //
    // scrcpy 2.x natively forwards desktop touch events as Android multi-touch.
    // When the desktop has a touchscreen, touches on the scrcpy window are
    // automatically mapped to the phone.

    /// 转发所有鼠标/触摸点击 (包括中键和右键)
    /// Forward all mouse/touch clicks (including middle and right clicks)
    pub forward_all_clicks: bool,

    /// 禁用鼠标悬停事件 (纯触摸屏模式下建议开启)
    /// Disable mouse hover events (recommended for pure touch screen mode)
    pub no_mouse_hover: bool,

    /// OTG 模式: 将桌面作为 Android 的 USB HID 设备 (不需要 adb 调试授权)
    /// OTG mode: desktop acts as USB HID device for Android (no adb auth needed)
    /// 注意: OTG 模式下触摸直接通过 USB HID 传递，延迟最低
    /// Note: In OTG mode, touch is passed through USB HID directly with lowest latency
    pub otg_mode: bool,

    /// 触摸屏专用: 将触摸事件映射为 Android 触摸 (而非鼠标点击)
    /// Touch screen only: map touch events to Android touch (not mouse clicks)
    /// scrcpy 2.x 中 --prefer-text 或 uhid 可改善触摸体验
    /// In scrcpy 2.x, --prefer-text or uhid can improve touch experience
    pub prefer_text: bool,
}

impl Default for ScrcpyOptions {
    fn default() -> Self {
        Self {
            max_size: 1920,
            bit_rate: 8_000_000,
            max_fps: 0,
            borderless: false,
            always_on_top: false,
            fullscreen: false,
            no_audio: false,
            show_touches: false,
            stay_awake: true,
            turn_screen_off: false,
            no_control: false,
            record_file: None,
            window_title: None,
            crop: None,
            display_id: None,
            rotation: None,
            // 触摸相关默认值 / Touch defaults
            forward_all_clicks: true,
            no_mouse_hover: false,
            otg_mode: false,
            prefer_text: false,
        }
    }
}

struct ScrcpyInstance {
    child: Child,
    serial: String,
    options: ScrcpyOptions,
}

pub struct ScrcpyManager {
    instances: Arc<Mutex<HashMap<String, ScrcpyInstance>>>,
}

impl ScrcpyManager {
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 检查 scrcpy 是否可用
    /// Check if scrcpy is installed and available
    pub fn check_available() -> ScrcpyResult<String> {
        let output = Command::new(scrcpy_binary())
            .arg("--version")
            .output()
            .map_err(|_| ScrcpyError::NotFound)?;

        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(version)
        } else {
            Err(ScrcpyError::NotFound)
        }
    }

    /// 启动 scrcpy 投射
    /// Start scrcpy mirroring for a specific device
    pub fn start(&self, serial: &str, options: Option<ScrcpyOptions>) -> ScrcpyResult<()> {
        let mut instances = self.instances.lock();

        if instances.contains_key(serial) {
            return Err(ScrcpyError::AlreadyRunning(serial.to_string()));
        }

        let opts = options.unwrap_or_default();
        let mut cmd = Command::new(scrcpy_binary());

        // 设备选择 (仅 USB) / Device selection (USB only)
        cmd.arg("-s").arg(serial);

        // 视频选项 / Video options
        if opts.max_size > 0 {
            cmd.arg("--max-size").arg(opts.max_size.to_string());
        }
        if opts.bit_rate > 0 {
            cmd.arg("--video-bit-rate").arg(format!("{}M", opts.bit_rate / 1_000_000));
        }
        if opts.max_fps > 0 {
            cmd.arg("--max-fps").arg(opts.max_fps.to_string());
        }

        // 窗口选项 / Window options
        if opts.borderless {
            cmd.arg("--window-borderless");
        }
        if opts.always_on_top {
            cmd.arg("--always-on-top");
        }
        if opts.fullscreen {
            cmd.arg("--fullscreen");
        }

        // 行为选项 / Behavior options
        if opts.no_audio {
            cmd.arg("--no-audio");
        }
        if opts.show_touches {
            cmd.arg("--show-touches");
        }
        if opts.stay_awake {
            cmd.arg("--stay-awake");
        }
        if opts.turn_screen_off {
            cmd.arg("--turn-screen-off");
        }
        if opts.no_control {
            cmd.arg("--no-control");
        }

        // ========== 触摸屏传递选项 ==========
        // ========== Touch screen passthrough options ==========
        if opts.forward_all_clicks {
            cmd.arg("--forward-all-clicks");
        }
        if opts.no_mouse_hover {
            cmd.arg("--no-mouse-hover");
        }
        if opts.otg_mode {
            // OTG 模式: 纯 USB HID 输入，不投射屏幕
            // OTG mode: pure USB HID input, no screen mirroring
            cmd.arg("--otg");
        }
        if opts.prefer_text {
            cmd.arg("--prefer-text");
        }

        // 可选设置 / Optional settings
        if let Some(ref file) = opts.record_file {
            cmd.arg("--record").arg(file);
        }
        if let Some(ref title) = opts.window_title {
            cmd.arg("--window-title").arg(title);
        } else {
            cmd.arg("--window-title").arg(format!("DroidLink - {}", serial));
        }
        if let Some(ref crop) = opts.crop {
            cmd.arg("--crop").arg(crop);
        }
        if let Some(display) = opts.display_id {
            cmd.arg("--display-id").arg(display.to_string());
        }
        if let Some(rot) = opts.rotation {
            cmd.arg("--rotation").arg(rot.to_string());
        }

        let child = cmd
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;

        log::info!("scrcpy 已启动 / scrcpy started for device {} (PID: {})", serial, child.id());

        instances.insert(
            serial.to_string(),
            ScrcpyInstance {
                child,
                serial: serial.to_string(),
                options: opts,
            },
        );

        Ok(())
    }

    /// 停止指定设备的 scrcpy
    /// Stop scrcpy for a specific device
    pub fn stop(&self, serial: &str) -> ScrcpyResult<()> {
        let mut instances = self.instances.lock();
        if let Some(mut inst) = instances.remove(serial) {
            log::info!("停止 scrcpy / Stopping scrcpy for device {}", serial);
            let _ = inst.child.kill();
            let _ = inst.child.wait();
        }
        Ok(())
    }

    /// 停止所有 scrcpy 实例
    /// Stop all scrcpy instances
    pub fn stop_all(&self) {
        let mut instances = self.instances.lock();
        for (serial, mut inst) in instances.drain() {
            log::info!("停止 scrcpy / Stopping scrcpy for device {}", serial);
            let _ = inst.child.kill();
            let _ = inst.child.wait();
        }
    }

    /// 检查 scrcpy 是否正在运行
    /// Check if scrcpy is running for a device
    pub fn is_running(&self, serial: &str) -> bool {
        let mut instances = self.instances.lock();
        if let Some(inst) = instances.get_mut(serial) {
            match inst.child.try_wait() {
                Ok(Some(_)) => {
                    instances.remove(serial);
                    false
                }
                Ok(None) => true,
                Err(_) => {
                    instances.remove(serial);
                    false
                }
            }
        } else {
            false
        }
    }

    /// 获取正在运行的实例列表
    /// Get running instances info
    pub fn get_running_instances(&self) -> Vec<String> {
        let instances = self.instances.lock();
        instances.keys().cloned().collect()
    }

    /// 通过 adb 截取设备屏幕
    /// Take a screenshot of device via adb
    pub fn take_screenshot(serial: &str, output_path: &str) -> ScrcpyResult<()> {
        let status = Command::new("adb")
            .args(["-s", serial, "exec-out", "screencap", "-p"])
            .stdout(std::fs::File::create(output_path).map_err(ScrcpyError::ProcessError)?)
            .status()
            .map_err(ScrcpyError::ProcessError)?;

        if status.success() {
            Ok(())
        } else {
            Err(ScrcpyError::StartFailed("Screenshot failed".into()))
        }
    }

    /// 录屏
    /// Record device screen to file
    pub fn start_recording(&self, serial: &str, output_path: &str, options: Option<ScrcpyOptions>) -> ScrcpyResult<()> {
        let mut opts = options.unwrap_or_default();
        opts.record_file = Some(output_path.to_string());
        opts.no_control = true;
        self.start(serial, Some(opts))
    }

    // ========== 输入法模式 A: DroidLink IME (中日韩文本输入) ==========
    // ========== Input Mode A: DroidLink IME (CJK text input) ==========
    //
    // 通过 ADB broadcast 将完整文本发送到 DroidLinkIME，由 IME commitText()。
    // 优点: 支持所有 Unicode 字符，包括中文、日文、韩文、emoji
    // 缺点: 需要切换到 DroidLink 输入法，不支持手机端自带输入法的候选词
    //
    // Sends full text to DroidLinkIME via ADB broadcast, IME calls commitText().
    // Pros: Supports all Unicode chars including CJK and emoji
    // Cons: Requires switching to DroidLink IME, no native IME candidate words

    /// 通过 DroidLink IME 发送文本 (支持中日韩等全部 Unicode)
    /// Send text via DroidLink IME (supports all Unicode including CJK)
    pub fn send_text_input(serial: &str, text: &str) -> ScrcpyResult<()> {
        let encoded = base64_encode(text.as_bytes());
        let cmd = format!(
            "am broadcast -a com.droidlink.INPUT_TEXT --es text_b64 '{}' 2>/dev/null",
            encoded
        );
        crate::adb::shell(serial, &cmd).map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
        Ok(())
    }

    /// 通过 DroidLink IME 发送按键事件 (Enter, Backspace 等)
    /// Send key event via DroidLink IME (Enter, Backspace, etc.)
    pub fn send_key_input(serial: &str, key_code: i32) -> ScrcpyResult<()> {
        let cmd = format!(
            "am broadcast -a com.droidlink.INPUT_KEY --ei keyCode {} 2>/dev/null",
            key_code
        );
        crate::adb::shell(serial, &cmd).map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
        Ok(())
    }

    /// 发送退格键
    /// Send backspace key events
    pub fn send_backspace(serial: &str, count: i32) -> ScrcpyResult<()> {
        let cmd = format!(
            "am broadcast -a com.droidlink.INPUT_BACKSPACE --ei count {} 2>/dev/null",
            count
        );
        crate::adb::shell(serial, &cmd).map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
        Ok(())
    }

    /// 发送回车键
    /// Send enter key event
    pub fn send_enter(serial: &str) -> ScrcpyResult<()> {
        let cmd = "am broadcast -a com.droidlink.INPUT_ENTER 2>/dev/null";
        crate::adb::shell(serial, cmd).map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
        Ok(())
    }

    /// 启用 DroidLink 输入法
    /// Enable and switch to DroidLink IME
    pub fn setup_ime(serial: &str) -> ScrcpyResult<String> {
        let output = crate::adb::shell(serial, "ime list -s 2>/dev/null")
            .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;

        let ime_id = "com.droidlink.companion/.ime.DroidLinkIME";
        let is_enabled = output.contains(ime_id);

        if !is_enabled {
            crate::adb::shell(serial, &format!("ime enable {}", ime_id))
                .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
        }

        crate::adb::shell(serial, &format!("ime set {}", ime_id))
            .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;

        Ok(ime_id.to_string())
    }

    /// 恢复默认输入法
    /// Restore the default IME
    pub fn restore_ime(serial: &str) -> ScrcpyResult<()> {
        let output = crate::adb::shell(serial, "ime list -s 2>/dev/null")
            .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;

        for line in output.lines() {
            let line = line.trim();
            if !line.is_empty() && !line.contains("com.droidlink") {
                crate::adb::shell(serial, &format!("ime set {}", line))
                    .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
                return Ok(());
            }
        }
        Ok(())
    }

    // ========== 输入法模式 B: 键盘直通 (使用手机自带输入法) ==========
    // ========== Input Mode B: Keyboard passthrough (uses phone's native IME) ==========
    //
    // 通过 `adb shell input keyevent` 发送原始按键事件，
    // 相当于插了一个 USB 实体键盘，由 Android 系统内的输入法处理按键。
    // 优点: 使用手机自带输入法（搜狗、Gboard 等），有候选词和联想
    // 缺点: 只能发送单个按键，不能直接发送组合文字
    //
    // Sends raw key events via `adb shell input keyevent`,
    // equivalent to plugging in a physical USB keyboard.
    // Android's active IME processes the keystrokes.
    // Pros: Uses phone's native IME (Sogou, Gboard, etc.) with candidates
    // Cons: Can only send individual keys, cannot send composed text directly

    /// 键盘直通: 发送单个按键码 (模拟实体键盘)
    /// Keyboard passthrough: send a single keycode (simulates physical keyboard)
    pub fn passthrough_keyevent(serial: &str, key_code: i32) -> ScrcpyResult<()> {
        let cmd = format!("input keyevent {}", key_code);
        crate::adb::shell(serial, &cmd).map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
        Ok(())
    }

    /// 键盘直通: 发送多个按键 (批量)
    /// Keyboard passthrough: send multiple keycodes (batch)
    pub fn passthrough_keyevents(serial: &str, key_codes: &[i32]) -> ScrcpyResult<()> {
        for &code in key_codes {
            let cmd = format!("input keyevent {}", code);
            crate::adb::shell(serial, &cmd).map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
        }
        Ok(())
    }

    /// 键盘直通: 发送 ASCII 文本 (仅限英文/数字/符号，由 input text 命令处理)
    /// Keyboard passthrough: send ASCII text (English/digits/symbols only, via input text)
    /// 注意: `input text` 不支持空格和部分特殊字符，空格需要用 keyevent 62
    /// Note: `input text` doesn't support spaces and some special chars, space needs keyevent 62
    pub fn passthrough_text(serial: &str, text: &str) -> ScrcpyResult<()> {
        // 将文本按空格分段处理
        // Split text by spaces for handling
        for segment in text.split(' ') {
            if !segment.is_empty() {
                // 转义 shell 特殊字符 / Escape shell special characters
                let escaped = segment.replace('\\', "\\\\")
                    .replace('\'', "\\'")
                    .replace('"', "\\\"")
                    .replace('&', "\\&")
                    .replace('|', "\\|")
                    .replace(';', "\\;")
                    .replace('(', "\\(")
                    .replace(')', "\\)")
                    .replace('<', "\\<")
                    .replace('>', "\\>");
                let cmd = format!("input text '{}'", escaped);
                crate::adb::shell(serial, &cmd)
                    .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
            }
            // 发送空格键 (keyevent 62 = KEYCODE_SPACE)
            // Send space key (keyevent 62 = KEYCODE_SPACE)
            let cmd = "input keyevent 62";
            crate::adb::shell(serial, cmd)
                .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
        }
        Ok(())
    }

    /// 获取当前手机输入法列表 (供用户选择/查看)
    /// Get the list of IMEs on the phone (for user selection/display)
    pub fn list_device_imes(serial: &str) -> ScrcpyResult<Vec<String>> {
        let output = crate::adb::shell(serial, "ime list -s 2>/dev/null")
            .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;

        let imes: Vec<String> = output.lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();

        Ok(imes)
    }

    /// 获取当前激活的输入法
    /// Get the currently active IME
    pub fn get_current_ime(serial: &str) -> ScrcpyResult<String> {
        let output = crate::adb::shell(serial, "settings get secure default_input_method 2>/dev/null")
            .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
        Ok(output.trim().to_string())
    }

    /// 切换到指定输入法
    /// Switch to a specific IME by ID
    pub fn switch_ime(serial: &str, ime_id: &str) -> ScrcpyResult<()> {
        crate::adb::shell(serial, &format!("ime set {}", ime_id))
            .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
        Ok(())
    }
}

impl Drop for ScrcpyManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}

fn scrcpy_binary() -> &'static str {
    if cfg!(target_os = "windows") {
        "scrcpy.exe"
    } else {
        "scrcpy"
    }
}

/// Base64 编码 (用于 shell 安全传输文本)
/// Base64 encode bytes (for safe text transmission via shell)
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
