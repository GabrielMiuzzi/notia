use libloading::Library;
use serde::Serialize;
use std::ffi::{c_char, c_void, CStr, CString};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Manager};

const MODEL_DIRECTORY_06B: &str = "qwen3-tts-0.6b-customvoice-q4_k_m";
const TALKER_FILE_06B: &str = "qwen-talker-0.6b-customvoice-Q4_K_M.gguf";
const MODEL_DIRECTORY_17B: &str = "qwen3-tts-1.7b-customvoice-q4_k_m";
const TALKER_FILE_17B: &str = "qwen-talker-1.7b-customvoice-Q4_K_M.gguf";
const TOKENIZER_FILE: &str = "qwen-tokenizer-12hz-Q4_K_M.gguf";
const MAX_TEXT_CHARS: usize = 2_000;
const MIN_AUDIO_TOKENS: usize = 256;
const MAX_AUDIO_TOKENS: usize = 2_048;

#[repr(C)]
struct QwenParams {
    max_audio_tokens: i32,
    temperature: f32,
    top_p: f32,
    top_k: i32,
    n_threads: i32,
    print_progress: i32,
    print_timing: i32,
    repetition_penalty: f32,
    language_id: i32,
    instruction: *const c_char,
    speaker: *const c_char,
    vocoder_left_context_sec: f32,
}

#[repr(C)]
struct QwenResult {
    audio: *mut f32,
    audio_len: i32,
    sample_rate: i32,
    success: i32,
    error_msg: *mut c_char,
    total_ms: i64,
}

type InitFn = unsafe extern "C" fn() -> *mut c_void;
type FreeFn = unsafe extern "C" fn(*mut c_void);
type LoadFn = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> i32;
type SynthesizeFn = unsafe extern "C" fn(*mut c_void, *const c_char, QwenParams) -> QwenResult;
type FreeResultFn = unsafe extern "C" fn(QwenResult);
type LastErrorFn = unsafe extern "C" fn(*mut c_void) -> *mut c_char;
type FreeStringFn = unsafe extern "C" fn(*mut c_char);

struct QwenEngine {
    _library: Library,
    _dependencies: Vec<Library>,
    context: *mut c_void,
    free: FreeFn,
    synthesize: SynthesizeFn,
    free_result: FreeResultFn,
    last_error: LastErrorFn,
    free_string: FreeStringFn,
}

// The native context is only accessed while held by Qwen3TtsRuntimeState.engine's Mutex.
unsafe impl Send for QwenEngine {}

