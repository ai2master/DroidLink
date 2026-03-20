# DroidLink 三层版本方案 / Three-Layer Version Scheme

## 概述 / Overview

DroidLink 采用三层版本管理机制，解决 Desktop 和 Companion APK 独立更新周期导致的版本混乱问题。

DroidLink uses a three-layer version management scheme to solve version confusion caused by independent update cycles between Desktop and Companion APK.

**核心改进 / Core Improvement:**
- 旧方案：每次 CI 构建都改版本号 → Companion 永远显示 "需要更新" (误报)
- Before: every CI build changed version → Companion always showed "needs update" (false positive)
- 新方案：基于协议版本判断兼容性 → 只有 ADB 接口不兼容时才提示更新
- After: compatibility based on protocol version → only prompts update when ADB interface is incompatible

---

## 三层版本 / Three Layers

### 第 1 层：语义版本号 (Semantic Version) — 手动维护

| 属性 / Property | 值 / Value |
|---|---|
| 格式 / Format | `MAJOR.MINOR.PATCH` (如 `2.0.0`) |
| 定义位置 / Defined in | `src-tauri/tauri.conf.json` → `version` 字段 |
| 何时修改 / When to change | 重大功能变更、破坏性变更、新功能里程碑 |
| 谁来修改 / Who changes | 开发者手动修改 |

**说明 / Description:**
- 遵循语义化版本规范 (SemVer)。
  Follows Semantic Versioning specification.
- MAJOR：不兼容的 API 变更 / Incompatible API changes
- MINOR：向后兼容的新功能 / Backward-compatible new features
- PATCH：向后兼容的 bug 修复 / Backward-compatible bug fixes
- CI 构建时读取此值作为基础版本，不修改源文件。
  CI reads this value as the base version at build time, does not modify source.

### 第 2 层：协议版本号 (Protocol Version) — 手动维护

| 属性 / Property | 值 / Value |
|---|---|
| 格式 / Format | 正整数 (如 `1`) |
| 定义位置 / Defined in | 三处同步定义 (见下方) |
| 何时修改 / When to change | Desktop ↔ Companion 的 ADB 通信接口变更时 |
| 谁来修改 / Who changes | 开发者手动修改 (三处同时改) |

**三处定义位置 / Three definition locations:**

| 文件 / File | 常量 / Constant |
|---|---|
| `src-tauri/src/commands/mod.rs` | `pub const PROTOCOL_VERSION: u32 = 1;` |
| `android/.../CompanionVersion.kt` | `const val PROTOCOL_VERSION = 1` |
| `.github/workflows/build.yml` | `protocolVersion: 1` (version.txt JSON 中) |

**需要递增的场景 / When to increment:**

| 场景 / Scenario | 是否递增 / Increment? |
|---|---|
| 新增 broadcast action (如 `EXPORT_NEW_DATA`) | **是 / YES** |
| 修改导出 JSON 字段 (增删改字段名/类型) | **是 / YES** |
| 修改 intent extra 键名或值类型 | **是 / YES** |
| 修改 DroidLinkIME broadcast 接口 | **是 / YES** |
| 修改 ClipboardReceiver broadcast 接口 | **是 / YES** |
| 内部逻辑优化 (性能、ContentObserver 策略) | **否 / NO** |
| Companion UI 界面调整 | **否 / NO** |
| 权限检查逻辑变更 (不影响输出格式) | **否 / NO** |
| Desktop 前端 UI 变更 | **否 / NO** |
| 日志输出变更 | **否 / NO** |

### 第 3 层：构建标识符 (Build Identifier) — CI 自动生成

| 属性 / Property | 值 / Value |
|---|---|
| 格式 / Format | 正整数 (如 `42`) |
| 来源 / Source | `git rev-list --count HEAD` (commit count) |
| 生成位置 / Generated in | `.github/workflows/build.yml` |
| 何时变化 / When it changes | 每次 git commit 自动递增 |

**说明 / Description:**
- 确保每次 CI 构建产出的版本号唯一。
  Ensures every CI build produces a unique version number.
- 同时作为 Android `versionCode` (Google Play 要求每次发布必须递增)。
  Also used as Android `versionCode` (Google Play requires monotonic increase).
- 配合 git commit SHA (7 位) 可精确追溯到源码。
  Combined with git commit SHA (7 chars) enables precise source code tracing.

---

## 完整版本号格式 / Full Version Number Format

```
{MAJOR}.{MINOR}.{PATCH}.{BUILD}
  2   .  0   .  0   .  42

  ↑ 语义版本 (手动)      ↑ 构建号 (CI 自动)
  ↑ Semantic (manual)    ↑ Build number (CI auto)
```

