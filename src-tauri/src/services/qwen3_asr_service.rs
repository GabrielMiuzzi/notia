use crate::services::speech_audio::PcmBufferStats;
use crate::services::speech_worker::{RecognitionUpdate, StreamingRecognizer};
use libloading::Library;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::AppHandle;
#[cfg(not(debug_assertions))]
use tauri::Manager;

const SAMPLE_RATE: usize = 16_000;
const GPU_PARTIAL_INTERVAL_SAMPLES: usize = SAMPLE_RATE;
const MIN_PARTIAL_INTERVAL_SAMPLES: usize = SAMPLE_RATE * 3 / 2;
const DEFAULT_PARTIAL_INTERVAL_SAMPLES: usize = SAMPLE_RATE * 2;
const MODERATE_PARTIAL_INTERVAL_SAMPLES: usize = SAMPLE_RATE * 3;
const SLOW_PARTIAL_INTERVAL_SAMPLES: usize = SAMPLE_RATE * 4;
const MIN_DECODE_SAMPLES: usize = SAMPLE_RATE * 4 / 5;
// Qwen3-ASR is not a genuinely streaming model: every partial encodes the
// complete audio passed to it again. Keeping an utterance open indefinitely
// therefore makes CPU inference fall behind capture. Commit bounded segments
// and retain a short CPU overlap so long speech stays close to real time. GPU
// windows are longer and contiguous; decoding their boundary twice produced
// divergent duplicate phrases that cannot be reconciled reliably.
const CPU_MAX_UTTERANCE_SAMPLES: usize = SAMPLE_RATE * 6;
const CPU_ENDPOINT_OVERLAP_SAMPLES: usize = SAMPLE_RATE * 3 / 4;
const GPU_MAX_UTTERANCE_SAMPLES: usize = SAMPLE_RATE * 12;
const GPU_ENDPOINT_OVERLAP_SAMPLES: usize = 0;
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
type BackendLoadFn = unsafe extern "C" fn(*const c_char) -> *mut c_void;
type BackendDeviceByTypeFn = unsafe extern "C" fn(c_int) -> *mut c_void;

#[derive(Debug, Clone, Copy)]
enum InferenceReason {
    Partial,
    Endpoint,
    Final,
}

