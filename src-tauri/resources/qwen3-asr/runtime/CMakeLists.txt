cmake_minimum_required(VERSION 3.22)
project(notia_qwen3_asr LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_MTMD ON CACHE BOOL "" FORCE)
set(MTMD_VIDEO OFF CACHE BOOL "" FORCE)

add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/../../../vendor/llama.cpp llama EXCLUDE_FROM_ALL)

# TTS carga otra versión de estas bibliotecas en el mismo proceso. Nombres
# únicos evitan que el cargador de Windows reutilice DLL incompatibles.
foreach(_target llama mtmd ggml ggml-base ggml-cpu ggml-vulkan)
  if(TARGET ${_target})
    set_target_properties(${_target} PROPERTIES OUTPUT_NAME "notia_asr_${_target}")
  endif()
endforeach()

add_library(notia_qwen3_asr SHARED qwen3_asr_bridge.cpp)
target_include_directories(notia_qwen3_asr PRIVATE
  ${CMAKE_CURRENT_LIST_DIR}/../../../vendor/llama.cpp/include
  ${CMAKE_CURRENT_LIST_DIR}/../../../vendor/llama.cpp/tools/mtmd
)
target_link_libraries(notia_qwen3_asr PRIVATE llama mtmd)
target_compile_definitions(notia_qwen3_asr PRIVATE NOTIA_QWEN3_ASR_EXPORTS)

if(MSVC)
  target_compile_options(notia_qwen3_asr PRIVATE /utf-8)
endif()
