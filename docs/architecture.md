# DroidLink 技术架构

## 整体架构

DroidLink 采用 Tauri v2 架构，由三部分组成：

```
+---------------------------------------------------+
|                  桌面应用 (Desktop)                  |
|                                                     |
|  +------------------+    +----------------------+   |
|  | React 前端        |    | Rust 后端             |   |
|  | (WebView)        |<-->| (Tauri Core)         |   |
|  |                  |IPC |                      |   |
|  | - Ant Design UI  |    | - ADB 管理            |   |
|  | - Zustand 状态    |    | - 数据同步引擎         |   |
|  | - react-i18next  |    | - SQLite 数据库       |   |
|  | - react-router   |    | - 版本管理            |   |
|  +------------------+    | - 剪贴板桥接          |   |
|                          | - scrcpy 控制        |   |
|                          +----------+-----------+   |
|                                     |               |
+-------------------------------------|---------------+
                                      | adb shell / adb push / adb pull
                                      | (纯 USB，零网络)
                                      |
+-------------------------------------|---------------+
|                Android Companion App                 |
|                                                     |
|  +------------------+    +----------------------+   |
|  | Jetpack Compose  |    | BroadcastReceivers    |   |
|  | (UI)             |    | - DataExportReceiver |   |
|  |                  |    | - ClipboardReceiver  |   |
|  +------------------+    +----------------------+   |
|                                                     |
|  +------------------+    +----------------------+   |
|  | DroidLinkService |    | ContentObservers      |   |
|  | (前台服务)        |    | (数据变化监控)         |   |
|  +------------------+    +----------------------+   |
|                                                     |
|  +------------------+    +----------------------+   |
|  | DroidLinkIME     |    | Data Providers        |   |
|  | (输入法服务)      |    | (ContentProvider查询) |   |
|  +------------------+    +----------------------+   |
+-----------------------------------------------------+
```

## 安全模型

### 核心约束

| 约束 | 实现方式 |
|------|---------|
| 零网络连接 | Android 端无 INTERNET 权限，Rust 端不建立到设备的网络连接 |
| 零 adb forward | 代码中无 `adb forward` 调用，无端口转发 |
| 纯 ADB USB | 所有通信仅通过 `adb shell`、`adb push`、`adb pull` |
| 被动模式 | Android 端仅响应 ADB 广播命令，不主动发起连接 |
| 单向控制 | 桌面端控制 Android 端，反向不可行 |

### 数据流向

```
桌面端发起请求:
  adb shell am broadcast -a com.droidlink.EXPORT_CONTACTS \
    --es output_path '/data/local/tmp/.droidlink_contacts.json' \
    -n com.droidlink.companion/.data.DataExportReceiver

Android 端响应:
  DataExportReceiver 接收广播
    -> ContactProvider 查询 ContentResolver
    -> Gson 序列化为 JSON
    -> 写入 /data/local/tmp/.droidlink_contacts.json

桌面端取回数据:
  adb pull /data/local/tmp/.droidlink_contacts.json {local_temp}

桌面端清理:
  adb shell rm -f /data/local/tmp/.droidlink_contacts.json
  rm {local_temp}
```

### TcpStream 唯一用途

`adb/mod.rs` 中的 `is_adb_server_running()` 使用 `TcpStream::connect_timeout` 连接 `127.0.0.1:5037`。这是检测 **桌面本机** 的 ADB 守护进程是否运行，不是连接 Android 设备。

---

## 技术栈

### 桌面端

| 层次 | 技术 | 版本 |
|------|------|------|
| 框架 | Tauri | 2.x |
| 后端语言 | Rust | 2021 edition |
| 前端框架 | React | 19.x |
| UI 组件库 | Ant Design | 5.22+ |
| 状态管理 | Zustand | 5.x |
| 国际化 | react-i18next | 15.x |
| 路由 | react-router-dom | 7.x |
| 虚拟列表 | react-virtuoso | 4.x |
| 构建工具 | Vite | 6.x |
| 类型系统 | TypeScript | 5.7+ |
| 数据库 | SQLite (rusqlite) | 0.32 |
| 序列化 | serde / serde_json | 1.x |
| 异步运行时 | Tokio | 1.x |
| 文件监控 | notify | 7.x |
| 哈希 | xxhash-rust (xxh3) | 0.8 |
| 日期时间 | chrono | 0.4 |

