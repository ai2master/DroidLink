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
#[serde(rename_all = "camelCase")]
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

    /// 检查 scrcpy 是否可用（不执行 scrcpy，避免 snap notice 弹窗）
    /// Check if scrcpy is installed (without executing it, to avoid snap notice popups)
    pub fn check_available() -> ScrcpyResult<String> {
        let binary = scrcpy_binary();
        // 检查路径是否为文件或是否在 PATH 中
        // Check if path exists as file or is in PATH
        let path = std::path::Path::new(&binary);
        if path.is_absolute() && path.exists() {
            Ok("installed (bundled)".to_string())
        } else if which::which(&binary).is_ok() {
            Ok("installed".to_string())
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
        let mut cmd = Command::new(&scrcpy_binary());

        // 设置 scrcpy-server 路径 (使用打包的服务端)
        // Set scrcpy-server path (use bundled server)
        if let Some(server_path) = bundled_scrcpy_server_path() {
            cmd.env("SCRCPY_SERVER_PATH", server_path);
        }

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

        let binary = scrcpy_binary();
        log::info!("scrcpy 二进制路径 / scrcpy binary path: {}", binary);

        let mut child = cmd
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| ScrcpyError::StartFailed(
                format!("Failed to start scrcpy (binary: {}): {}", binary, e)
            ))?;

        // 等待一小段时间，检查进程是否立即崩溃
        // Wait briefly and check if the process crashed immediately
        std::thread::sleep(std::time::Duration::from_millis(500));

        match child.try_wait() {
            Ok(Some(exit_status)) => {
                // scrcpy 立即退出了，读取 stderr 获取错误信息
                // scrcpy exited immediately, read stderr for error details
                let stderr_output = if let Some(stderr) = child.stderr.take() {
                    use std::io::Read;
                    let mut buf = String::new();
                    let mut reader = std::io::BufReader::new(stderr);
                    let _ = reader.read_to_string(&mut buf);
                    buf
                } else {
                    String::new()
                };

                let error_msg = if !stderr_output.trim().is_empty() {
                    format!("scrcpy exited immediately ({}): {}", exit_status, stderr_output.trim())
                } else {
                    format!("scrcpy exited immediately with {}", exit_status)
                };
                log::error!("{}", error_msg);
                return Err(ScrcpyError::StartFailed(error_msg));
            }
            Ok(None) => {
                // 进程还在运行，正常
                // Process still running, good
            }
            Err(e) => {
                log::warn!("Failed to check scrcpy process status: {}", e);
            }
        }

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
            if !line.is_empty() && !line.contains("com.droidlink") && is_valid_ime_id(line) {
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
    ///
    /// 安全策略: 使用白名单验证，只允许安全字符通过 `input text` 命令。
    /// 非安全字符(shell 特殊字符)通过逐个 keyevent 发送，完全避免 shell 注入风险。
    /// Security: Whitelist validation. Safe chars go through `input text`.
    /// Unsafe chars (shell metacharacters) are sent via individual keyevent codes,
    /// completely avoiding shell injection risk.
    pub fn passthrough_text(serial: &str, text: &str) -> ScrcpyResult<()> {
        // 安全: 限制最大长度 / Security: limit max length
        if text.len() > 1000 {
            return Err(ScrcpyError::StartFailed("Text too long for passthrough (max 1000 chars)".to_string()));
        }

        // 安全字符白名单: 只有这些字符可以直接传给 `input text`
        // Safe char whitelist: only these can be passed to `input text`
        fn is_safe_for_input_text(c: char) -> bool {
            matches!(c,
                'a'..='z' | 'A'..='Z' | '0'..='9' |
                '.' | '-' | '_' | '+' | '=' | '@' | ',' | ':' | '/' | '?' |
                '[' | ']' | '(' | ')' // Android input text supports these
            )
        }

        // Android keyevent 映射表 (用于无法安全通过 shell 的字符)
        // Android keyevent mapping (for chars unsafe to pass through shell)
        fn char_to_keyevent(c: char) -> Option<&'static str> {
            match c {
                ' '  => Some("input keyevent 62"),  // KEYCODE_SPACE
                '\n' => Some("input keyevent 66"),  // KEYCODE_ENTER
                '\t' => Some("input keyevent 61"),  // KEYCODE_TAB
                _    => None,
            }
        }

        // 将文本分成安全段和非安全字符，批量处理
        // Split text into safe segments and unsafe chars, process in batches
        let mut safe_buf = String::new();

        for ch in text.chars() {
            if is_safe_for_input_text(ch) {
                safe_buf.push(ch);
            } else {
                // 先刷出安全缓冲区 / Flush safe buffer first
                if !safe_buf.is_empty() {
                    let cmd = format!("input text '{}'", safe_buf);
                    crate::adb::shell(serial, &cmd)
                        .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
                    safe_buf.clear();
                }

                // 处理非安全字符 / Handle unsafe character
                if let Some(keyevent_cmd) = char_to_keyevent(ch) {
                    crate::adb::shell(serial, keyevent_cmd)
                        .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
                } else if (ch as u32) > 127 {
                    // Unicode 字符通过 DroidLink IME 的 base64 方式发送，更安全
                    // Unicode chars sent via DroidLink IME's base64 method, safer
                    let encoded = base64_encode(ch.to_string().as_bytes());
                    let cmd = format!(
                        "am broadcast -a com.droidlink.INPUT_TEXT --es text_b64 '{}' 2>/dev/null",
                        encoded
                    );
                    crate::adb::shell(serial, &cmd)
                        .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
                } else {
                    // ASCII 特殊字符: 通过 base64 广播发送，避免 shell 注入
                    // ASCII special chars: send via base64 broadcast to avoid shell injection
                    let encoded = base64_encode(ch.to_string().as_bytes());
                    let cmd = format!(
                        "am broadcast -a com.droidlink.INPUT_TEXT --es text_b64 '{}' 2>/dev/null",
                        encoded
                    );
                    crate::adb::shell(serial, &cmd)
                        .map_err(|e| ScrcpyError::StartFailed(e.to_string()))?;
                }
            }
        }

        // 刷出剩余的安全缓冲区 / Flush remaining safe buffer
        if !safe_buf.is_empty() {
            let cmd = format!("input text '{}'", safe_buf);
            crate::adb::shell(serial, &cmd)
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
        // 验证 IME ID 格式，防止 shell 注入
        // Validate IME ID format to prevent shell injection
        // Valid format: com.package.name/.ClassName or com.package.name/com.package.name.ClassName
        if !is_valid_ime_id(ime_id) {
            return Err(ScrcpyError::StartFailed(format!("Invalid IME ID: {}", ime_id)));
        }
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

/// 全局 scrcpy 自定义路径 (设置后覆盖默认值)
/// Global scrcpy custom path (overrides default when set)
static SCRCPY_CUSTOM_PATH: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// 设置 scrcpy 自定义路径
/// Set custom scrcpy path from settings
pub fn set_scrcpy_custom_path(path: &str) {
    if let Ok(mut p) = SCRCPY_CUSTOM_PATH.lock() {
        *p = path.to_string();
    }
}

/// scrcpy 来源模式 (bundled / system / custom)
/// scrcpy source mode
static SCRCPY_SOURCE: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// 设置 scrcpy 来源
/// Set scrcpy source mode
pub fn set_scrcpy_source(source: &str) {
    if let Ok(mut s) = SCRCPY_SOURCE.lock() {
        *s = source.to_string();
    }
}

/// Tauri 资源目录路径 (由 lib.rs 在启动时设置)
/// Tauri resource directory path (set by lib.rs at startup)
/// 重要: 这是 Tauri 实际放置 bundle resources 的目录，不是 exe_dir
/// Important: This is where Tauri actually places bundled resources, NOT exe_dir
static RESOURCE_DIR: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// 设置 Tauri 资源目录 (由 lib.rs 在 setup 中调用)
/// Set Tauri resource directory (called by lib.rs during setup)
pub fn set_resource_dir(path: &str) {
    if let Ok(mut d) = RESOURCE_DIR.lock() {
        *d = path.to_string();
        log::info!("scrcpy resource_dir set to: {}", path);
    }
}

fn scrcpy_binary() -> String {
    let source = SCRCPY_SOURCE.lock().ok()
        .map(|s| if s.is_empty() { "bundled".to_string() } else { s.clone() })
        .unwrap_or_else(|| "bundled".to_string());
    match source.as_str() {
        "bundled" => {
            // 尝试使用打包的 scrcpy / Try bundled scrcpy
            if let Some(path) = bundled_scrcpy_path() {
                return path;
            }
            // 回退到系统 PATH / Fall back to system PATH
            log::warn!("Bundled scrcpy not found, falling back to system PATH");
            default_scrcpy_name()
        }
        "custom" => {
            if let Ok(custom) = SCRCPY_CUSTOM_PATH.lock() {
                if !custom.is_empty() {
                    return custom.clone();
                }
            }
            default_scrcpy_name()
        }
        _ => default_scrcpy_name(),
    }
}

fn default_scrcpy_name() -> String {
    if cfg!(target_os = "windows") {
        "scrcpy.exe".to_string()
    } else {
        "scrcpy".to_string()
    }
}

/// 检查是否有打包的 scrcpy
/// Check if bundled scrcpy binary exists
pub fn has_bundled_scrcpy() -> bool {
    bundled_scrcpy_path().is_some()
}

/// 获取打包的 scrcpy 路径
/// Get bundled scrcpy binary path
///
/// 使用 Tauri resource_dir（由 set_resource_dir 设置）而不是 exe_dir，
/// 因为 Tauri v2 在 Linux DEB/AppImage 中将资源放在不同于可执行文件的目录。
/// Uses Tauri resource_dir (set via set_resource_dir) instead of exe_dir,
/// because Tauri v2 places resources in a different directory than the executable on Linux DEB/AppImage.
fn bundled_scrcpy_path() -> Option<String> {
    let mut candidates = Vec::new();

    // 优先使用 Tauri resource_dir（正确路径）
    // Prefer Tauri resource_dir (correct path)
    if let Ok(dir) = RESOURCE_DIR.lock() {
        if !dir.is_empty() {
            let res_dir = std::path::PathBuf::from(dir.as_str());
            let binary_name = if cfg!(target_os = "windows") { "scrcpy.exe" } else { "scrcpy" };
            candidates.push(res_dir.join("scrcpy").join(binary_name));
        }
    }

    // 回退: 使用 exe_dir 相对路径 (开发模式或某些打包格式)
    // Fallback: use exe_dir relative paths (dev mode or certain package formats)
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        if cfg!(target_os = "macos") {
            candidates.push(exe_dir.join("../Resources/scrcpy/scrcpy"));
            candidates.push(exe_dir.join("scrcpy/scrcpy"));
        } else if cfg!(target_os = "windows") {
            candidates.push(exe_dir.join("scrcpy/scrcpy.exe"));
            candidates.push(exe_dir.join("resources/scrcpy/scrcpy.exe"));
        } else {
            candidates.push(exe_dir.join("scrcpy/scrcpy"));
            candidates.push(exe_dir.join("resources/scrcpy/scrcpy"));
        }
    }

    for candidate in &candidates {
        if candidate.exists() {
            log::info!("Found bundled scrcpy at: {}", candidate.display());
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    log::warn!("Bundled scrcpy not found. Searched: {:?}", candidates.iter().map(|c| c.display().to_string()).collect::<Vec<_>>());
    None
}

/// 获取打包的 scrcpy-server 路径
/// Get bundled scrcpy-server path
fn bundled_scrcpy_server_path() -> Option<String> {
    let mut candidates = Vec::new();

    // 优先使用 Tauri resource_dir
    // Prefer Tauri resource_dir
    if let Ok(dir) = RESOURCE_DIR.lock() {
        if !dir.is_empty() {
            let res_dir = std::path::PathBuf::from(dir.as_str());
            candidates.push(res_dir.join("scrcpy").join("scrcpy-server"));
        }
    }

    // 回退: exe_dir 相对路径
    // Fallback: exe_dir relative paths
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        if cfg!(target_os = "macos") {
            candidates.push(exe_dir.join("../Resources/scrcpy/scrcpy-server"));
            candidates.push(exe_dir.join("scrcpy/scrcpy-server"));
        } else {
            candidates.push(exe_dir.join("scrcpy/scrcpy-server"));
            candidates.push(exe_dir.join("resources/scrcpy/scrcpy-server"));
        }
    }

    for candidate in &candidates {
        if candidate.exists() {
            log::info!("Found bundled scrcpy-server at: {}", candidate.display());
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}

/// 验证 scrcpy 路径是否可用
/// Validate a scrcpy binary path
pub fn validate_scrcpy_path(path: &str) -> bool {
    let p = std::path::Path::new(path);
    if !p.exists() {
        return false;
    }
    // 关闭 stdin 防止 snap notice 等交互提示阻塞
    // Close stdin to prevent snap notice or other interactive prompts from blocking
    Command::new(p)
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 验证 Android IME ID 格式，防止 shell 注入
/// Validate Android IME ID format to prevent shell injection
/// Valid: com.package.name/.ClassName or com.package.name/com.package.name.ClassName
fn is_valid_ime_id(ime_id: &str) -> bool {
    // IME ID 只能包含字母、数字、点、斜杠、下划线、美元符号（内部类）
    // IME ID can only contain alphanumeric, dots, slashes, underscores, dollar signs (inner classes)
    if ime_id.is_empty() || ime_id.len() > 256 {
        return false;
    }
    // Must contain exactly one slash separating package and class
    if ime_id.matches('/').count() != 1 {
        return false;
    }
    ime_id.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '/' || c == '_' || c == '$')
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
