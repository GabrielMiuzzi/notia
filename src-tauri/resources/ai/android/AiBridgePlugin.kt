package com.gabriel.notia

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * Versioned Android boundary for Ollama access. The WebView never opens the
 * provider directly; Rust owns the Tauri command and this plugin owns the
 * Android HTTP transport.
 *
 * The tool command receives JSON strings for messages/tools so the DTO stays
 * stable even when a tool argument contains a nested object or array.
 */
@TauriPlugin
class AiBridgePlugin(private val activity: Activity) : Plugin(activity) {
    private val activeStreams = ConcurrentHashMap<String, HttpURLConnection>()

    @Command
    fun healthCheck(invoke: Invoke) {
        run(invoke) {
            val args = arguments(invoke)
            val response = request(args.string("ollamaUrl"), args.string("apiKey"), "/api/tags", "GET", null)
            val models = response.optJSONArray("models")
            val defaultModel = models?.optJSONObject(0)?.optString("name")?.ifBlank { null }
            JSObject()
                .put("ok", true)
                .put("message", "Ollama disponible")
                .put("defaultModel", defaultModel)
        }
    }

    @Command
    fun listModels(invoke: Invoke) {
        run(invoke) {
            val args = arguments(invoke)
            val response = request(args.string("ollamaUrl"), args.string("apiKey"), "/api/tags", "GET", null)
            val source = response.optJSONArray("models") ?: JSONArray()
            val models = JSONArray()
            for (index in 0 until source.length()) {
                val name = source.optJSONObject(index)?.optString("name")?.trim().orEmpty()
                if (name.isNotEmpty()) models.put(name)
            }
            JSObject().put("models", models)
        }
    }

    @Command
    fun inspectModel(invoke: Invoke) {
        run(invoke) {
            val args = arguments(invoke)
            val model = args.string("model")
            if (model.isBlank()) error("El modelo de Ollama es obligatorio.")
            val response = request(
                args.string("ollamaUrl"),
                args.string("apiKey"),
                "/api/show",
                "POST",
                JSONObject().put("name", model),
            )
            val capabilities = response.optJSONArray("capabilities") ?: JSONArray()
            JSObject().put("capabilities", capabilities)
        }
    }

    @Command
    fun chat(invoke: Invoke) = completeChat(invoke)

    @Command
    fun chatStreaming(invoke: Invoke) {
        Thread {
            try {
                invoke.resolve(streamChat(arguments(invoke)))
            } catch (error: Exception) {
                invoke.resolve(JSObject().put("ok", false).put("error", error.message ?: "Fallo en el streaming AI Android."))
            }
        }.start()
    }

    @Command
    fun cancelStreaming(invoke: Invoke) {
        run(invoke) {
            val requestId = arguments(invoke).string("requestId")
            if (requestId.isBlank()) error("El identificador de streaming es obligatorio.")
            activeStreams.remove(requestId)?.disconnect()
            JSObject().put("cancelled", true)
        }
    }

    @Command
    fun toolChat(invoke: Invoke) {
        run(invoke) {
            val args = arguments(invoke)
            val requestId = args.string("requestId")
            val libraryId = args.string("libraryId")
            val actorLibraryUserId = args.string("actorLibraryUserId")
            val channel = args.string("channel")
            val requestedScope = args.string("requestedScope")
            val persistencePolicy = args.string("persistencePolicy")
            val hasGlobalMetadata = listOf(requestId, libraryId, actorLibraryUserId, channel, requestedScope, persistencePolicy).any { it.isNotBlank() }
            if (hasGlobalMetadata && listOf(requestId, libraryId, actorLibraryUserId, channel, requestedScope, persistencePolicy).any { it.isBlank() }) {
                error("El sobre global de IA Android está incompleto.")
            }
            val body = JSONObject()
                .put("model", args.string("model"))
                .put("stream", false)
                .put("messages", JSONArray(args.string("messagesJson")))
                .put("tools", JSONArray(args.string("toolsJson")))
            args.value("think")?.let { body.put("think", JSONObject.wrap(it)) }
            val response = request(
                args.string("ollamaUrl"),
                args.string("apiKey"),
                "/api/chat",
                "POST",
                body,
                args.number("timeoutSeconds", DEFAULT_TOOL_TIMEOUT_SECONDS)
            )
            toJsObject(response)
        }
    }

