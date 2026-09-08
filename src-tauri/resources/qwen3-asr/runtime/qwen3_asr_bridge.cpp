#include "llama.h"
#include "mtmd.h"
#include "mtmd-helper.h"

#include <algorithm>
#include <cctype>
#include <climits>
#include <cstring>
#include <memory>
#include <new>
#include <string>
#include <thread>
#include <vector>

#if defined(_WIN32)
#define NOTIA_ASR_API extern "C" __declspec(dllexport)
#else
#define NOTIA_ASR_API extern "C" __attribute__((visibility("default")))
#endif

struct notia_qwen3_asr {
    llama_model * model = nullptr;
    llama_context * context = nullptr;
    mtmd_context * multimodal = nullptr;
    llama_sampler * sampler = nullptr;
    std::string error;

    ~notia_qwen3_asr() {
        if (sampler) llama_sampler_free(sampler);
        if (multimodal) mtmd_free(multimodal);
        if (context) llama_free(context);
        if (model) llama_model_free(model);
    }
};

static std::string language_name(const char * language) {
    const std::string value = language ? language : "";
    if (value == "es") return "Spanish";
    if (value == "en") return "English";
    if (value == "pt") return "Portuguese";
    if (value == "fr") return "French";
    if (value == "de") return "German";
    if (value == "it") return "Italian";
    return value.empty() ? "Spanish" : value;
}

static bool decode_prompt(notia_qwen3_asr * engine, const float * samples, size_t sample_count, const char * language) {
    llama_memory_clear(llama_get_memory(engine->context), true);
    mtmd_bitmap * audio = mtmd_bitmap_init_from_audio(sample_count, samples);
    if (!audio) {
        engine->error = "No se pudo preparar el audio para Qwen3-ASR.";
        return false;
    }
    const std::string content = std::string(mtmd_default_marker());
    const llama_chat_message message { "user", content.c_str() };
    const char * chat_template = llama_model_chat_template(engine->model, nullptr);
    int32_t required = llama_chat_apply_template(chat_template, &message, 1, true, nullptr, 0);
    if (required < 0) {
        mtmd_bitmap_free(audio);
        engine->error = "Qwen3-ASR no contiene una plantilla de conversación válida.";
        return false;
    }
    std::vector<char> formatted(static_cast<size_t>(required) + 1);
    required = llama_chat_apply_template(chat_template, &message, 1, true, formatted.data(), static_cast<int32_t>(formatted.size()));
    if (required < 0 || static_cast<size_t>(required) >= formatted.size()) {
        mtmd_bitmap_free(audio);
        engine->error = "Qwen3-ASR no pudo formatear el prompt.";
        return false;
    }
    std::string prompt(formatted.data(), static_cast<size_t>(required));
    prompt += "language " + language_name(language) + "<asr_text>";

    mtmd_input_text input { prompt.data(), prompt.size(), true, true };
    mtmd_input_chunks * chunks = mtmd_input_chunks_init();
    if (!chunks) {
        mtmd_bitmap_free(audio);
        engine->error = "Qwen3-ASR no pudo reservar memoria para el prompt.";
        return false;
    }
    const mtmd_bitmap * bitmaps[] = { audio };
    const int32_t tokenized = mtmd_tokenize(engine->multimodal, chunks, &input, bitmaps, 1);
    mtmd_bitmap_free(audio);
    if (tokenized != 0) {
        mtmd_input_chunks_free(chunks);
        engine->error = "Qwen3-ASR no pudo tokenizar el audio.";
        return false;
    }
    llama_pos n_past = 0;
    const int32_t decoded = mtmd_helper_eval_chunks(engine->multimodal, engine->context, chunks, 0, 0, 512, true, &n_past);
    mtmd_input_chunks_free(chunks);
    if (decoded != 0) {
        engine->error = "Qwen3-ASR no pudo codificar el audio.";
        return false;
    }
    return true;
}

