package com.droidlink.companion.providers

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.util.Log
import java.security.MessageDigest

data class SmsMessage(
    val id: String,
    val threadId: String,
    val address: String,
    val body: String,
    val date: Long,
    val dateSent: Long,
    val type: Int,
    val read: Boolean,
    val hash: String
)

class SmsProvider(private val context: Context) {

    private val contentResolver: ContentResolver = context.contentResolver

    companion object {
        private val SMS_URI = Uri.parse("content://sms")

        // SMS Types
        const val MESSAGE_TYPE_ALL = 0
        const val MESSAGE_TYPE_INBOX = 1
        const val MESSAGE_TYPE_SENT = 2
        const val MESSAGE_TYPE_DRAFT = 3
        const val MESSAGE_TYPE_OUTBOX = 4
        const val MESSAGE_TYPE_FAILED = 5
        const val MESSAGE_TYPE_QUEUED = 6
    }

    fun getAllMessages(): List<SmsMessage> {
        val messages = mutableListOf<SmsMessage>()

        val projection = arrayOf(
            "_id",
            "thread_id",
            "address",
            "body",
            "date",
            "date_sent",
            "type",
            "read"
        )

        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(
                SMS_URI,
                projection,
                null,
                null,
                "date DESC"
            )

            cursor?.use {
                val idIndex = it.getColumnIndex("_id")
                val threadIdIndex = it.getColumnIndex("thread_id")
                val addressIndex = it.getColumnIndex("address")
                val bodyIndex = it.getColumnIndex("body")
                val dateIndex = it.getColumnIndex("date")
                val dateSentIndex = it.getColumnIndex("date_sent")
                val typeIndex = it.getColumnIndex("type")
                val readIndex = it.getColumnIndex("read")

                while (it.moveToNext()) {
                    try {
                        val id = it.getString(idIndex) ?: continue
                        val threadId = it.getString(threadIdIndex) ?: "0"
                        val address = it.getString(addressIndex) ?: ""
                        val body = it.getString(bodyIndex) ?: ""
                        val date = it.getLong(dateIndex)
                        val dateSent = it.getLong(dateSentIndex)
                        val type = it.getInt(typeIndex)
                        val read = it.getInt(readIndex) == 1

                        val hashString = "$id|$threadId|$address|$body|$date|$dateSent|$type|$read"
                        val hash = hashString.toMD5()

                        messages.add(
                            SmsMessage(
                                id = id,
                                threadId = threadId,
                                address = address,
                                body = body,
                                date = date,
                                dateSent = dateSent,
                                type = type,
                                read = read,
                                hash = hash
                            )
                        )
                    } catch (e: Exception) {
                        Log.e("SmsProvider", "Error reading SMS row", e)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("SmsProvider", "Error querying SMS", e)
        } finally {
            cursor?.close()
        }

        return messages
    }

    fun getMessagesChangedSince(timestamp: Long): List<SmsMessage> {
        val messages = mutableListOf<SmsMessage>()

        val projection = arrayOf(
            "_id",
            "thread_id",
            "address",
            "body",
            "date",
            "date_sent",
            "type",
            "read"
        )

        val selection = "date >= ?"
        val selectionArgs = arrayOf(timestamp.toString())

        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(
                SMS_URI,
                projection,
                selection,
                selectionArgs,
                "date DESC"
            )

            cursor?.use {
                val idIndex = it.getColumnIndex("_id")
                val threadIdIndex = it.getColumnIndex("thread_id")
                val addressIndex = it.getColumnIndex("address")
                val bodyIndex = it.getColumnIndex("body")
                val dateIndex = it.getColumnIndex("date")
                val dateSentIndex = it.getColumnIndex("date_sent")
                val typeIndex = it.getColumnIndex("type")
                val readIndex = it.getColumnIndex("read")

                while (it.moveToNext()) {
                    try {
                        val id = it.getString(idIndex) ?: continue
                        val threadId = it.getString(threadIdIndex) ?: "0"
                        val address = it.getString(addressIndex) ?: ""
                        val body = it.getString(bodyIndex) ?: ""
                        val date = it.getLong(dateIndex)
                        val dateSent = it.getLong(dateSentIndex)
                        val type = it.getInt(typeIndex)
                        val read = it.getInt(readIndex) == 1

                        val hashString = "$id|$threadId|$address|$body|$date|$dateSent|$type|$read"
                        val hash = hashString.toMD5()

                        messages.add(
                            SmsMessage(
                                id = id,
                                threadId = threadId,
                                address = address,
                                body = body,
                                date = date,
                                dateSent = dateSent,
                                type = type,
                                read = read,
                                hash = hash
                            )
                        )
                    } catch (e: Exception) {
                        Log.e("SmsProvider", "Error reading SMS row", e)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("SmsProvider", "Error querying changed SMS", e)
        } finally {
            cursor?.close()
        }

        return messages
    }

    private fun String.toMD5(): String {
        val bytes = MessageDigest.getInstance("MD5").digest(this.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
