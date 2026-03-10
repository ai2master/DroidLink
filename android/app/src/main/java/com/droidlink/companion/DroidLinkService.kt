package com.droidlink.companion

import android.app.*
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.droidlink.companion.observers.ContentObserverManager

class DroidLinkService : Service() {

    private var contentObserverManager: ContentObserverManager? = null

    companion object {
        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "droidlink_service_channel"

        @Volatile
        var isRunning = false
            private set
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        isRunning = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = createNotification()
        startForeground(NOTIFICATION_ID, notification)

        // Register content observers for change detection
        startContentObservers()

        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        stopContentObservers()
        isRunning = false
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notification_channel_description)
                setShowBadge(false)
            }

            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        val pendingIntent = Intent(this, MainActivity::class.java).let { notificationIntent ->
            PendingIntent.getActivity(
                this,
                0,
                notificationIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText("纯 USB 模式 - 等待 ADB 命令")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun startContentObservers() {
        contentObserverManager = ContentObserverManager(this).apply {
            registerObservers()
        }
        android.util.Log.i("DroidLinkService", "Content observers registered (pure ADB mode)")
    }

    private fun stopContentObservers() {
        contentObserverManager?.unregisterObservers()
        contentObserverManager = null
    }

    fun getContentObserverManager(): ContentObserverManager? {
        return contentObserverManager
    }
}
