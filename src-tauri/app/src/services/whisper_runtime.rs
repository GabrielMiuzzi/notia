#![cfg(any(target_os = "windows", target_os = "android"))]

//! whisper.cpp through Notia's C bridge (`resources/whisper/runtime`). The
//! bridge loads the ggml backends by path: on Windows the Vulkan one when the
//! system has a Vulkan driver, otherwise and on Android the CPU one.

use crate::host::AppHandle;
#[cfg(all(target_os = "windows", not(debug_assertions)))]
use crate::host::Manager;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
const RUNTIME_RELATIVE_PATH: &str = "resources/whisper/runtime/windows-x86_64/notia_whisper.dll";
#[cfg(target_os = "android")]
const ANDROID_RUNTIME_LIBRARY_NAME: &str = "libnotia_whisper.so";
const LOAD_ERROR_CAPACITY: usize = 512;

type LoadFn = unsafe extern "C" fn(*const c_char, *const c_char, c_int, c_int, *mut c_char, usize) -> *mut c_void;
type LoadAlignedFn =
    unsafe extern "C" fn(*const c_char, *const c_char, c_int, c_int, *const c_char, *mut c_char, usize) -> *mut c_void;
type FreeFn = unsafe extern "C" fn(*mut c_void);
type BackendFn = unsafe extern "C" fn(*const c_void) -> *const c_char;
type LanguageSupportedFn = unsafe extern "C" fn(*const c_char) -> c_int;
type TranscribeFn =
    unsafe extern "C" fn(*mut c_void, *const f32, c_int, *const c_char, *const c_char, c_int) -> *const c_char;
type LastErrorFn = unsafe extern "C" fn(*const c_void) -> *const c_char;

/// The bridge library, resolved only from the packaged resources (Windows)
/// or the APK's native libraries (Android).
pub fn runtime_path(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Ok(PathBuf::from(ANDROID_RUNTIME_LIBRARY_NAME))
    }
    #[cfg(all(target_os = "windows", debug_assertions))]
    {
        let _ = app;
        Ok(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/..")).join(RUNTIME_RELATIVE_PATH))
    }
    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    {
        Ok(app
            .path()
            .resource_dir()
            .map_err(|error| format!("No se pudo resolver el directorio de recursos: {error}"))?
            .join(RUNTIME_RELATIVE_PATH))
    }
}

pub struct WhisperEngine {
    engine: *mut c_void,
    free: FreeFn,
    transcribe: TranscribeFn,
    /// Missing in a bridge built before word timestamps.
    transcribe_timed: Option<TranscribeFn>,
    last_error: LastErrorFn,
    backend: String,
    // Dropped last: the function pointers above live in it.
    library: libloading::Library,
}

impl WhisperEngine {
    /// Loads the bridge at `runtime` and the model. `use_gpu` asks for the
    /// Vulkan backend; without one the model runs on the CPU.
    pub fn load(runtime: &Path, model: &Path, use_gpu: bool, threads: i32) -> Result<Self, String> {
        Self::load_with(runtime, model, use_gpu, threads, None)
    }

    /// Like `load`, with the DTW alignment heads of `alignment`
    /// ("large-v3" or "large-v3-turbo"): `transcribe_timed` then gives the
    /// aligned start of each token. Without flash attention, which whisper.cpp
    /// does not combine with DTW.
    #[cfg_attr(target_os = "android", allow(dead_code))]
    pub fn load_aligned(runtime: &Path, model: &Path, use_gpu: bool, threads: i32, alignment: &str) -> Result<Self, String> {
        let alignment = CString::new(alignment).map_err(|_| "Modelo de alineacion de Whisper invalido.".to_string())?;
        Self::load_with(runtime, model, use_gpu, threads, Some(&alignment))
    }

    fn load_with(runtime: &Path, model: &Path, use_gpu: bool, threads: i32, alignment: Option<&CStr>) -> Result<Self, String> {
        // Android resolves the bridge and its backends by library name inside
        // the APK. Windows loads them by fully qualified path, without `..`
        // or forward slashes, as the DLL folder search requires.
        #[cfg(target_os = "windows")]
        let runtime = &std::path::absolute(runtime)
            .map_err(|error| format!("Ruta del runtime whisper.cpp invalida: {error}"))?;
        let library = load_library(runtime)?;
        let model_path = path_string(model)?;
        let backend_directory = if cfg!(target_os = "android") {
            CString::default()
        } else {
            path_string(runtime.parent().unwrap_or(Path::new("")))?
        };
        unsafe {
            let free: FreeFn = symbol(&library, b"notia_whisper_free\0")?;
            let backend: BackendFn = symbol(&library, b"notia_whisper_backend\0")?;
            let transcribe: TranscribeFn = symbol(&library, b"notia_whisper_transcribe\0")?;
            let transcribe_timed: Option<TranscribeFn> = symbol(&library, b"notia_whisper_transcribe_timed\0").ok();
            let last_error: LastErrorFn = symbol(&library, b"notia_whisper_last_error\0")?;
            let mut error = [0 as c_char; LOAD_ERROR_CAPACITY];
            let engine = match alignment {
                None => {
                    let load: LoadFn = symbol(&library, b"notia_whisper_load\0")?;
                    load(model_path.as_ptr(), backend_directory.as_ptr(), c_int::from(use_gpu), threads, error.as_mut_ptr(), error.len())
                }
                Some(alignment) => {
                    let load: LoadAlignedFn = symbol(&library, b"notia_whisper_load_aligned\0")?;
                    load(
                        model_path.as_ptr(),
                        backend_directory.as_ptr(),
                        c_int::from(use_gpu),
                        threads,
                        alignment.as_ptr(),
                        error.as_mut_ptr(),
                        error.len(),
                    )
                }
            };
            if engine.is_null() {
                let message = CStr::from_ptr(error.as_ptr()).to_string_lossy().into_owned();
                return Err(if message.is_empty() {
                    "whisper.cpp no pudo cargar el modelo.".to_string()
                } else {
                    message
                });
            }
            let backend = read_string(backend(engine));
            Ok(Self {
                engine,
                free,
                transcribe,
                transcribe_timed,
                last_error,
                backend,
                library,
            })
        }
    }

