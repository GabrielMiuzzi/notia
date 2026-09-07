package com.gabriel.notia

import android.app.Activity
import android.net.Uri
import android.provider.DocumentsContract
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@TauriPlugin
class LibraryDatabasePlugin(private val activity: Activity) : Plugin(activity) {
    private val temporaryDatabases = mutableMapOf<String, File>()

    @Command
    fun initializeDatabase(invoke: Invoke) = prepare(invoke)

    @Command
    fun prepareDatabase(invoke: Invoke) = prepare(invoke)

    @Command
    fun syncDatabase(invoke: Invoke) {
        val libraryUri = invoke.parseArgs(DatabaseArgs::class.java).libraryUri
        try {
            val temporary = temporaryDatabases[libraryUri] ?: error("La copia temporal no está preparada")
            val databaseUri = databaseUri(libraryUri)
            activity.contentResolver.openOutputStream(databaseUri, "wt")?.use { output ->
                temporary.inputStream().use { input -> input.copyTo(output) }
            } ?: error("No se pudo abrir notia.db para escritura")
            invoke.resolve(success(temporary))
        } catch (_: SecurityException) {
            invoke.resolve(failure("El permiso de la carpeta fue revocado. Volvé a seleccionar la biblioteca."))
        } catch (_: Exception) {
            invoke.resolve(failure("No se pudo sincronizar la base SQLite con la biblioteca."))
        }
    }

    private fun prepare(invoke: Invoke) {
        val libraryUri = invoke.parseArgs(DatabaseArgs::class.java).libraryUri
        try {
            val existing = temporaryDatabases[libraryUri]
            val temporary = if (existing?.isFile == true) existing else {
                val created = File.createTempFile("notia-db-", ".db", activity.cacheDir)
                val databaseUri = databaseUri(libraryUri)
                activity.contentResolver.openInputStream(databaseUri)?.use { input ->
                    created.outputStream().use { output -> input.copyTo(output) }
                }
                temporaryDatabases[libraryUri] = created
                created
            }
            invoke.resolve(success(temporary))
        } catch (_: SecurityException) {
            invoke.resolve(failure("El permiso de la carpeta fue revocado. Volvé a seleccionar la biblioteca."))
        } catch (_: Exception) {
            invoke.resolve(failure("No se pudo preparar la base SQLite Android."))
        }
    }

    private fun databaseUri(libraryUriValue: String): Uri {
        val libraryUri = Uri.parse(libraryUriValue)
        val resolver = activity.contentResolver
        val notiaDirectory = findChild(libraryUri, ".notia")
            ?: DocumentsContract.createDocument(resolver, libraryUri, DocumentsContract.Document.MIME_TYPE_DIR, ".notia")
            ?: error("No se pudo crear .notia")
        return findChild(notiaDirectory, "notia.db")
            ?: DocumentsContract.createDocument(resolver, notiaDirectory, "application/octet-stream", "notia.db")
            ?: error("No se pudo crear notia.db")
    }

    private fun findChild(parentUri: Uri, name: String): Uri? {
        val resolver = activity.contentResolver
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(parentUri, DocumentsContract.getDocumentId(parentUri))
        resolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { cursor ->
            val id = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val displayName = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            while (cursor.moveToNext()) if (cursor.getString(displayName) == name) {
                return DocumentsContract.buildDocumentUriUsingTree(parentUri, cursor.getString(id))
            }
        }
        return null
    }

    private fun success(file: File) = JSObject().put("ok", true).put("databasePath", file.absolutePath)
    private fun failure(message: String) = JSObject().put("ok", false).put("error", message)
}

private data class DatabaseArgs(val libraryUri: String)
