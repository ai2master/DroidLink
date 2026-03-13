package com.droidlink.companion.providers

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.provider.ContactsContract
import android.util.Log
import java.security.MessageDigest

data class Contact(
    val id: String,
    val displayName: String,
    val phoneNumbers: List<String>,
    val emails: List<String>,
    val organization: String?,
    val photoUri: String?,
    val hash: String
)

class ContactProvider(private val context: Context) {

    private val contentResolver: ContentResolver = context.contentResolver

    fun getAllContacts(): List<Contact> {
        val contacts = mutableMapOf<String, ContactBuilder>()

        // Query contacts
        queryContacts(contacts)

        // Query phone numbers
        queryPhoneNumbers(contacts)

        // Query emails
        queryEmails(contacts)

        // Query organizations
        queryOrganizations(contacts)

        // Build and return final contact list
        return contacts.values.map { it.build() }
    }

    fun getContactsChangedSince(timestamp: Long): List<Contact> {
        val contacts = mutableMapOf<String, ContactBuilder>()

        // Query contacts modified since timestamp
        queryContactsModifiedSince(timestamp, contacts)

        if (contacts.isEmpty()) {
            return emptyList()
        }

        // Query phone numbers for these contacts
        queryPhoneNumbers(contacts)

        // Query emails for these contacts
        queryEmails(contacts)

        // Query organizations
        queryOrganizations(contacts)

        return contacts.values.map { it.build() }
    }

