// Only the window build (feature `app`) prepares bundles and Android sources.
#![cfg_attr(not(feature = "app"), allow(dead_code))]

fn main() {
    // The headless-only build (`--no-default-features`) bundles no window,
    // no Android project and no speech models.
    #[cfg(feature = "app")]
    {
        validate_bundled_speech_models();
        prepare_android_speech_runtime();
        prepare_android_directory_picker_plugin();
        prepare_android_database_plugin();
        prepare_android_ai_plugin();
        prepare_android_continuity_plugin();
        tauri_build::build()
    }
}

fn prepare_android_directory_picker_plugin() {
    if std::env::var_os("CARGO_CFG_TARGET_OS").as_deref() != Some(std::ffi::OsStr::new("android")) {
        return;
    }
    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR")
        .map(std::path::PathBuf::from)
        .expect("CARGO_MANIFEST_DIR is required");
    let source = manifest_dir
        .join("resources")
        .join("directory-picker")
        .join("android")
        .join("DirectoryPickerPlugin.kt");
    let destination = manifest_dir
        .join("gen/android/app/src/main/java/com/gabriel/notia/DirectoryPickerPlugin.kt");
    println!("cargo:rerun-if-changed={}", source.display());
    let parent = destination
        .parent()
        .expect("Android directory picker destination has a parent");
    std::fs::create_dir_all(parent).expect("failed to create Android directory picker directory");
    std::fs::copy(source, destination).expect("failed to install Android directory picker source");
}

fn prepare_android_ai_plugin() {
    if std::env::var_os("CARGO_CFG_TARGET_OS").as_deref() != Some(std::ffi::OsStr::new("android")) {
        return;
    }
    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR")
        .map(std::path::PathBuf::from)
        .expect("CARGO_MANIFEST_DIR is required");
    let source = manifest_dir
        .join("resources")
        .join("ai")
        .join("android")
        .join("AiBridgePlugin.kt");
    let destination = manifest_dir
        .join("gen")
        .join("android")
        .join("app")
        .join("src")
        .join("main")
        .join("java")
        .join("com")
        .join("gabriel")
        .join("notia")
        .join("AiBridgePlugin.kt");
    println!("cargo:rerun-if-changed={}", source.display());
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).expect("failed to create Android AI plugin directory");
    }
    std::fs::copy(source, destination).expect("failed to install Android AI plugin source");
}

fn prepare_android_database_plugin() {
    if std::env::var_os("CARGO_CFG_TARGET_OS").as_deref() != Some(std::ffi::OsStr::new("android")) {
        return;
    }
    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR")
        .map(std::path::PathBuf::from)
        .expect("CARGO_MANIFEST_DIR is required");
    let source = manifest_dir
        .join("resources")
        .join("database")
        .join("android")
        .join("LibraryDatabasePlugin.kt");
    let destination = manifest_dir
        .join("gen")
        .join("android")
        .join("app")
        .join("src")
        .join("main")
        .join("java")
        .join("com")
        .join("gabriel")
        .join("notia")
        .join("LibraryDatabasePlugin.kt");
    println!("cargo:rerun-if-changed={}", source.display());
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .expect("failed to create Android database plugin directory");
    }
    std::fs::copy(source, destination).expect("failed to install Android database plugin source");
}

fn prepare_android_continuity_plugin() {
    if std::env::var_os("CARGO_CFG_TARGET_OS").as_deref() != Some(std::ffi::OsStr::new("android")) {
        return;
    }
    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR")
        .map(std::path::PathBuf::from)
        .expect("CARGO_MANIFEST_DIR is required");
    let source = manifest_dir
        .join("resources")
        .join("continuity")
        .join("android")
        .join("ContinuityPlugin.kt");
    let destination = manifest_dir
        .join("gen")
        .join("android")
        .join("app")
        .join("src")
        .join("main")
        .join("java")
        .join("com")
        .join("gabriel")
        .join("notia")
        .join("ContinuityPlugin.kt");
    println!("cargo:rerun-if-changed={}", source.display());
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .expect("failed to create Android continuity plugin directory");
    }
    std::fs::copy(source, destination).expect("failed to install Android continuity plugin source");
}

/// Los modelos base se distribuyen dentro del bundle de la aplicación. Fallar
/// durante el build evita generar un APK/EXE que luego pida una instalación
/// manual en AppData.
fn validate_bundled_speech_models() {
    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR")
        .map(std::path::PathBuf::from)
        .expect("CARGO_MANIFEST_DIR is required");
    let models = manifest_dir.join("resources").join("speech").join("models");
    let parakeet = models.join("es-parakeet-tdt-v3");
    let required = [
        parakeet.join("encoder.onnx"),
        parakeet.join("decoder.onnx"),
        parakeet.join("joiner.onnx"),
        parakeet.join("tokens.txt"),
        parakeet.join("silero_vad.onnx"),
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
            panic!(
                "missing bundled speech model: {}. Run scripts/install-speech.sh parakeet.",
                path.display()
            );
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
        let mut updated = contents.clone();
        let permissions = [
            "\n    <uses-permission android:name=\"android.permission.RECORD_AUDIO\" />",
            "\n    <uses-permission android:name=\"android.permission.FOREGROUND_SERVICE\" />",
            "\n    <uses-permission android:name=\"android.permission.FOREGROUND_SERVICE_MICROPHONE\" />",
            "\n    <uses-permission android:name=\"android.permission.FOREGROUND_SERVICE_DATA_SYNC\" />",
            "\n    <uses-permission android:name=\"android.permission.POST_NOTIFICATIONS\" />",
        ];
        for permission_tag in permissions {
            let permission_name = permission_tag
                .replace("\n    <uses-permission android:name=\"", "")
                .replace("\" />", "");
            if !updated.contains(&permission_name) {
                if let Some(manifest_start) = updated.find("<manifest") {
                    if let Some(relative_end) = updated[manifest_start..].find('>') {
                        updated.insert_str(manifest_start + relative_end + 1, permission_tag);
                    }
                }
            }
        }
        let service_declaration = "\n        <service\n            android:name=\".ContinuityPlugin$ContinuityService\"\n            android:exported=\"false\"\n            android:foregroundServiceType=\"microphone|dataSync\" />";
        if !updated.contains("ContinuityService") {
            if let Some(application_start) = updated.find("</application>") {
                updated.insert_str(application_start, service_declaration);
            }
        }
        if updated != contents {
            std::fs::write(&manifest_path, updated)
                .expect("failed to add continuity permissions to the generated Android manifest");
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
