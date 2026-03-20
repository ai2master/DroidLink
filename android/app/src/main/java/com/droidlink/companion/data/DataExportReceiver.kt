package com.droidlink.companion.data

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.droidlink.companion.CompanionVersion
import com.droidlink.companion.providers.CallLogProvider
import com.droidlink.companion.providers.ContactProvider
import com.droidlink.companion.providers.SmsProvider
import com.google.gson.GsonBuilder
import java.io.File

/**
 * Handles data export requests from the desktop app via ADB broadcast commands.
 * All communication is pure ADB over USB - no TCP/HTTP involved.
 *
 * 细粒度权限检查：每个导出操作独立检查所需权限。
 * 如果权限未授予，返回明确的错误信息而不是崩溃。
 * Granular permission check: each export operation independently checks required permission.
 * Returns clear error message if permission not granted instead of crashing.
 *
 * Pattern:
 * 1. Desktop sends: adb shell am broadcast -a com.droidlink.EXPORT_CONTACTS --es output_path /data/local/tmp/.droidlink_contacts.json
 * 2. This receiver checks permission, queries ContentProviders and writes JSON to the specified file
 * 3. Desktop retrieves: adb pull /data/local/tmp/.droidlink_contacts.json
 */
class DataExportReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "DataExportReceiver"
        const val ACTION_EXPORT_CONTACTS = "com.droidlink.EXPORT_CONTACTS"
        const val ACTION_EXPORT_MESSAGES = "com.droidlink.EXPORT_MESSAGES"
        const val ACTION_EXPORT_CALLLOGS = "com.droidlink.EXPORT_CALLLOGS"
        const val ACTION_EXPORT_CHANGES = "com.droidlink.EXPORT_CHANGES"
    }

    private val gson = GsonBuilder()
        .disableHtmlEscaping()
        .create()

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null || intent == null) {
            Log.w(TAG, "Null context or intent")
            return
        }

        val outputPath = intent.getStringExtra("output_path")

        when (intent.action) {
            ACTION_EXPORT_CONTACTS -> handleExportContacts(context, outputPath)
            ACTION_EXPORT_MESSAGES -> handleExportMessages(context, outputPath)
            ACTION_EXPORT_CALLLOGS -> handleExportCallLogs(context, outputPath)
            ACTION_EXPORT_CHANGES -> handleExportChanges(context, outputPath)
            else -> Log.w(TAG, "Unknown action: ${intent.action}")
        }
    }

    private fun handleExportContacts(context: Context, outputPath: String?) {
        val path = outputPath ?: "/data/local/tmp/.droidlink_contacts.json"
        // 检查联系人权限 / Check contacts permission
        if (!hasPermission(context, Manifest.permission.READ_CONTACTS)) {
            writePermissionError(path, "READ_CONTACTS")
            return
        }
        try {
            val provider = ContactProvider(context)
            val contacts = provider.getAllContacts()
            val json = gson.toJson(contacts)
            File(path).writeText(json, Charsets.UTF_8)
            Log.i(TAG, "Exported ${contacts.size} contacts to $path")
        } catch (e: Exception) {
            Log.e(TAG, "Error exporting contacts", e)
            writeError(path, e)
        }
    }

    private fun handleExportMessages(context: Context, outputPath: String?) {
        val path = outputPath ?: "/data/local/tmp/.droidlink_messages.json"
        // 检查短信权限 / Check SMS permission
        if (!hasPermission(context, Manifest.permission.READ_SMS)) {
            writePermissionError(path, "READ_SMS")
            return
        }
        try {
            val provider = SmsProvider(context)
            val messages = provider.getAllMessages()
            val json = gson.toJson(messages)
            File(path).writeText(json, Charsets.UTF_8)
            Log.i(TAG, "Exported ${messages.size} messages to $path")
        } catch (e: Exception) {
            Log.e(TAG, "Error exporting messages", e)
            writeError(path, e)
        }
    }

    private fun handleExportCallLogs(context: Context, outputPath: String?) {
        val path = outputPath ?: "/data/local/tmp/.droidlink_calllogs.json"
        // 检查通话记录权限 / Check call log permission
        if (!hasPermission(context, Manifest.permission.READ_CALL_LOG)) {
            writePermissionError(path, "READ_CALL_LOG")
            return
        }
        try {
            val provider = CallLogProvider(context)
            val callLogs = provider.getAllCallLogs()
            val json = gson.toJson(callLogs)
            File(path).writeText(json, Charsets.UTF_8)
            Log.i(TAG, "Exported ${callLogs.size} call logs to $path")
        } catch (e: Exception) {
            Log.e(TAG, "Error exporting call logs", e)
            writeError(path, e)
        }
    }

    /**
     * 处理 EXPORT_CHANGES 请求：返回数据可用状态摘要 + 协议版本号
     * Handle EXPORT_CHANGES request: return data availability summary + protocol version
     *
     * 此方法有两个用途 / This method serves two purposes:
     *   1. 告诉 Desktop 哪些数据类型有权限可导出 (contacts=1 表示有权限, 0 表示无权限)
     *      Tell Desktop which data types have export permission (1=granted, 0=denied)
     *   2. 在响应中携带 protocolVersion 字段，让 Desktop 判断协议是否兼容
     *      Include protocolVersion in response for Desktop to check protocol compatibility
     *
     * Desktop 调用路径 / Desktop call path:
     *   adb shell am broadcast -a com.droidlink.EXPORT_CHANGES \
     *     --es output_path '/data/local/tmp/.droidlink_changes.json' \
     *     -n com.droidlink.companion/.data.DataExportReceiver
     *   → 读取输出文件提取 protocolVersion 字段
     *   → Read output file to extract protocolVersion field
     *
     * 输出 JSON 格式 / Output JSON format:
     *   {
     *     "contacts": 1,           // 1=权限已授予 / 1=permission granted
     *     "messages": 0,           // 0=权限未授予 / 0=permission denied
     *     "callLogs": 1,
     *     "protocolVersion": 1     // 协议版本号 / protocol version number
     *   }
     *
     * @see CompanionVersion.PROTOCOL_VERSION - 协议版本常量定义
     *                                          Protocol version constant definition
     * @see commands/mod.rs get_device_protocol_version() - Desktop 端解析此字段的逻辑
     *                                                       Desktop side parsing logic
     */
    private fun handleExportChanges(context: Context, outputPath: String?) {
        val path = outputPath ?: "/data/local/tmp/.droidlink_changes.json"
        try {
            // 构建变更摘要：每种数据类型的权限状态 + 协议版本号
            // Build change summary: permission status for each data type + protocol version
            val changeSummary = mapOf(
                "contacts" to if (hasPermission(context, Manifest.permission.READ_CONTACTS)) 1 else 0,
                "messages" to if (hasPermission(context, Manifest.permission.READ_SMS)) 1 else 0,
                "callLogs" to if (hasPermission(context, Manifest.permission.READ_CALL_LOG)) 1 else 0,
                // 协议版本号：Desktop 用此字段判断是否需要更新 Companion
                // Protocol version: Desktop uses this field to determine if Companion needs update
                "protocolVersion" to CompanionVersion.PROTOCOL_VERSION
            )

            val json = gson.toJson(changeSummary)
            File(path).writeText(json, Charsets.UTF_8)
            Log.i(TAG, "Exported change summary to $path (protocol v${CompanionVersion.PROTOCOL_VERSION})")
        } catch (e: Exception) {
            Log.e(TAG, "Error exporting changes", e)
            writeError(path, e)
        }
    }

    private fun hasPermission(context: Context, permission: String): Boolean {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun writePermissionError(path: String, permissionName: String) {
        try {
            val error = mapOf(
                "error" to "PERMISSION_DENIED",
                "permission" to permissionName,
                "message" to "Permission $permissionName not granted. Please grant it in the DroidLink Companion app."
            )
            File(path).writeText(gson.toJson(error), Charsets.UTF_8)
            Log.w(TAG, "Permission $permissionName not granted, wrote error to $path")
        } catch (writeError: Exception) {
            Log.e(TAG, "Failed to write permission error file", writeError)
        }
    }

    private fun writeError(path: String, e: Exception) {
        try {
            val error = mapOf("error" to (e.message ?: "Unknown error"))
            File(path).writeText(gson.toJson(error), Charsets.UTF_8)
        } catch (writeError: Exception) {
            Log.e(TAG, "Failed to write error file", writeError)
        }
    }
}
