package com.gabriel.notia

import android.net.Uri
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.content.pm.ProviderInfo
import android.content.pm.ResolveInfo
import android.database.MatrixCursor
import android.provider.DocumentsContract
import androidx.appcompat.app.AppCompatActivity
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.PluginManager
import com.fasterxml.jackson.databind.ObjectMapper
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class DirectoryPickerPluginTest {
    private val activity = Robolectric.buildActivity(AppCompatActivity::class.java).get()
    private val plugin = DirectoryPickerPlugin(activity)
    // Use the mapper constructed by Tauri itself, including its visibility and modules.
    private val mapper = PluginManager::class.java.getDeclaredField("jsonMapper").apply {
        isAccessible = true
    }.get(PluginManager(activity)) as ObjectMapper

    private val root = "content://com.android.externalstorage.documents/tree/primary%3ANotas"
    private val content = "{\"title\":\"Configuración ñ\",\"lines\":\"uno\\ndos\"}"
    private val provider = EmptyDocumentsProvider()

    @Before fun registerProvider() {
        val authority = "com.android.externalstorage.documents"
        val info = ProviderInfo().apply { this.authority = authority }
        shadowOf(activity.packageManager).addResolveInfoForIntent(
            Intent(DocumentsContract.PROVIDER_INTERFACE),
            ResolveInfo().apply { providerInfo = info }
        )
        ShadowContentResolver.registerProviderInternal(authority, provider)
    }
    private fun payload() = JSONObject()
        .put("rootUri", root)
        .put("segments", org.json.JSONArray(listOf(".notia", "notiaConfig.json")))
        .put("entryType", "file")
        .put("content", content)

    private fun invoke(args: JSONObject, response: (Long, String) -> Unit = { _, _ -> }) =
        Invoke(1L, "createPathEntry", 2L, 3L, response, args.toString(), mapper)

    private fun receivedArgs(): JSONObject {
        var received: JSONObject? = null
        var callback: Long? = null
        val call = invoke(payload()) { id, _ -> callback = id }
        val block: (JSONObject) -> JSObject = { args ->
            received = args
            JSObject().put("ok", true)
        }
        // Exercise the production wrapper without touching a filesystem/provider.
        DirectoryPickerPlugin::class.java.getDeclaredMethod(
            "runSaf", Invoke::class.java, String::class.java, kotlin.jvm.functions.Function1::class.java
        ).apply { isAccessible = true }.invoke(plugin, call, "SAF failed", block)
        assertEquals(2L, callback)
        return requireNotNull(received)
    }

    @Test fun tauriJacksonJSONObjectReproducesLostKeys() {
        val call = invoke(payload())
        assertEquals(0, call.parseArgs(JSONObject::class.java).length())
        assertEquals(root, call.getArgs().getString("rootUri"))
    }

    @Test fun runSafPreservesRootUri() {
        assertEquals(root, receivedArgs().optString("rootUri"))
    }

    @Test fun runSafPreservesSegments() {
        assertEquals(payload().getJSONArray("segments").toString(), receivedArgs().optJSONArray("segments")?.toString())
    }

    @Test fun runSafPreservesContent() {
        assertEquals(content, receivedArgs().optString("content"))
    }

    private fun normalize(value: String): String = DirectoryPickerPlugin::class.java
        .getDeclaredMethod("normalizeToDocumentUri", Uri::class.java)
        .apply { isAccessible = true }
        .invoke(plugin, Uri.parse(value))!!.toString()

    @Test fun pureTreeBecomesRootDocumentUnderSameGrant() {
        assertEquals("$root/document/primary%3ANotas", normalize(root))
    }

    @Test fun treeDocumentKeepsChildInsteadOfReturningRoot() {
        val child = "$root/document/primary%3ANotas%2Fhijo.md"
        assertEquals(child, normalize(child))
    }

    @Test fun pureDocumentDoesNotAcquireInventedTreeGrant() {
        val document = "content://com.android.externalstorage.documents/document/primary%3ANotas%2Fhijo.md"
        assertEquals(document, normalize(document))
    }

    @Test fun verificationRejectsAProviderDocumentThatCannotBeResolved() {
        val document = "$root/document/primary%3ANotas%2Fhijo.md"
        val result = verify(document)

        assertFalse(result.getBoolean("ok"))
        assertEquals(
            listOf("$root/document/primary%3ANotas%2Fhijo.md"),
            provider.queries
        )
    }

    @Test fun verificationUsesTheProviderTreeAndDocumentIds() {
        activity.grantUriPermission(
            activity.packageName,
            Uri.parse(root),
            Intent.FLAG_GRANT_READ_URI_PERMISSION
        )
        provider.returnVerificationRows = true
        val document = "$root/document/primary%3ANotas%2Fhijo.md"
        val result = verify(document)

        assertTrue(result.getBoolean("ok"))
        assertEquals(
            listOf(
                "$root/document/primary%3ANotas%2Fhijo.md",
                "$root/document/primary%3ANotas/children"
            ),
            provider.queries
        )
    }

    private fun verify(document: String): JSONObject {
        var response = ""
        plugin.verifyDocumentUnderTree(
            invoke(
                JSONObject()
                    .put("treeUri", root)
                    .put("documentUri", document)
            ) { _, data -> response = data }
        )
        return JSONObject(response)
    }

    private fun assertRootQuery(command: (Invoke) -> Unit) {
        var callback: Long? = null
        var response = ""
        command(invoke(JSONObject().put("uri", root)) { id, data ->
            callback = id
            response = data
        })
        assertEquals(response, 2L, callback)
        assertEquals(listOf("$root/document/primary%3ANotas/children"), provider.queries)
    }

    @Test fun readDirectoryQueriesRootDocument() = assertRootQuery(plugin::readDirectory)
    @Test fun readTreeQueriesRootDocument() = assertRootQuery(plugin::readTree)
    @Test fun readFlatFileListQueriesRootDocument() = assertRootQuery(plugin::readFlatFileList)

    class EmptyDocumentsProvider : ContentProvider() {
        val queries = mutableListOf<String>()
        var returnVerificationRows = false
        override fun onCreate() = true
        override fun query(uri: Uri, projection: Array<out String>?, selection: String?,
                           selectionArgs: Array<out String>?, sortOrder: String?): MatrixCursor {
            queries.add(uri.toString())
            val columns = requireNotNull(projection)
            return MatrixCursor(columns).also { cursor ->
                if (returnVerificationRows) {
                    cursor.addRow(columns.map { column ->
                        when (column) {
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID ->
                                "primary:Notas/hijo.md"
                            DocumentsContract.Document.COLUMN_MIME_TYPE -> "text/markdown"
                            else -> null
                        }
                    }.toTypedArray())
                }
            }
        }
        override fun getType(uri: Uri): String? = null
        override fun insert(uri: Uri, values: ContentValues?): Uri? = error("Unexpected insert")
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = error("Unexpected delete")
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = error("Unexpected update")
    }
}
