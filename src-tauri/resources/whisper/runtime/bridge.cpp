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

    ~notia_whisper() {
        if (context) {
            whisper_free(context);
        }
    }
};

NOTIA_WHISPER_API notia_whisper * notia_whisper_load(const char * model_path, const char * backend_directory,
                                                     int use_gpu, int threads, char * error, size_t error_capacity) {
    try {
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
        params.flash_attn = gpu != nullptr;
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
        return engine.release();
    } catch (...) {
        write_error(error, error_capacity, "whisper.cpp fallo al cargar el modelo.");
        return nullptr;
    }
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
        whisper_full_params params = whisper_full_default_params(
            beam_size > 1 ? WHISPER_SAMPLING_BEAM_SEARCH : WHISPER_SAMPLING_GREEDY);
        params.n_threads = engine->threads;
        params.translate = false;
        params.no_context = true;
        params.no_timestamps = true;
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

NOTIA_WHISPER_API const char * notia_whisper_last_error(const notia_whisper * engine) {
    return engine ? engine->error.c_str() : "";
}
