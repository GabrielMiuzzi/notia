#![cfg(any(target_os = "windows", target_os = "android"))]

//! Silero VAD through the sherpa-onnx C API. It tells when someone is
//! speaking and closes each utterance after a pause.

use crate::services::sherpa_runtime::LoadedSherpaLibrary;
use crate::services::speech_audio::SPEECH_SAMPLE_RATE;
use std::ffi::{c_char, c_void, CString};
use std::path::Path;

pub struct VadSettings {
    pub threshold: f32,
    pub min_silence_seconds: f32,
    pub min_speech_seconds: f32,
    pub max_speech_seconds: f32,
    pub window_samples: i32,
    pub buffer_seconds: f32,
}

/// Samples of the stream (counted since the last reset) that an utterance spans.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VoicedRange {
    pub start: i64,
    pub end: i64,
}

type Ptr = *const c_char;
// The structs below mirror `sherpa-onnx/c-api/c-api.h` of sherpa-onnx 1.13.4
// field by field. The TEN VAD family stays zeroed (null model).
#[repr(C)]
#[derive(Default)]
struct VadFamily {
    model: Ptr,
    threshold: f32,
    min_silence_duration: f32,
    min_speech_duration: f32,
    window_size: i32,
    max_speech_duration: f32,
}
#[repr(C)]
#[derive(Default)]
struct VadConfig {
    silero_vad: VadFamily,
    sample_rate: i32,
    num_threads: i32,
    provider: Ptr,
    debug: i32,
    ten_vad: VadFamily,
}
#[repr(C)]
struct SpeechSegment {
    start: i32,
    samples: *mut f32,
    n: i32,
}

struct Api {
    destroy: unsafe extern "C" fn(*const c_void),
    accept: unsafe extern "C" fn(*const c_void, *const f32, i32),
    empty: unsafe extern "C" fn(*const c_void) -> i32,
    detected: unsafe extern "C" fn(*const c_void) -> i32,
    front: unsafe extern "C" fn(*const c_void) -> *const SpeechSegment,
    pop: unsafe extern "C" fn(*const c_void),
    reset: unsafe extern "C" fn(*const c_void),
    destroy_segment: unsafe extern "C" fn(*const SpeechSegment),
    flush: unsafe extern "C" fn(*const c_void),
}

pub struct SileroVad {
    // Dropped after `vad` is destroyed (see `Drop`).
    _library: LoadedSherpaLibrary,
    vad: *const c_void,
    api: Api,
    _model: CString,
    _provider: CString,
}

impl SileroVad {
    pub fn load(runtime: &Path, model: &Path, settings: &VadSettings) -> Result<Self, String> {
        let model = CString::new(model.to_string_lossy().as_bytes())
            .map_err(|_| "Ruta del modelo Silero VAD invalida.".to_string())?;
        let provider = CString::new("cpu").expect("static provider");
        let library = unsafe { LoadedSherpaLibrary::load(runtime) }?;
        unsafe {
            let create = symbol::<unsafe extern "C" fn(*const VadConfig, f32) -> *const c_void>(
                &library,
                b"SherpaOnnxCreateVoiceActivityDetector\0",
            )?;
            let api = Api {
                destroy: symbol(&library, b"SherpaOnnxDestroyVoiceActivityDetector\0")?,
                accept: symbol(&library, b"SherpaOnnxVoiceActivityDetectorAcceptWaveform\0")?,
                empty: symbol(&library, b"SherpaOnnxVoiceActivityDetectorEmpty\0")?,
                detected: symbol(&library, b"SherpaOnnxVoiceActivityDetectorDetected\0")?,
                front: symbol(&library, b"SherpaOnnxVoiceActivityDetectorFront\0")?,
                pop: symbol(&library, b"SherpaOnnxVoiceActivityDetectorPop\0")?,
                reset: symbol(&library, b"SherpaOnnxVoiceActivityDetectorReset\0")?,
                destroy_segment: symbol(&library, b"SherpaOnnxDestroySpeechSegment\0")?,
                flush: symbol(&library, b"SherpaOnnxVoiceActivityDetectorFlush\0")?,
            };
            let config = VadConfig {
                silero_vad: VadFamily {
                    model: model.as_ptr(),
                    threshold: settings.threshold,
                    min_silence_duration: settings.min_silence_seconds,
                    min_speech_duration: settings.min_speech_seconds,
                    window_size: settings.window_samples,
                    max_speech_duration: settings.max_speech_seconds,
                },
                sample_rate: SPEECH_SAMPLE_RATE as i32,
                num_threads: 1,
                provider: provider.as_ptr(),
                ..VadConfig::default()
            };
            let vad = create(&config, settings.buffer_seconds);
            if vad.is_null() {
                return Err("sherpa-onnx no pudo crear Silero VAD.".into());
            }
            Ok(Self {
                _library: library,
                vad,
                api,
                _model: model,
                _provider: provider,
            })
        }
    }

    pub fn accept(&mut self, samples: &[f32]) -> Result<(), String> {
        let n = i32::try_from(samples.len()).map_err(|_| "Lote PCM demasiado grande.".to_string())?;
        unsafe { (self.api.accept)(self.vad, samples.as_ptr(), n) };
        Ok(())
    }

    /// Whether an utterance is in progress.
    pub fn speaking(&self) -> bool {
        unsafe { (self.api.detected)(self.vad) != 0 }
    }

    /// The oldest utterance closed and not taken yet. The caller keeps the
    /// audio itself; an empty segment comes back as `Some` with `start == end`.
    pub fn pop_closed(&mut self) -> Result<Option<VoicedRange>, String> {
        unsafe {
            if (self.api.empty)(self.vad) != 0 {
                return Ok(None);
            }
            let segment = (self.api.front)(self.vad);
            if segment.is_null() {
                return Err("Silero VAD devolvio un segmento invalido.".into());
            }
            let raw = &*segment;
            let start = i64::from(raw.start).max(0);
            let length = if raw.samples.is_null() { 0 } else { i64::from(raw.n.max(0)) };
            (self.api.destroy_segment)(segment);
            (self.api.pop)(self.vad);
            Ok(Some(VoicedRange { start, end: start + length }))
        }
    }

    /// Closes the utterance in progress, if any, so `pop_closed` returns it.
    pub fn flush(&mut self) {
        unsafe { (self.api.flush)(self.vad) };
    }

    pub fn reset(&mut self) {
        unsafe { (self.api.reset)(self.vad) };
    }
}

// The handle is exclusively owned and only used by the speech worker after a
// move between threads, an ownership model sherpa-onnx supports.
unsafe impl Send for SileroVad {}

impl Drop for SileroVad {
    fn drop(&mut self) {
        unsafe { (self.api.destroy)(self.vad) };
    }
}

unsafe fn symbol<T: Copy>(library: &LoadedSherpaLibrary, name: &[u8]) -> Result<T, String> {
    unsafe {
        library.get::<T>(name).map(|symbol| *symbol).map_err(|error| {
            format!("Falta simbolo sherpa {}: {error}", String::from_utf8_lossy(name))
        })
    }
}