### Android 端

| 层次 | 技术 | 版本 |
|------|------|------|
| 语言 | Kotlin | 1.9.20 |
| UI | Jetpack Compose | BOM 2023.10.01 |
| JSON | Gson | 2.10.1 |
| 协程 | kotlinx-coroutines | 1.7.3 |
| 最低 SDK | 26 (Android 8.0) | |
| 目标 SDK | 34 (Android 14) | |
| AGP | 8.2.0 | |

---

## Rust 后端模块结构

```
src-tauri/src/
├── main.rs                 # 入口点 / Entry point
├── lib.rs                  # 模块声明、AppState、事件路由、命令注册
│                           # Module declarations, AppState, event routing, command registration
│
├── adb/mod.rs              # ADB 管理模块 / ADB management
│   ├── AdbManager          # ADB 可执行文件路径解析、冲突避免
│   ├── DeviceMonitor       # 设备热插拔监控（2秒轮询）
│   ├── shell/push/pull     # ADB 命令封装
│   └── get_adb_path()      # 暴露 ADB 路径给其他模块
│
├── commands/mod.rs         # Tauri 命令处理 / Tauri command handlers
│   ├── 设备命令             # list_devices, get_device_info
│   ├── 数据同步命令         # get_contacts, get_messages, get_call_logs, trigger_sync
│   ├── 版本管理命令         # get_versions, get_version_detail, restore_version, compare_versions
│   ├── 文件管理命令         # list_files, upload_file, download_file, delete_file
│   ├── 剪贴板命令          # get_clipboard, set_clipboard
│   └── Companion 命令      # check_companion_app, install_companion_app
│
├── db/mod.rs               # SQLite 数据库 / SQLite database
│   ├── Database            # 连接管理
│   ├── init_tables()       # 表结构初始化
│   ├── upsert_contact/message/call_log  # 数据写入
│   └── VersionRecord       # 版本记录结构体
│
├── sync/mod.rs             # 数据同步引擎 / Data sync engine
│   ├── SyncEngine          # 同步调度和状态管理
│   ├── fetch_via_companion_adb()  # 通过 ADB 广播+pull 获取数据
│   ├── sync_contacts/messages/call_logs  # 按类型同步
│   └── 冲突检测             # 基于 xxh3 哈希的变更检测
│
├── version/mod.rs          # 版本管理 / Version management
│   ├── VersionManager      # 版本创建、查询、恢复
│   ├── create_version()    # 创建版本快照（JSON 文件）
│   ├── get_version_detail()# 获取版本详情
│   └── restore_version()   # 恢复版本数据
│
├── clipboard/mod.rs        # 剪贴板桥接 / Clipboard bridge
│   ├── ClipboardBridge     # 双向剪贴板同步
│   └── ADB broadcast 通信  # 通过广播和文件传输
│
├── scrcpy/mod.rs           # 屏幕镜像 / Screen mirroring
│   ├── ScrcpyManager       # scrcpy 进程管理
│   └── 参数配置             # 分辨率、比特率、帧率等
│
├── filemanager/mod.rs      # 文件管理 / File manager
│   ├── list_files()        # adb shell ls 列出文件
│   ├── push_file()         # adb push 上传
│   └── pull_file()         # adb pull 下载
│
└── transfer/mod.rs         # 文件夹同步 / Folder sync
    ├── FolderSync          # 同步规则管理
    ├── notify watcher      # 本地文件变化监控
    └── 增量同步             # 基于哈希的增量传输
```

## 前端结构

