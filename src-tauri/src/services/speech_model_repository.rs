use crate::dto::speech::{
    SpeechModelFileStatusDto, SpeechModelProfileStatusDto, SpeechModelStatusDto,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;
use tauri::{AppHandle, Manager};

const MODEL_MANIFEST_JSON: &str = include_str!("../../resources/speech/model-manifest.json");
const MODEL_DIRECTORY_NAME: &str = "speech-models";
static MODEL_HASH_CACHE: OnceLock<Mutex<std::collections::HashMap<PathBuf, CachedModelHash>>> =
    OnceLock::new();

#[derive(Clone)]
struct CachedModelHash {
    bytes: u64,
    modified: Option<SystemTime>,
    sha256: String,
}
const SUPPORTED_MANIFEST_SCHEMA_VERSION: u32 = 1;
const MAX_MODEL_FILE_BYTES: u64 = 5 * 1024 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SpeechModelManifest {
    schema_version: u32,
    profiles: Vec<SpeechModelProfile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SpeechModelProfile {
    profile_id: String,
    language: String,
    #[serde(default)]
    asr: Option<SpeechAsrConfig>,
    #[serde(default)]
    diarization: Option<SpeechDiarizationConfig>,
    files: Vec<SpeechModelFile>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum SpeechDiarizationConfig {
    Pyannote {
        segmentation: String,
        embedding: String,
    },
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub struct ResolvedDiarizationModel {
    pub segmentation: PathBuf,
    pub embedding: PathBuf,
    pub num_threads: i32,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum SpeechAsrConfig {
    Qwen3Asr { model: String, mmproj: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SpeechModelFile {
    relative_path: String,
    bytes: u64,
    sha256: String,
}

pub fn inspect_installed_models(app: &AppHandle) -> Result<SpeechModelStatusDto, String> {
    let root = model_root(app)?;
    inspect_manifest_metadata(MODEL_MANIFEST_JSON, &root)
}

fn model_root(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        // En desarrollo, los recursos del checkout son la fuente de verdad.
        // Esto evita que una instalación anterior en AppData oculte modelos
        // actualizados del proyecto al ejecutar `npm run dev:tauri:windows`.
        let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("speech")
            .join("models");
        let source_asr = source_root.join("qwen3-asr-0.6b-q8");
        if source_asr.join("Qwen3-ASR-0.6B-Q8_0.gguf").is_file()
            && source_asr.join("mmproj-Qwen3-ASR-0.6B-Q8_0.gguf").is_file()
        {
            return Ok(source_root);
        }
    }
    let installed_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo resolver el directorio privado de modelos: {error}"))?
        .join(MODEL_DIRECTORY_NAME);
    // No alcanza con que exista la carpeta: instalaciones interrumpidas pueden
    // dejarla creada pero sin los archivos requeridos. Solo la usamos cuando el
    // perfil Qwen3-ASR realmente contiene ambos artefactos principales.
    let installed_asr = installed_root.join("qwen3-asr-0.6b-q8");
    if installed_asr.join("Qwen3-ASR-0.6B-Q8_0.gguf").is_file()
        && installed_asr
            .join("mmproj-Qwen3-ASR-0.6B-Q8_0.gguf")
            .is_file()
    {
        return Ok(installed_root);
    }
    Ok(app
        .path()
        .resource_dir()
        .map_err(|error| format!("No se pudo resolver el directorio de recursos: {error}"))?
        .join("resources")
        .join("speech")
        .join("models"))
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn resolve_qwen3_asr_model(
    app: &AppHandle,
    model_size: &str,
    language: &str,
    device: &str,
) -> Result<crate::services::qwen3_asr_service::Qwen3AsrModelConfig, String> {
    let manifest: SpeechModelManifest = serde_json::from_str(MODEL_MANIFEST_JSON)
        .map_err(|error| format!("El manifiesto de modelos de voz no es valido: {error}"))?;
    validate_manifest(&manifest)?;
    let profile = manifest
        .profiles
        .iter()
        .find(|profile| {
            profile.profile_id == format!("qwen3-asr-{model_size}-q8") && profile.asr.is_some()
        })
        .ok_or_else(|| format!("No hay un modelo Qwen3-ASR {model_size} configurado."))?;
    let models_root = model_root(app)?;
    let profile_root = models_root.join(&profile.profile_id);
    let status = inspect_profile(&models_root, profile)?;
    if !status.ready {
        return Err(format!(
            "El modelo ASR {} no esta instalado o no supera su verificacion.",
            profile.profile_id
        ));
    }
    let (model, mmproj) = match profile.asr.as_ref() {
        Some(SpeechAsrConfig::Qwen3Asr { model, mmproj }) => (model, mmproj),
        None => return Err("El perfil seleccionado no declara un modelo ASR.".to_string()),
    };
    Ok(crate::services::qwen3_asr_service::Qwen3AsrModelConfig {
        model: resolve_verified_role_path(&profile_root, model)?,
        mmproj: resolve_verified_role_path(&profile_root, mmproj)?,
        language: language.to_string(),
        use_gpu: device == "gpu",
    })
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn resolve_diarization_model(
    app: &AppHandle,
    language: &str,
) -> Result<ResolvedDiarizationModel, String> {
    let manifest: SpeechModelManifest = serde_json::from_str(MODEL_MANIFEST_JSON)
        .map_err(|error| format!("El manifiesto de modelos de voz no es valido: {error}"))?;
    validate_manifest(&manifest)?;
    let profile = manifest
        .profiles
        .iter()
        .find(|profile| profile.diarization.is_some())
        .ok_or_else(|| format!("No hay un modelo de diarizacion para el idioma {language}."))?;
    let models_root = model_root(app)?;
    if !inspect_profile(&models_root, profile)?.ready {
        return Err("El perfil de diarizacion no supera su verificacion.".to_string());
    }
    let (segmentation, embedding) = match profile.diarization.as_ref() {
        Some(SpeechDiarizationConfig::Pyannote {
            segmentation,
            embedding,
        }) => (segmentation, embedding),
        None => return Err("El perfil no declara diarizacion.".to_string()),
    };
    let profile_root = models_root.join(&profile.profile_id);
    Ok(ResolvedDiarizationModel {
        segmentation: resolve_verified_role_path(&profile_root, segmentation)?,
        embedding: resolve_verified_role_path(&profile_root, embedding)?,
        num_threads: 2,
    })
}

#[cfg(test)]
fn inspect_manifest(manifest_json: &str, root: &Path) -> Result<SpeechModelStatusDto, String> {
    inspect_manifest_with_hashes(manifest_json, root, true)
}

fn inspect_manifest_metadata(
    manifest_json: &str,
    root: &Path,
) -> Result<SpeechModelStatusDto, String> {
    inspect_manifest_with_hashes(manifest_json, root, false)
}

fn inspect_manifest_with_hashes(
    manifest_json: &str,
    root: &Path,
    verify_hashes: bool,
) -> Result<SpeechModelStatusDto, String> {
    let manifest: SpeechModelManifest = serde_json::from_str(manifest_json)
        .map_err(|error| format!("El manifiesto de modelos de voz no es valido: {error}"))?;
    validate_manifest(&manifest)?;

    let profiles = manifest
        .profiles
        .iter()
        .map(|profile| inspect_profile_with_hashes(root, profile, verify_hashes))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(SpeechModelStatusDto {
        schema_version: manifest.schema_version,
        profiles,
    })
}

fn validate_manifest(manifest: &SpeechModelManifest) -> Result<(), String> {
    if manifest.schema_version != SUPPORTED_MANIFEST_SCHEMA_VERSION {
        return Err(format!(
            "Version de manifiesto de voz no soportada: {}.",
            manifest.schema_version
        ));
    }
    let mut profile_ids = std::collections::HashSet::new();
    for profile in &manifest.profiles {
        validate_identifier(&profile.profile_id, "perfil")?;
        validate_identifier(&profile.language, "idioma")?;
        if !profile_ids.insert(profile.profile_id.as_str()) {
            return Err("El manifiesto contiene identificadores de perfil duplicados.".to_string());
        }
        if profile.files.is_empty() {
            return Err(format!(
                "El perfil de voz {} no declara archivos.",
                profile.profile_id
            ));
        }
        let mut declared_paths = std::collections::HashSet::new();
        for model_file in &profile.files {
            validate_relative_path(&model_file.relative_path)?;
            if !declared_paths.insert(model_file.relative_path.as_str()) {
                return Err(format!(
                    "El perfil {} declara un archivo duplicado.",
                    profile.profile_id
                ));
            }
            if model_file.bytes == 0 || model_file.bytes > MAX_MODEL_FILE_BYTES {
                return Err(format!(
                    "El tamano declarado para {} no es valido.",
                    model_file.relative_path
                ));
            }
            if model_file.sha256.len() != 64
                || !model_file
                    .sha256
                    .bytes()
                    .all(|value| value.is_ascii_hexdigit())
            {
                return Err(format!(
                    "El SHA-256 declarado para {} no es valido.",
                    model_file.relative_path
                ));
            }
        }
        if let Some(asr) = &profile.asr {
            validate_asr_roles(asr, &declared_paths)?;
        }
        if let Some(diarization) = &profile.diarization {
            validate_diarization_roles(diarization, &declared_paths)?;
        }
    }
    Ok(())
}

fn validate_diarization_roles(
    config: &SpeechDiarizationConfig,
    declared_paths: &std::collections::HashSet<&str>,
) -> Result<(), String> {
    let SpeechDiarizationConfig::Pyannote {
        segmentation,
        embedding,
    } = config;
    if segmentation == embedding {
        return Err("Los modelos de segmentacion y embedding deben ser distintos.".to_string());
    }
    for path in [segmentation, embedding] {
        validate_relative_path(path)?;
        if !declared_paths.contains(path.as_str()) {
            return Err(format!("El rol de diarizacion {path} no esta declarado."));
        }
    }
    Ok(())
}

fn validate_asr_roles(
    config: &SpeechAsrConfig,
    declared_paths: &std::collections::HashSet<&str>,
) -> Result<(), String> {
    let SpeechAsrConfig::Qwen3Asr { model, mmproj } = config;
    let roles = [model, mmproj];
    let mut unique_roles = std::collections::HashSet::new();
    for path in roles {
        validate_relative_path(path)?;
        if !declared_paths.contains(path.as_str()) {
            return Err(format!(
                "El rol ASR {path} no corresponde a un archivo declarado."
            ));
        }
        if !unique_roles.insert(path.as_str()) {
            return Err("Los roles del modelo ASR deben usar archivos distintos.".to_string());
        }
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 80
        || !value.bytes().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, b'-' | b'_' | b'.')
        })
    {
        return Err(format!("El identificador de {label} no es valido."));
    }
    Ok(())
}

fn validate_relative_path(value: &str) -> Result<(), String> {
    let path = Path::new(value);
    if value.is_empty()
        || value.len() > 240
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("El manifiesto contiene una ruta de modelo no segura.".to_string());
    }
    Ok(())
}

fn inspect_profile(
    root: &Path,
    profile: &SpeechModelProfile,
) -> Result<SpeechModelProfileStatusDto, String> {
    inspect_profile_with_hashes(root, profile, true)
}

fn inspect_profile_with_hashes(
    root: &Path,
    profile: &SpeechModelProfile,
    verify_hashes: bool,
) -> Result<SpeechModelProfileStatusDto, String> {
    let profile_root = root.join(&profile.profile_id);
    let files = profile
        .files
        .iter()
        .map(|model_file| inspect_file(&profile_root, model_file, verify_hashes))
        .collect::<Result<Vec<_>, _>>()?;
    let ready = files.iter().all(|file| file.valid);
    Ok(SpeechModelProfileStatusDto {
        profile_id: profile.profile_id.clone(),
        language: profile.language.clone(),
        ready,
        asr_ready: ready && profile.asr.is_some(),
        diarization_ready: ready && profile.diarization.is_some(),
        files,
    })
}

fn inspect_file(
    root: &Path,
    model_file: &SpeechModelFile,
    verify_hash: bool,
) -> Result<SpeechModelFileStatusDto, String> {
    let path = root.join(&model_file.relative_path);
    let metadata = match path.symlink_metadata() {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => metadata,
        Ok(_) | Err(_) => {
            return Ok(file_status(model_file, false, false));
        }
    };
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("No se pudo validar el directorio del perfil de voz: {error}"))?;
    let canonical_path = fs::canonicalize(&path)
        .map_err(|error| format!("No se pudo validar la ruta de un modelo de voz: {error}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Un modelo de voz resuelve fuera de su perfil autorizado.".to_string());
    }
    if metadata.len() != model_file.bytes {
        return Ok(file_status(model_file, true, false));
    }
    if !verify_hash {
        return Ok(file_status(model_file, true, true));
    }
    let actual_sha256 = hash_file(&path)?;
    Ok(file_status(
        model_file,
        true,
        actual_sha256.eq_ignore_ascii_case(&model_file.sha256),
    ))
}

fn resolve_verified_role_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("No se pudo validar el directorio del perfil de voz: {error}"))?;
    let path = root.join(relative_path);
    let metadata = path
        .symlink_metadata()
        .map_err(|_| "Falta un archivo requerido por el modelo ASR.".to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Un archivo requerido por el modelo ASR no es regular.".to_string());
    }
    let canonical_path = fs::canonicalize(path)
        .map_err(|error| format!("No se pudo validar un archivo del modelo ASR: {error}"))?;
    if !canonical_path.starts_with(canonical_root) {
        return Err("Un archivo del modelo ASR resuelve fuera de su perfil.".to_string());
    }
    Ok(canonical_path)
}

fn file_status(
    model_file: &SpeechModelFile,
    installed: bool,
    valid: bool,
) -> SpeechModelFileStatusDto {
    SpeechModelFileStatusDto {
        relative_path: model_file.relative_path.clone(),
        expected_bytes: model_file.bytes,
        installed,
        valid,
    }
}

fn hash_file(path: &PathBuf) -> Result<String, String> {
    let metadata = path
        .metadata()
        .map_err(|error| format!("No se pudo inspeccionar un modelo de voz: {error}"))?;
    let modified = metadata.modified().ok();
    let cache = MODEL_HASH_CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()));
    if let Ok(cache) = cache.lock() {
        if let Some(cached) = cache.get(path) {
            if cached.bytes == metadata.len() && cached.modified == modified {
                return Ok(cached.sha256.clone());
            }
        }
    }
    let file =
        File::open(path).map_err(|error| format!("No se pudo abrir un modelo de voz: {error}"))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("No se pudo validar un modelo de voz: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let sha256 = format!("{:x}", hasher.finalize());
    if let Ok(mut cache) = cache.lock() {
        cache.insert(
            path.clone(),
            CachedModelHash {
                bytes: metadata.len(),
                modified,
                sha256: sha256.clone(),
            },
        );
    }
    Ok(sha256)
}

#[cfg(test)]
mod tests {
    use super::{inspect_manifest, inspect_manifest_metadata};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "notia-speech-model-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("valid clock")
                .as_nanos()
        ))
    }

    #[test]
    fn rejects_path_traversal() {
        let manifest = r#"{"schemaVersion":1,"profiles":[{"profileId":"es","language":"es","files":[{"relativePath":"../model.onnx","bytes":3,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}]}"#;
        assert!(inspect_manifest(manifest, &temporary_root()).is_err());
    }

    #[test]
    fn verifies_size_and_sha256() {
        let root = temporary_root();
        let profile_root = root.join("es-test");
        fs::create_dir_all(&profile_root).expect("create test model directory");
        fs::write(profile_root.join("model.onnx"), b"abc").expect("write test model");
        let manifest = r#"{"schemaVersion":1,"profiles":[{"profileId":"es-test","language":"es","files":[{"relativePath":"model.onnx","bytes":3,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}]}]}"#;
        let status = inspect_manifest(manifest, &root).expect("inspect valid manifest");
        assert!(status.profiles[0].ready);
        fs::remove_dir_all(root).expect("remove test model directory");
    }

    #[test]
    fn metadata_inspection_does_not_hash_large_models() {
        let root = temporary_root();
        let profile_root = root.join("es-test");
        std::fs::create_dir_all(&profile_root).expect("create profile");
        std::fs::write(profile_root.join("model.onnx"), b"xyz").expect("write model");
        let manifest = r#"{"schemaVersion":1,"profiles":[{"profileId":"es-test","language":"es","files":[{"relativePath":"model.onnx","bytes":3,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}]}]}"#;

        let metadata = inspect_manifest_metadata(manifest, &root).expect("inspect metadata");
        let verified = inspect_manifest(manifest, &root).expect("inspect hashes");

        assert!(metadata.profiles[0].ready);
        assert!(!verified.profiles[0].ready);
    }

    #[test]
    fn marks_missing_files_without_creating_directories() {
        let root = temporary_root();
        let manifest = r#"{"schemaVersion":1,"profiles":[{"profileId":"es-test","language":"es","files":[{"relativePath":"model.onnx","bytes":3,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}]}]}"#;
        let status = inspect_manifest(manifest, &root).expect("inspect missing model");
        assert!(!status.profiles[0].ready);
        assert!(!root.exists());
    }

    #[test]
    fn rejects_asr_roles_that_are_not_declared_files() {
        let manifest = r#"{"schemaVersion":1,"profiles":[{"profileId":"es-test","language":"es","asr":{"type":"offlineNemoTransducer","encoder":"encoder.onnx","decoder":"decoder.onnx","joiner":"joiner.onnx","tokens":"tokens.txt","vad":"silero_vad.onnx"},"files":[{"relativePath":"encoder.onnx","bytes":3,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}]}]}"#;
        assert!(inspect_manifest(manifest, &temporary_root()).is_err());
    }

    #[test]
    fn accepts_declared_offline_nemo_transducer_roles() {
        let manifest = r#"{"schemaVersion":1,"profiles":[{"profileId":"es-test","language":"es","asr":{"type":"offlineNemoTransducer","encoder":"encoder.onnx","decoder":"decoder.onnx","joiner":"joiner.onnx","tokens":"tokens.txt","vad":"silero_vad.onnx"},"files":[{"relativePath":"encoder.onnx","bytes":3,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},{"relativePath":"decoder.onnx","bytes":3,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},{"relativePath":"joiner.onnx","bytes":3,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},{"relativePath":"tokens.txt","bytes":3,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},{"relativePath":"silero_vad.onnx","bytes":3,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}]}]}"#;
        let status = inspect_manifest(manifest, &temporary_root()).expect("valid ASR roles");
        assert!(!status.profiles[0].ready);
    }
}