    private fun queryContacts(contacts: MutableMap<String, ContactBuilder>) {
        val projection = arrayOf(
            ContactsContract.Contacts._ID,
            ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
            ContactsContract.Contacts.PHOTO_URI,
            ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP
        )

        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(
                ContactsContract.Contacts.CONTENT_URI,
                projection,
                null,
                null,
                ContactsContract.Contacts.DISPLAY_NAME_PRIMARY + " ASC"
            )

            cursor?.use {
                val idIndex = it.getColumnIndex(ContactsContract.Contacts._ID)
                val nameIndex = it.getColumnIndex(ContactsContract.Contacts.DISPLAY_NAME_PRIMARY)
                val photoIndex = it.getColumnIndex(ContactsContract.Contacts.PHOTO_URI)
                val timestampIndex = it.getColumnIndex(ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP)

                while (it.moveToNext()) {
                    val id = it.getString(idIndex) ?: continue
                    val name = it.getString(nameIndex) ?: "未命名"
                    val photoUri = it.getString(photoIndex)
                    val timestamp = if (timestampIndex >= 0) it.getLong(timestampIndex) else 0L

                    contacts[id] = ContactBuilder(id, name, photoUri, timestamp)
                }
            }
        } catch (e: Exception) {
            Log.e("ContactProvider", "Error querying contacts", e)
        } finally {
            cursor?.close()
        }
    }

    private fun queryContactsModifiedSince(timestamp: Long, contacts: MutableMap<String, ContactBuilder>) {
        val projection = arrayOf(
            ContactsContract.Contacts._ID,
            ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
            ContactsContract.Contacts.PHOTO_URI,
            ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP
        )

        val selection = "${ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP} > ?"
        val selectionArgs = arrayOf(timestamp.toString())

        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(
                ContactsContract.Contacts.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                null
            )

            cursor?.use {
                val idIndex = it.getColumnIndex(ContactsContract.Contacts._ID)
                val nameIndex = it.getColumnIndex(ContactsContract.Contacts.DISPLAY_NAME_PRIMARY)
                val photoIndex = it.getColumnIndex(ContactsContract.Contacts.PHOTO_URI)
                val timestampIndex = it.getColumnIndex(ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP)

                while (it.moveToNext()) {
                    val id = it.getString(idIndex) ?: continue
                    val name = it.getString(nameIndex) ?: "未命名"
                    val photoUri = it.getString(photoIndex)
                    val ts = if (timestampIndex >= 0) it.getLong(timestampIndex) else 0L

                    contacts[id] = ContactBuilder(id, name, photoUri, ts)
                }
            }
        } catch (e: Exception) {
            Log.e("ContactProvider", "Error querying modified contacts", e)
        } finally {
            cursor?.close()
        }
    }

    private fun queryPhoneNumbers(contacts: MutableMap<String, ContactBuilder>) {
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )

        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                null,
                null,
                null
            )

            cursor?.use {
                val contactIdIndex = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
                val numberIndex = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)

                while (it.moveToNext()) {
                    val contactId = it.getString(contactIdIndex) ?: continue
                    val number = it.getString(numberIndex) ?: continue

                    contacts[contactId]?.addPhoneNumber(number)
                }
            }
        } catch (e: Exception) {
            Log.e("ContactProvider", "Error querying phone numbers", e)
        } finally {
            cursor?.close()
        }
    }

    private fun queryEmails(contacts: MutableMap<String, ContactBuilder>) {
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Email.CONTACT_ID,
            ContactsContract.CommonDataKinds.Email.ADDRESS
        )

        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(
                ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                projection,
                null,
                null,
                null
            )

            cursor?.use {
                val contactIdIndex = it.getColumnIndex(ContactsContract.CommonDataKinds.Email.CONTACT_ID)
                val emailIndex = it.getColumnIndex(ContactsContract.CommonDataKinds.Email.ADDRESS)

                while (it.moveToNext()) {
                    val contactId = it.getString(contactIdIndex) ?: continue
                    val email = it.getString(emailIndex) ?: continue

                    contacts[contactId]?.addEmail(email)
                }
            }
        } catch (e: Exception) {
            Log.e("ContactProvider", "Error querying emails", e)
        } finally {
            cursor?.close()
        }
    }

    private fun queryOrganizations(contacts: MutableMap<String, ContactBuilder>) {
        val projection = arrayOf(
            ContactsContract.Data.CONTACT_ID,
            ContactsContract.CommonDataKinds.Organization.COMPANY
        )

        val selection = "${ContactsContract.Data.MIMETYPE} = ?"
        val selectionArgs = arrayOf(ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE)

        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(
                ContactsContract.Data.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                null
            )

            cursor?.use {
                val contactIdIndex = it.getColumnIndex(ContactsContract.Data.CONTACT_ID)
                val companyIndex = it.getColumnIndex(ContactsContract.CommonDataKinds.Organization.COMPANY)

                while (it.moveToNext()) {
                    val contactId = it.getString(contactIdIndex) ?: continue
                    val company = it.getString(companyIndex) ?: continue

                    contacts[contactId]?.setOrganization(company)
                }
            }
        } catch (e: Exception) {
            Log.e("ContactProvider", "Error querying organizations", e)
        } finally {
            cursor?.close()
        }
    }

    private class ContactBuilder(
        private val id: String,
        private val displayName: String,
        private val photoUri: String?,
        private val timestamp: Long
    ) {
        private val phoneNumbers = mutableListOf<String>()
        private val emails = mutableListOf<String>()
        private var organization: String? = null

        fun addPhoneNumber(number: String) {
            phoneNumbers.add(number)
        }

        fun addEmail(email: String) {
            emails.add(email)
        }

        fun setOrganization(org: String) {
            organization = org
        }

        fun build(): Contact {
            val hashString = "$id|$displayName|${phoneNumbers.joinToString(",")}|${emails.joinToString(",")}|$organization|$timestamp"
            val bytes = MessageDigest.getInstance("MD5").digest(hashString.toByteArray())
            val hash = bytes.joinToString("") { "%02x".format(it) }

            return Contact(
                id = id,
                displayName = displayName,
                phoneNumbers = phoneNumbers.toList(),
                emails = emails.toList(),
                organization = organization,
                photoUri = photoUri,
                hash = hash
            )
        }
    }
}
