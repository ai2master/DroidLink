package com.droidlink.companion.providers

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.provider.CallLog
import android.util.Log
import java.security.MessageDigest

data class CallLogEntry(
    val id: String,
    val number: String,
    val cachedName: String?,
    val type: Int,
    val date: Long,
    val duration: Long,
    val hash: String
)

class CallLogProvider(private val context: Context) {

    private val contentResolver: ContentResolver = context.contentResolver

    companion object {
        // Call types from CallLog.Calls
        const val TYPE_INCOMING = CallLog.Calls.INCOMING_TYPE
        const val TYPE_OUTGOING = CallLog.Calls.OUTGOING_TYPE
        const val TYPE_MISSED = CallLog.Calls.MISSED_TYPE
        const val TYPE_VOICEMAIL = CallLog.Calls.VOICEMAIL_TYPE
        const val TYPE_REJECTED = CallLog.Calls.REJECTED_TYPE
        const val TYPE_BLOCKED = CallLog.Calls.BLOCKED_TYPE
    }

    fun getAllCallLogs(): List<CallLogEntry> {
        val callLogs = mutableListOf<CallLogEntry>()

        val projection = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION
        )

        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                projection,
                null,
                null,
                CallLog.Calls.DATE + " DESC"
            )

            cursor?.use {
                val idIndex = it.getColumnIndex(CallLog.Calls._ID)
                val numberIndex = it.getColumnIndex(CallLog.Calls.NUMBER)
                val nameIndex = it.getColumnIndex(CallLog.Calls.CACHED_NAME)
                val typeIndex = it.getColumnIndex(CallLog.Calls.TYPE)
                val dateIndex = it.getColumnIndex(CallLog.Calls.DATE)
                val durationIndex = it.getColumnIndex(CallLog.Calls.DURATION)

                while (it.moveToNext()) {
                    try {
                        val id = it.getString(idIndex) ?: continue
                        val number = it.getString(numberIndex) ?: ""
                        val cachedName = it.getString(nameIndex)
                        val type = it.getInt(typeIndex)
                        val date = it.getLong(dateIndex)
                        val duration = it.getLong(durationIndex)

                        val hashString = "$id|$number|$cachedName|$type|$date|$duration"
                        val hash = hashString.toMD5()

                        callLogs.add(
                            CallLogEntry(
                                id = id,
                                number = number,
                                cachedName = cachedName,
                                type = type,
                                date = date,
                                duration = duration,
                                hash = hash
                            )
                        )
                    } catch (e: Exception) {
                        Log.e("CallLogProvider", "Error reading call log row", e)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("CallLogProvider", "Error querying call logs", e)
        } finally {
            cursor?.close()
        }

        return callLogs
    }

    fun getCallLogsChangedSince(timestamp: Long): List<CallLogEntry> {
        val callLogs = mutableListOf<CallLogEntry>()

        val projection = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION
        )

        val selection = "${CallLog.Calls.DATE} >= ?"
        val selectionArgs = arrayOf(timestamp.toString())

        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                CallLog.Calls.DATE + " DESC"
            )

            cursor?.use {
                val idIndex = it.getColumnIndex(CallLog.Calls._ID)
                val numberIndex = it.getColumnIndex(CallLog.Calls.NUMBER)
                val nameIndex = it.getColumnIndex(CallLog.Calls.CACHED_NAME)
                val typeIndex = it.getColumnIndex(CallLog.Calls.TYPE)
                val dateIndex = it.getColumnIndex(CallLog.Calls.DATE)
                val durationIndex = it.getColumnIndex(CallLog.Calls.DURATION)

                while (it.moveToNext()) {
                    try {
                        val id = it.getString(idIndex) ?: continue
                        val number = it.getString(numberIndex) ?: ""
                        val cachedName = it.getString(nameIndex)
                        val type = it.getInt(typeIndex)
                        val date = it.getLong(dateIndex)
                        val duration = it.getLong(durationIndex)

                        val hashString = "$id|$number|$cachedName|$type|$date|$duration"
                        val hash = hashString.toMD5()

                        callLogs.add(
                            CallLogEntry(
                                id = id,
                                number = number,
                                cachedName = cachedName,
                                type = type,
                                date = date,
                                duration = duration,
                                hash = hash
                            )
                        )
                    } catch (e: Exception) {
                        Log.e("CallLogProvider", "Error reading call log row", e)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("CallLogProvider", "Error querying changed call logs", e)
        } finally {
            cursor?.close()
        }

        return callLogs
    }

    private fun String.toMD5(): String {
        val bytes = MessageDigest.getInstance("MD5").digest(this.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
