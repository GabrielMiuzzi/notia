package com.gabriel.notia

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import java.io.File

@TauriPlugin
class LibraryDatabasePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun initializeDatabase(invoke: Invoke) {
        val libraryUri = invoke.parseArgs(InitializeDatabaseArgs::class.java).libraryUri
        try {
            val databaseUri = initializeDatabaseFile(libraryUri)
            invoke.resolve(JSObject().put("ok", true).put("databasePath", databaseUri.toString()).put("schemaVersion", 1))
        } catch (error: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("error", "No se pudo inicializar la base SQLite Android."))
        }
    }

    private fun initializeDatabaseFile(libraryUriValue: String): Uri {
        val libraryUri = Uri.parse(libraryUriValue)
        val resolver = activity.contentResolver
        val notiaDirectory = findChild(libraryUri, ".notia")
            ?: DocumentsContract.createDocument(resolver, libraryUri, DocumentsContract.Document.MIME_TYPE_DIR, ".notia")
            ?: error("No se pudo crear .notia")
        val databaseUri = findChild(notiaDirectory, "notia.db")
            ?: DocumentsContract.createDocument(resolver, notiaDirectory, "application/octet-stream", "notia.db")
            ?: error("No se pudo crear notia.db")

        val temporaryDatabase = File.createTempFile("notia-db-", ".db", activity.cacheDir)
        try {
            resolver.openInputStream(databaseUri)?.use { input -> temporaryDatabase.outputStream().use(input::copyTo) }
            val database = android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(temporaryDatabase, null)
            database.execSQL("PRAGMA foreign_keys = ON")
            database.execSQL("CREATE TABLE IF NOT EXISTS notia_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
            database.execSQL("INSERT OR IGNORE INTO notia_schema_migrations (version) VALUES (1)")
            database.close()
            resolver.openOutputStream(databaseUri, "wt")?.use { output ->
                temporaryDatabase.inputStream().use { input -> input.copyTo(output) }
            }
                ?: error("No se pudo guardar notia.db")
            return databaseUri
        } finally {
            temporaryDatabase.delete()
        }
    }

    private fun findChild(parentUri: Uri, name: String): Uri? {
        val resolver = activity.contentResolver
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(parentUri, DocumentsContract.getDocumentId(parentUri))
        resolver.query(childrenUri, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            while (cursor.moveToNext()) {
                if (cursor.getString(nameIndex) == name) {
                    return DocumentsContract.buildDocumentUriUsingTree(parentUri, cursor.getString(idIndex))
                }
            }
        }
        return null
    }
}

private data class InitializeDatabaseArgs(val libraryUri: String)
