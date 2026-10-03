package com.gabriel.notia

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PersistableBundle
import android.view.View
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.atomic.AtomicBoolean
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
 *
 * It also shows the fixed notification with the state of a client's link
 * with its host (`showConnectionStatus`) while the app is open. Rust decides
 * what it says; this only shows it.
 *
 * It also keeps the interface clear of the system bars (`load`).
 */
@TauriPlugin
class ContinuityPlugin(private val activity: Activity) : Plugin(activity) {

    override fun load(webView: WebView) {
        keepContentClearOfSystemBars()
    }

    /**
     * MainActivity draws edge to edge, but the WebView does not report the
     * tablet taskbar, the navigation bar or the caption bar of a desktop-mode
     * window as `env(safe-area-inset-*)`, so they covered the interface. The
     * content view that holds the WebView is padded by those bars (and the
     * display cutout) instead, and they are taken out of the insets the
     * WebView receives, so nothing is padded twice. The keyboard inset still
     * reaches the WebView, which `useKeyboardInset` relies on.
     */
    private fun keepContentClearOfSystemBars() {
        val content = activity.findViewById<View>(android.R.id.content) ?: return
        content.setBackgroundColor(SYSTEM_BARS_BACKGROUND)
        WindowCompat.getInsetsController(activity.window, content).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets.inset(bars)
        }
        ViewCompat.requestApplyInsets(content)
    }

    @Command
    fun beginWork(invoke: Invoke) {
        try {
            val workKind = invoke.getArgs().getString("workKind", null)
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

    /**
     * Opens an https address in the device's browser while the backend keeps
     * working, for example to sign in to a mail provider and come back to
     * the loopback redirect.
     */
    @Command
    fun openUrl(invoke: Invoke) {
        try {
            val uri = Uri.parse(invoke.getArgs().text("url"))
            if (uri.scheme != "https") {
                invoke.resolve(JSObject().put("ok", false).put("error", "Solo se abren direcciones https."))
                return
            }
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            invoke.resolve(JSObject().put("ok", true))
        } catch (error: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("error", "No se pudo abrir el navegador."))
        }
    }

    /**
     * Copies a ColdPass secret marked as sensitive, so the system preview
     * hides it, and clears it after `clearAfterMs` if the clipboard still
     * holds it. Android only lets the app in the foreground read the
     * clipboard: when Notia is in the background the check cannot be made
     * and the secret stays, as anything copied by another app would.
     */
    @Command
    fun copySecret(invoke: Invoke) {
        try {
            val args = secretArgs(invoke.getArgs())
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText(SECRET_LABEL, args.text)
            val sensitiveKey = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ClipDescription.EXTRA_IS_SENSITIVE
            } else {
                "android.content.extra.IS_SENSITIVE"
            }
            clip.description.extras = PersistableBundle().apply { putBoolean(sensitiveKey, true) }
            val main = Handler(Looper.getMainLooper())
            main.post {
                try {
                    clipboard.setPrimaryClip(clip)
                } catch (_: Exception) {
                }
            }
            main.postDelayed({
                try {
                    val current = clipboard.primaryClip
                    val stillOurs = current != null &&
                        current.description.label?.toString() == SECRET_LABEL &&
                        current.itemCount > 0 &&
                        current.getItemAt(0).text?.toString() == args.text
                    if (stillOurs) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                            clipboard.clearPrimaryClip()
                        } else {
                            clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
                        }
                    }
                } catch (_: Exception) {
                }
            }, args.clearAfterMs.coerceIn(1_000L, 600_000L))
            invoke.resolve(JSObject().put("ok", true))
        } catch (error: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("error", "No se pudo copiar al portapapeles."))
        }
    }

    @Command
    fun endWork(invoke: Invoke) {
        try {
            val token = activeWork.updateAndGet { current -> if (current <= 0) 0 else current - 1 }
            // A service still waiting for `startForeground` must not be
            // stopped: Android kills the app. It stops itself once it is in
            // the foreground and sees no work left.
            if (token == 0 && inForeground.get()) {
                stopService()
            }
            invoke.resolve(JSObject().put("ok", true).put("activeWork", token))
        } catch (_: Exception) {
            invoke.resolve(JSObject().put("ok", false))
        }
    }

    @Command
    fun showConnectionStatus(invoke: Invoke) {
        try {
            val args = invoke.getArgs()
            val kind = args.getString("kind", null) ?: "connecting"
            val title = args.getString("title", null) ?: "Notia"
            val text = args.getString("text", null) ?: ""
            askNotificationPermission()
            val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CONNECTION_CHANNEL_ID,
                    "Conexión con el host",
                    NotificationManager.IMPORTANCE_LOW
                )
                channel.setShowBadge(false)
                manager.createNotificationChannel(channel)
            }
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(activity, CONNECTION_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(activity)
            }
            builder
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(Notification.BigTextStyle().bigText(text))
                .setSmallIcon(connectionIcon(kind))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
            activity.packageManager.getLaunchIntentForPackage(activity.packageName)?.let { launch ->
                val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                builder.setContentIntent(PendingIntent.getActivity(activity, 0, launch, flags))
            }
            manager.notify(CONNECTION_NOTIFICATION_ID, builder.build())
            invoke.resolve(JSObject().put("ok", true))
        } catch (_: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("error", "No se pudo mostrar el estado de la conexión."))
        }
    }

    @Command
    fun clearConnectionStatus(invoke: Invoke) {
        cancelConnectionStatus()
        invoke.resolve(JSObject().put("ok", true))
    }

    /** The notification lives while the app is open, not after it closes. */
    override fun onDestroy() {
        if (!activity.isChangingConfigurations) {
            cancelConnectionStatus()
        }
        super.onDestroy()
    }

    private fun cancelConnectionStatus() {
        try {
            val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.cancel(CONNECTION_NOTIFICATION_ID)
        } catch (_: Exception) {
        }
    }

    /** Android 13 hides the app's notifications until the person allows them. */
    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || notificationsAsked.getAndSet(true)) {
            return
        }
        if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return
        }
        activity.runOnUiThread {
            try {
                activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST)
            } catch (_: Exception) {
            }
        }
    }

    private fun connectionIcon(kind: String): Int = when (kind) {
        "connected" -> android.R.drawable.presence_online
        "syncing" -> android.R.drawable.stat_notify_sync
        "failed" -> android.R.drawable.stat_notify_error
        "offline" -> android.R.drawable.presence_offline
        else -> android.R.drawable.stat_notify_sync_noanim
    }

    @Command
    fun workStatus(invoke: Invoke) {
        invoke.resolve(JSObject().put("activeWork", activeWork.get()))
    }

    private fun startForegroundService(workKind: String) {
        val intent = Intent(activity, ContinuityService::class.java)
        intent.putExtra(EXTRA_WORK_KIND, workKind)
        inForeground.set(false)
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
                try {
                    startForeground(NOTIFICATION_ID, notification, serviceType(workKind))
                } catch (_: SecurityException) {
                    // Microphone without permission: the work still needs to
                    // survive, and a service that never reaches the
                    // foreground brings the app down.
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                }
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            inForeground.set(true)
            // The work may have ended before the service got here.
            if (activeWork.get() == 0) {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelfResult(startId)
            }
            return START_NOT_STICKY
        }

        override fun onDestroy() {
            inForeground.set(false)
            super.onDestroy()
        }

        private fun serviceType(workKind: String): Int = if (workKind == "microphone") {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        } else {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
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
        const val SECRET_LABEL = "Notia ColdPass"
        const val CONNECTION_CHANNEL_ID = "notia-host-connection"
        const val CONNECTION_NOTIFICATION_ID = 0x4E0B
        const val NOTIFICATION_PERMISSION_REQUEST = 0x4E0C
        // Ink of the dark theme, behind the system bars.
        const val SYSTEM_BARS_BACKGROUND = 0xFF0F1420.toInt()

        // Shared with the service, which outlives the plugin's calls.
        val activeWork = AtomicInteger(0)
        val inForeground = AtomicBoolean(false)
        val notificationsAsked = AtomicBoolean(false)
    }
}

private data class SecretArgs(val text: String, val clearAfterMs: Long)

// Read by hand: `parseArgs` cannot build Kotlin data classes (Jackson has
// no Kotlin module here), so every call failed.
private fun JSObject.text(key: String): String =
    getString(key, null) ?: throw IllegalArgumentException("missing argument")

private fun secretArgs(args: JSObject) = SecretArgs(args.text("text"), args.optLong("clearAfterMs", 30_000L))