```
src/
├── main.tsx                # React 入口 / React entry
├── App.tsx                 # 根组件：路由、设备事件监听、Companion 安装提示
│
├── pages/
│   ├── Dashboard.tsx       # 仪表盘：设备信息、数据统计、同步状态
│   ├── ScreenMirror.tsx    # 屏幕镜像：scrcpy 控制、触控输入、IME 切换
│   ├── Contacts.tsx        # 联系人：列表、搜索、版本历史/预览/对比/恢复
│   ├── Messages.tsx        # 短信：按联系人分组、版本历史
│   ├── CallLogs.tsx        # 通话记录：列表、版本历史
│   ├── FileManager.tsx     # 文件管理器：浏览、上传、下载
│   ├── FolderSync.tsx      # 文件夹同步：规则管理、状态显示
│   ├── Transfer.tsx        # 快速传输
│   ├── VersionHistory.tsx  # 版本历史：时间线、对比模式、恢复
│   └── Settings.tsx        # 设置：语言、同步、ADB、输入法
│
├── components/
│   ├── Sidebar.tsx              # 侧边导航栏
│   ├── StatusBar.tsx            # 底部状态栏（连接/同步状态）
│   ├── VersionPreview.tsx       # 版本数据富预览（按类型渲染）
│   ├── VersionDiffView.tsx      # 版本对比（并排、字段级高亮）
│   └── CompanionInstallPrompt.tsx  # Companion APK 安装提示对话框
│
├── stores/
│   └── useStore.ts         # Zustand 全局状态（设备信息、同步状态）
│
├── i18n/
│   ├── index.ts            # i18next 初始化配置
│   └── locales/
│       ├── zh.json         # 简体中文（~480 keys）
│       ├── en.json         # English
│       ├── ja.json         # 日本語
│       ├── ko.json         # 한국어
│       ├── ru.json         # Русский
│       ├── de.json         # Deutsch
│       └── ar.json         # العربية
│
├── utils/
│   ├── tauri.ts            # Tauri IPC 封装（invoke, listen）
│   └── format.ts           # 格式化工具（文件大小、日期等）
│
└── styles/
    └── global.css          # 全局样式
```

## Android Companion App 结构

```
android/app/src/main/java/com/droidlink/companion/
├── MainActivity.kt              # Compose UI：权限请求、服务控制
├── DroidLinkService.kt          # 前台服务：启动 ContentObservers
│
├── data/
│   └── DataExportReceiver.kt    # 数据导出广播接收器
│       接收: EXPORT_CONTACTS / EXPORT_MESSAGES / EXPORT_CALLLOGS / EXPORT_CHANGES
│       流程: 接收广播 -> 查询 Provider -> 写 JSON 到 output_path
│
├── clipboard/
│   ├── ClipboardReceiver.kt     # 剪贴板广播接收器
│   │   接收: SET_CLIPBOARD / GET_CLIPBOARD / SET_CLIPBOARD_FILE / GET_CLIPBOARD_FILE
│   └── ClipboardActivity.kt     # Android 10+ 前台剪贴板访问 workaround
│
├── ime/
│   └── DroidLinkIME.kt          # 输入法服务：接收 ADB 广播文本，提交到输入框
│
├── observers/
│   └── ContentObserverManager.kt # 注册 ContentObserver 监控联系人/短信/通话记录变化
│
└── providers/
    ├── ContactProvider.kt        # 查询联系人（多电话/邮箱、MD5 哈希）
    ├── SmsProvider.kt            # 查询短信（全类型、时间戳过滤）
    └── CallLogProvider.kt        # 查询通话记录（全类型、时长）
```

## 关键数据流

### 1. 设备连接流程

```
DeviceMonitor (每2秒轮询 adb devices)
  -> 检测到新设备
  -> 发射 device-connected 事件 (含设备信息)
  -> 启动线程: adb shell pm list packages com.droidlink.companion
  -> 发射 companion-status 事件
  -> 前端收到事件:
     - 更新 Zustand store 中的 connectedDevice
     - 如果 companion 未安装，显示 CompanionInstallPrompt
  -> 触发自动同步 (如果已配置)
```

### 2. 数据同步流程