    /// The device the model runs on: the GPU's description or "CPU".
    pub fn backend(&self) -> &str {
        &self.backend
    }

    pub fn uses_gpu(&self) -> bool {
        self.backend != "CPU"
    }

    /// Whether whisper.cpp knows `language` ("auto" detects it per decode).
    pub fn supports_language(&self, language: &CStr) -> Result<bool, String> {
        unsafe {
            let supported: LanguageSupportedFn = symbol(&self.library, b"notia_whisper_language_supported\0")?;
            Ok(supported(language.as_ptr()) != 0)
        }
    }

    /// Text of 16 kHz mono `samples` (at most one 30-second window). `prompt`
    /// is earlier text that steers spelling and punctuation; `beam_size` 1
    /// decodes greedily.
    pub fn transcribe(&mut self, samples: &[f32], language: &CStr, prompt: &str, beam_size: i32) -> Result<String, String> {
        let transcribe = self.transcribe;
        self.call(transcribe, samples, language, prompt, beam_size)
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Whether the bridge gives the time of each word.
    #[cfg_attr(target_os = "android", allow(dead_code))]
    pub fn has_word_times(&self) -> bool {
        self.transcribe_timed.is_some()
    }

    /// The timed tokens of `samples`, one `start\tend\ttext` line each (see
    /// `timed_transcript::words_from_timed_tokens`), as raw bytes: a token
    /// may hold half of a letter.
    pub fn transcribe_timed(&mut self, samples: &[f32], language: &CStr, prompt: &str, beam_size: i32) -> Result<Vec<u8>, String> {
        let transcribe = self.transcribe_timed.ok_or_else(|| "El runtime whisper.cpp no da los tiempos de las palabras.".to_string())?;
        self.call(transcribe, samples, language, prompt, beam_size)
    }

    fn call(&mut self, transcribe: TranscribeFn, samples: &[f32], language: &CStr, prompt: &str, beam_size: i32) -> Result<Vec<u8>, String> {
        let count = c_int::try_from(samples.len()).map_err(|_| "El audio a transcribir es demasiado largo.".to_string())?;
        // A prompt never holds NUL bytes; if it did, it is dropped, not the decode.
        let prompt = CString::new(prompt).unwrap_or_default();
        unsafe {
            let text = transcribe(
                self.engine,
                samples.as_ptr(),
                count,
                language.as_ptr(),
                prompt.as_ptr(),
                beam_size,
            );
            if text.is_null() {
                let message = read_string((self.last_error)(self.engine));
                return Err(if message.is_empty() {
                    "whisper.cpp no pudo transcribir el audio.".to_string()
                } else {
                    message
                });
            }
            Ok(CStr::from_ptr(text).to_bytes().to_vec())
        }
    }
}

// The context is exclusively owned and only used by the speech worker after a
// move between threads; whisper.cpp only forbids concurrent use.
unsafe impl Send for WhisperEngine {}

impl Drop for WhisperEngine {
    fn drop(&mut self) {
        unsafe { (self.free)(self.engine) };
    }
}

fn load_library(path: &Path) -> Result<libloading::Library, String> {
    #[cfg(target_os = "windows")]
    let library = {
        use libloading::os::windows::{
            Library as WindowsLibrary, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
        };
        // Its ggml and whisper libraries load from the bridge's own folder,
        // never from PATH or the folder of another ggml runtime.
        let flags = LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS;
        unsafe { WindowsLibrary::load_with_flags(path, flags) }.map(Into::into)
    };
    #[cfg(not(target_os = "windows"))]
    let library = unsafe { libloading::Library::new(path) };
    library.map_err(|error| format!("No se pudo cargar el runtime whisper.cpp: {error}"))
}

unsafe fn symbol<T: Copy>(library: &libloading::Library, name: &[u8]) -> Result<T, String> {
    unsafe {
        library.get::<T>(name).map(|symbol| *symbol).map_err(|error| {
            format!("Falta el simbolo {} del runtime whisper.cpp: {error}", String::from_utf8_lossy(name))
        })
    }
}

unsafe fn read_string(value: *const c_char) -> String {
    if value.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(value) }.to_string_lossy().into_owned()
}

fn path_string(path: &Path) -> Result<CString, String> {
    CString::new(path.to_string_lossy().as_bytes()).map_err(|_| "Ruta del modelo de voz invalida.".to_string())
}
