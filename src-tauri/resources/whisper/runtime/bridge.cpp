// C ABI that Notia's Rust backend loads at run time: it loads the ggml
// backends by path, opens a Whisper model and transcribes 16 kHz mono audio.
// No C++ exception crosses this boundary.

#include "ggml-backend.h"
#include "whisper.h"

#include <cstdio>
#include <cstring>
#include <memory>
#include <mutex>
#include <new>
#include <string>

#if defined(_WIN32)
#define NOTIA_WHISPER_API extern "C" __declspec(dllexport)
#else
#define NOTIA_WHISPER_API extern "C" __attribute__((visibility("default")))
#endif

namespace {

#if defined(_WIN32)
const char * const CPU_BACKENDS[] = { "notia_stt_ggml-cpu.dll" };
const char * const GPU_BACKEND = "notia_stt_ggml-vulkan.dll";
#elif defined(__ANDROID__)
// Most capable first: a variant whose instructions the CPU lacks refuses to load.
const char * const CPU_BACKENDS[] = {
    "libnotia_stt_ggml-cpu-android_armv8.6_1.so",
    "libnotia_stt_ggml-cpu-android_armv8.2_2.so",
    "libnotia_stt_ggml-cpu-android_armv8.2_1.so",
    "libnotia_stt_ggml-cpu-android_armv8.0_1.so",
};
const char * const GPU_BACKEND = nullptr;
#else
const char * const CPU_BACKENDS[] = { "libnotia_stt_ggml-cpu.so" };
const char * const GPU_BACKEND = nullptr;
#endif

struct Backends {
    std::mutex mutex;
    bool cpu = false;
    bool gpu_tried = false;
};

Backends & backends() {
    static Backends instance;
    return instance;
}

std::string backend_path(const char * directory, const char * name) {
    std::string path = directory ? directory : "";
    if (!path.empty() && path.back() != '/' && path.back() != '\\') {
        path += '/';
    }
    return path + name;
}

// The ggml registry is global to the process: each backend is loaded once.
bool load_backends(const char * directory, bool gpu) {
    Backends & state = backends();
    std::lock_guard<std::mutex> lock(state.mutex);
    for (const char * name : CPU_BACKENDS) {
        if (state.cpu) {
            break;
        }
        state.cpu = ggml_backend_load(backend_path(directory, name).c_str()) != nullptr;
    }
    if (gpu && GPU_BACKEND && !state.gpu_tried) {
        state.gpu_tried = true;
        ggml_backend_load(backend_path(directory, GPU_BACKEND).c_str());
    }
    return state.cpu;
}

ggml_backend_dev_t first_gpu() {
    for (size_t index = 0; index < ggml_backend_dev_count(); ++index) {
        ggml_backend_dev_t device = ggml_backend_dev_get(index);
        const enum ggml_backend_dev_type type = ggml_backend_dev_type(device);
        if (type == GGML_BACKEND_DEVICE_TYPE_GPU || type == GGML_BACKEND_DEVICE_TYPE_IGPU) {
            return device;
        }
    }
    return nullptr;
}

// Only errors reach stderr; the model and backend chatter stays out of the logs.
void log_errors(enum ggml_log_level level, const char * text, void *) {
    if (level == GGML_LOG_LEVEL_ERROR && text) {
        std::fputs(text, stderr);
    }
}

void write_error(char * buffer, size_t capacity, const char * message) {
    if (buffer && capacity > 0) {
        std::snprintf(buffer, capacity, "%s", message);
    }
}

} // namespace

struct notia_whisper {
    whisper_context * context = nullptr;
    std::string backend;
    std::string text;
    std::string error;
    int threads = 1;
    /// Loaded with DTW alignment heads: each token has `t_dtw`.
    bool aligned = false;

    ~notia_whisper() {
        if (context) {
            whisper_free(context);
        }
    }
};

/// Alignment heads of a model name, for DTW token times.
static bool alignment_preset(const char * alignment, whisper_alignment_heads_preset * preset) {
    if (!alignment || !*alignment) {
        *preset = WHISPER_AHEADS_NONE;
        return true;
    }
    if (std::strcmp(alignment, "large-v3") == 0) {
        *preset = WHISPER_AHEADS_LARGE_V3;
        return true;
    }
    if (std::strcmp(alignment, "large-v3-turbo") == 0) {
        *preset = WHISPER_AHEADS_LARGE_V3_TURBO;
        return true;
    }
    return false;
}