impl InferenceReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::Partial => "partial",
            Self::Endpoint => "endpoint",
            Self::Final => "final",
        }
    }
}

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
    has_new_speech_since_decode: bool,
    trailing_silence: usize,
    has_speech: bool,
    last_text: String,
    endpoint_overlap: Vec<f32>,
    partial_interval_samples: usize,
    capture_stats: PcmBufferStats,
    inference_count: u64,
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
    fn maximum_utterance_samples(&self) -> usize {
        maximum_utterance_samples(self.config.use_gpu, self.capture_stats.buffered_samples)
    }

    fn endpoint_overlap_samples(&self) -> usize {
        endpoint_overlap_samples(self.config.use_gpu)
    }

    pub fn load(app: &AppHandle, config: &Qwen3AsrModelConfig) -> Result<Self, String> {
        let config = config.clone();
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
        if config.use_gpu && !runtime_dir.join(vulkan_backend_name()).is_file() {
            return Err(
                "El runtime Qwen3-ASR instalado no incluye el backend Vulkan requerido para usar GPU. Reconstruilo con scripts/build-qwen3-asr-runtime.ps1 -Device gpu."
                    .to_string(),
            );
        }
        let mut loaded_dependencies = Vec::new();
        let mut gpu_device_available = !config.use_gpu;
        for dependency in dependencies {
            let path = runtime_dir.join(dependency);
            if path.is_file() {
                let loaded = unsafe { Library::new(&path) }
                    .map_err(|error| format!("No se pudo cargar {}: {error}", path.display()))?;
                if dependency == &ggml_backend_loader_name() {
                    let load_backend =
                        unsafe { loaded.get::<BackendLoadFn>(b"ggml_backend_load\0") }.map_err(
                            |error| {
                                format!("El runtime GGML no permite registrar backends: {error}")
                            },
                        )?;
                    let mut backend_names = vec![cpu_backend_name()];
                    if config.use_gpu {
                        backend_names.push(vulkan_backend_name());
                    }
                    for backend_name in backend_names {
                        let backend_path = path_to_cstring(&runtime_dir.join(backend_name))?;
                        if unsafe { load_backend(backend_path.as_ptr()) }.is_null() {
                            return Err(format!(
                                "No se pudo registrar el backend {backend_name} de Qwen3-ASR."
                            ));
                        }
                    }
                    if config.use_gpu {
                        let device_by_type = unsafe {
                            loaded.get::<BackendDeviceByTypeFn>(b"ggml_backend_dev_by_type\0")
                        }
                        .map_err(|error| {
                            format!("El runtime GGML no permite detectar la GPU: {error}")
                        })?;
                        // ggml_backend_dev_type: GPU=1, integrated GPU=2.
                        gpu_device_available = !(unsafe { device_by_type(1) }).is_null()
                            || !(unsafe { device_by_type(2) }).is_null();
                    }
                }
                loaded_dependencies.push(loaded);
            }
        }
        if !gpu_device_available {
            return Err(
                "Vulkan está instalado, pero llama.cpp no detectó una GPU compatible. Seleccioná CPU o actualizá el controlador gráfico."
                    .to_string(),
            );
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
            has_new_speech_since_decode: false,
            trailing_silence: 0,
            has_speech: false,
            last_text: String::new(),
            endpoint_overlap: Vec::new(),
            partial_interval_samples: if config.use_gpu {
                GPU_PARTIAL_INTERVAL_SAMPLES
            } else {
                DEFAULT_PARTIAL_INTERVAL_SAMPLES
            },
            capture_stats: PcmBufferStats::default(),
            inference_count: 0,
            config: config.clone(),
        })
    }

    pub fn matches(&self, config: &Qwen3AsrModelConfig) -> bool {
        self.config.model == config.model
            && self.config.mmproj == config.mmproj
            && self.config.language == config.language
            && self.config.use_gpu == config.use_gpu
    }

    fn decode_from(&mut self, start: usize, reason: InferenceReason) -> Result<String, String> {
        let samples = &self.utterance[start.min(self.utterance.len())..];
        if !self.has_speech || samples.len() < MIN_DECODE_SAMPLES {
            return Ok(String::new());
        }
        let audio_samples = samples.len();
        let started_at = Instant::now();
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
        let inference_ms = started_at.elapsed().as_secs_f64() * 1_000.0;
        self.inference_count = self.inference_count.saturating_add(1);
        let interval_before = self.partial_interval_samples;
        self.partial_interval_samples = next_partial_interval_samples(
            self.config.use_gpu,
            inference_ms,
            interval_before,
            self.capture_stats.buffered_samples,
        );
        log::info!(
            "[notia:speech:inference] sequence={} reason={} device={} audio_ms={} inference_ms={:.1} rtf={:.3} queue_ms={} dropped_samples={} next_partial_ms={}",
            self.inference_count,
            reason.as_str(),
            if self.config.use_gpu { "gpu" } else { "cpu" },
            samples_to_ms(audio_samples),
            inference_ms,
            inference_ms / samples_to_ms(audio_samples).max(1) as f64,
            samples_to_ms(self.capture_stats.buffered_samples),
            self.capture_stats.dropped_samples,
            samples_to_ms(self.partial_interval_samples),
        );
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
        let text = unsafe { CStr::from_ptr(output.as_ptr()) }
            .to_string_lossy()
            .trim()
            .to_string();
        Ok(if self.config.language == "es" {
            normalize_spanish_chunk_punctuation(&normalize_spanish_questions(&text))
        } else {
            text
        })
    }

    fn clear_utterance(&mut self) {
        self.utterance.clear();
        self.samples_since_decode = 0;
        self.has_new_speech_since_decode = false;
        self.trailing_silence = 0;
        self.has_speech = false;
        self.last_text.clear();
        self.endpoint_overlap.clear();
    }
}

