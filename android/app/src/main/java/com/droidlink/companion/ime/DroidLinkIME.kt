package com.droidlink.companion.ime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.inputmethodservice.InputMethodService
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.InputConnection
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Base64

/**
 * DroidLink Input Method Service for Chinese/CJK text input via ADB.
 *
 * This IME enables typing Chinese and other Unicode characters from the desktop
 * by receiving text via ADB broadcasts and committing it directly to input fields.
 *
 * Supported actions:
 * - com.droidlink.INPUT_TEXT: Commit text (supports all Unicode)
 * - com.droidlink.INPUT_KEY: Send key event (Enter, Backspace, etc.)
 * - com.droidlink.INPUT_BACKSPACE: Send N backspace key events
 * - com.droidlink.INPUT_ENTER: Send Enter key event
 * - com.droidlink.INPUT_CLEAR: Clear composition
 */
class DroidLinkIME : InputMethodService() {

    companion object {
        private const val TAG = "DroidLinkIME"

        // Broadcast actions
        private const val ACTION_INPUT_TEXT = "com.droidlink.INPUT_TEXT"
        private const val ACTION_INPUT_KEY = "com.droidlink.INPUT_KEY"
        private const val ACTION_INPUT_BACKSPACE = "com.droidlink.INPUT_BACKSPACE"
        private const val ACTION_INPUT_ENTER = "com.droidlink.INPUT_ENTER"
        private const val ACTION_INPUT_CLEAR = "com.droidlink.INPUT_CLEAR"

        // Static reference to current InputConnection
        @Volatile
        private var currentInputConnection: InputConnection? = null
    }

    private var textReceiver: BroadcastReceiver? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "DroidLink IME created")

        // Register broadcast receiver for text input
        val filter = IntentFilter().apply {
            addAction(ACTION_INPUT_TEXT)
            addAction(ACTION_INPUT_KEY)
            addAction(ACTION_INPUT_BACKSPACE)
            addAction(ACTION_INPUT_ENTER)
            addAction(ACTION_INPUT_CLEAR)
        }

        textReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                when (intent?.action) {
                    ACTION_INPUT_TEXT -> handleInputText(intent)
                    ACTION_INPUT_KEY -> handleInputKey(intent)
                    ACTION_INPUT_BACKSPACE -> handleBackspace(intent)
                    ACTION_INPUT_ENTER -> handleEnter()
                    ACTION_INPUT_CLEAR -> handleClear()
                }
            }
        }

        registerReceiver(textReceiver, filter, Context.RECEIVER_EXPORTED)
        Log.i(TAG, "Broadcast receiver registered")
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            textReceiver?.let { unregisterReceiver(it) }
        } catch (e: Exception) {
            Log.e(TAG, "Error unregistering receiver", e)
        }
        currentInputConnection = null
        Log.i(TAG, "DroidLink IME destroyed")
    }

    override fun onCreateInputView(): View {
        // Create a minimal banner view showing IME is active
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#1890ff"))
            setPadding(16, 8, 16, 8)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val titleText = TextView(this).apply {
            text = getString(R.string.ime_banner)
            textSize = 14f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }

        val hintText = TextView(this).apply {
            text = "支持中文、日文、韩文、Emoji 等所有 Unicode 字符"
            textSize = 11f
            setTextColor(Color.parseColor("#e6f7ff"))
            gravity = Gravity.CENTER
        }

        layout.addView(titleText)
        layout.addView(hintText)

        return layout
    }

    override fun onStartInput(attribute: android.view.inputmethod.EditorInfo?, restarting: Boolean) {
        super.onStartInput(attribute, restarting)
        currentInputConnection = currentInputConnection
        Log.d(TAG, "Input started, restarting=$restarting")
    }

    override fun onStartInputView(info: android.view.inputmethod.EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        currentInputConnection = currentInputConnection
        Log.d(TAG, "Input view started")
    }

    override fun onFinishInput() {
        super.onFinishInput()
        currentInputConnection = null
        Log.d(TAG, "Input finished")
    }

    override fun onBindInput() {
        super.onBindInput()
        currentInputConnection = currentInputConnection
        Log.d(TAG, "Input bound")
    }

    override fun onUnbindInput() {
        super.onUnbindInput()
        currentInputConnection = null
        Log.d(TAG, "Input unbound")
    }

    /**
     * Handle INPUT_TEXT action: commit text to input field.
     * Supports base64-encoded text for safe shell transmission.
     */
    private fun handleInputText(intent: Intent) {
        val ic = currentInputConnection ?: run {
            Log.w(TAG, "No input connection available")
            return
        }

        try {
            val text = when {
                // Try base64-encoded text first (safer for shell)
                intent.hasExtra("text_b64") -> {
                    val encoded = intent.getStringExtra("text_b64") ?: return
                    val decoded = Base64.getDecoder().decode(encoded)
                    String(decoded, Charsets.UTF_8)
                }
                // Fall back to plain text
                intent.hasExtra("text") -> {
                    intent.getStringExtra("text") ?: return
                }
                else -> {
                    Log.w(TAG, "No text extra in INPUT_TEXT intent")
                    return
                }
            }

            if (text.isEmpty()) {
                Log.w(TAG, "Empty text received")
                return
            }

            // Commit the text to the input field
            ic.commitText(text, 1)
            Log.i(TAG, "Committed text: ${text.length} chars")
        } catch (e: Exception) {
            Log.e(TAG, "Error handling INPUT_TEXT", e)
        }
    }

    /**
     * Handle INPUT_KEY action: send key event.
     */
    private fun handleInputKey(intent: Intent) {
        val ic = currentInputConnection ?: run {
            Log.w(TAG, "No input connection available")
            return
        }

        try {
            val keyCode = intent.getIntExtra("keyCode", -1)
            if (keyCode == -1) {
                Log.w(TAG, "No keyCode extra in INPUT_KEY intent")
                return
            }

            ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
            ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keyCode))
            Log.i(TAG, "Sent key event: $keyCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error handling INPUT_KEY", e)
        }
    }

    /**
     * Handle INPUT_BACKSPACE action: send N backspace key events.
     */
    private fun handleBackspace(intent: Intent) {
        val ic = currentInputConnection ?: run {
            Log.w(TAG, "No input connection available")
            return
        }

        try {
            val count = intent.getIntExtra("count", 1)
            repeat(count) {
                ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DEL))
                ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DEL))
            }
            Log.i(TAG, "Sent $count backspace events")
        } catch (e: Exception) {
            Log.e(TAG, "Error handling INPUT_BACKSPACE", e)
        }
    }

    /**
     * Handle INPUT_ENTER action: send Enter key event.
     */
    private fun handleEnter() {
        val ic = currentInputConnection ?: run {
            Log.w(TAG, "No input connection available")
            return
        }

        try {
            ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
            ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
            Log.i(TAG, "Sent Enter key event")
        } catch (e: Exception) {
            Log.e(TAG, "Error handling INPUT_ENTER", e)
        }
    }

    /**
     * Handle INPUT_CLEAR action: clear composition.
     */
    private fun handleClear() {
        val ic = currentInputConnection ?: run {
            Log.w(TAG, "No input connection available")
            return
        }

        try {
            ic.finishComposingText()
            Log.i(TAG, "Cleared composition")
        } catch (e: Exception) {
            Log.e(TAG, "Error handling INPUT_CLEAR", e)
        }
    }
}
