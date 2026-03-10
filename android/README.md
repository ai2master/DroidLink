# DroidLink Android Companion App

DroidLink Android 伴侣应用，在 Android 设备上运行，通过纯 ADB USB 通道与桌面应用通信。

This is the DroidLink Android companion app. It runs on the Android device and communicates with the desktop app via pure ADB over USB.

## 安全架构 / Security Architecture

- **零网络连接 / Zero Network**: 不使用任何 TCP、HTTP、WebSocket 或网络连接 (No TCP, HTTP, WebSocket, or network connections)
- **零 ADB Forward / Zero ADB Forward**: 不使用 `adb forward` 端口转发 (No `adb forward` port forwarding)
- **纯 ADB USB / Pure ADB USB**: 所有数据通过 `adb shell` 广播命令和 `adb push/pull` 文件传输 (All data via `adb shell` broadcasts and `adb push/pull` file transfers)
- **无 INTERNET 权限 / No INTERNET Permission**: AndroidManifest 中不声明 INTERNET 权限 (No INTERNET permission in AndroidManifest)
- **被动模式 / Passive Mode**: 仅响应桌面端发来的 ADB 命令，不会主动建立任何连接 (Only responds to ADB commands from desktop, never initiates connections)

## 通信模式 / Communication Pattern

```
桌面端 (Desktop)                         Android 端 (Phone)
     |                                        |
     |-- adb shell am broadcast ------------->| DataExportReceiver 写入 JSON 临时文件
     |                                        |   (writes JSON to temp file)
     |<-- adb pull /data/local/tmp/.droidlink_*
     |                                        |
     |-- adb shell am broadcast ------------->| ClipboardReceiver 处理剪贴板
     |                                        |   (handles clipboard)
     |                                        |
     |-- adb push file.apk /data/local/tmp/ ->| (文件传输 / file transfer)
     |<-- adb pull /sdcard/path/file.txt ---- |
```

## 功能特性 / Features

- **联系人同步 / Contacts Sync**: 通过 ADB 广播导出联系人为 JSON (Export contacts as JSON via ADB broadcast)
- **短信同步 / Messages Sync**: 通过 ADB 广播导出短信为 JSON (Export SMS as JSON via ADB broadcast)
- **通话记录同步 / Call Logs Sync**: 通过 ADB 广播导出通话记录为 JSON (Export call logs as JSON via ADB broadcast)
- **剪贴板共享 / Clipboard Share**: 通过 ADB 广播和临时文件实现剪贴板同步 (Clipboard sync via ADB broadcast and temp files)
- **DroidLink IME**: 支持从桌面输入中日韩文本到手机 (Support CJK text input from desktop to phone)
- **数据变化监控 / Change Detection**: ContentObserver 实时监控数据变化 (ContentObserver monitors data changes in real-time)

## 技术栈 / Tech Stack

- **Kotlin**: 主要开发语言 (Primary language)
- **Jetpack Compose**: 现代 UI 框架 (Modern UI framework)
- **BroadcastReceiver**: 接收桌面端通过 ADB 发送的命令 (Receive commands from desktop via ADB)
- **ContentObserver**: 监控数据变化 (Monitor data changes)
- **ContentProvider**: 本地数据访问 (Local data access)
- **Gson**: JSON 序列化 (JSON serialization)

## 项目结构 / Project Structure

```
android/
├── app/
│   ├── build.gradle.kts
│   ├── src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── java/com/droidlink/companion/
│   │   │   ├── MainActivity.kt              # 主界面 (Main UI)
│   │   │   ├── DroidLinkService.kt          # 前台服务 (Foreground service)
│   │   │   ├── clipboard/
│   │   │   │   ├── ClipboardReceiver.kt     # 剪贴板广播接收器 (Clipboard broadcast receiver)
│   │   │   │   └── ClipboardActivity.kt     # 剪贴板活动 (Android 10+ workaround)
│   │   │   ├── data/
│   │   │   │   └── DataExportReceiver.kt    # 数据导出广播接收器 (Data export broadcast receiver)
│   │   │   ├── ime/
│   │   │   │   └── DroidLinkIME.kt          # 输入法服务 (Input method service)
│   │   │   ├── observers/
│   │   │   │   └── ContentObserverManager.kt  # 内容观察器管理 (Content observer manager)
│   │   │   └── providers/
│   │   │       ├── ContactProvider.kt        # 联系人数据 (Contact data)
│   │   │       ├── SmsProvider.kt            # 短信数据 (SMS data)
│   │   │       └── CallLogProvider.kt        # 通话记录数据 (Call log data)
│   │   └── res/
│   │       ├── values/
│   │       │   ├── strings.xml
│   │       │   ├── themes.xml
│   │       │   └── colors.xml
│   │       └── xml/
│   │           ├── network_security_config.xml  # 空配置 (Empty - no network used)
│   │           ├── method.xml                   # IME 配置 (IME config)
│   │           ├── backup_rules.xml
│   │           └── data_extraction_rules.xml
├── build.gradle.kts
├── settings.gradle.kts
└── gradle.properties
```

## 构建要求 / Build Requirements

- Android Studio Arctic Fox (2020.3.1) 或更高版本
- JDK 8 或更高版本
- Android SDK API 34
- Gradle 8.0+

