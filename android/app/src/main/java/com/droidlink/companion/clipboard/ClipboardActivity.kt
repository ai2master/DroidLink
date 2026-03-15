package com.droidlink.companion.clipboard

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.util.Log
import java.io.File

/**
 * Transparent Activity for clipboard operations on Android 10+.
 *
 * Android 10+ restricts background clipboard reading. BroadcastReceivers can't reliably
 * read clipboard content. Only foreground Activities can access clipboard.
 *
 * This Activity:
 * - Is started via `adb shell am start -n com.droidlink.companion/.clipboard.ClipboardActivity`
 * - Performs clipboard operation (GET or SET)
 * - Finishes immediately after completing the operation
 * - Uses a transparent theme so it's invisible to the user
 *
 * Supported actions (passed via intent extra):
 * - GET: Read clipboard, write to output file, finish
 * - SET: Read from input file, set clipboard, finish
 * - SET_TEXT: Set clipboard from text passed directly via intent extra
 */
class ClipboardActivity : Activity() {

    companion object {
        private const val TAG = "ClipboardActivity"
        const val EXTRA_ACTION = "action"
        const val EXTRA_OUTPUT_PATH = "output_path"
        const val EXTRA_INPUT_PATH = "input_path"
        const val EXTRA_TEXT = "text"
        const val ACTION_GET = "GET"
        const val ACTION_SET = "SET"
        const val ACTION_SET_TEXT = "SET_TEXT"
        private const val DEFAULT_OUTPUT_PATH = "/data/local/tmp/.droidlink_clipboard_out"
        private const val DEFAULT_INPUT_PATH = "/data/local/tmp/.droidlink_clipboard"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // This Activity is transparent and finishes immediately
        // No UI is shown to the user

        try {
            val clipboardManager = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            if (clipboardManager == null) {
                Log.e(TAG, "ClipboardManager not available")
                finish()
                return
            }

            val action = intent.getStringExtra(EXTRA_ACTION) ?: ""
            Log.d(TAG, "ClipboardActivity started with action: $action")

            when (action) {
                ACTION_GET -> handleGet(clipboardManager)
                ACTION_SET -> handleSet(clipboardManager)
                ACTION_SET_TEXT -> handleSetText(clipboardManager)
                else -> Log.w(TAG, "Unknown action: $action")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in ClipboardActivity", e)
        } finally {
            // Always finish immediately - this Activity should not be visible
            finish()
        }
    }

    /**
     * GET action: Read clipboard and write to output file.
     * The Activity can read clipboard because it's in the foreground (Android 10+ requirement).
     */
    private fun handleGet(clipboardManager: ClipboardManager) {
        val outputPath = intent.getStringExtra(EXTRA_OUTPUT_PATH) ?: DEFAULT_OUTPUT_PATH
        try {
            val clipData = clipboardManager.primaryClip
            val text = if (clipData != null && clipData.itemCount > 0) {
                clipData.getItemAt(0).text?.toString()
            } else {
                null
            }

            if (text != null) {
                File(outputPath).writeText(text, Charsets.UTF_8)
                Log.i(TAG, "Clipboard read and written to $outputPath (${text.length} chars)")
            } else {
                // Clipboard is empty (no text content) - write CLIPBOARD_EMPTY marker
                // This is distinct from CLIPBOARD_ACCESS_DENIED (SecurityException)
                File(outputPath).writeText("CLIPBOARD_EMPTY", Charsets.UTF_8)
                Log.i(TAG, "Clipboard is empty, wrote CLIPBOARD_EMPTY marker to $outputPath")
            }
        } catch (e: SecurityException) {
            // Actual access denied by Android security policy
            Log.e(TAG, "Clipboard access denied by security policy", e)
            try {
                File(outputPath).writeText("CLIPBOARD_ACCESS_DENIED", Charsets.UTF_8)
            } catch (writeError: Exception) {
                Log.e(TAG, "Error writing access denied marker", writeError)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error reading clipboard", e)
            try {
                File(outputPath).writeText("CLIPBOARD_READ_ERROR", Charsets.UTF_8)
            } catch (writeError: Exception) {
                Log.e(TAG, "Error writing error marker", writeError)
            }
        }
    }

    /**
     * SET action: Read text from input file and set clipboard.
     */
    private fun handleSet(clipboardManager: ClipboardManager) {
        try {
            val inputPath = intent.getStringExtra(EXTRA_INPUT_PATH) ?: DEFAULT_INPUT_PATH

            val file = File(inputPath)
            if (!file.exists()) {
                Log.e(TAG, "Input file not found: $inputPath")
                return
            }

            val text = file.readText(Charsets.UTF_8)
            val clip = ClipData.newPlainText("DroidLink", text)
            clipboardManager.setPrimaryClip(clip)

            // Clean up temp file
            file.delete()

            Log.i(TAG, "Clipboard set from file $inputPath (${text.length} chars)")
        } catch (e: Exception) {
            Log.e(TAG, "Error setting clipboard from file", e)
        }
    }

    /**
     * SET_TEXT action: Set clipboard from text passed directly via intent extra.
     */
    private fun handleSetText(clipboardManager: ClipboardManager) {
        try {
            val text = intent.getStringExtra(EXTRA_TEXT) ?: ""
            val clip = ClipData.newPlainText("DroidLink", text)
            clipboardManager.setPrimaryClip(clip)
            Log.i(TAG, "Clipboard set from intent extra (${text.length} chars)")
        } catch (e: Exception) {
            Log.e(TAG, "Error setting clipboard from text", e)
        }
    }
}