NOTIA_ASR_API notia_qwen3_asr * notia_qwen3_asr_load(const char * model_path, const char * mmproj_path, int use_gpu, int threads) {
    try {
        llama_backend_init();
        auto engine = std::unique_ptr<notia_qwen3_asr>(new (std::nothrow) notia_qwen3_asr());
        if (!engine || !model_path || !mmproj_path) return nullptr;
        llama_model_params model_params = llama_model_default_params();
        model_params.n_gpu_layers = use_gpu ? -1 : 0;
        engine->model = llama_model_load_from_file(model_path, model_params);
        if (!engine->model) return nullptr;
        llama_context_params context_params = llama_context_default_params();
        context_params.n_ctx = 4096;
        context_params.n_batch = 512;
        context_params.n_ubatch = 512;
        context_params.n_threads = std::max(1, threads);
        context_params.n_threads_batch = std::max(1, threads);
        engine->context = llama_init_from_model(engine->model, context_params);
        if (!engine->context) return nullptr;
        mtmd_context_params mtmd_params = mtmd_context_params_default();
        mtmd_params.use_gpu = use_gpu != 0;
        mtmd_params.n_threads = std::max(1, threads);
        mtmd_params.warmup = true;
        engine->multimodal = mtmd_init_from_file(mmproj_path, engine->model, mtmd_params);
        if (!engine->multimodal || !mtmd_support_audio(engine->multimodal)) return nullptr;

        // llama_sampler_sample() builds a candidate array the size of the
        // vocabulary. Keep its capacity across windows; meetings can invoke
        // this function thousands of times and repeatedly allocating that
        // array puts avoidable pressure on the native heap.
        engine->sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
        if (!engine->sampler) return nullptr;
        auto * greedy = llama_sampler_init_greedy();
        if (!greedy) return nullptr;
        llama_sampler_chain_add(engine->sampler, greedy);
        return engine.release();
    } catch (...) {
        // Never let a C++ exception cross the Rust FFI boundary.
        return nullptr;
    }
}

NOTIA_ASR_API void notia_qwen3_asr_free(notia_qwen3_asr * engine) { delete engine; }

NOTIA_ASR_API int notia_qwen3_asr_transcribe(notia_qwen3_asr * engine, const float * samples, size_t sample_count,
                                               const char * language, char * output, size_t output_capacity) {
    if (!engine || !samples || sample_count == 0 || !output || output_capacity == 0) return -1;
    try {
        engine->error.clear();
        output[0] = '\0';
        if (!decode_prompt(engine, samples, sample_count, language)) return -1;
        if (!engine->sampler) {
            engine->error = "Qwen3-ASR no tiene un sampler disponible.";
            return -1;
        }
        llama_sampler_reset(engine->sampler);
        const llama_vocab * vocab = llama_model_get_vocab(engine->model);
        if (!vocab) {
            engine->error = "Qwen3-ASR no pudo acceder al vocabulario.";
            return -1;
        }
        const int32_t vocabulary_size = llama_vocab_n_tokens(vocab);
        std::string text;
        for (int i = 0; i < 512; ++i) {
            const llama_token token = llama_sampler_sample(engine->sampler, engine->context, -1);
            if (token == LLAMA_TOKEN_NULL || token < 0 || token >= vocabulary_size) {
                engine->error = "Qwen3-ASR produjo un token inválido.";
                return -1;
            }
            if (llama_vocab_is_eog(vocab, token)) break;
            char piece[512];
            const int32_t length = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, false);
            if (length < 0 || length >= static_cast<int32_t>(sizeof(piece))) {
                engine->error = "Qwen3-ASR produjo una pieza de texto inválida.";
                return -1;
            }
            if (length > 0) text.append(piece, static_cast<size_t>(length));
            llama_token mutable_token = token;
            llama_batch batch = llama_batch_get_one(&mutable_token, 1);
            if (llama_decode(engine->context, batch) != 0) {
                engine->error = "Qwen3-ASR falló durante la decodificación.";
                return -1;
            }
        }
        const std::string prefix = "language " + language_name(language) + "<asr_text>";
        if (text.rfind(prefix, 0) == 0) text.erase(0, prefix.size());
        while (!text.empty() && std::isspace(static_cast<unsigned char>(text.front()))) text.erase(text.begin());
        if (text.size() + 1 > output_capacity) return static_cast<int>(text.size() + 1);
        std::memcpy(output, text.c_str(), text.size() + 1);
        return static_cast<int>(text.size());
    } catch (...) {
        // Never let a C++ exception cross the Rust FFI boundary.
        engine->error = "Qwen3-ASR encontró un error interno durante la transcripción.";
        output[0] = '\0';
        return -1;
    }
}

NOTIA_ASR_API const char * notia_qwen3_asr_last_error(notia_qwen3_asr * engine) {
    return engine ? engine->error.c_str() : "Qwen3-ASR no está inicializado.";
}
