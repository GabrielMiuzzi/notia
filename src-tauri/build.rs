fn main() {
    validate_bundled_speech_models();
    prepare_android_speech_runtime();
    tauri_build::build()
}

/// Los modelos base se distribuyen dentro del bundle de la aplicación. Fallar
/// durante el build evita generar un APK/EXE que luego pida una instalación
/// manual en AppData.
fn validate_bundled_speech_models() {
    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR")
        .map(std::path::PathBuf::from)
        .expect("CARGO_MANIFEST_DIR is required");
    let models = manifest_dir.join("resources").join("speech").join("models");
    let required = [
        models
            .join("qwen3-asr-0.6b-q8")
            .join("Qwen3-ASR-0.6B-Q8_0.gguf"),
        models
            .join("qwen3-asr-0.6b-q8")
            .join("mmproj-Qwen3-ASR-0.6B-Q8_0.gguf"),
        models
            .join("speaker-diarization-v1")
            .join("segmentation.onnx"),
        models.join("speaker-diarization-v1").join("embedding.onnx"),
    ];
    for path in required {
        if !path.is_file() {
            panic!("missing bundled speech model: {}", path.display());
        }
        println!("cargo:rerun-if-changed={}", path.display());
    }
}

fn prepare_android_speech_runtime() {
    if std::env::var_os("CARGO_CFG_TARGET_OS").as_deref() != Some(std::ffi::OsStr::new("android")) {
        return;
    }
    let manifest_dir = match std::env::var_os("CARGO_MANIFEST_DIR") {
        Some(value) => std::path::PathBuf::from(value),
        None => return,
    };
    let generated_app = manifest_dir.join("gen").join("android").join("app");
    let kotlin_source = manifest_dir
        .join("resources")
        .join("speech")
        .join("android")
        .join("SpeechPermissionPlugin.kt");
    let kotlin_destination = generated_app
        .join("src")
        .join("main")
        .join("java")
        .join("com")
        .join("gabriel")
        .join("notia")
        .join("SpeechPermissionPlugin.kt");
    if kotlin_source.is_file() {
        if let Some(parent) = kotlin_destination.parent() {
            std::fs::create_dir_all(parent)
                .expect("failed to create the Android speech plugin source directory");
        }
        std::fs::copy(&kotlin_source, &kotlin_destination)
            .expect("failed to install the Android speech permission plugin source");
    }
    let manifest_path = generated_app
        .join("src")
        .join("main")
        .join("AndroidManifest.xml");
    if let Ok(contents) = std::fs::read_to_string(&manifest_path) {
        if !contents.contains("android.permission.RECORD_AUDIO") {
            if let Some(manifest_start) = contents.find("<manifest") {
                if let Some(relative_end) = contents[manifest_start..].find('>') {
                    let mut updated = contents;
                    updated.insert_str(
                        manifest_start + relative_end + 1,
                        "\n    <uses-permission android:name=\"android.permission.RECORD_AUDIO\" />",
                    );
                    std::fs::write(&manifest_path, updated)
                        .expect("failed to add RECORD_AUDIO to the generated Android manifest");
                }
            }
        }
    }
    let source_dir = manifest_dir
        .join("resources")
        .join("speech")
        .join("runtime")
        .join("android-arm64-v8a");
    if source_dir.is_dir() {
        let destination_dir = generated_app
            .join("src")
            .join("main")
            .join("jniLibs")
            .join("arm64-v8a");
        std::fs::create_dir_all(&destination_dir)
            .expect("failed to create the Android speech native library directory");
        if let Ok(entries) = std::fs::read_dir(source_dir) {
            for entry in entries.flatten() {
                let source = entry.path();
                if source.is_file()
                    && source.extension().and_then(|value| value.to_str()) == Some("so")
                {
                    if let Some(file_name) = source.file_name() {
                        std::fs::copy(&source, destination_dir.join(file_name))
                            .expect("failed to copy an Android sherpa-onnx library");
                    }
                }
            }
        }
    }
    let qwen_runtime_dir = manifest_dir
        .join("resources")
        .join("qwen3-tts")
        .join("runtime")
        .join("android-arm64-v8a");
    if qwen_runtime_dir.is_dir() {
        let destination_dir = generated_app
            .join("src")
            .join("main")
            .join("jniLibs")
            .join("arm64-v8a");
        std::fs::create_dir_all(&destination_dir)
            .expect("failed to create the Android Qwen3-TTS native library directory");
        for entry in
            std::fs::read_dir(qwen_runtime_dir).expect("failed to list Android Qwen3-TTS libraries")
        {
            let source = entry
                .expect("failed to read Android Qwen3-TTS library entry")
                .path();
            if source.extension().and_then(|value| value.to_str()) == Some("so") {
                let file_name = source
                    .file_name()
                    .expect("Qwen3-TTS library without filename");
                std::fs::copy(&source, destination_dir.join(file_name))
                    .expect("failed to copy an Android Qwen3-TTS library");
            }
        }
    }
    let qwen_asr_runtime_dir = manifest_dir
        .join("resources")
        .join("qwen3-asr")
        .join("runtime")
        .join("android-arm64-v8a");
    if qwen_asr_runtime_dir.is_dir() {
        let destination_dir = generated_app
            .join("src")
            .join("main")
            .join("jniLibs")
            .join("arm64-v8a");
        std::fs::create_dir_all(&destination_dir)
            .expect("failed to create the Android Qwen3-ASR native library directory");
        for entry in std::fs::read_dir(qwen_asr_runtime_dir)
            .expect("failed to list Android Qwen3-ASR libraries")
        {
            let source = entry
                .expect("failed to read Qwen3-ASR library entry")
                .path();
            if source.extension().and_then(|value| value.to_str()) == Some("so") {
                let file_name = source
                    .file_name()
                    .expect("Qwen3-ASR library without filename");
                std::fs::copy(&source, destination_dir.join(file_name))
                    .expect("failed to copy an Android Qwen3-ASR library");
            }
        }
    }
}