impl StreamingRecognizer for Qwen3AsrRecognizer {
    fn update_capture_stats(&mut self, stats: PcmBufferStats) {
        self.capture_stats = stats;
    }

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
        let silence_endpoint = self.has_speech && self.trailing_silence >= ENDPOINT_SILENCE_SAMPLES;
        let forced_endpoint =
            self.has_speech && self.utterance.len() >= self.maximum_utterance_samples();
        let endpoint = silence_endpoint || forced_endpoint;
        if endpoint {
            self.samples_since_decode = 0;
            self.has_new_speech_since_decode = false;
            let decoded = self.decode_from(0, InferenceReason::Endpoint)?;
            if !decoded.is_empty() {
                self.last_text = decoded;
            }
            if forced_endpoint && !silence_endpoint {
                let overlap_start = self
                    .utterance
                    .len()
                    .saturating_sub(self.endpoint_overlap_samples());
                self.endpoint_overlap = self.utterance[overlap_start..].to_vec();
            }
        } else if self.samples_since_decode
            >= current_partial_interval_samples(
                self.config.use_gpu,
                self.partial_interval_samples,
                self.capture_stats.buffered_samples,
            )
            && self.has_new_speech_since_decode
        {
            self.samples_since_decode = 0;
            self.has_new_speech_since_decode = false;
            let decoded = self.decode_from(0, InferenceReason::Partial)?;
            // `speech_service` keeps confirmed text separately and treats
            // this field as the current utterance preview. Replacing the
            // preview avoids duplicating words when successive windows share
            // audio context.
            if !decoded.is_empty() {
                self.last_text = decoded;
            }
        }
        Ok(RecognitionUpdate {
            text: self.last_text.clone(),
            endpoint_detected: endpoint,
        })
    }

    fn finish(&mut self) -> Result<RecognitionUpdate, String> {
        let decoded = self.decode_from(0, InferenceReason::Final)?;
        if !decoded.is_empty() {
            self.last_text = decoded;
        }
        Ok(RecognitionUpdate {
            text: self.last_text.clone(),
            endpoint_detected: false,
        })
    }

    fn reset_after_endpoint(&mut self) -> Result<(), String> {
        let overlap = std::mem::take(&mut self.endpoint_overlap);
        self.clear_utterance();
        if !overlap.is_empty() {
            self.utterance = overlap;
            self.has_speech = true;
        }
        Ok(())
    }

    fn reset_session(&mut self) -> Result<(), String> {
        self.clear_utterance();
        self.partial_interval_samples = if self.config.use_gpu {
            GPU_PARTIAL_INTERVAL_SAMPLES
        } else {
            DEFAULT_PARTIAL_INTERVAL_SAMPLES
        };
        self.capture_stats = PcmBufferStats::default();
        self.inference_count = 0;
        Ok(())
    }
}

fn adaptive_partial_interval_samples(
    inference_ms: f64,
    previous_interval_samples: usize,
    buffered_samples: usize,
) -> usize {
    let previous_interval_ms = samples_to_ms(previous_interval_samples).max(1) as f64;
    let utilization = inference_ms / previous_interval_ms;
    let preferred = if utilization <= 0.30 {
        MIN_PARTIAL_INTERVAL_SAMPLES
    } else if utilization <= 0.60 {
        DEFAULT_PARTIAL_INTERVAL_SAMPLES
    } else if utilization <= 0.85 {
        MODERATE_PARTIAL_INTERVAL_SAMPLES
    } else if utilization <= 1.0 {
        SLOW_PARTIAL_INTERVAL_SAMPLES
    } else {
        CPU_MAX_UTTERANCE_SAMPLES
    };
    effective_partial_interval_samples(preferred, buffered_samples)
}

fn next_partial_interval_samples(
    use_gpu: bool,
    inference_ms: f64,
    previous_interval_samples: usize,
    buffered_samples: usize,
) -> usize {
    if use_gpu && buffered_samples < SAMPLE_RATE / 2 {
        GPU_PARTIAL_INTERVAL_SAMPLES
    } else {
        adaptive_partial_interval_samples(inference_ms, previous_interval_samples, buffered_samples)
    }
}

