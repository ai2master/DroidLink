package com.droidlink.companion.clipboard

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File

/**
 * Transparent Activity for clipboard operations on Android 10+.
 *
 * Android 10+ restricts background clipboard reading. Only foreground Activities
 * with **window focus** can reliably access the clipboard.
 * (Reference: https://github.com/majido/clipper, Android issue 123461156)
 *
 * Critical: Clipboard must NOT be read in onCreate() - the window may not have
 * focus yet. Instead, clipboard operations are deferred to onWindowFocusChanged()
 * which fires when the Activity's window actually gains focus.
 *
 * This Activity:
 * - Is started via `adb shell am start -n com.droidlink.companion/.clipboard.ClipboardActivity`
 * - Waits for window focus before performing clipboard operations
 * - Finishes immediately after completing the operation
 * - Uses a transparent theme so it's invisible to the user
 *
 * File permission note: The output file at /data/local/tmp/ must be pre-created
 * by the desktop (via adb shell) with chmod 666, because this Activity runs as
 * the companion app's UID which cannot create files in that shell-owned directory.
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
        private const val FOCUS_TIMEOUT_MS = 3000L
    }

    private var operationDone = false
    private val handler = Handler(Looper.getMainLooper())
    private val timeoutRunnable = Runnable {
        // Fallback: if onWindowFocusChanged never fires, try from here
        if (!operationDone) {
            Log.w(TAG, "Window focus timeout after ${FOCUS_TIMEOUT_MS}ms, attempting clipboard operation anyway")
            performOperation()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val action = intent.getStringExtra(EXTRA_ACTION) ?: ""
        Log.d(TAG, "ClipboardActivity started with action: $action")

        // Don't perform clipboard operations here.
        // On Android 10+, the window must have focus before clipboard can be read.
        // Schedule a timeout fallback in case onWindowFocusChanged never fires.
        handler.postDelayed(timeoutRunnable, FOCUS_TIMEOUT_MS)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && !operationDone) {
            Log.d(TAG, "Window focus gained, performing clipboard operation")
            handler.removeCallbacks(timeoutRunnable)
            performOperation()
        }
    }

    private fun performOperation() {
        if (operationDone) return
        operationDone = true

        try {
            val clipboardManager = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            if (clipboardManager == null) {
                Log.e(TAG, "ClipboardManager not available")
                finish()
                return
            }

            when (intent.getStringExtra(EXTRA_ACTION) ?: "") {
                ACTION_GET -> handleGet(clipboardManager)
                ACTION_SET -> handleSet(clipboardManager)
                ACTION_SET_TEXT -> handleSetText(clipboardManager)
                else -> Log.w(TAG, "Unknown action: ${intent.getStringExtra(EXTRA_ACTION)}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in ClipboardActivity", e)
        } finally {
            finish()
        }
    }

    /**
     * GET action: Read clipboard and write to output file.
     * Must be called after window focus is confirmed (Android 10+ requirement).
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

    override fun onDestroy() {
        handler.removeCallbacks(timeoutRunnable)
        super.onDestroy()
    }
}
