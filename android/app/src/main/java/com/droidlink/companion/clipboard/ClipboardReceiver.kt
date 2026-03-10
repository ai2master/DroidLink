package com.droidlink.companion.clipboard

import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.util.Base64
import android.util.Log
import java.io.File

/**
 * Handles clipboard operations via ADB broadcast commands.
 * All communication is pure ADB over USB - no TCP/HTTP involved.
 *
 * Supported actions:
 * - SET_CLIPBOARD: Set clipboard from base64-encoded text (broadcast extra)
 * - GET_CLIPBOARD: Read clipboard and write to output file
 * - SET_CLIPBOARD_FILE: Read text from a file and set clipboard
 * - GET_CLIPBOARD_FILE: Read clipboard and write to a file
 */
class ClipboardReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "ClipboardReceiver"
        const val ACTION_SET_CLIPBOARD = "com.droidlink.SET_CLIPBOARD"
        const val ACTION_GET_CLIPBOARD = "com.droidlink.GET_CLIPBOARD"
        const val ACTION_SET_CLIPBOARD_FILE = "com.droidlink.SET_CLIPBOARD_FILE"
        const val ACTION_GET_CLIPBOARD_FILE = "com.droidlink.GET_CLIPBOARD_FILE"
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null || intent == null) {
            Log.w(TAG, "Null context or intent")
            return
        }

        val clipboardManager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        if (clipboardManager == null) {
            Log.e(TAG, "ClipboardManager not available")
            return
        }

        when (intent.action) {
            ACTION_SET_CLIPBOARD -> handleSetClipboard(clipboardManager, intent)
            ACTION_GET_CLIPBOARD -> handleGetClipboard(clipboardManager, intent)
            ACTION_SET_CLIPBOARD_FILE -> handleSetClipboardFromFile(clipboardManager, intent)
            ACTION_GET_CLIPBOARD_FILE -> handleGetClipboardToFile(clipboardManager, intent)
            else -> Log.w(TAG, "Unknown action: ${intent.action}")
        }
    }

    /**
     * Set clipboard from base64-encoded content in broadcast extra.
     * Used for small text (<=100KB).
     */
    private fun handleSetClipboard(clipboardManager: ClipboardManager, intent: Intent) {
        try {
            val contentB64 = intent.getStringExtra("content_b64")
            if (contentB64 != null) {
                val bytes = Base64.decode(contentB64, Base64.DEFAULT)
                val text = String(bytes, Charsets.UTF_8)
                val clip = ClipData.newPlainText("DroidLink", text)
                clipboardManager.setPrimaryClip(clip)
                Log.i(TAG, "Clipboard set via broadcast (${text.length} chars)")
                return
            }

            // Legacy: plain text extra
            val text = intent.getStringExtra("text") ?: ""
            val isEncoded = intent.getBooleanExtra("encoded", false)
            val decodedText = if (isEncoded && text.isNotEmpty()) {
                val bytes = Base64.decode(text, Base64.DEFAULT)
                String(bytes, Charsets.UTF_8)
            } else {
                text
            }

            val clip = ClipData.newPlainText("DroidLink", decodedText)
            clipboardManager.setPrimaryClip(clip)
            Log.i(TAG, "Clipboard set via broadcast (${decodedText.length} chars)")
        } catch (e: Exception) {
            Log.e(TAG, "Error setting clipboard", e)
        }
    }

    /**
     * Read clipboard and write to output file specified in broadcast extra.
     * Desktop will read this file via `adb shell cat` or `adb pull`.
     *
     * Android 10+ restriction: BroadcastReceivers can't reliably read clipboard.
     * If clipboard read returns null/empty on Android 10+, write a special marker
     * so the desktop side knows to fall back to the Activity-based approach.
     */
    private fun handleGetClipboard(clipboardManager: ClipboardManager, intent: Intent) {
        try {
            val outputPath = intent.getStringExtra("output_path")
                ?: "/data/local/tmp/.droidlink_clipboard_out"

            val clipData = clipboardManager.primaryClip
            val text = if (clipData != null && clipData.itemCount > 0) {
                clipData.getItemAt(0).text?.toString()
            } else {
                null
            }

            // Android 10+ restriction: If clipboard read fails (returns null),
            // write a special marker so desktop knows to use Activity fallback
            if (text == null) {
                File(outputPath).writeText("CLIPBOARD_ACCESS_DENIED", Charsets.UTF_8)
                Log.w(TAG, "Clipboard access denied (Android 10+ restriction), wrote marker to $outputPath")
            } else {
                File(outputPath).writeText(text, Charsets.UTF_8)
                Log.i(TAG, "Clipboard written to $outputPath (${text.length} chars)")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error getting clipboard", e)
            // Write the marker on any error as well
            try {
                val outputPath = intent.getStringExtra("output_path")
                    ?: "/data/local/tmp/.droidlink_clipboard_out"
                File(outputPath).writeText("CLIPBOARD_ACCESS_DENIED", Charsets.UTF_8)
            } catch (writeError: Exception) {
                Log.e(TAG, "Error writing error marker", writeError)
            }
        }
    }

    /**
     * Read text from a file (pushed via `adb push`) and set clipboard.
     * Used for large text (>100KB).
     */
    private fun handleSetClipboardFromFile(clipboardManager: ClipboardManager, intent: Intent) {
        try {
            val filePath = intent.getStringExtra("file_path")
                ?: "/data/local/tmp/.droidlink_clipboard"

            val file = File(filePath)
            if (!file.exists()) {
                Log.e(TAG, "Clipboard file not found: $filePath")
                return
            }

            val text = file.readText(Charsets.UTF_8)
            val clip = ClipData.newPlainText("DroidLink", text)
            clipboardManager.setPrimaryClip(clip)

            // Clean up temp file
            file.delete()

            Log.i(TAG, "Clipboard set from file $filePath (${text.length} chars)")
        } catch (e: Exception) {
            Log.e(TAG, "Error setting clipboard from file", e)
        }
    }

    /**
     * Read clipboard and write to a file.
     * Desktop will retrieve this file via `adb pull`.
     *
     * Android 10+ restriction: BroadcastReceivers can't reliably read clipboard.
     * If clipboard read returns null/empty on Android 10+, write a special marker
     * so the desktop side knows to fall back to the Activity-based approach.
     */
    private fun handleGetClipboardToFile(clipboardManager: ClipboardManager, intent: Intent) {
        try {
            val filePath = intent.getStringExtra("file_path")
                ?: "/data/local/tmp/.droidlink_clipboard_out"

            val clipData = clipboardManager.primaryClip
            val text = if (clipData != null && clipData.itemCount > 0) {
                clipData.getItemAt(0).text?.toString()
            } else {
                null
            }

            // Android 10+ restriction: If clipboard read fails (returns null),
            // write a special marker so desktop knows to use Activity fallback
            if (text == null) {
                File(filePath).writeText("CLIPBOARD_ACCESS_DENIED", Charsets.UTF_8)
                Log.w(TAG, "Clipboard access denied (Android 10+ restriction), wrote marker to $filePath")
            } else {
                File(filePath).writeText(text, Charsets.UTF_8)
                Log.i(TAG, "Clipboard written to file $filePath (${text.length} chars)")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error writing clipboard to file", e)
            // Write the marker on any error as well
            try {
                val filePath = intent.getStringExtra("file_path")
                    ?: "/data/local/tmp/.droidlink_clipboard_out"
                File(filePath).writeText("CLIPBOARD_ACCESS_DENIED", Charsets.UTF_8)
            } catch (writeError: Exception) {
                Log.e(TAG, "Error writing error marker", writeError)
            }
        }
    }
}
