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
import java.io.IOException

/**
 * SQLite persistence boundary for Android libraries.
 *
 * The live database lives inside the library through SAF (`<library>/.notia/notia.db`);
 * Rust opens a local copy in the app cache and writes through rusqlite. This plugin
 * copies the SAF document into the cache and, on sync, writes the copy back.
 *
 * Durability rules implemented here:
 * - `syncDatabase` writes to a staged document first and then replaces the SAF
 *   document by delete + rename so an interrupted copy can never leave a
 *   truncated `notia.db` as the only copy. If the provider does not support
 *   staging, it falls back to a truncating copy.
 * - The temporary cache copy is verified to still exist before syncing; a
 *   cleared cache surfaces as an explicit recoverable error instead of an
 *   empty database overwriting the real one.
 * - Revoked SAF grants surface as `ok:false` with an explicit message.
 */
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
            if (!temporary.isFile) {
                error("La copia temporal de la base ya no existe. Volvé a seleccionar la biblioteca.")
            }
            val databaseUri = databaseUri(libraryUri)
            writeAtomically(databaseUri, temporary)
            invoke.resolve(success(temporary))
        } catch (_: SecurityException) {
            invoke.resolve(failure("El permiso de la carpeta fue revocado. Volvé a seleccionar la biblioteca."))
        } catch (error: IllegalStateException) {
            invoke.resolve(failure(error.message ?: "No se pudo sincronizar la base SQLite con la biblioteca."))
        } catch (_: Exception) {
            invoke.resolve(failure("No se pudo sincronizar la base SQLite con la biblioteca."))
        }
    }

    @Command
    fun cleanupDatabases(invoke: Invoke) {
        try {
            var removed = 0
            synchronized(temporaryDatabases) {
                val iterator = temporaryDatabases.entries.iterator()
                while (iterator.hasNext()) {
                    val file = iterator.next().value
                    if (file.exists() && file.delete()) {
                        removed += 1
                    }
                    iterator.remove()
                }
            }
            invoke.resolve(JSObject().put("ok", true).put("removed", removed))
        } catch (_: Exception) {
            invoke.resolve(JSObject().put("ok", false))
        }
    }

    private fun prepare(invoke: Invoke) {
        val libraryUri = invoke.parseArgs(DatabaseArgs::class.java).libraryUri
        try {
            val existing = synchronized(temporaryDatabases) { temporaryDatabases[libraryUri] }
            val temporary = if (existing?.isFile == true) existing else {
                val created = File.createTempFile("notia-db-", ".db", activity.cacheDir)
                val databaseUri = databaseUri(libraryUri)
                activity.contentResolver.openInputStream(databaseUri)?.use { input ->
                    created.outputStream().use { output -> input.copyTo(output) }
                }
                synchronized(temporaryDatabases) { temporaryDatabases[libraryUri] = created }
                created
            }
            invoke.resolve(success(temporary))
        } catch (_: SecurityException) {
            invoke.resolve(failure("El permiso de la carpeta fue revocado. Volvé a seleccionar la biblioteca."))
        } catch (_: Exception) {
            invoke.resolve(failure("No se pudo preparar la base SQLite Android."))
        }
    }

    /**
     * Replaces the SAF document with the contents of `source` without ever
     * leaving a truncated final document: the copy goes to a staged document
     * first. The previous database is renamed to a recoverable backup before
     * the staged document takes its place; the previous document is restored
     * if promotion fails. Providers without the required rename semantics fail
     * safely instead of truncating the only database copy.
     */
    private fun writeAtomically(databaseUri: Uri, source: File) {
        val resolver = activity.contentResolver
        val parentUri = resolveParentDocumentUri(databaseUri)
        val staged = if (parentUri != null) {
            DocumentsContract.createDocument(
                resolver,
                parentUri,
                "application/octet-stream",
                "notia.db.tmp-${System.currentTimeMillis()}"
            )
        } else {
            null
        }

        if (staged == null) throw IOException("El proveedor de documentos no permite una sincronización SQLite recuperable.")

        var backup: Uri? = null
        try {
            resolver.openOutputStream(staged, "wt")?.use { output ->
                source.inputStream().use { input -> input.copyTo(output) }
                output.flush()
            } ?: throw IOException("No se pudo abrir el documento temporal para escritura.")
            backup = DocumentsContract.renameDocument(resolver, databaseUri, DATABASE_BACKUP_FILE)
            if (backup == null) {
                throw IOException("No se pudo resguardar la base SQLite anterior.")
            }
            val renamed = DocumentsContract.renameDocument(resolver, staged, DATABASE_FILE)
            if (renamed == null) {
                throw IOException("No se pudo renombrar la copia de la base.")
            }
            backup?.let { backupUri ->
                runCatching { DocumentsContract.deleteDocument(resolver, backupUri) }
            }
        } catch (error: Exception) {
            runCatching { DocumentsContract.deleteDocument(resolver, staged) }
            backup?.let { backupUri ->
                runCatching { DocumentsContract.renameDocument(resolver, backupUri, DATABASE_FILE) }
            }
            throw error
        }
    }

    /**
     * Resolves the parent directory URI of a document URI so a staged copy can
     * be created in the same `.notia` directory. Returns null when the parent
     * cannot be determined and the caller should fall back.
     */
    private fun resolveParentDocumentUri(databaseUri: Uri): Uri? {
        return try {
            val documentId = DocumentsContract.getDocumentId(databaseUri)
            val lastSeparator = documentId.lastIndexOf('/')
            if (lastSeparator <= 0) {
                return null
            }
            val parentDocumentId = documentId.substring(0, lastSeparator)
            DocumentsContract.buildDocumentUriUsingTree(databaseUri, parentDocumentId)
        } catch (_: Exception) {
            null
        }
    }

    private fun databaseUri(libraryUriValue: String): Uri {
        val libraryUri = Uri.parse(libraryUriValue)
        val resolver = activity.contentResolver
        val notiaDirectory = findChild(libraryUri, NOTIA_DIRECTORY)
            ?: DocumentsContract.createDocument(resolver, libraryUri, DocumentsContract.Document.MIME_TYPE_DIR, NOTIA_DIRECTORY)
            ?: error("No se pudo crear .notia")
        val current = findChild(notiaDirectory, DATABASE_FILE)
        if (current != null) {
            // A previous sync may have completed promotion just before its
            // cleanup. The current database is authoritative in that case.
            findChild(notiaDirectory, DATABASE_BACKUP_FILE)?.let { staleBackup ->
                runCatching { DocumentsContract.deleteDocument(resolver, staleBackup) }
            }
            return current
        }
        val backup = findChild(notiaDirectory, DATABASE_BACKUP_FILE)
        if (backup != null) {
            return DocumentsContract.renameDocument(resolver, backup, DATABASE_FILE)
                ?: throw IOException("No se pudo recuperar la base SQLite después de una sincronización interrumpida.")
        }
        return DocumentsContract.createDocument(resolver, notiaDirectory, "application/octet-stream", DATABASE_FILE)
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

    private companion object {
        const val NOTIA_DIRECTORY = ".notia"
        const val DATABASE_FILE = "notia.db"
        const val DATABASE_BACKUP_FILE = "notia.db.backup"
    }
}

private data class DatabaseArgs(val libraryUri: String)