fn effective_partial_interval_samples(preferred: usize, buffered_samples: usize) -> usize {
    let backlog_floor = if buffered_samples >= SAMPLE_RATE * 3 {
        CPU_MAX_UTTERANCE_SAMPLES
    } else if buffered_samples >= SAMPLE_RATE {
        SLOW_PARTIAL_INTERVAL_SAMPLES
    } else if buffered_samples >= SAMPLE_RATE / 2 {
        MODERATE_PARTIAL_INTERVAL_SAMPLES
    } else {
        MIN_PARTIAL_INTERVAL_SAMPLES
    };
    preferred.max(backlog_floor).min(CPU_MAX_UTTERANCE_SAMPLES)
}

fn current_partial_interval_samples(
    use_gpu: bool,
    preferred: usize,
    buffered_samples: usize,
) -> usize {
    if use_gpu && buffered_samples < SAMPLE_RATE / 2 {
        preferred
    } else {
        effective_partial_interval_samples(preferred, buffered_samples)
    }
}

fn maximum_utterance_samples(use_gpu: bool, buffered_samples: usize) -> usize {
    if use_gpu && buffered_samples < SAMPLE_RATE {
        GPU_MAX_UTTERANCE_SAMPLES
    } else {
        CPU_MAX_UTTERANCE_SAMPLES
    }
}

fn endpoint_overlap_samples(use_gpu: bool) -> usize {
    if use_gpu {
        GPU_ENDPOINT_OVERLAP_SAMPLES
    } else {
        CPU_ENDPOINT_OVERLAP_SAMPLES
    }
}

fn samples_to_ms(samples: usize) -> u64 {
    ((samples as u128 * 1_000) / SAMPLE_RATE as u128).min(u128::from(u64::MAX)) as u64
}

fn path_to_cstring(path: &Path) -> Result<CString, String> {
    CString::new(path.to_string_lossy().as_bytes())
        .map_err(|_| "La ruta del modelo Qwen3-ASR no es válida.".to_string())
}

fn normalize_spanish_questions(text: &str) -> String {
    const QUESTION_STARTERS: &[&str] = &[
        "acaso", "adonde", "adónde", "como", "cómo", "cual", "cuál", "cuando", "cuándo", "cuanto",
        "cuánto", "donde", "dónde", "es", "esta", "está", "estan", "están", "hay", "puede",
        "pueden", "podria", "podría", "podrian", "podrían", "por", "que", "qué", "quien", "quién",
        "quiere", "quieren", "tiene", "tienen",
    ];

    let mut normalized = text.to_string();
    let mut search_from = 0;
    while let Some(relative_end) = normalized[search_from..].find('?') {
        let question_end = search_from + relative_end;
        let clause_start = normalized[..question_end]
            .char_indices()
            .rev()
            .find(|(_, character)| matches!(character, '.' | '!' | '?' | '\n'))
            .map_or(0, |(index, character)| index + character.len_utf8());
        let leading_whitespace = normalized[clause_start..question_end]
            .find(|character: char| !character.is_whitespace())
            .map_or(question_end, |offset| clause_start + offset);
        if normalized[leading_whitespace..question_end].contains('¿') {
            search_from = question_end + 1;
            continue;
        }

        let mut insertion = None;
        for (offset, word) in word_spans(&normalized[leading_whitespace..question_end]) {
            let index = leading_whitespace + offset;
            let starts_uppercase = word.chars().next().is_some_and(char::is_uppercase);
            let lowercase_word = word.to_lowercase();
            let is_question_starter = QUESTION_STARTERS
                .iter()
                .any(|starter| lowercase_word == *starter);
            if index > leading_whitespace && starts_uppercase && is_question_starter {
                insertion = Some(index);
            }
        }

        if let Some(index) = insertion {
            let whitespace_start = normalized[..index]
                .char_indices()
                .rev()
                .take_while(|(_, character)| character.is_whitespace())
                .last()
                .map_or(index, |(position, _)| position);
            normalized.replace_range(whitespace_start..index, ". ¿");
            search_from = question_end + 4;
        } else {
            normalized.insert(leading_whitespace, '¿');
            search_from = question_end + 3;
        }
    }
    normalized
}