```
SyncEngine.sync_contacts(serial)
  -> fetch_via_companion_adb(serial, "EXPORT_CONTACTS", "contacts")
     -> adb shell am broadcast -a com.droidlink.EXPORT_CONTACTS ...
     -> sleep 500ms (等待 Android 端写文件)
     -> adb pull /data/local/tmp/.droidlink_contacts.json
     -> 读取本地 JSON 文件
     -> 清理临时文件 (本地 + 设备端)
  -> 解析 JSON 为 Vec<Contact>
  -> 与数据库中现有数据比较 (xxh3 哈希)
  -> 对变更的记录:
     -> VersionManager.create_version() 创建版本快照
     -> db.upsert_contact() 更新数据库
  -> 发射 sync-complete 事件
```

### 3. 版本恢复流程

```
commands::restore_version(version_id)
  -> VersionManager.get_version_detail(version_id)
     -> 读取版本记录 + JSON 快照文件
  -> 获取当前数据库状态作为 data_before
  -> 将恢复数据通过 upsert 写回数据库
  -> VersionManager.create_version(action="restore")
     -> 创建新版本记录 (不修改/删除旧版本)
     -> 保存新快照文件
  -> 返回成功结果
```

### 4. Companion APK 安装流程

```
前端: 用户点击 "安装 Companion App"
  -> invoke('install_companion_app', { serial })
  -> Rust: 解析 Tauri 资源目录
     -> 找到 resources/companion/DroidLinkCompanion.apk
     -> 验证非占位符文件 (>1KB)
     -> adb -s {serial} install -r {apk_path}
  -> 处理结果:
     - Success -> 返回成功
     - INSTALL_FAILED_USER_RESTRICTED -> 提示开启"通过USB安装"
     - INSTALL_FAILED_VERIFICATION_FAILURE -> 提示关闭安装验证
  -> 前端显示结果 (成功/失败及建议操作)
```

## 数据库结构

SQLite 数据库位于 Tauri 应用数据目录下：

### contacts 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 联系人 ID |
| device_serial | TEXT | 设备序列号 |
| display_name | TEXT | 显示名称 |
| phone_numbers | TEXT | JSON 数组 |
| emails | TEXT | JSON 数组 |
| organization | TEXT | 组织/公司 |
| hash | TEXT | xxh3 哈希 |
| updated_at | TEXT | 更新时间 |

### messages / call_logs 表
结构类似，包含各自数据类型的字段。

### versions 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID v4 |
| device_serial | TEXT | 设备序列号 |
| data_type | TEXT | contacts / messages / call_logs |
| item_id | TEXT | 关联数据项 ID |
| action | TEXT | create / update / delete / restore |
| snapshot_path | TEXT | JSON 快照文件路径 |
| data_before | TEXT | 变更前数据摘要 |
| data_after | TEXT | 变更后数据摘要 |
| source | TEXT | desktop / android |
| description | TEXT | 变更描述 |
| created_at | TEXT | 创建时间 |

版本快照文件存储在：`{app_data}/versions/{data_type}/{version_id}.json`

## 构建配置

### 开发模式
```bash
npm install
npm run tauri dev
```

### 生产构建
```bash
npm run tauri build
```

生成物：
- Windows: `src-tauri/target/release/bundle/msi/DroidLink_x.x.x_x64_en-US.msi`
- macOS: `src-tauri/target/release/bundle/dmg/DroidLink_x.x.x_x64.dmg`
- Linux: `src-tauri/target/release/bundle/deb/droidlink_x.x.x_amd64.deb` + AppImage

### Companion App 构建
```bash
cd android
./gradlew assembleRelease
# 输出: app/build/outputs/apk/release/app-release.apk
```

`build.rs` 会在 Tauri 构建时自动将 APK 复制到 `resources/companion/DroidLinkCompanion.apk`。

## Tauri 安全配置

### CSP (Content Security Policy)
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src ipc: http://ipc.localhost
```

### 文件系统访问控制
```json
"allow": ["$APPDATA/**", "$DOWNLOAD/**", "$TEMP/**", "$HOME/**"],
"deny": ["**/.ssh/**", "**/.gnupg/**", "**/id_rsa*", "**/*.key", "**/*.pem"]
```

禁止访问 SSH 密钥、GPG 密钥和证书文件。
