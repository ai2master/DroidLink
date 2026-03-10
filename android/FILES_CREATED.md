# DroidLink Android App - Complete File List

## Summary
- Production-ready Android companion app
- Pure ADB USB communication (zero network, zero adb forward)
- BroadcastReceiver-based data export
- Full Chinese/UTF-8 support

---

## Build Configuration Files

### `/build.gradle.kts`
Root project Gradle build configuration (AGP 8.2.0, Kotlin 1.9.20)

### `/settings.gradle.kts`
Project settings with repositories (Google Maven, Maven Central)

### `/gradle.properties`
Gradle properties (AndroidX, UTF-8, Kotlin incremental)

### `/app/build.gradle.kts`
App module build configuration
- Application ID: com.droidlink.companion
- Min SDK: 26, Target SDK: 34
- Dependencies: Gson, Jetpack Compose, Coroutines

---

## Source Code Files

### `/app/src/main/java/com/droidlink/companion/MainActivity.kt`
Main Activity with Jetpack Compose UI
- Permission request handling
- Service start/stop controls
- Connection status display

### `/app/src/main/java/com/droidlink/companion/DroidLinkService.kt`
Foreground Service
- Manages ContentObserverManager for data change detection
- Persistent notification (pure USB mode)
- No HTTP server, no network listeners

### `/app/src/main/java/com/droidlink/companion/data/DataExportReceiver.kt`
BroadcastReceiver for data export via ADB
- Receives: `com.droidlink.EXPORT_CONTACTS`, `EXPORT_MESSAGES`, `EXPORT_CALLLOGS`, `EXPORT_CHANGES`
- Queries ContentProviders and writes JSON to temp files
- Desktop retrieves data via `adb pull`

### `/app/src/main/java/com/droidlink/companion/clipboard/ClipboardReceiver.kt`
BroadcastReceiver for clipboard operations via ADB
- SET_CLIPBOARD / GET_CLIPBOARD via broadcast extras
- SET_CLIPBOARD_FILE / GET_CLIPBOARD_FILE via temp files
- Base64 encoding support for Unicode

### `/app/src/main/java/com/droidlink/companion/clipboard/ClipboardActivity.kt`
Transparent Activity for clipboard access (Android 10+ workaround)
- Background apps cannot access clipboard on Android 10+
- This activity briefly comes to foreground for clipboard operations

### `/app/src/main/java/com/droidlink/companion/ime/DroidLinkIME.kt`
Input Method Service for CJK text input from desktop
- Receives text via ADB broadcast
- Commits text to current input field
- Supports Chinese, Japanese, Korean, and all Unicode

### `/app/src/main/java/com/droidlink/companion/providers/ContactProvider.kt`
Contact data access layer
- Queries ContactsContract ContentProvider
- Multiple phones/emails per contact
- MD5 hash for change detection

### `/app/src/main/java/com/droidlink/companion/providers/SmsProvider.kt`
SMS data access layer
- Queries content://sms ContentProvider
- All message types (inbox, sent, draft)
- Timestamp filtering

### `/app/src/main/java/com/droidlink/companion/providers/CallLogProvider.kt`
Call log data access layer
- Queries CallLog.Calls ContentProvider
- All call types with duration tracking

### `/app/src/main/java/com/droidlink/companion/observers/ContentObserverManager.kt`
Real-time change detection
- ContentObservers for contacts/SMS/call logs
- Atomic change counters
- Timestamp tracking

---

## Android Manifest & Configuration

### `/app/src/main/AndroidManifest.xml`
Application manifest
- 8 permissions declared (NO INTERNET permission)
- MainActivity, ClipboardActivity
- DroidLinkService (foreground, no network)
- ClipboardReceiver, DataExportReceiver (broadcast)
- DroidLinkIME (input method service)

---

## Resource Files

### `/app/src/main/res/values/strings.xml`
String resources (Chinese + English)

### `/app/src/main/res/values/themes.xml`
Material3 theme configuration

### `/app/src/main/res/values/colors.xml`
Color definitions

### `/app/src/main/res/xml/network_security_config.xml`
Empty network security configuration (no network used)

### `/app/src/main/res/xml/method.xml`
IME configuration for DroidLinkIME

### `/app/src/main/res/xml/backup_rules.xml`
Backup configuration (excludes all data)

### `/app/src/main/res/xml/data_extraction_rules.xml`
Data extraction rules (excludes from cloud/device transfer)

---

## Documentation Files

### `/README.md` - Project documentation (bilingual)
### `/BUILDING.md` - Detailed build instructions
### `/QUICKSTART.md` - Quick start guide
### `/PROJECT_SUMMARY.md` - Technical architecture
### `/ICONS_NOTE.md` - Icon creation guide
### `/FILES_CREATED.md` - This file

---

## Communication Pattern

```
Desktop (Rust/Tauri)              Android (Companion App)
       |                                |
       |-- adb shell am broadcast ----->| DataExportReceiver
       |                                |   writes JSON to /data/local/tmp/
       |<-- adb pull -------------------|
       |                                |
       |-- adb shell am broadcast ----->| ClipboardReceiver
       |<-- adb pull -------------------|
       |                                |
       |-- adb push ------------------->| (file transfer)
       |<-- adb pull -------------------|
```

No HTTP server. No TCP connections. No adb forward. Pure ADB USB only.

---

## Permissions Declared

1. READ_CONTACTS
2. WRITE_CONTACTS
3. READ_SMS
4. READ_CALL_LOG
5. READ_PHONE_STATE
6. FOREGROUND_SERVICE
7. FOREGROUND_SERVICE_DATA_SYNC
8. POST_NOTIFICATIONS (Android 13+)

**NO INTERNET permission.**

---

## Dependencies

### Core Libraries
- Kotlin: 1.9.20
- AGP: 8.2.0

### Android Libraries
- androidx.core:core-ktx:1.12.0
- androidx.appcompat:appcompat:1.6.1
- androidx.lifecycle:lifecycle-runtime-ktx:2.7.0
- androidx.lifecycle:lifecycle-service:2.7.0
- androidx.activity:activity-compose:1.8.2

### Jetpack Compose
- Compose BOM: 2023.10.01

### Third-party
- com.google.code.gson:gson:2.10.1
- org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3

**No NanoHTTPD. No HTTP server library.**
