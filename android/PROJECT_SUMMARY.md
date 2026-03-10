# DroidLink Android Companion App - Project Summary

## Overview

This is a production-ready Android companion application for the DroidLink project. The app provides data export capabilities for syncing contacts, SMS messages, call logs, and clipboard data with the desktop application. All communication happens through **pure ADB over USB** -- no network connections, no HTTP server, no `adb forward`.

## Security Architecture

### Zero Network Policy

| Constraint | Status |
|-----------|--------|
| No INTERNET permission | Enforced in AndroidManifest.xml |
| No HTTP server | No NanoHTTPD, no Ktor, no OkHttp server |
| No TCP/socket connections | No ServerSocket, no TcpListener |
| No `adb forward` | No port forwarding of any kind |
| No WebSocket | No WebSocket client or server |
| Passive mode only | App only responds to ADB commands, never initiates connections |

### Communication Pattern

All desktop-to-Android communication uses exactly two ADB mechanisms:

1. **`adb shell am broadcast`** -- Send commands to the companion app via Android Intent broadcasts
2. **`adb push/pull`** -- Transfer files between desktop and device via USB

```
Desktop                                   Android
  |                                          |
  |-- adb shell am broadcast EXPORT_* ----->|  DataExportReceiver
  |                                          |    queries ContentProvider
  |                                          |    writes JSON to /data/local/tmp/
  |<---- adb pull temp_file.json ---------- |
  |                                          |
  |-- adb shell am broadcast SET_CLIPBOARD ->|  ClipboardReceiver
  |-- adb shell am broadcast GET_CLIPBOARD ->|    writes to temp file
  |<---- adb pull clipboard.txt ----------- |
  |                                          |
  |-- adb push file.apk /path/ ------------>|  (direct file transfer)
  |<---- adb pull /sdcard/file ------------ |
```

## Project Statistics

- **Language**: Kotlin 1.9.20
- **Min SDK**: 26 (Android 8.0 Oreo)
- **Target SDK**: 34 (Android 14)
- **Architecture**: Service + BroadcastReceivers + ContentObservers
- **UI Framework**: Jetpack Compose
- **HTTP Server**: None (pure ADB)

## Core Components

### 1. MainActivity.kt
- **Purpose**: Main user interface
- **Framework**: Jetpack Compose Material3
- **Features**: Service control, permission handling, status display

### 2. DroidLinkService.kt
- **Purpose**: Foreground service for background operation
- **Type**: Android Foreground Service with dataSync type
- **Features**: Starts ContentObserverManager, shows persistent notification
- **Note**: Does NOT start any HTTP server or network listener

### 3. DataExportReceiver.kt
- **Purpose**: Export device data to temp files when requested via ADB broadcast
- **Type**: BroadcastReceiver
- **Supported actions**:
  - `com.droidlink.EXPORT_CONTACTS` -- Export all contacts as JSON
  - `com.droidlink.EXPORT_MESSAGES` -- Export all SMS messages as JSON
  - `com.droidlink.EXPORT_CALLLOGS` -- Export all call logs as JSON
  - `com.droidlink.EXPORT_CHANGES` -- Export change summary as JSON
- **Flow**: Receives broadcast -> queries ContentProvider -> writes JSON to output_path -> desktop pulls file

### 4. ClipboardReceiver.kt
- **Purpose**: Handle clipboard operations via ADB broadcasts
- **Type**: BroadcastReceiver
- **Supported actions**:
  - `com.droidlink.SET_CLIPBOARD` -- Set clipboard from broadcast extra
  - `com.droidlink.GET_CLIPBOARD` -- Get clipboard, write to file
  - `com.droidlink.SET_CLIPBOARD_FILE` -- Set clipboard from file content
  - `com.droidlink.GET_CLIPBOARD_FILE` -- Get clipboard, write to file
- **Features**: Base64 encoding support for Unicode/CJK

### 5. ClipboardActivity.kt
- **Purpose**: Transparent activity for clipboard access on Android 10+
- **Background**: Android 10+ restricts background clipboard access
- **Flow**: Briefly comes to foreground, performs clipboard operation, finishes immediately

### 6. DroidLinkIME.kt
- **Purpose**: Input Method Service for CJK text input from desktop
- **Type**: Android InputMethodService
- **Features**: Receives text via ADB, commits to active input field, supports all Unicode

### 7. ContentObserverManager.kt
- **Purpose**: Monitor data changes in real-time
- **Mechanism**: Android ContentObserver
- **Features**: Atomic counters for contacts/SMS/call logs, timestamp tracking

### 8. Data Providers
- **ContactProvider.kt**: Queries ContactsContract, multiple phones/emails, MD5 hash
- **SmsProvider.kt**: Queries content://sms, all message types, timestamp filtering
- **CallLogProvider.kt**: Queries CallLog.Calls, all call types, duration tracking

## Data Models

### Contact
```kotlin
data class Contact(
    val id: String,
    val displayName: String,
    val phoneNumbers: List<String>,
    val emails: List<String>,
    val organization: String?,
    val photoUri: String?,
    val hash: String
)
```

### SmsMessage
```kotlin
data class SmsMessage(
    val id: String,
    val threadId: String,
    val address: String,
    val body: String,
    val date: Long,
    val dateSent: Long,
    val type: Int,
    val read: Boolean,
    val hash: String
)
```

