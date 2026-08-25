package com.gabriel.notia

import android.Manifest
import android.app.Activity
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")
    ]
)
class SpeechPermissionPlugin(private val activity: Activity) : Plugin(activity)
