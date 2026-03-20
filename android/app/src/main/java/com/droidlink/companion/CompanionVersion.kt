package com.droidlink.companion

/**
 * =====================================================================
 * DroidLink Companion 版本与协议常量
 * DroidLink Companion Version & Protocol Constants
 * =====================================================================
 *
 * 【三层版本方案 / Three-Layer Version Scheme】
 *
 * DroidLink 采用三层版本管理机制来解决 Desktop 和 Companion 独立更新的问题：
 * DroidLink uses a three-layer version management scheme to handle
 * independent Desktop and Companion update cycles:
 *
 *   1. 语义版本号 (Semantic Version) - 手动维护
 *      Semantic version - manually maintained
 *      例如 / Example: "2.0.0" (基础版本), CI 生成 "2.0.42" (MAJOR.MINOR.BUILD)
 *      ── 在 tauri.conf.json (Desktop) 和 build.gradle.kts (Companion) 中定义
 *      ── Defined in tauri.conf.json (Desktop) and build.gradle.kts (Companion)
 *      ── 仅在功能性重大变更时手动更新 MAJOR/MINOR
 *      ── Only manually update MAJOR/MINOR on significant feature changes
 *      ── Tauri v2 要求严格 3 段 semver，CI 用 commit count 作为第三段
 *      ── Tauri v2 requires strict 3-segment semver, CI uses commit count as third segment
 *
 *   2. 协议版本号 (Protocol Version) - 手动维护，本文件定义
 *      Protocol version - manually maintained, defined in this file
 *      例如 / Example: 1
 *      ── 仅在 Desktop ↔ Companion 的 ADB 通信接口变更时递增
 *      ── Only incremented when Desktop ↔ Companion ADB communication interface changes
 *      ── Desktop 端有对应的 PROTOCOL_VERSION 常量 (commands/mod.rs)
 *      ── Desktop has a matching PROTOCOL_VERSION constant (commands/mod.rs)
 *
 *   3. 构建标识符 (Build Identifier) - CI 自动生成
 *      Build identifier - CI auto-generated
 *      例如 / Example: 42 (来自 git commit count / from git commit count)
 *      ── CI 通过 gradle 属性注入 versionCode 和 versionName
 *      ── CI injects versionCode and versionName via gradle properties
 *      ── 本地开发使用 build.gradle.kts 中的默认值
 *      ── Local development uses defaults from build.gradle.kts
 *
 * 【需要递增 PROTOCOL_VERSION 的场景 / When to increment PROTOCOL_VERSION】
 *
 *   需要递增 / MUST increment:
 *   - 新增、修改或删除 broadcast action (如 EXPORT_CONTACTS, EXPORT_CHANGES)
 *     Added/modified/removed broadcast actions (e.g. EXPORT_CONTACTS, EXPORT_CHANGES)
 *   - 修改导出的 JSON 字段格式 (增删改字段名、类型或嵌套结构)
 *     Changed export JSON field format (add/remove/modify field names, types, or nesting)
 *   - 修改 DroidLinkIME 的 broadcast 输入接口
 *     Changed DroidLinkIME broadcast input interface
 *   - 修改 ClipboardReceiver 的 broadcast 接口
 *     Changed ClipboardReceiver broadcast interface
 *   - 修改 intent extra 的键名或值类型
 *     Changed intent extra key names or value types
 *
 *   不需要递增 / DO NOT increment:
 *   - 内部逻辑优化 (ContentObserver 策略调整、性能改进)
 *     Internal logic optimizations (ContentObserver strategy, performance)
 *   - UI 界面调整 (Companion 应用本身的界面变更)
 *     UI adjustments (Companion app's own interface changes)
 *   - 权限检查逻辑变更 (不影响输出格式)
 *     Permission check logic changes (not affecting output format)
 *   - 日志输出变更
 *     Log output changes
 *
 * 【版本兼容判断流程 / Version Compatibility Check Flow】
 *
 *   Desktop 连接设备时:
 *   When Desktop connects to device:
 *     1. 通过 EXPORT_CHANGES broadcast 获取设备端的 protocolVersion
 *        Get device's protocolVersion via EXPORT_CHANGES broadcast
 *     2. 如果 device.protocolVersion >= desktop.PROTOCOL_VERSION → 兼容，不提示更新
 *        If device.protocolVersion >= desktop.PROTOCOL_VERSION → compatible, no update prompt
 *     3. 如果 device.protocolVersion < desktop.PROTOCOL_VERSION → 不兼容，提示更新
 *        If device.protocolVersion < desktop.PROTOCOL_VERSION → incompatible, prompt update
 *     4. 如果无法获取 protocolVersion (旧版 Companion) → 回退到 versionName 字符串比较
 *        If cannot get protocolVersion (old Companion) → fallback to versionName comparison
 *
 * @see commands/mod.rs - Desktop 端的 PROTOCOL_VERSION 常量和判断逻辑
 *                        Desktop side PROTOCOL_VERSION constant and check logic
 * @see DataExportReceiver.kt - EXPORT_CHANGES 响应中包含 protocolVersion
 *                              EXPORT_CHANGES response includes protocolVersion
 * @see build.gradle.kts - CI 注入的 versionCode/versionName
 *                         CI-injected versionCode/versionName
 * @see .github/workflows/build.yml - 统一版本号生成逻辑
 *                                    Unified version number generation logic
 */
object CompanionVersion {
    /**
     * 协议版本号 / Protocol version number
     *
     * Desktop 端有对应的 PROTOCOL_VERSION 常量 (src-tauri/src/commands/mod.rs)，两端必须保持一致。
     * Desktop has a matching PROTOCOL_VERSION constant (src-tauri/src/commands/mod.rs);
     * both sides must agree on this value.
     *
     * 修改此值时请同时修改：
     * When modifying this value, also update:
     *   1. src-tauri/src/commands/mod.rs → pub const PROTOCOL_VERSION
     *   2. .github/workflows/build.yml → version.txt 中的 protocolVersion 字段
     *      .github/workflows/build.yml → protocolVersion field in version.txt
     */
    const val PROTOCOL_VERSION = 1
}
