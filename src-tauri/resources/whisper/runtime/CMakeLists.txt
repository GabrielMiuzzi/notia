cmake_minimum_required(VERSION 3.22)
project(notia_whisper_runtime LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>" CACHE STRING "" FORCE)
endif()

# Backends are separate libraries that the bridge loads by path: a missing
# Vulkan driver only leaves the GPU backend out instead of failing the load.
set(BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL ON CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
# ggml's own thread pool: no OpenMP runtime to ship next to the libraries.
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)

add_subdirectory("${WHISPER_SOURCE}" whisper EXCLUDE_FROM_ALL)

add_library(notia_whisper SHARED bridge.cpp)
target_link_libraries(notia_whisper PRIVATE whisper ggml)
if(MSVC)
  target_compile_options(notia_whisper PRIVATE /utf-8)
endif()

# Each backend defines its target in its own subdirectory of ggml/src.
function(collect_targets directory output)
  get_property(_found DIRECTORY "${directory}" PROPERTY BUILDSYSTEM_TARGETS)
  get_property(_children DIRECTORY "${directory}" PROPERTY SUBDIRECTORIES)
  foreach(_child ${_children})
    collect_targets("${_child}" _child_found)
    list(APPEND _found ${_child_found})
  endforeach()
  set(${output} ${_found} PARENT_SCOPE)
endfunction()

# Qwen3-TTS loads its own ggml libraries in the same process. Unique names
# keep the Windows loader from reusing them and the APK from overwriting them.
collect_targets("${WHISPER_SOURCE}/ggml/src" _ggml_targets)
foreach(_target whisper ${_ggml_targets})
  get_target_property(_type ${_target} TYPE)
  if(_type STREQUAL "SHARED_LIBRARY" OR _type STREQUAL "MODULE_LIBRARY")
    set_target_properties(${_target} PROPERTIES OUTPUT_NAME "notia_stt_${_target}")
    if(_type STREQUAL "MODULE_LIBRARY")
      add_dependencies(notia_whisper ${_target})
    endif()
  endif()
endforeach()
