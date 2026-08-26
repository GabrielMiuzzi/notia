#include "qwen3_tts_c.h"

#if defined(_WIN32)
#define NOTIA_EXPORT extern "C" __declspec(dllexport)
#else
#define NOTIA_EXPORT extern "C" __attribute__((visibility("default")))
#endif

NOTIA_EXPORT qwen3_tts_context_t* qwen3_tts_init_export() { return qwen3_tts_init(); }
NOTIA_EXPORT void qwen3_tts_free_export(qwen3_tts_context_t* value) { qwen3_tts_free(value); }
NOTIA_EXPORT int32_t qwen3_tts_load_models_with_name_export(qwen3_tts_context_t* value, const char* root, const char* name) { return qwen3_tts_load_models_with_name(value, root, name); }
NOTIA_EXPORT qwen3_tts_result_t qwen3_tts_synthesize_export(qwen3_tts_context_t* value, const char* text, qwen3_tts_params_t params) { return qwen3_tts_synthesize(value, text, params); }
NOTIA_EXPORT void qwen3_tts_free_result_export(qwen3_tts_result_t value) { qwen3_tts_free_result(value); }
NOTIA_EXPORT char* qwen3_tts_get_last_error_export(qwen3_tts_context_t* value) { return qwen3_tts_get_last_error(value); }
NOTIA_EXPORT void qwen3_tts_free_string_export(char* value) { qwen3_tts_free_string(value); }
