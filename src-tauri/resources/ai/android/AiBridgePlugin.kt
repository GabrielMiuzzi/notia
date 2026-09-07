package com.gabriel.notia

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
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
            val body = JSONObject()
                .put("model", args.string("model"))
                .put("stream", false)
                .put("messages", JSONArray(args.string("messagesJson")))
                .put("tools", JSONArray(args.string("toolsJson")))
            args.value("think")?.let { body.put("think", JSONObject.wrap(it)) }
            val response = request(args.string("ollamaUrl"), args.string("apiKey"), "/api/chat", "POST", body)
            toJsObject(response)
        }
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
            messages.put(JSONObject().put("role", "user").put("content", args.string("prompt")))
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

    private fun streamChat(args: ArgumentMap): JSObject {
        val requestId = args.string("requestId")
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
        messages.put(JSONObject().put("role", "user").put("content", args.string("prompt")))
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

    private fun triggerStream(requestId: String, type: String, value: String) {
        val payload = JSObject()
            .put("requestId", requestId)
            .put("type", type)
            .put("payload", JSObject().put(if (type == "error") "message" else if (type == "done") "answer" else "delta", value))
        trigger("stream", payload)
    }

    private fun request(baseUrl: String, apiKey: String, path: String, method: String, body: JSONObject?): JSONObject {
        val connection = openConnection(baseUrl, apiKey, path, method, body)
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

    private fun openConnection(baseUrl: String, apiKey: String, path: String, method: String, body: JSONObject?): HttpURLConnection {
        val normalizedBase = baseUrl.trim().trimEnd('/')
        if (normalizedBase.isEmpty()) error("La URL de Ollama es obligatoria.")
        return (URL("$normalizedBase$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 600_000
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
}