static notia_whisper * load_engine(const char * model_path, const char * backend_directory, int use_gpu, int threads,
                                   const char * alignment, char * error, size_t error_capacity) {
    try {
        whisper_alignment_heads_preset preset = WHISPER_AHEADS_NONE;
        if (!alignment_preset(alignment, &preset)) {
            write_error(error, error_capacity, "Modelo de alineacion de Whisper desconocido.");
            return nullptr;
        }
        if (!model_path || threads < 1) {
            write_error(error, error_capacity, "Parametros invalidos para cargar Whisper.");
            return nullptr;
        }
        whisper_log_set(log_errors, nullptr);
        if (!load_backends(backend_directory, use_gpu != 0)) {
            write_error(error, error_capacity, "No se pudo cargar el backend CPU de whisper.cpp.");
            return nullptr;
        }
        ggml_backend_dev_t gpu = use_gpu ? first_gpu() : nullptr;
        whisper_context_params params = whisper_context_default_params();
        params.use_gpu = gpu != nullptr;
        // whisper.cpp computes DTW times only without flash attention.
        params.flash_attn = gpu != nullptr && preset == WHISPER_AHEADS_NONE;
        params.dtw_token_timestamps = preset != WHISPER_AHEADS_NONE;
        params.dtw_aheads_preset = preset;
        params.gpu_device = 0;
        auto engine = std::unique_ptr<notia_whisper>(new (std::nothrow) notia_whisper());
        if (!engine) {
            write_error(error, error_capacity, "Sin memoria para crear el contexto de Whisper.");
            return nullptr;
        }
        engine->context = whisper_init_from_file_with_params(model_path, params);
        if (!engine->context) {
            write_error(error, error_capacity, "whisper.cpp no pudo cargar el modelo.");
            return nullptr;
        }
        engine->backend = gpu ? ggml_backend_dev_description(gpu) : "CPU";
        engine->threads = threads;
        engine->aligned = preset != WHISPER_AHEADS_NONE;
        return engine.release();
    } catch (...) {
        write_error(error, error_capacity, "whisper.cpp fallo al cargar el modelo.");
        return nullptr;
    }
}

NOTIA_WHISPER_API notia_whisper * notia_whisper_load(const char * model_path, const char * backend_directory,
                                                     int use_gpu, int threads, char * error, size_t error_capacity) {
    return load_engine(model_path, backend_directory, use_gpu, threads, nullptr, error, error_capacity);
}

/// Like `notia_whisper_load`, with the DTW alignment heads of `alignment`
/// ("large-v3" or "large-v3-turbo"): `notia_whisper_transcribe_timed` then
/// gives the aligned time of each token, which follows the audio closely,
/// instead of the decoder's, which stretches the last word before a pause.
NOTIA_WHISPER_API notia_whisper * notia_whisper_load_aligned(const char * model_path, const char * backend_directory,
                                                             int use_gpu, int threads, const char * alignment,
                                                             char * error, size_t error_capacity) {
    if (!alignment || !*alignment) {
        write_error(error, error_capacity, "Falta el modelo de alineacion de Whisper.");
        return nullptr;
    }
    return load_engine(model_path, backend_directory, use_gpu, threads, alignment, error, error_capacity);
}

NOTIA_WHISPER_API void notia_whisper_free(notia_whisper * engine) {
    delete engine;
}

/// Device the model runs on: the GPU description or "CPU".
NOTIA_WHISPER_API const char * notia_whisper_backend(const notia_whisper * engine) {
    return engine ? engine->backend.c_str() : "";
}

/// Whether whisper.cpp knows the language code ("auto" detects it).
NOTIA_WHISPER_API int notia_whisper_language_supported(const char * language) {
    if (!language) {
        return 0;
    }
    return std::strcmp(language, "auto") == 0 || whisper_lang_id(language) >= 0;
}

