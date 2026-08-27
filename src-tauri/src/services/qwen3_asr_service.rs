use crate::services::speech_worker::{RecognitionUpdate, StreamingRecognizer};
use libloading::Library;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
#[cfg(not(debug_assertions))]
use tauri::Manager;

const SAMPLE_RATE: usize = 16_000;
const PARTIAL_INTERVAL_SAMPLES: usize = SAMPLE_RATE * 3 / 2;
const MIN_DECODE_SAMPLES: usize = SAMPLE_RATE * 4 / 5;
const PARTIAL_WINDOW_SAMPLES: usize = SAMPLE_RATE * 12;
const PARTIAL_OVERLAP_SAMPLES: usize = SAMPLE_RATE * 2;
const PARTIAL_WINDOW_STEP_SAMPLES: usize = PARTIAL_WINDOW_SAMPLES - PARTIAL_OVERLAP_SAMPLES;
// A meeting often contains short hesitations inside a word or sentence. Keep a
// wider silence margin so those pauses do not reset the utterance prematurely.
const ENDPOINT_SILENCE_SAMPLES: usize = SAMPLE_RATE * 11 / 10;
const SPEECH_ENERGY_THRESHOLD: f32 = 0.000_12;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;

type LoadFn = unsafe extern "C" fn(*const c_char, *const c_char, c_int, c_int) -> *mut c_void;
type FreeFn = unsafe extern "C" fn(*mut c_void);
type TranscribeFn = unsafe extern "C" fn(
    *mut c_void,
    *const f32,
    usize,
    *const c_char,
    *mut c_char,
    usize,
) -> c_int;
type LastErrorFn = unsafe extern "C" fn(*mut c_void) -> *const c_char;
#[cfg(target_os = "windows")]
type BackendLoadFn = unsafe extern "C" fn(*const c_char) -> *mut c_void;

#[derive(Debug, Clone)]
pub struct Qwen3AsrModelConfig {
    pub model: PathBuf,
    pub mmproj: PathBuf,
    pub language: String,
    pub use_gpu: bool,
}

pub struct Qwen3AsrRecognizer {
    _library: Library,
    _dependencies: Vec<Library>,
    context: *mut c_void,
    free: FreeFn,
    transcribe: TranscribeFn,
    last_error: LastErrorFn,
    language: CString,
    utterance: Vec<f32>,
    samples_since_decode: usize,
    partial_window_start: usize,
    has_new_speech_since_decode: bool,
    trailing_silence: usize,
    has_speech: bool,
    last_text: String,
    config: Qwen3AsrModelConfig,
}

unsafe impl Send for Qwen3AsrRecognizer {}

impl Drop for Qwen3AsrRecognizer {
    fn drop(&mut self) {
        if !self.context.is_null() {
            unsafe { (self.free)(self.context) };
            self.context = std::ptr::null_mut();
        }
    }
}