- Desktop 显示版本: `2.0.0.42`
- Companion versionName: `2.0.0.42`
- Companion versionCode: `42`

---

## 版本号在各组件中的流动 / Version Flow Across Components

```
┌─────────────────────────────────────────────────┐
│ 源码 / Source Code                               │
│                                                   │
│  tauri.conf.json: "version": "2.0.0" (手动维护)  │
│  CompanionVersion.kt: PROTOCOL_VERSION = 1       │
│  commands/mod.rs: PROTOCOL_VERSION = 1           │
└───────────────────────┬─────────────────────────┘
                        │ git push → CI 触发 / CI triggered
                        ▼
┌─────────────────────────────────────────────────┐
│ CI (build.yml)                                    │
│                                                   │
│  读取 tauri.conf.json → BASE_VERSION = "2.0.0"  │
│  git commit count → BUILD_NUMBER = "42"          │
│  git short SHA → SHORT_SHA = "9d8f3a1"           │
│  VERSION = "2.0.0.42"                            │
│                                                   │
│  ┌─ 写入 tauri.conf.json: "2.0.0.42" (临时)     │
│  ├─ 写入 Cargo.toml: "2.0.0.42" (临时)          │
│  ├─ 传给 gradle: -PciVersionCode=42             │
│  │               -PciVersionName="2.0.0.42"     │
│  └─ 生成 version.txt JSON:                       │
│     {                                             │
│       "version": "2.0.0",                        │
│       "build": 42,                               │
│       "versionCode": 42,                         │
│       "protocolVersion": 1,                      │
│       "sha": "9d8f3a1"                           │
│     }                                             │
└───────────────────────┬─────────────────────────┘
                        │ 编译构建 / Build
                        ▼
┌─────────────────────────────────────────────────┐
│ 产出 / Build Artifacts                            │
│                                                   │
│  Desktop 安装包:                                  │
│    内置 version.txt JSON + DroidLinkCompanion.apk│
│    版本号: 2.0.0.42                              │
│                                                   │
│  Companion APK:                                   │
│    versionCode: 42                               │
│    versionName: "2.0.0.42"                       │
│    内部 PROTOCOL_VERSION: 1                      │
└─────────────────────────────────────────────────┘
```

---

## 兼容性判断流程 / Compatibility Check Flow

当 Desktop 检测到 USB 设备连接时，自动执行以下检查：

When Desktop detects a USB device connection, it automatically performs this check:

```
设备连接 / Device Connected
    │
    ▼
pm list packages com.droidlink.companion
    │
    ├── 未安装 / Not installed
    │   → 前端弹出安装提示 / Frontend shows install prompt
    │
    └── 已安装 / Installed
        │
        ▼
    发送 EXPORT_CHANGES broadcast → 获取 protocolVersion
    Send EXPORT_CHANGES broadcast → get protocolVersion
        │
        ├── 获取成功 (新版 Companion)
        │   Got protocolVersion (new Companion)
        │   │
        │   ├── device.proto >= desktop.PROTO
        │   │   → 兼容，不提示更新
        │   │     Compatible, no update prompt
        │   │     Dashboard 显示 "协议兼容，无需更新"
        │   │     Dashboard shows "Protocol compatible"
        │   │
        │   └── device.proto < desktop.PROTO
        │       → 不兼容，提示更新
        │         Incompatible, prompt update
        │         Dashboard 显示版本对比
        │         Dashboard shows version comparison
        │
        └── 获取失败 (旧版 Companion, 无 protocolVersion 字段)
            Failed (old Companion, no protocolVersion field)
            │
            └── 回退到 versionName 字符串比较
                Fallback to versionName string comparison
                deviceVersion != bundledVersion → 提示更新
                deviceVersion != bundledVersion → prompt update
```

---

## 相关文件索引 / Related File Index

### 后端 (Rust) / Backend

| 文件 / File | 说明 / Description |
|---|---|
| `src-tauri/src/commands/mod.rs` | `PROTOCOL_VERSION` 常量、`check_companion_app()` 命令、`get_device_protocol_version()` 设备协议查询、`get_bundled_companion_info()` 版本文件读取、`get_bundled_companion_version_public()` 版本号拼接 |
| `src-tauri/src/lib.rs` | 设备连接时自动检查 Companion 状态并 emit `companion-status` 事件 |
| `src-tauri/tauri.conf.json` | 基础语义版本定义 (`"version": "2.0.0"`) |
| `src-tauri/Cargo.toml` | 包版本 (CI 构建时临时覆盖) |

### Android (Kotlin) / Companion

