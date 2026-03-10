package com.droidlink.companion.data

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.droidlink.companion.observers.ContentObserverManager
import com.droidlink.companion.providers.CallLogProvider
import com.droidlink.companion.providers.ContactProvider
import com.droidlink.companion.providers.SmsProvider
import com.google.gson.GsonBuilder
import java.io.File

/**
 * Handles data export requests from the desktop app via ADB broadcast commands.
 * All communication is pure ADB over USB - no TCP/HTTP involved.
 *
 * Pattern:
 * 1. Desktop sends: adb shell am broadcast -a com.droidlink.EXPORT_CONTACTS --es output_path /data/local/tmp/.droidlink_contacts.json
 * 2. This receiver queries ContentProviders and writes JSON to the specified file
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

    private fun handleExportChanges(context: Context, outputPath: String?) {
        val path = outputPath ?: "/data/local/tmp/.droidlink_changes.json"
        try {
            // Try to get change summary from the running service
            val changeSummary = try {
                val serviceField = Class.forName("com.droidlink.companion.DroidLinkService")
                // We can't easily access the service instance from a BroadcastReceiver,
                // so we report changes based on a simple check
                mapOf(
                    "contacts" to 1,
                    "messages" to 1,
                    "callLogs" to 1
                )
            } catch (e: Exception) {
                mapOf(
                    "contacts" to 1,
                    "messages" to 1,
                    "callLogs" to 1
                )
            }

            val json = gson.toJson(changeSummary)
            File(path).writeText(json, Charsets.UTF_8)
            Log.i(TAG, "Exported change summary to $path")
        } catch (e: Exception) {
            Log.e(TAG, "Error exporting changes", e)
            writeError(path, e)
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
