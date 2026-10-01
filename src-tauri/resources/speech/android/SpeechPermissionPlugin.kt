package com.gabriel.notia

import android.Manifest
import android.app.Activity
import android.content.res.AssetManager
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")
    ]
)
class SpeechPermissionPlugin(private val activity: Activity) : Plugin(activity) {
    /**
     * Copies one speech model packed in the APK (`assets/<asset>`) to
     * `destination`, a file inside the app's private data. The native
     * recognizer only opens real files, and the APK assets are not. Runs on
     * its own thread: a model is hundreds of megabytes. Never logs paths or
     * exception messages.
     */
    @Command
    fun extractAsset(invoke: Invoke) {
        val args = invoke.getArgs()
        val asset = args.getString("asset", null)
        val destination = args.getString("destination", null)
        val dataDir = File(activity.applicationInfo.dataDir).canonicalFile
        val target = destination?.let { File(it).canonicalFile }
        val valid = asset != null &&
            asset.startsWith("resources/speech/models/") &&
            !asset.split('/').any { it == ".." || it.isEmpty() } &&
            target != null &&
            target.path.startsWith(dataDir.path + File.separator)
        if (!valid) {
            invoke.resolve(JSObject().put("ok", false).put("code", "invalid"))
            return
        }
        Thread {
            val partial = File(target!!.path + ".partial")
            try {
                target.parentFile?.mkdirs()
                activity.assets.open(asset!!, AssetManager.ACCESS_STREAMING).use { input ->
                    FileOutputStream(partial).use { output -> input.copyTo(output, 1 shl 20) }
                }
                if (target.exists()) {
                    target.delete()
                }
                if (!partial.renameTo(target)) {
                    partial.delete()
                    invoke.resolve(JSObject().put("ok", false).put("code", "failed"))
                    return@Thread
                }
                invoke.resolve(JSObject().put("ok", true).put("bytes", target.length()))
            } catch (error: Exception) {
                partial.delete()
                invoke.resolve(JSObject().put("ok", false).put("code", "failed"))
            }
        }.start()
    }
}