## 构建步骤 / Build Steps

1. 使用 Android Studio 打开 `android` 目录
2. 同步 Gradle 依赖
3. 构建 APK:
   ```bash
   ./gradlew assembleDebug
   ```
   生成的 APK 位于: `app/build/outputs/apk/debug/app-debug.apk`

4. 安装到设备:
   ```bash
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

## ADB 命令参考 / ADB Command Reference

### 数据导出 / Data Export

```bash
# 导出联系人 / Export contacts
adb shell am broadcast -a com.droidlink.EXPORT_CONTACTS \
  --es output_path '/data/local/tmp/.droidlink_contacts.json' \
  -n com.droidlink.companion/.data.DataExportReceiver
adb pull /data/local/tmp/.droidlink_contacts.json

# 导出短信 / Export messages
adb shell am broadcast -a com.droidlink.EXPORT_MESSAGES \
  --es output_path '/data/local/tmp/.droidlink_messages.json' \
  -n com.droidlink.companion/.data.DataExportReceiver
adb pull /data/local/tmp/.droidlink_messages.json

# 导出通话记录 / Export call logs
adb shell am broadcast -a com.droidlink.EXPORT_CALLLOGS \
  --es output_path '/data/local/tmp/.droidlink_calllogs.json' \
  -n com.droidlink.companion/.data.DataExportReceiver
adb pull /data/local/tmp/.droidlink_calllogs.json

# 导出变化摘要 / Export change summary
adb shell am broadcast -a com.droidlink.EXPORT_CHANGES \
  --es output_path '/data/local/tmp/.droidlink_changes.json' \
  -n com.droidlink.companion/.data.DataExportReceiver
adb pull /data/local/tmp/.droidlink_changes.json
```

### 剪贴板 / Clipboard

```bash
# 设置剪贴板 / Set clipboard
adb shell am broadcast -a com.droidlink.SET_CLIPBOARD --es text "你好世界"

# 使用 Base64 编码（支持特殊字符） / Base64 encoded
adb shell am broadcast -a com.droidlink.SET_CLIPBOARD \
  --es text "5L2g5aW95LiW55WM" --ez encoded true

# 通过文件设置剪贴板 / Set clipboard from file
adb push clipboard.txt /data/local/tmp/.droidlink_clipboard_in.txt
adb shell am broadcast -a com.droidlink.SET_CLIPBOARD_FILE \
  --es path '/data/local/tmp/.droidlink_clipboard_in.txt'

# 获取剪贴板到文件 / Get clipboard to file
adb shell am broadcast -a com.droidlink.GET_CLIPBOARD_FILE \
  --es path '/data/local/tmp/.droidlink_clipboard_out.txt'
adb pull /data/local/tmp/.droidlink_clipboard_out.txt
```

## 权限说明 / Permissions

应用需要以下权限 (App requires these permissions):

| 权限 | 用途 |
|------|------|
| READ_CONTACTS | 读取联系人 |
| WRITE_CONTACTS | 写入联系人（预留） |
| READ_SMS | 读取短信 |
| READ_CALL_LOG | 读取通话记录 |
| READ_PHONE_STATE | 读取手机状态 |
| FOREGROUND_SERVICE | 运行前台服务 |
| FOREGROUND_SERVICE_DATA_SYNC | 数据同步服务类型 |
| POST_NOTIFICATIONS | 发送通知（Android 13+） |

**注意**: 不需要 INTERNET 权限。所有通信通过 ADB USB 完成。
**Note**: No INTERNET permission required. All communication via ADB USB.

## 使用方法 / Usage

1. 安装并启动应用
2. 授予所有必要权限
3. 点击"启动服务"按钮（启动 ContentObserver 监控数据变化）
4. 桌面端通过 ADB 命令读取数据

## 最低 SDK 版本 / SDK Versions

- `minSdk`: 26 (Android 8.0 Oreo)
- `targetSdk`: 34 (Android 14)
- `compileSdk`: 34

## 依赖版本 / Dependencies

- Kotlin: 1.9.20
- Android Gradle Plugin: 8.2.0
- Jetpack Compose: BOM 2023.10.01
- Gson: 2.10.1
- AndroidX Core: 1.12.0
- AndroidX Lifecycle: 2.7.0

## 注意事项 / Notes

1. **无需 Root**: 应用仅使用标准 Android API
2. **无网络**: 不使用任何网络连接，不使用 adb forward
3. **被动模式**: 仅在收到 ADB 广播命令时才响应
4. **权限管理**: 所有敏感权限需要用户手动授予
5. **电池优化**: 建议将应用添加到电池优化白名单

## 故障排除 / Troubleshooting

### 服务无法启动
- 检查是否授予了所有必要权限
- 查看 Logcat 日志: `adb logcat | grep DroidLink`

### 数据为空
- 检查权限是否已授予
- 某些手机厂商可能有额外的权限限制
- 查看日志了解详细错误信息

### 剪贴板不工作
- Android 10+ 需要通过 ClipboardActivity 前台访问剪贴板
- 确保服务正在运行

## 许可证 / License

此项目是 DroidLink 的一部分，供学习和研究使用。