impl Qwen3AsrRecognizer {
    pub fn load(app: &AppHandle, config: &Qwen3AsrModelConfig) -> Result<Self, String> {
        let mut config = config.clone();
        // GPU inference is intentionally disabled; preserve the field only
        // for compatibility with existing settings payloads.
        config.use_gpu = false;
        let runtime_dir = runtime_directory(app)?;
        // Las DLL de llama.cpp dependen entre sí. En Windows el cargador no
        // siempre incluye el directorio de una DLL cargada dinámicamente en su
        // búsqueda de dependencias, por lo que lo agregamos explícitamente.
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows::core::PCWSTR;
            let wide: Vec<u16> = runtime_dir
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            // SetDllDirectoryW aplica también a las dependencias transitivas
            // que Windows resuelve al cargar llama.dll.
            unsafe {
                windows::Win32::System::LibraryLoader::SetDllDirectoryW(PCWSTR(wide.as_ptr())).ok();
            }
            let runtime = runtime_dir.to_string_lossy();
            let current_path = std::env::var_os("PATH")
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_default();
            if !current_path
                .split(';')
                .any(|entry| entry.eq_ignore_ascii_case(runtime.as_ref()))
            {
                std::env::set_var("PATH", format!("{runtime};{current_path}"));
            }
        }
        let (library_name, dependencies) = runtime_files();
        #[cfg(target_os = "windows")]
        if config.use_gpu && !runtime_dir.join("notia_asr_ggml-vulkan.dll").is_file() {
            return Err(
                "El runtime Qwen3-ASR instalado no incluye el backend Vulkan requerido para usar GPU. Reconstruilo con scripts/build-qwen3-asr-runtime.ps1 -Device gpu."
                    .to_string(),
            );
        }
        let mut loaded_dependencies = Vec::new();
        for dependency in dependencies {
            let path = runtime_dir.join(dependency);
            if path.is_file() {
                let loaded = unsafe { Library::new(&path) }
                    .map_err(|error| format!("No se pudo cargar {}: {error}", path.display()))?;
                #[cfg(target_os = "windows")]
                if dependency == &"notia_asr_ggml.dll" {
                    let load_backend =
                        unsafe { loaded.get::<BackendLoadFn>(b"ggml_backend_load\0") }.map_err(
                            |error| {
                                format!("El runtime GGML no permite registrar backends: {error}")
                            },
                        )?;
                    let mut backend_names = vec!["notia_asr_ggml-cpu.dll"];
                    if config.use_gpu {
                        backend_names.push("notia_asr_ggml-vulkan.dll");
                    }
                    for backend_name in backend_names {
                        let backend_path = path_to_cstring(&runtime_dir.join(backend_name))?;
                        if unsafe { load_backend(backend_path.as_ptr()) }.is_null() {
                            return Err(format!(
                                "No se pudo registrar el backend {backend_name} de Qwen3-ASR."
                            ));
                        }
                    }
                }
                loaded_dependencies.push(loaded);
            }
        }
        let library_path = runtime_dir.join(library_name);
        let library = unsafe { Library::new(&library_path) }
            .map_err(|error| format!("No se pudo cargar llama.cpp para Qwen3-ASR: {error}"))?;
        let load = unsafe { library.get::<LoadFn>(b"notia_qwen3_asr_load\0") }
            .map(|symbol| *symbol)
            .map_err(|error| format!("El runtime Qwen3-ASR no exporta load: {error}"))?;
        let free = unsafe { library.get::<FreeFn>(b"notia_qwen3_asr_free\0") }
            .map(|symbol| *symbol)
            .map_err(|error| format!("El runtime Qwen3-ASR no exporta free: {error}"))?;
        let transcribe = unsafe { library.get::<TranscribeFn>(b"notia_qwen3_asr_transcribe\0") }
            .map(|symbol| *symbol)
            .map_err(|error| format!("El runtime Qwen3-ASR no exporta transcribe: {error}"))?;
        let last_error = unsafe { library.get::<LastErrorFn>(b"notia_qwen3_asr_last_error\0") }
            .map(|symbol| *symbol)
            .map_err(|error| format!("El runtime Qwen3-ASR no exporta last_error: {error}"))?;
        let model = path_to_cstring(&config.model)?;
        let mmproj = path_to_cstring(&config.mmproj)?;
        let language = CString::new(config.language.as_str())
            .map_err(|_| "El idioma de Qwen3-ASR no es válido.".to_string())?;
        let context = unsafe {
            load(
                model.as_ptr(),
                mmproj.as_ptr(),
                i32::from(config.use_gpu),
                available_threads(),
            )
        };
        if context.is_null() {
            return Err("No se pudo cargar el modelo Qwen3-ASR seleccionado.".to_string());
        }
        Ok(Self {
            _library: library,
            _dependencies: loaded_dependencies,
            context,
            free,
            transcribe,
            last_error,
            language,
            utterance: Vec::new(),
            samples_since_decode: 0,
            partial_window_start: 0,
            has_new_speech_since_decode: false,
            trailing_silence: 0,
            has_speech: false,
            last_text: String::new(),
            config: config.clone(),
        })
    }

    pub fn matches(&self, config: &Qwen3AsrModelConfig) -> bool {
        self.config.model == config.model
            && self.config.mmproj == config.mmproj
            && self.config.language == config.language
            && self.config.use_gpu == config.use_gpu
    }

    fn decode_from(&mut self, start: usize) -> Result<String, String> {
        let samples = &self.utterance[start.min(self.utterance.len())..];
        if !self.has_speech || samples.len() < MIN_DECODE_SAMPLES {
            return Ok(String::new());
        }
        let mut output = vec![0_i8; MAX_OUTPUT_BYTES];
        let result = unsafe {
            (self.transcribe)(
                self.context,
                samples.as_ptr(),
                samples.len(),
                self.language.as_ptr(),
                output.as_mut_ptr(),
                output.len(),
            )
        };
        if result < 0 {
            let message = unsafe { (self.last_error)(self.context) };
            return Err(if message.is_null() {
                "Qwen3-ASR no pudo transcribir el audio.".to_string()
            } else {
                unsafe { CStr::from_ptr(message) }
                    .to_string_lossy()
                    .into_owned()
            });
        }
        if result as usize >= output.len() {
            return Err("La transcripción de Qwen3-ASR excedió el límite permitido.".to_string());
        }
        Ok(unsafe { CStr::from_ptr(output.as_ptr()) }
            .to_string_lossy()
            .trim()
            .to_string())
    }

    fn clear_utterance(&mut self) {
        self.utterance.clear();
        self.samples_since_decode = 0;
        self.partial_window_start = 0;
        self.has_new_speech_since_decode = false;
        self.trailing_silence = 0;
        self.has_speech = false;
        self.last_text.clear();
    }
}

