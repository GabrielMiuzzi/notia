package com.gabriel.notia

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * Android SAF boundary for the library picker. The class must be present in
 * the APK because Rust registers it during Tauri startup, before any picker
 * command is invoked.
 */
@TauriPlugin
class DirectoryPickerPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun pickDirectoryTree(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            )
        }
        startActivityForResult(invoke, intent, "directoryTreeResult")
    }

    @ActivityCallback
    fun directoryTreeResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("No se seleccionó ninguna carpeta.")
            return
        }
        val uri: Uri = result.data?.data ?: run {
            invoke.reject("No se pudo resolver la carpeta seleccionada.")
            return
        }
        try {
            activity.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
            invoke.resolve(JSObject().put("path", uri.toString()).put("uri", uri.toString()))
        } catch (error: SecurityException) {
            invoke.reject("No se pudo conservar el permiso de la carpeta seleccionada: ${error.message}")
        }
    }
}
