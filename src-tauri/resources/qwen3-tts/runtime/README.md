# Runtime nativo de Qwen3-TTS

`scripts/build-qwen3-tts-runtime.ps1` compila el submódulo fijado
`src-tauri/vendor/qwen3-tts.cpp` y coloca la biblioteca C ABI en la carpeta de
Windows. Para Android, el mismo wrapper debe compilarse con el NDK para
`arm64-v8a`; `build.rs` copia el `.so` producido a `jniLibs`.