| 文件 / File | 说明 / Description |
|---|---|
| `android/.../CompanionVersion.kt` | `PROTOCOL_VERSION` 常量定义，包含完整的三层版本方案说明文档 |
| `android/.../DataExportReceiver.kt` | `handleExportChanges()` 方法在响应中包含 `protocolVersion` 字段 |
| `android/app/build.gradle.kts` | 通过 `project.findProperty()` 接收 CI 注入的 `ciVersionCode` 和 `ciVersionName` |

### 前端 (TypeScript/React) / Frontend

| 文件 / File | 说明 / Description |
|---|---|
| `src/stores/useStore.ts` | `CompanionStatus` 接口定义，包含 `protocolVersion` 和 `deviceProtocolVersion` 字段 |
| `src/App.tsx` | 监听 `companion-status` Tauri 事件，写入 store，触发安装/更新提示 |
| `src/pages/Dashboard.tsx` | Companion 状态卡片 UI，根据 `needsUpdate` 显示不同状态 |
| `src/i18n/locales/*.json` | `companion.protocolOk` 翻译键 (7 种语言) |

### CI / GitHub Actions

| 文件 / File | 说明 / Description |
|---|---|
| `.github/workflows/build.yml` | 统一版本号生成、Companion APK 构建 + version.txt JSON 生成 |

---

## 开发者操作指南 / Developer Guide

### 日常开发 (不涉及 ADB 接口变更)

1. 正常开发提交代码
2. CI 自动递增构建号
3. Companion 不会收到 "需要更新" 提示
4. **无需任何版本操作**

### 发布新功能里程碑

1. 修改 `src-tauri/tauri.conf.json` 中的 `version` 字段 (如 `"2.0.0"` → `"2.1.0"`)
2. 提交并推送
3. CI 自动生成完整版本号 (如 `"2.1.0.58"`)

### 修改了 ADB 通信接口

1. 修改 `src-tauri/src/commands/mod.rs` 中的 `PROTOCOL_VERSION` (如 `1` → `2`)
2. 修改 `android/.../CompanionVersion.kt` 中的 `PROTOCOL_VERSION` (如 `1` → `2`)
3. 修改 `.github/workflows/build.yml` 中 version.txt 的 `protocolVersion` (如 `1` → `2`)
4. 提交并推送
5. 所有使用旧版 Companion 的用户将收到 "需要更新" 提示

### 本地开发 Companion APK

- 本地构建使用 `build.gradle.kts` 中的默认值: `versionCode=2`, `versionName="2.0.0"`
- 如需模拟 CI 版本: `gradle assembleRelease -PciVersionCode=99 -PciVersionName="2.0.0.99"`

---

## 常见问题 / FAQ

### Q: 为什么不直接用 versionName 比较？/ Why not just compare versionName?

**A:** 因为 Desktop 和 Companion 共享同一个 CI 构建流程。每次 Desktop 有代码改动 (即使完全不涉及 Companion)，CI 重新构建时 Companion 的 versionName 也会因为 commit count 增加而改变，导致已安装的 Companion 永远显示 "需要更新"。

Because Desktop and Companion share the same CI build pipeline. Every Desktop code change (even those completely unrelated to Companion) causes Companion's versionName to change due to increased commit count, making installed Companion always show "needs update".

### Q: protocolVersion 是如何传递的？/ How is protocolVersion transmitted?

**A:** Desktop 通过 ADB 发送 `EXPORT_CHANGES` broadcast 到 Companion 的 `DataExportReceiver`。Receiver 将包含 `protocolVersion` 字段的 JSON 写入临时文件 `/data/local/tmp/.droidlink_proto_check.json`，Desktop 读取后解析。

Desktop sends `EXPORT_CHANGES` broadcast to Companion's `DataExportReceiver` via ADB. The receiver writes JSON containing `protocolVersion` to temp file `/data/local/tmp/.droidlink_proto_check.json`, which Desktop reads and parses.

### Q: 旧版 Companion (没有 protocolVersion) 怎么处理？/ How are old Companions handled?

**A:** 如果 `get_device_protocol_version()` 返回 `None` (旧版 Companion 的 EXPORT_CHANGES 响应不含此字段)，则回退到 versionName 字符串比较。这确保了向后兼容。

If `get_device_protocol_version()` returns `None` (old Companion's EXPORT_CHANGES response lacks this field), it falls back to versionName string comparison. This ensures backward compatibility.

### Q: 三处 protocolVersion 不一致会怎样？/ What if protocolVersion is inconsistent across the three locations?

**A:**
- `mod.rs` 和 `CompanionVersion.kt` 不一致 → Desktop 和 Companion 协议版本不匹配，会错误地触发/不触发更新提示
- `build.yml` 和 `mod.rs` 不一致 → version.txt 中的 protocolVersion 不准确，但不影响运行时判断 (运行时使用 `mod.rs` 中的常量)
- 三处应始终保持一致！