impl Drop for QwenEngine {
    fn drop(&mut self) {
        if !self.context.is_null() {
            unsafe { (self.free)(self.context) };
            self.context = std::ptr::null_mut();
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Qwen3TtsStatusDto {
    pub supported: bool,
    pub ready: bool,
    pub loading: bool,
    pub error: Option<String>,
}

pub struct Qwen3TtsRuntimeState {
    engine: Mutex<Option<QwenEngine>>,
    loading: AtomicBool,
    error: Mutex<Option<String>>,
}

impl Default for Qwen3TtsRuntimeState {
    fn default() -> Self {
        Self {
            engine: Mutex::new(None),
            loading: AtomicBool::new(false),
            error: Mutex::new(None),
        }
    }
}

pub fn preload_at_startup(app: AppHandle) {
    {
        let state = app.state::<Qwen3TtsRuntimeState>();
        if state.loading.swap(true, Ordering::AcqRel)
            || state.engine.lock().is_ok_and(|slot| slot.is_some())
        {
            return;
        }
    }
    let worker_app = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("notia-qwen3-tts-preload".into())
        .spawn(move || {
            let result = load_engine(&worker_app, MODEL_DIRECTORY_06B, TALKER_FILE_06B);
            let state = worker_app.state::<Qwen3TtsRuntimeState>();
            match result {
                Ok(engine) => {
                    if let Ok(mut slot) = state.engine.lock() {
                        *slot = Some(engine);
                    }
                    if let Ok(mut slot) = state.error.lock() {
                        *slot = None;
                    }
                    log::info!("[notia:qwen3-tts] native runtime preloaded");
                }
                Err(error) => {
                    if let Ok(mut slot) = state.error.lock() {
                        *slot = Some(error.clone());
                    }
                    log::warn!("[notia:qwen3-tts] preload failed: {error}");
                }
            }
            state.loading.store(false, Ordering::Release);
        })
    {
        let state = app.state::<Qwen3TtsRuntimeState>();
        state.loading.store(false, Ordering::Release);
        if let Ok(mut slot) = state.error.lock() {
            *slot = Some(error.to_string());
        };
    }
}

pub fn status(state: &Qwen3TtsRuntimeState) -> Qwen3TtsStatusDto {
    Qwen3TtsStatusDto {
        supported: cfg!(any(target_os = "windows", target_os = "android")),
        ready: state.engine.lock().is_ok_and(|slot| slot.is_some()),
        loading: state.loading.load(Ordering::Acquire),
        error: state.error.lock().ok().and_then(|value| value.clone()),
    }
}

pub fn reload(state: &Qwen3TtsRuntimeState) -> Result<(), String> {
    let mut engine = state
        .engine
        .lock()
        .map_err(|_| "No se pudo recargar Qwen3-TTS.".to_string())?;
    *engine = None;
    if let Ok(mut error) = state.error.lock() {
        *error = None;
    }
    Ok(())
}

pub fn synthesize(
    app: &AppHandle,
    state: &Qwen3TtsRuntimeState,
    text: &str,
    voice: &str,
    language: &str,
    speed: f32,
    model: &str,
    device: &str,
) -> Result<Vec<u8>, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("El texto para sintetizar esta vacio.".into());
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err("El texto supera el limite de 2000 caracteres.".into());
    }
    if !matches!(
        voice,
        "vivian"
            | "serena"
            | "uncle_fu"
            | "dylan"
            | "eric"
            | "ryan"
            | "aiden"
            | "ono_anna"
            | "sohee"
    ) {
        return Err("La voz de Qwen3-TTS seleccionada no es valida.".into());
    }
    if !(0.7..=1.8).contains(&speed) {
        return Err("La velocidad de voz no es valida.".into());
    }
    if !matches!(model, "0.6b" | "1.7b") {
        return Err("El modelo Qwen3-TTS no es valido.".into());
    }
    if !matches!(device, "cpu" | "gpu") {
        return Err("El dispositivo de Qwen3-TTS no es valido.".into());
    }
    let (model_directory, talker_file) = if model == "1.7b" {
        (MODEL_DIRECTORY_17B, TALKER_FILE_17B)
    } else {
        (MODEL_DIRECTORY_06B, TALKER_FILE_06B)
    };
    // The selected backend is determined by the native runtime compiled for the platform.
    // Keep the setting in the contract so GPU-enabled builds can honor it without a UI change.
    let _ = device;
    ensure_loaded(app, state, model_directory, talker_file)?;
    ensure_tts_generation_memory(model)?;
    let text_c =
        CString::new(text).map_err(|_| "El texto contiene caracteres nulos.".to_string())?;
    let voice_c = CString::new(voice).map_err(|_| "La voz no es valida.".to_string())?;
    let mut guard = state
        .engine
        .lock()
        .map_err(|_| "No se pudo acceder al sintetizador.".to_string())?;
    let engine = guard
        .as_mut()
        .ok_or_else(|| "Qwen3-TTS no esta listo.".to_string())?;
    let params = QwenParams {
        max_audio_tokens: audio_token_budget(text),
        temperature: 0.5,
        top_p: 1.0,
        top_k: 50,
        n_threads: available_threads(),
        print_progress: 0,
        print_timing: 0,
        repetition_penalty: 1.05,
        language_id: language_id(language)?,
        instruction: std::ptr::null(),
        speaker: voice_c.as_ptr(),
        vocoder_left_context_sec: 0.0,
    };
    let result = unsafe { (engine.synthesize)(engine.context, text_c.as_ptr(), params) };
    if result.success == 0 || result.audio.is_null() || result.audio_len <= 0 {
        let message = if result.error_msg.is_null() {
            native_last_error(engine)
        } else {
            unsafe { CStr::from_ptr(result.error_msg) }
                .to_string_lossy()
                .into_owned()
        };
        unsafe { (engine.free_result)(result) };
        return Err(format!("Fallo Qwen3-TTS: {message}"));
    }
    let samples = unsafe { std::slice::from_raw_parts(result.audio, result.audio_len as usize) };
    let wav = encode_wav(samples, result.sample_rate);
    unsafe { (engine.free_result)(result) };
    wav
}

fn available_threads() -> i32 {
    std::thread::available_parallelism().map_or(4, |value| value.get().clamp(2, 8)) as i32
}

fn audio_token_budget(text: &str) -> i32 {
    text.chars()
        .count()
        .saturating_mul(5)
        .div_ceil(4)
        .clamp(MIN_AUDIO_TOKENS, MAX_AUDIO_TOKENS) as i32
}

fn language_id(language: &str) -> Result<i32, String> {
    match language.trim().to_ascii_lowercase().as_str() {
        "es" | "spanish" | "español" => Ok(2054),
        "en" | "english" => Ok(2050),
        "de" | "german" => Ok(2053),
        "fr" | "french" => Ok(2061),
        "zh" | "chinese" => Ok(2055),
        "ja" | "japanese" => Ok(2058),
        "ko" | "korean" => Ok(2064),
        "ru" | "russian" => Ok(2069),
        _ => Err("El idioma seleccionado no es compatible con Qwen3-TTS nativo.".into()),
    }
}

fn ensure_loaded(
    app: &AppHandle,
    state: &Qwen3TtsRuntimeState,
    model_directory: &str,
    talker_file: &str,
) -> Result<(), String> {
    if state.engine.lock().is_ok_and(|slot| slot.is_some()) {
        return Ok(());
    }
    let engine = load_engine(app, model_directory, talker_file)?;
    *state
        .engine
        .lock()
        .map_err(|_| "No se pudo preparar Qwen3-TTS.".to_string())? = Some(engine);
    Ok(())
}

fn load_engine(
    app: &AppHandle,
    model_directory: &str,
    talker_file: &str,
) -> Result<QwenEngine, String> {
    // Dedicated CodePred schedulers trade a large duplicated compute reserve
    // for throughput. Notia keeps ASR and TTS resident together, so use the
    // shared scheduler to keep the combined native memory budget bounded.
    std::env::set_var("QWEN3_TTS_CODE_PRED_DEDICATED_SCHED", "0");
    let runtime = runtime_path(app)?;
    let models = model_root(app, model_directory, talker_file)?;
    let mut dependencies = Vec::new();
    #[cfg(target_os = "windows")]
    {
        let directory = runtime
            .parent()
            .ok_or_else(|| "La ruta del runtime nativo no tiene directorio.".to_string())?;
        // ggml-cpu depends on ggml-base; load the dependency chain from the
        // bottom up so Windows can resolve every import reliably.
        for name in ["ggml-base.dll", "ggml-cpu.dll", "ggml.dll"] {
            let path = directory.join(name);
            if path.is_file() {
                dependencies.push(unsafe { Library::new(&path) }.map_err(|error| {
                    format!("No se pudo cargar la dependencia nativa {name}: {error}")
                })?);
            }
        }
    }
    let library = unsafe { Library::new(&runtime) }.map_err(|error| {
        format!(
            "No se pudo cargar el runtime nativo de Qwen3-TTS en {}: {error}",
            runtime.display()
        )
    })?;
    unsafe {
        let init: InitFn = *library
            .get(b"qwen3_tts_init_export\0")
            .map_err(|error| error.to_string())?;
        let free: FreeFn = *library
            .get(b"qwen3_tts_free_export\0")
            .map_err(|error| error.to_string())?;
        let load: LoadFn = *library
            .get(b"qwen3_tts_load_models_with_name_export\0")
            .map_err(|error| error.to_string())?;
        let synthesize: SynthesizeFn = *library
            .get(b"qwen3_tts_synthesize_export\0")
            .map_err(|error| error.to_string())?;
        let free_result: FreeResultFn = *library
            .get(b"qwen3_tts_free_result_export\0")
            .map_err(|error| error.to_string())?;
        let last_error: LastErrorFn = *library
            .get(b"qwen3_tts_get_last_error_export\0")
            .map_err(|error| error.to_string())?;
        let free_string: FreeStringFn = *library
            .get(b"qwen3_tts_free_string_export\0")
            .map_err(|error| error.to_string())?;
        let context = init();
        if context.is_null() {
            return Err("Qwen3-TTS no pudo crear el contexto nativo.".into());
        }
        let model_dir = CString::new(path_to_string(&models)?)
            .map_err(|_| "La ruta del modelo no es valida.".to_string())?;
        let model_name = CString::new(talker_file).expect("static filename");
        if load(context, model_dir.as_ptr(), model_name.as_ptr()) == 0 {
            let temporary = QwenEngine {
                _library: library,
                _dependencies: dependencies,
                context,
                free,
                synthesize,
                free_result,
                last_error,
                free_string,
            };
            return Err(format!(
                "No se pudieron cargar los modelos de Qwen3-TTS: {}",
                native_last_error(&temporary)
            ));
        }
        Ok(QwenEngine {
            _library: library,
            _dependencies: dependencies,
            context,
            free,
            synthesize,
            free_result,
            last_error,
            free_string,
        })
    }
}

#[cfg(target_os = "windows")]
fn ensure_tts_generation_memory(model: &str) -> Result<(), String> {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    unsafe { GlobalMemoryStatusEx(&mut status) }
        .map_err(|error| format!("No se pudo consultar la memoria disponible: {error}"))?;
    let required = if model == "1.7b" { 3_u64 } else { 2_u64 } * 1024 * 1024 * 1024;
    if status.ullAvailPageFile < required {
        return Err(format!(
            "No hay memoria virtual suficiente para generar voz con Qwen3-TTS {model}. Cerrá aplicaciones pesadas o ampliá el archivo de paginación de Windows; Notia mantuvo activos los runtimes y evitó un cierre inesperado."
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn ensure_tts_generation_memory(_model: &str) -> Result<(), String> {
    Ok(())
}

fn native_last_error(engine: &QwenEngine) -> String {
    let pointer = unsafe { (engine.last_error)(engine.context) };
    if pointer.is_null() {
        return "error nativo desconocido".into();
    }
    let message = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { (engine.free_string)(pointer) };
    message
}

fn runtime_path(app: &AppHandle) -> Result<PathBuf, String> {
    let _ = app;
    #[cfg(target_os = "android")]
    return Ok(PathBuf::from("libqwen3_tts_runtime.so"));
    #[cfg(target_os = "windows")]
    {
        #[cfg(debug_assertions)]
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/qwen3-tts/runtime/windows-x86_64/qwen3_tts_runtime.dll"));
        #[cfg(not(debug_assertions))]
        return Ok(app
            .path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("resources/qwen3-tts/runtime/windows-x86_64/qwen3_tts_runtime.dll"));
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    Err("Qwen3-TTS nativo solo esta integrado en Windows y Android.".into())
}

fn model_root(
    app: &AppHandle,
    model_directory: &str,
    talker_file: &str,
) -> Result<PathBuf, String> {
    let installed = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("qwen3-tts-models")
        .join(model_directory);
    if model_files_are_ready(&installed, talker_file) {
        return Ok(installed);
    }
    #[cfg(debug_assertions)]
    {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/qwen3-tts/models")
            .join(model_directory);
        if model_files_are_ready(&source, talker_file) {
            return Ok(source);
        }
    }
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("resources/qwen3-tts/models")
        .join(model_directory);
    if model_files_are_ready(&bundled, talker_file) {
        return Ok(bundled);
    }
    Err(format!(
        "Los modelos Qwen3-TTS ({model_directory}) no estan instalados."
    ))
}

fn model_files_are_ready(root: &Path, talker_file: &str) -> bool {
    root.join(talker_file).is_file() && root.join(TOKENIZER_FILE).is_file()
}
fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "La ruta de Qwen3-TTS no es Unicode valido.".into())
}

fn encode_wav(samples: &[f32], sample_rate: i32) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: sample_rate as u32,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::new(Cursor::new(&mut bytes), spec).map_err(|error| error.to_string())?;
    for sample in samples {
        writer
            .write_sample((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
            .map_err(|error| error.to_string())?;
    }
    writer.finalize().map_err(|error| error.to_string())?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::{
        audio_token_budget, language_id, model_files_are_ready, TALKER_FILE_06B, TOKENIZER_FILE,
    };
    #[test]
    fn audio_cache_budget_scales_with_text_length() {
        assert_eq!(audio_token_budget("Hola"), 256);
        assert_eq!(audio_token_budget(&"a".repeat(1_000)), 1_250);
        assert_eq!(audio_token_budget(&"a".repeat(2_000)), 2_048);
    }
    #[test]
    fn maps_spanish_language() {
        assert_eq!(language_id("es"), Ok(2054));
    }
    #[test]
    fn requires_both_qwen_model_files() {
        let root = std::env::temp_dir().join(format!("notia-qwen3-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("fixture");
        std::fs::write(root.join(TALKER_FILE_06B), []).expect("talker");
        assert!(!model_files_are_ready(&root, TALKER_FILE_06B));
        std::fs::write(root.join(TOKENIZER_FILE), []).expect("tokenizer");
        assert!(model_files_are_ready(&root, TALKER_FILE_06B));
        std::fs::remove_dir_all(root).expect("cleanup");
    }
}
