package com.droidlink.companion

/**
 * Companion 版本与协议常量
 * Companion version and protocol constants
 *
 * PROTOCOL_VERSION 仅在 Desktop ↔ Companion 的 ADB 通信接口变更时递增：
 * - 新增/修改/删除 broadcast action
 * - 修改导出 JSON 格式
 * - 修改 DroidLinkIME 的 broadcast 接口
 * - 修改 ClipboardReceiver 的 broadcast 接口
 *
 * 内部逻辑优化（如 ContentObserver 策略、UI 调整）不需要改协议版本。
 *
 * PROTOCOL_VERSION only increments when the ADB communication interface
 * between Desktop and Companion changes:
 * - Added/modified/removed broadcast actions
 * - Changed export JSON format
 * - Changed DroidLinkIME broadcast interface
 * - Changed ClipboardReceiver broadcast interface
 *
 * Internal optimizations (ContentObserver strategy, UI tweaks) do NOT require
 * a protocol version bump.
 */
object CompanionVersion {
    /**
     * 协议版本号 / Protocol version number
     * Desktop 端有对应的 PROTOCOL_VERSION 常量，两端必须匹配。
     * Desktop has a matching PROTOCOL_VERSION constant; both sides must agree.
     */
    const val PROTOCOL_VERSION = 1
}