/// Decoding parameters shared by both transcriptions; `timed` asks whisper.cpp
/// for its timestamps and the time of each token.
static whisper_full_params decode_params(const notia_whisper * engine, const char * language, const char * prompt,
                                         int beam_size, bool timed) {
    whisper_full_params params = whisper_full_default_params(
        beam_size > 1 ? WHISPER_SAMPLING_BEAM_SEARCH : WHISPER_SAMPLING_GREEDY);
    params.n_threads = engine->threads;
    params.translate = false;
    params.no_context = true;
    params.no_timestamps = !timed;
    params.token_timestamps = timed;
    params.print_special = false;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    params.language = language;
    params.detect_language = false;
    params.suppress_blank = true;
    params.suppress_nst = true;
    params.initial_prompt = prompt && *prompt ? prompt : nullptr;
    params.beam_search.beam_size = beam_size;
    return params;
}

/// Transcribes `samples` and returns its text, owned by the engine until the
/// next call, or null with `notia_whisper_last_error` set. `beam_size` above 1
/// selects beam search; 1 decodes greedily.
NOTIA_WHISPER_API const char * notia_whisper_transcribe(notia_whisper * engine, const float * samples, int sample_count,
                                                        const char * language, const char * prompt, int beam_size) {
    if (!engine || !samples || sample_count <= 0 || !language || beam_size < 1) {
        return nullptr;
    }
    try {
        engine->error.clear();
        engine->text.clear();
        const whisper_full_params params = decode_params(engine, language, prompt, beam_size, false);
        if (whisper_full(engine->context, params, samples, sample_count) != 0) {
            engine->error = "whisper.cpp no pudo transcribir el audio.";
            return nullptr;
        }
        const int segments = whisper_full_n_segments(engine->context);
        for (int segment = 0; segment < segments; ++segment) {
            const char * text = whisper_full_get_segment_text(engine->context, segment);
            if (text) {
                engine->text += text;
            }
        }
        return engine->text.c_str();
    } catch (...) {
        engine->error = "whisper.cpp fallo al transcribir el audio.";
        return nullptr;
    }
}

/// Like `notia_whisper_transcribe`, with the time of every text token: one
/// line per token, `start\tend\ttext`, in hundredths of a second from the
/// start of `samples`. A token that starts a word begins with a space. An
/// aligned engine gives the DTW time as the start.
NOTIA_WHISPER_API const char * notia_whisper_transcribe_timed(notia_whisper * engine, const float * samples,
                                                              int sample_count, const char * language,
                                                              const char * prompt, int beam_size) {
    if (!engine || !samples || sample_count <= 0 || !language || beam_size < 1) {
        return nullptr;
    }
    try {
        engine->error.clear();
        engine->text.clear();
        const whisper_full_params params = decode_params(engine, language, prompt, beam_size, true);
        if (whisper_full(engine->context, params, samples, sample_count) != 0) {
            engine->error = "whisper.cpp no pudo transcribir el audio.";
            return nullptr;
        }
        const whisper_token end_of_text = whisper_token_eot(engine->context);
        const int segments = whisper_full_n_segments(engine->context);
        for (int segment = 0; segment < segments; ++segment) {
            const int tokens = whisper_full_n_tokens(engine->context, segment);
            for (int token = 0; token < tokens; ++token) {
                const whisper_token_data data = whisper_full_get_token_data(engine->context, segment, token);
                if (data.id >= end_of_text) {
                    continue;
                }
                const char * text = whisper_full_get_token_text(engine->context, segment, token);
                if (!text || !*text) {
                    continue;
                }
                std::string piece(text);
                for (char & character : piece) {
                    if (character == '\n' || character == '\t' || character == '\r') {
                        character = ' ';
                    }
                }
                const int64_t start = engine->aligned && data.t_dtw >= 0 ? data.t_dtw : data.t0;
                engine->text += std::to_string(start) + '\t' + std::to_string(data.t1) + '\t' + piece + '\n';
            }
        }
        return engine->text.c_str();
    } catch (...) {
        engine->error = "whisper.cpp fallo al transcribir el audio.";
        return nullptr;
    }
}

NOTIA_WHISPER_API const char * notia_whisper_last_error(const notia_whisper * engine) {
    return engine ? engine->error.c_str() : "";
}