fn normalize_spanish_chunk_punctuation(text: &str) -> String {
    const COMMA_CONNECTORS: &[&str] = &["aunque", "pero", "porque", "pues", "sino"];
    let mut normalized = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(relative_period) = text[cursor..].find('.') {
        let period = cursor + relative_period;
        normalized.push_str(&text[cursor..period]);
        let after_period = period + 1;
        let Some(relative_next) =
            text[after_period..].find(|character: char| !character.is_whitespace())
        else {
            normalized.push('.');
            cursor = after_period;
            break;
        };
        let next = after_period + relative_next;
        let next_character = text[next..].chars().next();
        if !next_character.is_some_and(char::is_lowercase) {
            normalized.push('.');
            cursor = after_period;
            continue;
        }
        let next_word = word_spans(&text[next..])
            .first()
            .map(|(_, word)| word.to_lowercase())
            .unwrap_or_default();
        if COMMA_CONNECTORS.contains(&next_word.as_str()) {
            normalized.push(',');
        }
        cursor = after_period;
    }
    normalized.push_str(&text[cursor..]);
    normalized
}

fn word_spans(text: &str) -> Vec<(usize, &str)> {
    let mut spans = Vec::new();
    let mut word_start = None;
    for (index, character) in text.char_indices() {
        if character.is_alphanumeric() {
            word_start.get_or_insert(index);
        } else if let Some(start) = word_start.take() {
            spans.push((start, &text[start..index]));
        }
    }
    if let Some(start) = word_start {
        spans.push((start, &text[start..]));
    }
    spans
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
fn ggml_backend_loader_name() -> &'static str {
    "notia_asr_ggml.dll"
}

#[cfg(target_os = "android")]
fn ggml_backend_loader_name() -> &'static str {
    "libnotia_asr_ggml.so"
}

#[cfg(target_os = "windows")]
fn cpu_backend_name() -> &'static str {
    "notia_asr_ggml-cpu.dll"
}

#[cfg(target_os = "android")]
fn cpu_backend_name() -> &'static str {
    "libnotia_asr_ggml-cpu.so"
}

#[cfg(target_os = "windows")]
fn vulkan_backend_name() -> &'static str {
    "notia_asr_ggml-vulkan.dll"
}

