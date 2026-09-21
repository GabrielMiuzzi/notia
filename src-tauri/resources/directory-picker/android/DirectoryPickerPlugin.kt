package com.gabriel.notia

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

/**
 * Android SAF boundary used by Rust through `run_mobile_plugin`.
 *
 * Contract (kept in sync with `src-tauri/src/mobile_directory_picker.rs`):
 * - readTree/readDirectory return `{ nodes: [...] }`. Each node has
 *   `id` (content:// document URI), `name`, `type` ('file'|'folder'),
 *   `path` (logical path relative to the tree root), `hasChildren` and,
 *   optionally, `children`/`expanded`/`modifiedAt`. Rust caches
 *   path → id so later commands can be addressed by logical path or URI.
 * - readFlatFileList returns `{ files: [{path,type,name}] }` with the same
 *   logical-path convention.
 * - readFile returns `{ content: <UTF-8 text> }`; Rust derives the document
 *   revision from that text.
 * - writeFile receives plain text `content` and returns `{ ok: boolean }`.
 * - statEntry returns `{ ok: boolean, type: 'file'|'folder' }`.
 * - createEntry returns `{ path: <uri string> }` for the created entry or an
 *   existing child with the same name and type.
 * - deleteEntry returns `{ ok: boolean }`.
 * - renameEntry/copyEntry/moveEntry return `{ ok: boolean, path: <uri> }`.
 *
 * Tree URIs are normalized to document URIs before any stream access and
 * every command checks read/write permissions explicitly, so a revoked
 * grant surfaces as a recoverable rejection instead of a crash.
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
        try {
            android.util.Log.i(
                "NotiaSAF",
                "directoryTreeResult resultCode=${result.resultCode} hasData=${result.data != null}"
            )
            if (result.resultCode != Activity.RESULT_OK) {
                invoke.reject("No se seleccionó ninguna carpeta.")
                return
            }
            val data = result.data
            val uri: Uri = data?.data ?: run {
                invoke.reject("No se pudo resolver la carpeta seleccionada.")
                return
            }
            if (uri.scheme != ContentResolver.SCHEME_CONTENT || !DocumentsContract.isTreeUri(uri)) {
                invoke.reject("El selector no devolvió una URI tree SAF válida.")
                return
            }
            val grantedFlags = (data.flags and (
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            ))
            if (grantedFlags == 0) {
                invoke.reject("El selector no concedió permisos para la carpeta seleccionada.")
                return
            }
            activity.contentResolver.takePersistableUriPermission(
                uri,
                grantedFlags
            )
            invoke.resolve(JSObject().put("path", uri.toString()).put("uri", uri.toString()))
        } catch (error: SecurityException) {
            invoke.reject("No se pudo conservar el permiso de la carpeta seleccionada: ${error.message}")
        } catch (error: Exception) {
            android.util.Log.e("NotiaSAF", "directoryTreeResult failed: ${error::class.java.simpleName}")
            invoke.reject(error.message ?: "No se pudo resolver la carpeta seleccionada.")
        }
    }

    @Command
    fun readTree(invoke: Invoke) {
        runSaf(invoke, "No se pudo leer la carpeta Android.") { args ->
            val treeUri = requireUri(args)
            val rootPath = treeUri.toString().trimEnd('/')
            val nodes = readChildrenRecursive(treeUri, rootPath = rootPath, depth = 0)
            JSObject().put("nodes", nodes)
        }
    }

    @Command
    fun readDirectory(invoke: Invoke) {
        runSaf(invoke, "No se pudo leer el directorio Android.") { args ->
            val treeUri = requireUri(args)
            val rootPath = treeUri.toString().trimEnd('/')
            val nodes = readChildrenShallow(treeUri, rootPath = rootPath)
            JSObject().put("nodes", nodes)
        }
    }

    @Command
    fun readFlatFileList(invoke: Invoke) {
        runSaf(invoke, "No se pudo leer la lista de archivos Android.") { args ->
            val treeUri = requireUri(args)
            val rootPath = treeUri.toString().trimEnd('/')
            val files = JSONArray()
            collectFlatEntries(treeUri, rootPath = rootPath, files, depth = 0)
            JSObject().put("files", files)
        }
    }

    @Command
    fun readFile(invoke: Invoke) {
        runSaf(invoke, "No se pudo leer el archivo Android.") { args ->
            val documentUri = normalizeToDocumentUri(requireUri(args))
            val content = activity.contentResolver.openInputStream(documentUri)?.use { input ->
                input.readBytes().toString(Charsets.UTF_8)
            } ?: throw IOException("No se pudo abrir el archivo Android.")
            JSObject().put("content", content)
        }
    }

    /**
     * Reads the raw document bytes encoded as Base64. Text files go through
     * [readFile]; binary documents (PDF/images for finance extraction) need
     * this because text decoding would corrupt them.
     */
    @Command
    fun readFileBinary(invoke: Invoke) {
        runSaf(invoke, "No se pudo leer el archivo Android.") { args ->
            val documentUri = normalizeToDocumentUri(requireUri(args))
            val bytes = activity.contentResolver.openInputStream(documentUri)?.use { input ->
                input.readBytes()
            } ?: throw IOException("No se pudo abrir el archivo Android.")
            val displayName = queryDisplayName(documentUri) ?: "documento"
            JSObject()
                .put("name", displayName)
                .put("base64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
        }
    }

    @Command
    fun writeFile(invoke: Invoke) {
        runSaf(invoke, "No se pudo escribir el archivo Android.") { args ->
            val documentUri = normalizeToDocumentUri(requireUri(args))
            val bytes = args.optString("base64", "").takeIf { it.isNotEmpty() }
                ?.let { encoded ->
                    try {
                        android.util.Base64.decode(encoded, android.util.Base64.DEFAULT)
                    } catch (_: IllegalArgumentException) {
                        throw IOException("El contenido binario del archivo es inválido.")
                    }
                }
                ?: args.optString("content", "").toByteArray(Charsets.UTF_8)
            activity.contentResolver.openOutputStream(documentUri, "wt")?.use { output ->
                output.write(bytes)
            } ?: throw IOException("No se pudo abrir el archivo para escritura.")
            JSObject().put("ok", true)
        }
    }

    @Command
    fun statEntry(invoke: Invoke) {
        runSaf(invoke, "No se pudo leer la entrada Android.") { args ->
            val documentUri = normalizeToDocumentUri(requireUri(args))
            val isFolder = isDirectory(documentUri)
            if (!isFolder && !isDocumentReadable(documentUri)) {
                throw IOException("La entrada no existe o no es legible.")
            }
            JSObject().put("ok", true).put("type", if (isFolder) "folder" else "file")
        }
    }

    @Command
    fun createEntry(invoke: Invoke) {
        runSaf(invoke, "No se pudo crear la entrada Android.") { args ->
            val parentUri = normalizeToDocumentUri(requireUri(args.optString("parentUri", "")))
            val name = args.optString("name", "").trim()
            val entryType = args.optString("entryType", "file")
            if (name.isEmpty()) throw IOException("El nombre de la entrada es obligatorio.")
            val isFolder = entryType == "folder"
            val initialContent = args.optString("content", "")
            val created = createOrResolveChild(parentUri, name, isFolder, initialContent)
            JSObject().put("path", created.toString())
        }
    }

    /**
     * Creates a nested entry starting at the granted tree root. This command
     * deliberately does not depend on readTree/path caches, so bootstrap files
     * such as `.notia/notiaConfig.json` can be created atomically even when a
     * provider returns a stale tree immediately after creating `.notia`.
     */
    @Command
    fun createPathEntry(invoke: Invoke) {
        // MARK: createPathEntry logging hook
        runSaf(invoke, "No se pudo crear la ruta Android.") { args ->
            val rawRootUri = args.optString("rootUri", "").trim()
            android.util.Log.i(
                "NotiaSAF",
                "createPathEntry input rootUriPresent=${rawRootUri.isNotEmpty()} rootUriLength=${rawRootUri.length} segmentsPresent=${args.has("segments")}")
            val rootUri = normalizeToDocumentUri(requireTreeUri(rawRootUri))
            val rawSegments = args.optJSONArray("segments")
                ?: throw IOException("No se recibió una ruta Android válida.")
            if (rawSegments.length() == 0 || rawSegments.length() > MAX_TREE_DEPTH) {
                throw IOException("La ruta Android tiene una profundidad inválida.")
            }

            val segments = ArrayList<String>(rawSegments.length())
            for (index in 0 until rawSegments.length()) {
                val segment = rawSegments.optString(index, "").trim()
                if (segment.isEmpty() || segment == "." || segment == ".." ||
                    segment.contains('/') || segment.contains('\\')) {
                    throw IOException("La ruta Android contiene un segmento inválido.")
                }
                segments.add(segment)
            }

            val finalIsFolder = args.optString("entryType", "file") == "folder"
            val initialContent = args.optString("content", "")
            var currentUri = rootUri
            for (index in segments.indices) {
                val isFinal = index == segments.lastIndex
                val isFolder = !isFinal || finalIsFolder
                currentUri = createOrResolveChild(
                    currentUri,
                    segments[index],
                    isFolder,
                    if (isFinal && !isFolder) initialContent else ""
                )
            }
            JSObject().put("path", currentUri.toString())
        }
    }

    @Command
    fun deleteEntry(invoke: Invoke) {
        runSaf(invoke, "No se pudo eliminar la entrada Android.") { args ->
            val documentUri = normalizeToDocumentUri(requireUri(args))
            DocumentsContract.deleteDocument(activity.contentResolver, documentUri)
            JSObject().put("ok", true)
        }
    }

    @Command
    fun renameEntry(invoke: Invoke) {
        runSaf(invoke, "No se pudo renombrar la entrada Android.") { args ->
            val documentUri = normalizeToDocumentUri(requireUri(args))
            val newName = args.optString("newName", "").trim()
            if (newName.isEmpty()) throw IOException("El nombre nuevo es obligatorio.")
            val renamed = DocumentsContract.renameDocument(
                activity.contentResolver,
                documentUri,
                newName
            ) ?: throw IOException("El proveedor de documentos rechazó el renombrado.")
            JSObject().put("ok", true).put("path", renamed.toString())
        }
    }

    @Command
    fun copyEntry(invoke: Invoke) {
        runSaf(invoke, "No se pudo copiar la entrada Android.") { args ->
            val sourceUri = normalizeToDocumentUri(requireUri(args.optString("sourceUri", "")))
            val targetParentUri = normalizeToDocumentUri(requireUri(args.optString("targetParentUri", "")))
            val created = copyRecursive(sourceUri, targetParentUri)
            JSObject().put("ok", true).put("path", created.toString())
        }
    }

    @Command
    fun moveEntry(invoke: Invoke) {
        runSaf(invoke, "No se pudo mover la entrada Android.") { args ->
            val sourceUri = normalizeToDocumentUri(requireUri(args.optString("sourceUri", "")))
            val targetParentUri = normalizeToDocumentUri(requireUri(args.optString("targetParentUri", "")))
            val sourceParentUri = requireUri(args.optString("sourceParentUri", ""))
            val moved = DocumentsContract.moveDocument(
                activity.contentResolver,
                sourceUri,
                sourceParentUri,
                targetParentUri
            ) ?: throw IOException("El proveedor de documentos rechazó el movimiento.")
            JSObject().put("ok", true).put("path", moved.toString())
        }
    }

    // ── Execution wrapper ───────────────────────────────────────────────

    private inline fun runSaf(invoke: Invoke, fallbackMessage: String, block: (JSONObject) -> JSObject) {
        try {
            invoke.resolve(block(invoke.getArgs()))
        } catch (error: SecurityException) {
            invoke.reject("El permiso de la carpeta fue revocado. Volvé a seleccionar la biblioteca.")
        } catch (error: IOException) {
            invoke.reject(error.message ?: fallbackMessage)
        } catch (error: Exception) {
            invoke.reject(error.message ?: fallbackMessage)
        }
    }

    // ── Argument helpers ────────────────────────────────────────────────

    private fun requireUri(args: JSONObject): Uri = requireUri(args.optString("uri", ""))

    private fun requireUri(raw: String): Uri {
        val trimmed = raw.trim()
        if (!trimmed.startsWith("content://") || trimmed.any { it.isWhitespace() || it.code < 0x20 }) {
            throw IOException("No se recibió una URI SAF válida.")
        }
        val uri = Uri.parse(trimmed)
        if (uri.authority.isNullOrBlank()) {
            throw IOException("No se recibió una URI SAF válida.")
        }
        return uri
    }

    private fun requireTreeUri(raw: String): Uri {
        val uri = requireUri(raw)
        if (!DocumentsContract.isTreeUri(uri)) {
            throw IOException("La raíz Android debe ser una URI tree SAF válida.")
        }
        return uri
    }

    // ── URI helpers ─────────────────────────────────────────────────────

    /**
     * Tree URIs (`.../tree/<docId>`) cannot be opened as streams directly;
     * convert to a document URI under the same tree. Document URIs pass
     * through unchanged.
     */
    private fun normalizeToDocumentUri(uri: Uri): Uri {
        if (DocumentsContract.isDocumentUri(activity, uri)) return uri
        if (DocumentsContract.isTreeUri(uri)) {
            return DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
        }
        return uri
    }

    private fun treeUriFor(uri: Uri): Uri {
        if (DocumentsContract.isTreeUri(uri)) return uri
        val authority = uri.authority ?: throw IOException("La URI Android no tiene autoridad válida.")
        return try {
            DocumentsContract.buildTreeDocumentUri(
                authority,
                DocumentsContract.getTreeDocumentId(uri)
            )
        } catch (_: Exception) {
            throw IOException("La URI Android no pertenece a un árbol SAF válido.")
        }
    }

    private fun childDocumentUri(parentUri: Uri, documentId: String): Uri {
        return DocumentsContract.buildDocumentUriUsingTree(treeUriFor(parentUri), documentId)
    }

    private fun queryDisplayName(uri: Uri): String? {
        return try {
            activity.contentResolver.query(
                uri,
                arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                null,
                null,
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun isDocumentReadable(uri: Uri): Boolean {
        return try {
            activity.contentResolver.openInputStream(uri)?.close()
            true
        } catch (_: SecurityException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    private fun isDirectory(uri: Uri): Boolean {
        return try {
            activity.contentResolver.query(
                uri,
                arrayOf(DocumentsContract.Document.COLUMN_MIME_TYPE),
                null,
                null,
                null
            )?.use { cursor ->
                cursor.moveToFirst() &&
                    cursor.getString(0) == DocumentsContract.Document.MIME_TYPE_DIR
            } ?: false
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Resolves an immediate child by display name without depending on the
     * recursive tree payload. Some providers omit dot-prefixed entries from a
     * tree refresh even though they remain addressable through their parent.
     */
    private fun findChildDocument(parentUri: Uri, name: String, expectFolder: Boolean): Uri? {
        val parentTreeUri = treeUriFor(parentUri)
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            parentTreeUri,
            DocumentsContract.getDocumentId(parentUri)
        )
        activity.contentResolver.query(
            childrenUri,
            arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE
            ),
            null,
            null,
            null
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            val mimeIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
            while (cursor.moveToNext()) {
                if (cursor.getString(nameIndex) != name) continue
                val isFolder = cursor.getString(mimeIndex) == DocumentsContract.Document.MIME_TYPE_DIR
                if (isFolder != expectFolder) {
                    throw IOException("Ya existe una entrada incompatible con ese nombre.")
                }
                val documentId = cursor.getString(idIndex) ?: continue
                return childDocumentUri(parentTreeUri, documentId)
            }
        }
        return null
    }

    private fun createOrResolveChild(
        parentUri: Uri,
        name: String,
        isFolder: Boolean,
        initialContent: String
    ): Uri {
        if (name.length > MAX_ENTRY_NAME_LENGTH || name.any { it.isWhitespace() && it != ' ' || it.code < 0x20 } ||
            name == "." || name == ".." || name.contains('/') || name.contains('\\')) {
            throw IOException("El nombre de la entrada es inválido.")
        }
        val mimeType = if (isFolder) {
            DocumentsContract.Document.MIME_TYPE_DIR
        } else {
            "application/octet-stream"
        }
        val existing = findChildDocument(parentUri, name, isFolder)
        val (created, createdNew) = if (existing != null) {
            Pair(existing, false)
        } else try {
            val createdDocument = DocumentsContract.createDocument(
                activity.contentResolver,
                parentUri,
                mimeType,
                name
            )
            if (createdDocument != null) {
                Pair(createdDocument, true)
            } else {
                Pair(
                    findChildDocument(parentUri, name, isFolder)
                        ?: throw IOException("El proveedor de documentos rechazó la creación."),
                    false
                )
            }
        } catch (error: SecurityException) {
            throw error
        } catch (error: Exception) {
            Pair(findChildDocument(parentUri, name, isFolder) ?: throw error, false)
        }

        if (createdNew && !isFolder && initialContent.isNotEmpty()) {
            try {
                activity.contentResolver.openOutputStream(created)?.use { output ->
                    output.write(initialContent.toByteArray(Charsets.UTF_8))
                } ?: throw IOException("No se pudo abrir el archivo nuevo para escritura.")
            } catch (error: Exception) {
                try {
                    DocumentsContract.deleteDocument(activity.contentResolver, created)
                } catch (_: Exception) {
                    // Best-effort cleanup: preserve the original write error.
                }
                if (error is SecurityException) throw error
                throw IOException(
                    error.message ?: "No se pudo escribir el contenido inicial.",
                    error
                )
            }
        }
        return created
    }

    // ── Tree traversal ──────────────────────────────────────────────────

    private fun readChildrenShallow(treeOrDocumentUri: Uri, rootPath: String): JSONArray {
        val documentUri = normalizeToDocumentUri(treeOrDocumentUri)
        val treeUri = treeUriFor(treeOrDocumentUri)
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            treeUri,
            DocumentsContract.getDocumentId(documentUri)
        )
        val nodes = JSONArray()
        activity.contentResolver.query(
            childrenUri,
            arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED
            ),
            null,
            null,
            null
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            val mimeIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
            val modifiedIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
            while (cursor.moveToNext()) {
                val documentId = cursor.getString(idIndex) ?: continue
                val name = cursor.getString(nameIndex) ?: continue
                val mimeType = cursor.getString(mimeIndex) ?: ""
                val isFolder = mimeType == DocumentsContract.Document.MIME_TYPE_DIR
                val childUri = childDocumentUri(treeUri, documentId)
                val node = JSONObject()
                node.put("id", childUri.toString())
                node.put("name", name)
                node.put("path", joinLogicalPath(rootPath, name))
                node.put("type", if (isFolder) "folder" else "file")
                node.put("hasChildren", isFolder)
                val modifiedAt = cursor.getLong(modifiedIndex)
                if (modifiedAt > 0L) {
                    node.put("modifiedAt", modifiedAt)
                }
                nodes.put(node)
            }
        }
        return nodes
    }

    private fun readChildrenRecursive(treeUri: Uri, rootPath: String, depth: Int): JSONArray {
        val nodes = readChildrenShallow(treeUri, rootPath)
        if (depth >= MAX_TREE_DEPTH) {
            return nodes
        }
        for (index in 0 until nodes.length()) {
            val node = nodes.getJSONObject(index)
            if (node.optString("type") != "folder") {
                continue
            }
            val childUri = Uri.parse(node.optString("id"))
            node.put("children", readChildrenRecursive(childUri, node.optString("path"), depth + 1))
            node.put("expanded", true)
        }
        return nodes
    }

    private fun collectFlatEntries(treeOrDocumentUri: Uri, rootPath: String, files: JSONArray, depth: Int) {
        if (depth > MAX_TREE_DEPTH) {
            return
        }
        val documentUri = normalizeToDocumentUri(treeOrDocumentUri)
        val treeUri = treeUriFor(treeOrDocumentUri)
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            treeUri,
            DocumentsContract.getDocumentId(documentUri)
        )
        activity.contentResolver.query(
            childrenUri,
            arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE
            ),
            null,
            null,
            null
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            val mimeIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
            while (cursor.moveToNext()) {
                val documentId = cursor.getString(idIndex) ?: continue
                val name = cursor.getString(nameIndex) ?: continue
                val isFolder = (cursor.getString(mimeIndex) ?: "") == DocumentsContract.Document.MIME_TYPE_DIR
                val entryPath = joinLogicalPath(rootPath, name)
                val entry = JSONObject()
                entry.put("path", entryPath)
                entry.put("name", name)
                entry.put("type", if (isFolder) "folder" else "file")
                files.put(entry)
                if (isFolder) {
                    collectFlatEntries(childDocumentUri(treeUri, documentId), entryPath, files, depth + 1)
                }
            }
        }
    }

    private fun joinLogicalPath(parent: String, name: String): String {
        val trimmedParent = parent.trimEnd('/')
        return if (trimmedParent.isEmpty()) name else "$trimmedParent/$name"
    }

    // ── Recursive copy ──────────────────────────────────────────────────

    private fun copyRecursive(sourceUri: Uri, targetParentUri: Uri, depth: Int = 0): Uri {
        if (depth > MAX_TREE_DEPTH) {
            throw IOException("La copia supera la profundidad máxima soportada.")
        }
        val resolver = activity.contentResolver
        val sourceName = queryDisplayName(sourceUri)
            ?: throw IOException("No se pudo leer el nombre de la entrada.")
        val isFolder = isDirectory(sourceUri)
        val mimeType = if (isFolder) DocumentsContract.Document.MIME_TYPE_DIR else "application/octet-stream"
        val created = DocumentsContract.createDocument(resolver, targetParentUri, mimeType, sourceName)
            ?: throw IOException("El proveedor de documentos rechazó la copia.")
        if (!isFolder) {
            val bytes = resolver.openInputStream(sourceUri)?.use { it.readBytes() }
                ?: throw IOException("No se pudo leer la entrada original.")
            resolver.openOutputStream(created, "wt")?.use { output -> output.write(bytes) }
                ?: throw IOException("No se pudo escribir la copia.")
            return created
        }
        val sourceTreeUri = treeUriFor(sourceUri)
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            sourceTreeUri,
            DocumentsContract.getDocumentId(sourceUri)
        )
        val childIds = mutableListOf<String>()
        resolver.query(
            childrenUri,
            arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID),
            null,
            null,
            null
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            while (cursor.moveToNext()) {
                cursor.getString(idIndex)?.let { childIds.add(it) }
            }
        }
        for (childId in childIds) {
            copyRecursive(childDocumentUri(sourceTreeUri, childId), created, depth + 1)
        }
        return created
    }

    companion object {
        /** SAF recursion cap to keep memory bounded on large libraries. */
        private const val MAX_TREE_DEPTH = 24
        private const val MAX_ENTRY_NAME_LENGTH = 255
    }
}