    /**
     * Streams a backend-built `/api/chat` request (raw messages, no tools) to
     * the Rust runtime. Deltas go through the Rust-owned `onEvent` channel
     * tagged with `requestId`; the command resolves with the final answer.
     * `cancelStreaming` with the same `requestId` disconnects the stream.
     */
    @Command
    fun rawChatStreaming(invoke: Invoke) {
        val channel = try {
            invoke.parseArgs(StreamChannelArgs::class.java).onEvent
        } catch (error: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("error", "El canal de streaming no es valido."))
            return
        }
        val args = arguments(invoke)
        Thread {
            try {
                invoke.resolve(streamRawChat(args, channel))
            } catch (error: Exception) {
                invoke.resolve(JSObject().put("ok", false).put("error", error.message ?: "Fallo en el streaming AI Android."))
            }
        }.start()
    }

    @Command
    fun webSearch(invoke: Invoke) {
        run(invoke) {
            val args = arguments(invoke)
            val body = JSONObject()
                .put("query", args.string("query"))
                .put("max_results", args.number("maxResults", 5).coerceIn(1, 10))
            val response = request(args.string("ollamaUrl"), args.string("apiKey"), "/api/web_search", "POST", body)
            toJsObject(response)
        }
    }

    private fun completeChat(invoke: Invoke) {
        run(invoke) {
            val args = arguments(invoke)
            val messages = buildChatMessages(args)
            val body = JSONObject()
                .put("model", args.string("model"))
                .put("stream", false)
                .put("messages", messages)
            args.value("think")?.let { body.put("think", JSONObject.wrap(it)) }
            val response = request(args.string("ollamaUrl"), args.string("apiKey"), "/api/chat", "POST", body)
            val message = response.optJSONObject("message")
            val answer = message?.optString("content")?.trim().orEmpty()
            if (answer.isEmpty()) error("La IA no devolvio contenido.")
            JSObject().put("answer", answer)
        }
    }

    /**
     * Builds the `/api/chat` message array from the shared payload contract:
     * previous messages (with their images), inline file contents and, when
     * present, the visual attachment sent as `image`. Desktop assembles the
     * same content in TypeScript; this keeps Android equivalent.
     */
    private fun buildChatMessages(args: ArgumentMap): JSONArray {
        val messages = JSONArray()
        val previous = args.value("previousMessages") as? List<*>
        previous.orEmpty().forEach { value ->
            val map = value as? Map<*, *> ?: return@forEach
            val message = JSONObject()
                .put("role", map["role"]?.toString().orEmpty())
                .put("content", map["content"]?.toString().orEmpty())
            (map["images"] as? List<*>)?.let { images ->
                message.put("images", JSONArray(images.mapNotNull { it?.toString() }))
            }
            messages.put(message)
        }
        val prompt = StringBuilder()
        val longTermMemories = args.value("longTermMemories") as? List<*>
        longTermMemories.orEmpty().forEach { value ->
            val memory = value?.toString()?.trim().orEmpty()
            if (memory.isNotEmpty()) prompt.appendLine("- $memory")
        }
        val userPrompt = args.string("prompt").trim()
        if (userPrompt.isNotEmpty()) {
            if (prompt.isNotEmpty()) prompt.appendLine()
            prompt.append(userPrompt)
        }
        val files = args.value("files") as? List<*>
        files.orEmpty().forEach { value ->
            val map = value as? Map<*, *> ?: return@forEach
            val name = map["name"]?.toString().orEmpty()
            val content = map["content"]?.toString().orEmpty()
            if (name.isNotEmpty() && content.isNotEmpty()) {
                prompt.appendLine()
                prompt.append("<attached_file name=\"$name\">")
                prompt.appendLine()
                prompt.append(content)
                prompt.appendLine()
                prompt.append("</attached_file>")
            }
        }
        val image = args.value("image") as? Map<*, *>
        val imageBase64 = image?.get("base64")?.toString()?.trim().orEmpty()
        val additionalImages = image?.get("additionalBase64") as? List<*>
        val images = listOf(imageBase64).filter { it.isNotEmpty() } + additionalImages.orEmpty().mapNotNull { value ->
            value?.toString()?.trim()?.takeIf { it.isNotEmpty() }
        }
        val userMessage = JSONObject().put("role", "user").put("content", prompt.toString().trim())
        if (images.isNotEmpty()) {
            userMessage.put("images", JSONArray(images))
        }
        messages.put(userMessage)
        return messages
    }

    private fun streamChat(args: ArgumentMap): JSObject {
        val requestId = args.string("requestId")
        val messages = buildChatMessages(args)
        val body = JSONObject()
            .put("model", args.string("model"))
            .put("stream", true)
            .put("messages", messages)
        args.value("think")?.let { body.put("think", JSONObject.wrap(it)) }

        val connection = openConnection(args.string("ollamaUrl"), args.string("apiKey"), "/api/chat", "POST", body)
        activeStreams[requestId] = connection
        val answer = StringBuilder()
        val thinking = StringBuilder()
        try {
            connection.outputStream.use { output -> output.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            if (status !in 200..299) error("Ollama respondio con HTTP $status.")
            connection.inputStream.use { input ->
                BufferedReader(InputStreamReader(input, Charsets.UTF_8)).forEachLine { line ->
                    if (line.isBlank()) return@forEachLine
                    val chunk = JSONObject(line)
                    val message = chunk.optJSONObject("message") ?: return@forEachLine
                    val thinkingDelta = message.optString("thinking")
                    if (thinkingDelta.isNotEmpty()) {
                        thinking.append(thinkingDelta)
                        triggerStream(requestId, "thinking", thinkingDelta)
                    }
                    val answerDelta = message.optString("content")
                    if (answerDelta.isNotEmpty()) {
                        answer.append(answerDelta)
                        triggerStream(requestId, "delta", answerDelta)
                    }
                }
            }
            val finalAnswer = answer.toString().trim()
            if (finalAnswer.isEmpty()) error("La IA no devolvio contenido.")
            triggerStream(requestId, "done", finalAnswer)
            return JSObject().put("answer", finalAnswer)
        } catch (error: Exception) {
            triggerStream(requestId, "error", error.message ?: "Fallo en el streaming AI Android.")
            throw error
        } finally {
            activeStreams.remove(requestId, connection)
            connection.disconnect()
        }
    }

    private fun streamRawChat(args: ArgumentMap, channel: Channel): JSObject {
        val requestId = args.string("requestId")
        if (requestId.isBlank()) error("El identificador de streaming es obligatorio.")
        val body = JSONObject()
            .put("model", args.string("model"))
            .put("stream", true)
            .put("messages", JSONArray(args.string("messagesJson")))
        args.value("think")?.let { body.put("think", JSONObject.wrap(it)) }
        val connection = openConnection(
            args.string("ollamaUrl"),
            args.string("apiKey"),
            "/api/chat",
            "POST",
            body,
            args.number("timeoutSeconds", DEFAULT_STREAM_TIMEOUT_SECONDS),
        )
        activeStreams[requestId] = connection
        val answer = StringBuilder()
        try {
            connection.outputStream.use { output -> output.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            if (status !in 200..299) error("Ollama respondio con HTTP $status.")
            connection.inputStream.use { input ->
                BufferedReader(InputStreamReader(input, Charsets.UTF_8)).forEachLine { line ->
                    if (line.isBlank()) return@forEachLine
                    val message = JSONObject(line).optJSONObject("message") ?: return@forEachLine
                    val thinkingDelta = message.optString("thinking")
                    if (thinkingDelta.isNotEmpty()) {
                        channel.send(JSObject().put("requestId", requestId).put("type", "thinking").put("delta", thinkingDelta))
                    }
                    val answerDelta = message.optString("content")
                    if (answerDelta.isNotEmpty()) {
                        answer.append(answerDelta)
                        channel.send(JSObject().put("requestId", requestId).put("type", "content").put("delta", answerDelta))
                    }
                }
            }
            return JSObject().put("ok", true).put("answer", answer.toString())
        } finally {
            activeStreams.remove(requestId, connection)
            connection.disconnect()
        }
    }

    private fun triggerStream(requestId: String, type: String, value: String) {
        val payload = JSObject()
            .put("requestId", requestId)
            .put("type", type)
            .put("payload", JSObject().put(if (type == "error") "message" else if (type == "done") "answer" else "delta", value))
        trigger("stream", payload)
    }

    private fun request(
        baseUrl: String,
        apiKey: String,
        path: String,
        method: String,
        body: JSONObject?,
        readTimeoutSeconds: Int = DEFAULT_STREAM_TIMEOUT_SECONDS,
    ): JSONObject {
        val connection = openConnection(baseUrl, apiKey, path, method, body, readTimeoutSeconds)
        try {
            body?.let { connection.outputStream.use { output -> output.write(it.toString().toByteArray(Charsets.UTF_8)) } }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.use { input -> BufferedReader(InputStreamReader(input, Charsets.UTF_8)).readText() }.orEmpty()
            if (status !in 200..299) error("Ollama respondio con HTTP $status.")
            return JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    private fun openConnection(
        baseUrl: String,
        apiKey: String,
        path: String,
        method: String,
        body: JSONObject?,
        readTimeoutSeconds: Int = DEFAULT_STREAM_TIMEOUT_SECONDS,
    ): HttpURLConnection {
        val normalizedBase = baseUrl.trim().trimEnd('/')
        if (normalizedBase.isEmpty()) error("La URL de Ollama es obligatoria.")
        return (URL("$normalizedBase$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = readTimeoutSeconds.coerceIn(1, 600) * 1_000
            setRequestProperty("Accept", "application/json")
            if (apiKey.isNotBlank()) setRequestProperty("Authorization", "Bearer $apiKey")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
    }

    private fun run(invoke: Invoke, block: () -> JSObject) {
        try {
            invoke.resolve(block())
        } catch (error: Exception) {
            invoke.resolve(JSObject().put("ok", false).put("error", error.message ?: "Fallo en el bridge AI Android."))
        }
    }

    private fun toJsObject(source: JSONObject): JSObject {
        val target = JSObject()
        val keys = source.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            target.put(key, source.get(key))
        }
        return target
    }

    @Suppress("UNCHECKED_CAST")
    private fun arguments(invoke: Invoke): ArgumentMap = ArgumentMap(invoke.parseArgs(Map::class.java) as Map<String, Any?>)

    private class ArgumentMap(private val values: Map<String, Any?>) {
        fun value(key: String): Any? = values[key]
        fun string(key: String): String = values[key]?.toString()?.trim().orEmpty()
        fun number(key: String, fallback: Int): Int = when (val value = values[key]) {
            is Number -> value.toInt()
            else -> value?.toString()?.toIntOrNull() ?: fallback
        }
    }

    private class StreamChannelArgs {
        lateinit var onEvent: Channel
    }

    private companion object {
        /** Default read timeout for tool rounds, matching the Rust 600 s cap. */
        const val DEFAULT_TOOL_TIMEOUT_SECONDS = 600
        /** Default read timeout for full streaming completions. */
        const val DEFAULT_STREAM_TIMEOUT_SECONDS = 600
    }
}
