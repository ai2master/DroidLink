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
    /// Multi-tier approach for Android 10+ compatibility:
    /// Tier 1: Try direct Binder call (fastest, no companion needed, works on some devices)
    /// Tier 2: Try broadcast + file (fails on Android 10+ due to background restrictions)
    /// Tier 3: Use Activity-based approach (works on Android 10+, requires companion)
    pub fn get_from_device(&self, serial: &str) -> ClipResult<(String, String)> {
        log::info!("Getting clipboard from device");

        // Tier 1: Try direct Binder call via service call
        // This works on some devices because ADB has shell UID privileges
        // Fastest method, no companion app needed
        if let Ok(content) = receive_via_binder(serial) {
            if !content.is_empty() {
                log::info!("Clipboard received via Binder call: {} bytes", content.len());
                return Ok((content, "binder".to_string()));
            }
        }

        // Tier 2: Try broadcast + file (works on Android <10, fails on 10+ for background)
        match receive_via_broadcast(serial) {
            Ok(content) => {
                if content == "CLIPBOARD_ACCESS_DENIED" {
                    log::warn!("Broadcast method blocked by Android 10+ restrictions, trying Activity fallback");
                    // Fall through to Tier 3
                } else if !content.is_empty() {
                    log::info!("Clipboard received via broadcast: {} bytes", content.len());
                    return Ok((content, "broadcast".to_string()));
                }
            }
            Err(e) => {
                log::debug!("Broadcast method failed: {}, trying Activity fallback", e);
            }
        }

        // Tier 3: Try Activity-based approach (works on Android 10+)
        // This launches a foreground Activity that can read clipboard
        if let Ok(content) = receive_via_activity(serial) {
            if !content.is_empty() {
                log::info!("Clipboard received via Activity: {} bytes", content.len());
                return Ok((content, "activity".to_string()));
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
/// Works on some devices, but not all (depends on SELinux policy).
fn receive_via_binder(serial: &str) -> ClipResult<String> {
    // service call clipboard 2 s16 com.android.shell
    // The '2' is the transaction code for getting clipboard
    // s16 specifies the calling package (shell has clipboard access)
    let cmd = "service call clipboard 2 s16 com.android.shell 2>/dev/null";
    let output = adb::shell(serial, cmd)?;

    // Parse the Binder result format
    // Example output:
    // Result: Parcel(
    //   0x00000000: 00000000 00000009 00680054 00730069 '........T.h.i.s.'
    //   0x00000010: 00200020 00730069 00200020 00650074 '  . .i.s. . .t.e.'
    //   ...
    // )

    // Look for the Result: Parcel format
    if !output.contains("Result: Parcel") {
        return Err(ClipboardError::ReadFailed);
    }

    // Extract hex data from the parcel
    let mut text_chars = Vec::new();
    for line in output.lines() {
        // Skip non-hex lines
        if !line.trim().starts_with("0x") {
            continue;
        }

        // Parse hex bytes from the line
        // Format: 0x00000000: 00000000 00000009 00680054 ...
        if let Some(hex_part) = line.split(':').nth(1) {
            // Take only the hex values part (before the ASCII representation in quotes)
            let hex_data = if let Some(ascii_start) = hex_part.find('\'') {
                &hex_part[..ascii_start]
            } else {
                hex_part
            };

            // Parse hex values (each is 4 bytes / 8 hex digits)
            for hex_value in hex_data.split_whitespace() {
                if hex_value.len() == 8 {
                    // Parse as u32 (little-endian in the output)
                    if let Ok(val) = u32::from_str_radix(hex_value, 16) {
                        // Extract UTF-16 characters (Android uses UTF-16 internally)
                        let b0 = (val & 0xFF) as u8;
                        let b1 = ((val >> 8) & 0xFF) as u8;
                        let b2 = ((val >> 16) & 0xFF) as u8;
                        let b3 = ((val >> 24) & 0xFF) as u8;

                        // Combine bytes into UTF-16 code units
                        if b1 != 0 || b0 != 0 {
                            let c1 = u16::from_le_bytes([b0, b1]);
                            if c1 != 0 {
                                text_chars.push(c1);
                            }
                        }
                        if b3 != 0 || b2 != 0 {
                            let c2 = u16::from_le_bytes([b2, b3]);
                            if c2 != 0 {
                                text_chars.push(c2);
                            }
                        }
                    }
                }
            }
        }
    }

    // Convert UTF-16 to String
    let text = String::from_utf16_lossy(&text_chars);

    // The Binder result includes some header bytes, try to find the actual text
    // Skip any leading null/control characters
    let cleaned = text.trim_start_matches(|c: char| c.is_control() && c != '\n' && c != '\r' && c != '\t')
                      .trim_end_matches('\0')
                      .to_string();

    if cleaned.is_empty() {
        return Err(ClipboardError::ReadFailed);
    }

    Ok(cleaned)
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
