package com.droidlink.companion.observers

import android.content.Context
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.CallLog
import android.provider.ContactsContract
import android.util.Log
import java.util.concurrent.atomic.AtomicInteger

class ContentObserverManager(private val context: Context) {

    private val handler = Handler(Looper.getMainLooper())

    // Change counters
    private val contactsChangeCount = AtomicInteger(0)
    private val smsChangeCount = AtomicInteger(0)
    private val callLogChangeCount = AtomicInteger(0)

    // Last change timestamps
    @Volatile
    private var lastContactsChange: Long = System.currentTimeMillis()
    @Volatile
    private var lastSmsChange: Long = System.currentTimeMillis()
    @Volatile
    private var lastCallLogChange: Long = System.currentTimeMillis()

    // Content observers
    private var contactsObserver: ContentObserver? = null
    private var smsObserver: ContentObserver? = null
    private var callLogObserver: ContentObserver? = null

    fun registerObservers() {
        // Register contacts observer
        contactsObserver = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean, uri: Uri?) {
                super.onChange(selfChange, uri)
                contactsChangeCount.incrementAndGet()
                lastContactsChange = System.currentTimeMillis()
                Log.d("ContentObserverManager", "Contacts changed: $uri")
            }
        }.also {
            context.contentResolver.registerContentObserver(
                ContactsContract.Contacts.CONTENT_URI,
                true,
                it
            )
        }

        // Register SMS observer
        smsObserver = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean, uri: Uri?) {
                super.onChange(selfChange, uri)
                smsChangeCount.incrementAndGet()
                lastSmsChange = System.currentTimeMillis()
                Log.d("ContentObserverManager", "SMS changed: $uri")
            }
        }.also {
            context.contentResolver.registerContentObserver(
                Uri.parse("content://sms"),
                true,
                it
            )
        }

        // Register call log observer
        callLogObserver = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean, uri: Uri?) {
                super.onChange(selfChange, uri)
                callLogChangeCount.incrementAndGet()
                lastCallLogChange = System.currentTimeMillis()
                Log.d("ContentObserverManager", "Call log changed: $uri")
            }
        }.also {
            context.contentResolver.registerContentObserver(
                CallLog.Calls.CONTENT_URI,
                true,
                it
            )
        }

        Log.i("ContentObserverManager", "All content observers registered")
    }

    fun unregisterObservers() {
        contactsObserver?.let {
            context.contentResolver.unregisterContentObserver(it)
            contactsObserver = null
        }

        smsObserver?.let {
            context.contentResolver.unregisterContentObserver(it)
            smsObserver = null
        }

        callLogObserver?.let {
            context.contentResolver.unregisterContentObserver(it)
            callLogObserver = null
        }

        Log.i("ContentObserverManager", "All content observers unregistered")
    }

    /**
     * Returns a summary of all changes detected since observers were registered
     */
    fun getChangeSummary(): ChangeSummary {
        return ChangeSummary(
            contactsChangeCount = contactsChangeCount.get(),
            smsChangeCount = smsChangeCount.get(),
            callLogChangeCount = callLogChangeCount.get(),
            lastContactsChange = lastContactsChange,
            lastSmsChange = lastSmsChange,
            lastCallLogChange = lastCallLogChange
        )
    }

    /**
     * Resets all change counters
     */
    fun resetCounters() {
        contactsChangeCount.set(0)
        smsChangeCount.set(0)
        callLogChangeCount.set(0)
        Log.d("ContentObserverManager", "Change counters reset")
    }

    /**
     * Gets the change count for a specific type
     */
    fun getChangeCount(type: ChangeType): Int {
        return when (type) {
            ChangeType.CONTACTS -> contactsChangeCount.get()
            ChangeType.SMS -> smsChangeCount.get()
            ChangeType.CALL_LOG -> callLogChangeCount.get()
        }
    }

    /**
     * Gets the last change timestamp for a specific type
     */
    fun getLastChangeTimestamp(type: ChangeType): Long {
        return when (type) {
            ChangeType.CONTACTS -> lastContactsChange
            ChangeType.SMS -> lastSmsChange
            ChangeType.CALL_LOG -> lastCallLogChange
        }
    }

    data class ChangeSummary(
        val contactsChangeCount: Int,
        val smsChangeCount: Int,
        val callLogChangeCount: Int,
        val lastContactsChange: Long,
        val lastSmsChange: Long,
        val lastCallLogChange: Long
    ) {
        fun hasAnyChanges(): Boolean {
            return contactsChangeCount > 0 || smsChangeCount > 0 || callLogChangeCount > 0
        }
    }

    enum class ChangeType {
        CONTACTS,
        SMS,
        CALL_LOG
    }
}