#[cfg(target_os = "android")]
fn vulkan_backend_name() -> &'static str {
    "libnotia_asr_ggml-vulkan.so"
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
    use super::{
        adaptive_partial_interval_samples, current_partial_interval_samples,
        effective_partial_interval_samples, endpoint_overlap_samples, maximum_utterance_samples,
        next_partial_interval_samples, normalize_spanish_chunk_punctuation,
        normalize_spanish_questions, CPU_ENDPOINT_OVERLAP_SAMPLES, CPU_MAX_UTTERANCE_SAMPLES,
        DEFAULT_PARTIAL_INTERVAL_SAMPLES, GPU_ENDPOINT_OVERLAP_SAMPLES, GPU_MAX_UTTERANCE_SAMPLES,
        GPU_PARTIAL_INTERVAL_SAMPLES, MIN_PARTIAL_INTERVAL_SAMPLES,
        MODERATE_PARTIAL_INTERVAL_SAMPLES, SAMPLE_RATE, SLOW_PARTIAL_INTERVAL_SAMPLES,
    };

    #[test]
    fn long_utterances_are_bounded_with_boundary_context() {
        assert_eq!(maximum_utterance_samples(false, 0), SAMPLE_RATE * 6);
        assert_eq!(endpoint_overlap_samples(false), SAMPLE_RATE * 3 / 4);
        assert_eq!(maximum_utterance_samples(true, 0), SAMPLE_RATE * 12);
        assert_eq!(
            maximum_utterance_samples(true, SAMPLE_RATE),
            SAMPLE_RATE * 6
        );
        assert_eq!(endpoint_overlap_samples(true), 0);
        assert!(CPU_ENDPOINT_OVERLAP_SAMPLES < CPU_MAX_UTTERANCE_SAMPLES);
        assert!(GPU_ENDPOINT_OVERLAP_SAMPLES < GPU_MAX_UTTERANCE_SAMPLES);
    }

    #[test]
    fn adds_the_opening_mark_to_spanish_questions() {
        assert_eq!(
            normalize_spanish_questions("Tiene usted un sistema de ahorro de agua?"),
            "¿Tiene usted un sistema de ahorro de agua?"
        );
    }

    #[test]
    fn separates_a_capitalized_question_detected_inside_a_transcript() {
        assert_eq!(
            normalize_spanish_questions(
                "Lo utilizo para regar las plantas y no consumir agua Tiene usted un sistema de ahorro de agua? Sí."
            ),
            "Lo utilizo para regar las plantas y no consumir agua. ¿Tiene usted un sistema de ahorro de agua? Sí."
        );
    }

    #[test]
    fn preserves_questions_that_are_already_well_formed() {
        assert_eq!(
            normalize_spanish_questions("¿Cómo está? Bien."),
            "¿Cómo está? Bien."
        );
    }

    #[test]
    fn adaptive_partials_speed_up_when_inference_has_headroom() {
        assert_eq!(
            adaptive_partial_interval_samples(400.0, DEFAULT_PARTIAL_INTERVAL_SAMPLES, 0),
            MIN_PARTIAL_INTERVAL_SAMPLES
        );
    }

    #[test]
    fn gpu_streams_each_second_while_capture_has_no_backlog() {
        assert_eq!(
            next_partial_interval_samples(true, 150.0, DEFAULT_PARTIAL_INTERVAL_SAMPLES, 0),
            GPU_PARTIAL_INTERVAL_SAMPLES
        );
        assert_eq!(
            current_partial_interval_samples(true, GPU_PARTIAL_INTERVAL_SAMPLES, 0),
            GPU_PARTIAL_INTERVAL_SAMPLES
        );
        assert_eq!(
            next_partial_interval_samples(
                true,
                150.0,
                GPU_PARTIAL_INTERVAL_SAMPLES,
                SAMPLE_RATE / 2
            ),
            MODERATE_PARTIAL_INTERVAL_SAMPLES
        );
    }

    #[test]
    fn adaptive_partials_back_off_when_inference_is_too_slow() {
        assert_eq!(
            adaptive_partial_interval_samples(2_100.0, DEFAULT_PARTIAL_INTERVAL_SAMPLES, 0),
            CPU_MAX_UTTERANCE_SAMPLES
        );
    }

    #[test]
    fn capture_backlog_overrides_an_aggressive_partial_interval() {
        assert_eq!(
            effective_partial_interval_samples(MIN_PARTIAL_INTERVAL_SAMPLES, SAMPLE_RATE / 2),
            MODERATE_PARTIAL_INTERVAL_SAMPLES
        );
        assert_eq!(
            effective_partial_interval_samples(MIN_PARTIAL_INTERVAL_SAMPLES, SAMPLE_RATE),
            SLOW_PARTIAL_INTERVAL_SAMPLES
        );
        assert_eq!(
            effective_partial_interval_samples(MIN_PARTIAL_INTERVAL_SAMPLES, SAMPLE_RATE * 3),
            CPU_MAX_UTTERANCE_SAMPLES
        );
    }

    #[test]
    fn removes_false_periods_before_lowercase_chunk_continuations() {
        assert_eq!(
            normalize_spanish_chunk_punctuation(
                "preguntas sobre el ahorro. y contaminación del agua."
            ),
            "preguntas sobre el ahorro y contaminación del agua."
        );
        assert_eq!(
            normalize_spanish_chunk_punctuation(
                "Hay muchos factores. pero sobre todo está el ser humano."
            ),
            "Hay muchos factores, pero sobre todo está el ser humano."
        );
    }
}

#[cfg(target_os = "android")]
fn runtime_files() -> (&'static str, &'static [&'static str]) {
    (
        "libnotia_qwen3_asr.so",
        &[
            "libnotia_asr_ggml-base.so",
            "libnotia_asr_ggml-cpu.so",
            "libnotia_asr_ggml-vulkan.so",
            "libnotia_asr_ggml.so",
            "libnotia_asr_llama.so",
            "libnotia_asr_mtmd.so",
        ],
    )
}
