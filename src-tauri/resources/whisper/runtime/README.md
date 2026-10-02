# Runtime nativo de whisper.cpp

`scripts/build-whisper-runtime.ps1` compila el submódulo fijado
`src-tauri/vendor/whisper.cpp` (v1.9.4) junto con `bridge.cpp`, la C ABI que
carga el backend Rust:

- `-Platform windows` (Vulkan SDK obligatorio) deja en `windows-x86_64/` el
  bridge `notia_whisper.dll`, whisper, ggml y los backends `notia_stt_ggml-cpu`
  y `notia_stt_ggml-vulkan`. El bridge carga Vulkan solo si el sistema tiene un
  driver Vulkan; si no, transcribe en CPU.
- `-Platform android` (`ANDROID_NDK_HOME` obligatorio) deja en
  `android-arm64-v8a/` las mismas bibliotecas para arm64 con las variantes CPU
  de ggml; el bridge elige la más capaz que el procesador admite. `build.rs`
  las copia a `jniLibs`.

Todas las bibliotecas llevan el prefijo `notia_stt_` porque Qwen3-TTS carga sus
propias `ggml*.dll` en el mismo proceso.
