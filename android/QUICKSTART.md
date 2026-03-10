# DroidLink Android App - Quick Start Guide

## 5-Minute Setup

### Step 1: Open in Android Studio
```bash
# Launch Android Studio
# File > Open > Navigate to this 'android' directory
```

### Step 2: Sync Gradle
- Android Studio will prompt "Gradle files have changed"
- Click **"Sync Now"**
- Wait for dependencies to download (2-5 minutes first time)

### Step 3: Generate Icons (Optional but Recommended)
```
In Android Studio:
1. Right-click: app/src/main/res
2. New > Image Asset
3. Select "Launcher Icons"
4. Choose an icon or use clipart
5. Click Finish
```

### Step 4: Connect Your Android Device
```bash
# Enable Developer Options on your Android device:
# Settings > About Phone > Tap "Build Number" 7 times

# Enable USB Debugging:
# Settings > Developer Options > USB Debugging

# Connect via USB cable
# Accept the "Allow USB debugging" prompt on your device

# Verify connection:
adb devices
```

### Step 5: Build and Run
```
In Android Studio:
1. Click the green "Run" button (or press Shift+F10)
2. Select your device
3. Wait for build and installation
```

### Step 6: Grant Permissions
On your Android device:
1. The app will request permissions
2. Tap **"Grant Permissions"**
3. Allow all requested permissions:
   - Contacts
   - SMS
   - Call logs
   - Phone state
   - Notifications

### Step 7: Start the Service
On your Android device:
1. Tap the **"Start Service"** button
2. You should see "Service Running"
3. A persistent notification appears

### Step 8: Test via ADB
```bash
# Export contacts to temp file on device
adb shell am broadcast -a com.droidlink.EXPORT_CONTACTS \
  --es output_path '/data/local/tmp/.droidlink_contacts.json' \
  -n com.droidlink.companion/.data.DataExportReceiver

# Wait a moment for data to be written
sleep 1

# Pull the file to desktop
adb pull /data/local/tmp/.droidlink_contacts.json /tmp/contacts.json

# View the result
cat /tmp/contacts.json | jq '.[0]'
```

## That's It!

Your DroidLink companion app is now running and ready to sync with the desktop application via pure ADB USB.

**Important**: No network connections or port forwarding are needed. All communication happens through `adb shell` broadcasts and `adb push/pull` file transfers.

---

## Command-Line Build (Alternative)

If you prefer building without Android Studio:

```bash
# 1. Generate Gradle wrapper (one time only)
gradle wrapper --gradle-version 8.0

# 2. Make gradlew executable (Mac/Linux)
chmod +x gradlew

# 3. Build debug APK
./gradlew assembleDebug

# 4. Install to device
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 5. Launch the app
adb shell am start -n com.droidlink.companion/.MainActivity
```

---

## Testing Data Export

Once the service is running:

```bash
# Export contacts
adb shell am broadcast -a com.droidlink.EXPORT_CONTACTS \
  --es output_path '/data/local/tmp/.droidlink_contacts.json' \
  -n com.droidlink.companion/.data.DataExportReceiver
sleep 1
adb pull /data/local/tmp/.droidlink_contacts.json /tmp/

# Export messages
adb shell am broadcast -a com.droidlink.EXPORT_MESSAGES \
  --es output_path '/data/local/tmp/.droidlink_messages.json' \
  -n com.droidlink.companion/.data.DataExportReceiver
sleep 1
adb pull /data/local/tmp/.droidlink_messages.json /tmp/

# Export call logs
adb shell am broadcast -a com.droidlink.EXPORT_CALLLOGS \
  --es output_path '/data/local/tmp/.droidlink_calllogs.json' \
  -n com.droidlink.companion/.data.DataExportReceiver
sleep 1
adb pull /data/local/tmp/.droidlink_calllogs.json /tmp/

# Export change summary
adb shell am broadcast -a com.droidlink.EXPORT_CHANGES \
  --es output_path '/data/local/tmp/.droidlink_changes.json' \
  -n com.droidlink.companion/.data.DataExportReceiver
sleep 1
adb pull /data/local/tmp/.droidlink_changes.json /tmp/

# Test clipboard
adb shell am broadcast -a com.droidlink.SET_CLIPBOARD --es text "Hello from desktop!"
adb shell am broadcast -a com.droidlink.GET_CLIPBOARD_FILE \
  --es path '/data/local/tmp/.droidlink_clipboard.txt'
sleep 1
adb pull /data/local/tmp/.droidlink_clipboard.txt /tmp/
cat /tmp/.droidlink_clipboard.txt
```

---

## Troubleshooting

### "SDK location not found"
Create `local.properties` in the android directory:
```properties
sdk.dir=/Users/YourName/Library/Android/sdk  # macOS
# or
sdk.dir=/home/yourname/Android/Sdk           # Linux
# or
sdk.dir=C:\\Users\\YourName\\AppData\\Local\\Android\\Sdk  # Windows
```

### "Device not found" when running adb
```bash
# Check if device is connected
adb devices

# If not listed:
# 1. Check USB cable
# 2. Enable USB debugging on device
# 3. Accept the debugging prompt
# 4. Try: adb kill-server && adb start-server
```

### Build fails
```bash
# Clean and rebuild
./gradlew clean
./gradlew assembleDebug

# Or in Android Studio:
# Build > Clean Project
# Build > Rebuild Project
```

### Data export returns empty
```bash
# 1. Check service is running (notification should be visible)
# 2. Check permissions are granted
adb shell dumpsys package com.droidlink.companion | grep "permission"

# 3. Check logcat for errors
adb logcat -s DataExportReceiver ClipboardReceiver DroidLinkService
```

### Permissions not working
- Some phones (especially Chinese brands) have additional permission systems
- Go to: Settings > Apps > DroidLink > Permissions
- Manually enable all permissions
- Disable battery optimization for the app

---

## Next Steps

1. **Read the full documentation**: `README.md`
2. **Detailed build instructions**: `BUILDING.md`
3. **Technical architecture**: `PROJECT_SUMMARY.md`

---

## Requirements Checklist

Before building, ensure you have:

- [ ] Android Studio Arctic Fox or later
- [ ] JDK 8 or higher
- [ ] Android SDK Platform 34
- [ ] Android device with USB debugging enabled
- [ ] USB cable for device connection
- [ ] `ANDROID_HOME` environment variable set

---

## Debugging

```bash
# View app logs in real-time
adb logcat -s DroidLinkService DataExportReceiver ClipboardReceiver ContentObserverManager DroidLinkIME

# Clear logs first
adb logcat -c

# Filter for errors only
adb logcat *:E
```

## Testing Permissions

```bash
# Revoke all permissions (for testing)
adb shell pm revoke com.droidlink.companion android.permission.READ_CONTACTS
adb shell pm revoke com.droidlink.companion android.permission.READ_SMS
adb shell pm revoke com.droidlink.companion android.permission.READ_CALL_LOG

# Grant permissions via ADB
adb shell pm grant com.droidlink.companion android.permission.READ_CONTACTS
adb shell pm grant com.droidlink.companion android.permission.READ_SMS
adb shell pm grant com.droidlink.companion android.permission.READ_CALL_LOG
```

## Force Stop and Restart Service

```bash
# Stop the app
adb shell am force-stop com.droidlink.companion

# Start the service directly
adb shell am start-foreground-service \
  com.droidlink.companion/.DroidLinkService

# Restart the app
adb shell am start -n com.droidlink.companion/.MainActivity
```
