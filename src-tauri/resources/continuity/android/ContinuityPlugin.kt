package com.gabriel.notia

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.atomic.AtomicInteger

/**
 * Foreground continuity boundary for Android.
 *
 * Meeting/dictation capture and Telegram processing must survive the activity
 * being backgrounded or the screen being locked. A short-lived foreground
 * service with a notification declares that work to the OS so the process is
 * not frozen or killed while the WebView is hidden. The service is started
 * when a long operation begins and stopped when the last one finishes; the
 * type (`microphone` for voice capture, `dataSync` for network work) is chosen
 * by the caller and validated against the Android version.
 */
@TauriPlugin
class ContinuityPlugin(private val activity: Activity) : Plugin(activity) {

    private val activeWork = AtomicInteger(0)

    @Command
    fun beginWork(invoke: Invoke) {
        try {
            val workKind = invoke.parseArgs(WorkArgs::class.java).workKind
            val normalizedKind = when (workKind) {
                "microphone" -> "microphone"
                else -> "dataSync"
            }
            val token = activeWork.incrementAndGet()
            if (token == 1) {
                startForegroundService(normalizedKind)
            }
            invoke.resolve(JSObject().put("ok", true).put("activeWork", activeWork.get()))
        } catch (error: SecurityException) {
            activeWork.set(0)
            invoke.resolve(JSObject().put("ok", false).put("error", "El sistema rechazó el servicio en primer plano: ${error.message}"))
        } catch (error: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("error", error.message ?: "No se pudo asegurar la continuidad en segundo plano."))
        }
    }

    @Command
    fun endWork(invoke: Invoke) {
        try {
            val token = activeWork.updateAndGet { current -> if (current <= 0) 0 else current - 1 }
            if (token == 0) {
                stopService()
            }
            invoke.resolve(JSObject().put("ok", true).put("activeWork", token))
        } catch (_: Exception) {
            invoke.resolve(JSObject().put("ok", false))
        }
    }

    @Command
    fun workStatus(invoke: Invoke) {
        invoke.resolve(JSObject().put("activeWork", activeWork.get()))
    }

    private fun startForegroundService(workKind: String) {
        val intent = Intent(activity, ContinuityService::class.java)
        intent.putExtra(EXTRA_WORK_KIND, workKind)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startForegroundService(intent)
        } else {
            activity.startService(intent)
        }
    }

    private fun stopService() {
        activity.stopService(Intent(activity, ContinuityService::class.java))
    }

    class ContinuityService : Service() {
        override fun onBind(intent: Intent?): IBinder? = null

        override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
            val workKind = intent?.getStringExtra(EXTRA_WORK_KIND) ?: "dataSync"
            val notification = buildNotification(workKind)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                val serviceType = if (workKind == "microphone") {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                } else {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                }
                startForeground(NOTIFICATION_ID, notification, serviceType)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            return START_NOT_STICKY
        }

        private fun buildNotification(workKind: String): Notification {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Trabajo continuo de Notia",
                    NotificationManager.IMPORTANCE_LOW
                )
                channel.setShowBadge(false)
                manager.createNotificationChannel(channel)
            }
            val text = if (workKind == "microphone") {
                "Transcribiendo audio en segundo plano."
            } else {
                "Procesando una solicitud en segundo plano."
            }
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(this, CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this)
            }
            return builder
                .setContentTitle("Notia")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setOngoing(true)
                .build()
        }

        private companion object {
            const val NOTIFICATION_ID = 0x4E0A
        }
    }

    companion object {
        const val EXTRA_WORK_KIND = "workKind"
        const val CHANNEL_ID = "notia-continuity"
    }
}

private data class WorkArgs(val workKind: String)