### CallLogEntry
```kotlin
data class CallLogEntry(
    val id: String,
    val number: String,
    val cachedName: String?,
    val type: Int,
    val date: Long,
    val duration: Long,
    val hash: String
)
```

## Permissions Required

| Permission | Purpose |
|-----------|---------|
| READ_CONTACTS | Read contact information |
| WRITE_CONTACTS | Modify contacts (reserved) |
| READ_SMS | Read SMS messages |
| READ_CALL_LOG | Read call history |
| READ_PHONE_STATE | Read phone state information |
| FOREGROUND_SERVICE | Run foreground service |
| FOREGROUND_SERVICE_DATA_SYNC | Data sync service type |
| POST_NOTIFICATIONS | Show notifications (Android 13+) |

**NOT requested**: `INTERNET` -- The app has no network capabilities by design.

## Build Configuration

### Dependencies

**Core Android**:
- androidx.core:core-ktx:1.12.0
- androidx.appcompat:appcompat:1.6.1
- androidx.lifecycle:lifecycle-runtime-ktx:2.7.0
- androidx.lifecycle:lifecycle-service:2.7.0

**Jetpack Compose**:
- androidx.activity:activity-compose:1.8.2
- androidx.compose.material3:material3 (BOM 2023.10.01)

**JSON**:
- com.google.code.gson:gson:2.10.1

**Kotlin**:
- org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3

**NOT included**: NanoHTTPD, OkHttp, Ktor, Retrofit, or any HTTP/network library.

## Data Privacy

- **No Cloud Backup**: All data excluded from backup
- **No Device Transfer**: Data excluded from device-to-device transfer
- **No Network Access**: App cannot connect to any network
- **Passive Only**: App only responds to ADB commands from locally-connected desktop
- **USB Required**: Physical USB connection required for all communication

## ADB Command Reference

### Data Export
```bash
# Export contacts
adb shell am broadcast -a com.droidlink.EXPORT_CONTACTS \
  --es output_path '/data/local/tmp/.droidlink_contacts.json' \
  -n com.droidlink.companion/.data.DataExportReceiver
adb pull /data/local/tmp/.droidlink_contacts.json

# Export messages
adb shell am broadcast -a com.droidlink.EXPORT_MESSAGES \
  --es output_path '/data/local/tmp/.droidlink_messages.json' \
  -n com.droidlink.companion/.data.DataExportReceiver
adb pull /data/local/tmp/.droidlink_messages.json

# Export call logs
adb shell am broadcast -a com.droidlink.EXPORT_CALLLOGS \
  --es output_path '/data/local/tmp/.droidlink_calllogs.json' \
  -n com.droidlink.companion/.data.DataExportReceiver
adb pull /data/local/tmp/.droidlink_calllogs.json
```

### Clipboard
```bash
# Set clipboard
adb shell am broadcast -a com.droidlink.SET_CLIPBOARD --es text "Hello"

# Get clipboard to file
adb shell am broadcast -a com.droidlink.GET_CLIPBOARD_FILE \
  --es path '/data/local/tmp/.droidlink_clipboard.txt'
adb pull /data/local/tmp/.droidlink_clipboard.txt
```

### Service Control
```bash
# Start service
adb shell am start-foreground-service \
  com.droidlink.companion/.DroidLinkService

# Stop service
adb shell am stopservice \
  com.droidlink.companion/.DroidLinkService

# Start app
adb shell am start -n com.droidlink.companion/.MainActivity
```

## Desktop Integration (Rust/Tauri Backend)

The desktop app's Rust backend communicates with the companion app using this pattern:

```rust
// 1. Send ADB broadcast to trigger data export
adb::shell(&serial, "am broadcast -a com.droidlink.EXPORT_CONTACTS \
    --es output_path '/data/local/tmp/.droidlink_contacts.json' \
    -n com.droidlink.companion/.data.DataExportReceiver");

// 2. Wait for companion to write the file
std::thread::sleep(Duration::from_millis(500));

// 3. Pull the file via ADB (pure USB transfer)
adb::pull(&serial, "/data/local/tmp/.droidlink_contacts.json", &local_path);

// 4. Read and parse the JSON
let content = std::fs::read_to_string(&local_path)?;
let contacts: Vec<Contact> = serde_json::from_str(&content)?;

// 5. Clean up temp files
std::fs::remove_file(&local_path);
adb::shell(&serial, "rm -f '/data/local/tmp/.droidlink_contacts.json'");
```

**Zero TCP. Zero HTTP. Zero `adb forward`. Pure ADB USB only.**

## Performance

### Memory Usage
- Base service: ~30-50 MB
- ContentObservers: Minimal overhead (<1 MB)

### CPU Usage
- Idle: <1%
- During data export: 5-15% (depends on data volume)
- ContentObserver triggers: <1%

### Battery Impact
- Foreground service: Minimal drain
- ContentObservers: Negligible impact
- Recommendation: Add to battery optimization whitelist

## Build

```bash
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Limitations

1. **No Root Required**: Uses standard Android APIs only
2. **Android 8.0+**: Minimum SDK 26 (covers ~95% of devices)
3. **Permissions Required**: User must grant all permissions manually
4. **Foreground Service**: Must show persistent notification
5. **SMS Access**: May be restricted on some devices (Chinese ROMs)
6. **Clipboard on Android 10+**: Requires ClipboardActivity workaround

## License

This is part of the DroidLink project, for educational and development purposes.