impl StreamingRecognizer for Qwen3AsrRecognizer {
    fn accept_waveform(&mut self, samples: &[f32]) -> Result<RecognitionUpdate, String> {
        self.utterance.extend_from_slice(samples);
        self.samples_since_decode = self.samples_since_decode.saturating_add(samples.len());
        let energy =
            samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len().max(1) as f32;
        if energy >= SPEECH_ENERGY_THRESHOLD {
            self.has_speech = true;
            self.has_new_speech_since_decode = true;
            self.trailing_silence = 0;
        } else if self.has_speech {
            self.trailing_silence = self.trailing_silence.saturating_add(samples.len());
        }
        let endpoint = self.has_speech && self.trailing_silence >= ENDPOINT_SILENCE_SAMPLES;
        if endpoint {
            self.samples_since_decode = 0;
            self.has_new_speech_since_decode = false;
            let decoded = self.decode_from(0)?;
            if !decoded.is_empty() {
                self.last_text = decoded;
            }
        } else if self.samples_since_decode >= PARTIAL_INTERVAL_SAMPLES
            && self.has_new_speech_since_decode
        {
            self.samples_since_decode = 0;
            self.has_new_speech_since_decode = false;
            let decoded = self.decode_from(self.partial_window_start)?;
            // `speech_service` keeps confirmed text separately and treats
            // this field as the current utterance preview. Replacing the
            // preview avoids duplicating words when successive windows share
            // audio context.
            if !decoded.is_empty() {
                self.last_text = decoded;
            }
            if self
                .utterance
                .len()
                .saturating_sub(self.partial_window_start)
                >= PARTIAL_WINDOW_SAMPLES
            {
                self.partial_window_start = self
                    .partial_window_start
                    .saturating_add(PARTIAL_WINDOW_STEP_SAMPLES);
            }
        }
        Ok(RecognitionUpdate {
            text: self.last_text.clone(),
            endpoint_detected: endpoint,
        })
    }

    fn finish(&mut self) -> Result<RecognitionUpdate, String> {
        let decoded = self.decode_from(0)?;
        if !decoded.is_empty() {
            self.last_text = decoded;
        }
        Ok(RecognitionUpdate {
            text: self.last_text.clone(),
            endpoint_detected: false,
        })
    }

    fn reset_after_endpoint(&mut self) -> Result<(), String> {
        self.clear_utterance();
        Ok(())
    }

    fn reset_session(&mut self) -> Result<(), String> {
        self.clear_utterance();
        Ok(())
    }
}

fn path_to_cstring(path: &Path) -> Result<CString, String> {
    CString::new(path.to_string_lossy().as_bytes())
        .map_err(|_| "La ruta del modelo Qwen3-ASR no es válida.".to_string())
}

fn available_threads() -> i32 {
    std::thread::available_parallelism()
        .map(|value| value.get().min(8) as i32)
        .unwrap_or(2)
}

fn runtime_directory(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    let _ = app;
    let platform = if cfg!(target_os = "android") {
        "android-arm64-v8a"
    } else {
        "windows-x86_64"
    };
    #[cfg(debug_assertions)]
    return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("qwen3-asr")
        .join("runtime")
        .join(platform));
    #[cfg(not(debug_assertions))]
    app.path()
        .resource_dir()
        .map_err(|error| format!("No se pudo resolver el runtime Qwen3-ASR: {error}"))
        .map(|path| {
            path.join("resources")
                .join("qwen3-asr")
                .join("runtime")
                .join(platform)
        })
}

#[cfg(target_os = "windows")]
fn runtime_files() -> (&'static str, &'static [&'static str]) {
    (
        "notia_qwen3_asr.dll",
        &[
            "notia_asr_ggml-base.dll",
            "notia_asr_ggml-cpu.dll",
            "notia_asr_ggml.dll",
            "notia_asr_ggml-vulkan.dll",
            "notia_asr_llama.dll",
            "notia_asr_mtmd.dll",
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::{PARTIAL_OVERLAP_SAMPLES, PARTIAL_WINDOW_SAMPLES, SAMPLE_RATE};

    #[test]
    fn partial_windows_keep_two_seconds_of_audio_context() {
        assert_eq!(PARTIAL_WINDOW_SAMPLES, SAMPLE_RATE * 12);
        assert_eq!(PARTIAL_OVERLAP_SAMPLES, SAMPLE_RATE * 2);
    }
}

#[cfg(target_os = "android")]
fn runtime_files() -> (&'static str, &'static [&'static str]) {
    (
        "libnotia_qwen3_asr.so",
        &[
            "libnotia_asr_ggml-base.so",
            "libnotia_asr_ggml-cpu.so",
            "libnotia_asr_ggml.so",
            "libnotia_asr_llama.so",
            "libnotia_asr_mtmd.so",
        ],
    )
}
