#![cfg(any(target_os = "windows", target_os = "android"))]

use crate::services::speech_audio::SPEECH_SAMPLE_RATE;
use crate::services::speech_worker::{RecognitionUpdate, StreamingRecognizer};
use std::collections::VecDeque;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::{Path, PathBuf};

const VAD_PRE_SPEECH_SAMPLES: usize = SPEECH_SAMPLE_RATE as usize / 4;
const VAD_HISTORY_SAMPLES: usize = SPEECH_SAMPLE_RATE as usize * 30;

pub struct OfflineNemoTransducerConfig {
    pub encoder: PathBuf,
    pub decoder: PathBuf,
    pub joiner: PathBuf,
    pub tokens: PathBuf,
    pub vad: PathBuf,
    pub num_threads: i32,
}

type Ptr = *const c_char;
#[repr(C)]
#[derive(Default)]
struct Feature {
    sample_rate: i32,
    feature_dim: i32,
}
#[repr(C)]
#[derive(Default)]
struct Transducer {
    encoder: Ptr,
    decoder: Ptr,
    joiner: Ptr,
}
#[repr(C)]
#[derive(Default)]
struct One {
    model: Ptr,
}
#[repr(C)]
#[derive(Default)]
struct Whisper {
    encoder: Ptr,
    decoder: Ptr,
    language: Ptr,
    task: Ptr,
    tail_paddings: i32,
    enable_token_timestamps: i32,
    enable_segment_timestamps: i32,
}
#[repr(C)]
#[derive(Default)]
struct Canary {
    encoder: Ptr,
    decoder: Ptr,
    src_lang: Ptr,
    tgt_lang: Ptr,
    use_pnc: i32,
}
#[repr(C)]
#[derive(Default)]
struct Cohere {
    encoder: Ptr,
    decoder: Ptr,
    language: Ptr,
    use_punct: i32,
    use_itn: i32,
}
#[repr(C)]
#[derive(Default)]
struct Two {
    encoder: Ptr,
    decoder: Ptr,
}
#[repr(C)]
#[derive(Default)]
struct Moonshine {
    preprocessor: Ptr,
    encoder: Ptr,
    uncached_decoder: Ptr,
    cached_decoder: Ptr,
    merged_decoder: Ptr,
}
#[repr(C)]
#[derive(Default)]
struct Lm {
    model: Ptr,
    scale: f32,
}
#[repr(C)]
#[derive(Default)]
struct Sense {
    model: Ptr,
    language: Ptr,
    use_itn: i32,
}
#[repr(C)]
#[derive(Default)]
struct FunAsr {
    encoder_adaptor: Ptr,
    llm: Ptr,
    embedding: Ptr,
    tokenizer: Ptr,
    system_prompt: Ptr,
    user_prompt: Ptr,
    max_new_tokens: i32,
    temperature: f32,
    top_p: f32,
    seed: i32,
    language: Ptr,
    itn: i32,
    hotwords: Ptr,
}
#[repr(C)]
#[derive(Default)]
struct Qwen {
    conv_frontend: Ptr,
    encoder: Ptr,
    decoder: Ptr,
    tokenizer: Ptr,
    max_total_len: i32,
    max_new_tokens: i32,
    temperature: f32,
    top_p: f32,
    seed: i32,
    hotwords: Ptr,
}
#[repr(C)]
#[derive(Default)]
struct Homophone {
    dict_dir: Ptr,
    lexicon: Ptr,
    rule_fsts: Ptr,
}

#[repr(C)]
#[derive(Default)]
struct OfflineModel {
    transducer: Transducer,
    paraformer: One,
    nemo_ctc: One,
    whisper: Whisper,
    tdnn: One,
    tokens: Ptr,
    num_threads: i32,
    debug: i32,
    provider: Ptr,
    model_type: Ptr,
    modeling_unit: Ptr,
    bpe_vocab: Ptr,
    telespeech_ctc: Ptr,
    sense_voice: Sense,
    moonshine: Moonshine,
    fire_red_asr: Two,
    dolphin: One,
    zipformer_ctc: One,
    canary: Canary,
    wenet_ctc: One,
    omnilingual: One,
    medasr: One,
    funasr_nano: FunAsr,
    fire_red_asr_ctc: One,
    qwen3_asr: Qwen,
    cohere_transcribe: Cohere,
}

#[repr(C)]
#[derive(Default)]
struct OfflineConfig {
    feat_config: Feature,
    model_config: OfflineModel,
    lm_config: Lm,
    decoding_method: Ptr,
    max_active_paths: i32,
    hotwords_file: Ptr,
    hotwords_score: f32,
    rule_fsts: Ptr,
    rule_fars: Ptr,
    blank_penalty: f32,
    hr: Homophone,
}

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
    _start: i32,
    samples: *mut f32,
    n: i32,
}
#[repr(C)]
struct OfflineResult {
    text: Ptr,
}

struct Strings {
    encoder: CString,
    decoder: CString,
    joiner: CString,
    tokens: CString,
    vad: CString,
    cpu: CString,
    model_type: CString,
    decoding: CString,
}

pub struct OfflineVadRecognizer {
    _library: crate::services::sherpa_runtime::LoadedSherpaLibrary,
    recognizer: *const c_void,
    vad: *const c_void,
    api: Api,
    _strings: Strings,
    audio_history: VecDeque<f32>,
    history_start_sample: i64,
}

struct Api {
    destroy_recognizer: unsafe extern "C" fn(*const c_void),
    create_stream: unsafe extern "C" fn(*const c_void) -> *const c_void,
    destroy_stream: unsafe extern "C" fn(*const c_void),
    accept_offline: unsafe extern "C" fn(*const c_void, i32, *const f32, i32),
    decode: unsafe extern "C" fn(*const c_void, *const c_void),
    get_result: unsafe extern "C" fn(*const c_void) -> *const OfflineResult,
    destroy_result: unsafe extern "C" fn(*const OfflineResult),
    destroy_vad: unsafe extern "C" fn(*const c_void),
    vad_accept: unsafe extern "C" fn(*const c_void, *const f32, i32),
    vad_empty: unsafe extern "C" fn(*const c_void) -> i32,
    vad_front: unsafe extern "C" fn(*const c_void) -> *const SpeechSegment,
    vad_pop: unsafe extern "C" fn(*const c_void),
    vad_reset: unsafe extern "C" fn(*const c_void),
    destroy_segment: unsafe extern "C" fn(*const SpeechSegment),
    vad_flush: unsafe extern "C" fn(*const c_void),
}

impl OfflineVadRecognizer {
    pub fn load(runtime: &Path, model: &OfflineNemoTransducerConfig) -> Result<Self, String> {
        if !(1..=4).contains(&model.num_threads) {
            return Err("Cantidad de threads ASR invalida.".into());
        }
        let strings = Strings {
            encoder: path_string(&model.encoder)?,
            decoder: path_string(&model.decoder)?,
            joiner: path_string(&model.joiner)?,
            tokens: path_string(&model.tokens)?,
            vad: path_string(&model.vad)?,
            cpu: CString::new("cpu").unwrap(),
            model_type: CString::new("nemo_transducer").unwrap(),
            decoding: CString::new("greedy_search").unwrap(),
        };
        let library =
            unsafe { crate::services::sherpa_runtime::LoadedSherpaLibrary::load(runtime) }?;
        unsafe {
            let create_recognizer = symbol::<
                unsafe extern "C" fn(*const OfflineConfig) -> *const c_void,
            >(&library, b"SherpaOnnxCreateOfflineRecognizer\0")?;
            let create_vad = symbol::<unsafe extern "C" fn(*const VadConfig, f32) -> *const c_void>(
                &library,
                b"SherpaOnnxCreateVoiceActivityDetector\0",
            )?;
            let api = Api {
                destroy_recognizer: symbol(&library, b"SherpaOnnxDestroyOfflineRecognizer\0")?,
                create_stream: symbol(&library, b"SherpaOnnxCreateOfflineStream\0")?,
                destroy_stream: symbol(&library, b"SherpaOnnxDestroyOfflineStream\0")?,
                accept_offline: symbol(&library, b"SherpaOnnxAcceptWaveformOffline\0")?,
                decode: symbol(&library, b"SherpaOnnxDecodeOfflineStream\0")?,
                get_result: symbol(&library, b"SherpaOnnxGetOfflineStreamResult\0")?,
                destroy_result: symbol(&library, b"SherpaOnnxDestroyOfflineRecognizerResult\0")?,
                destroy_vad: symbol(&library, b"SherpaOnnxDestroyVoiceActivityDetector\0")?,
                vad_accept: symbol(&library, b"SherpaOnnxVoiceActivityDetectorAcceptWaveform\0")?,
                vad_empty: symbol(&library, b"SherpaOnnxVoiceActivityDetectorEmpty\0")?,
                vad_front: symbol(&library, b"SherpaOnnxVoiceActivityDetectorFront\0")?,
                vad_pop: symbol(&library, b"SherpaOnnxVoiceActivityDetectorPop\0")?,
                vad_reset: symbol(&library, b"SherpaOnnxVoiceActivityDetectorReset\0")?,
                destroy_segment: symbol(&library, b"SherpaOnnxDestroySpeechSegment\0")?,
                vad_flush: symbol(&library, b"SherpaOnnxVoiceActivityDetectorFlush\0")?,
            };
            let mut config = OfflineConfig::default();
            config.feat_config = Feature {
                sample_rate: SPEECH_SAMPLE_RATE as i32,
                feature_dim: 80,
            };
            config.model_config.transducer = Transducer {
                encoder: strings.encoder.as_ptr(),
                decoder: strings.decoder.as_ptr(),
                joiner: strings.joiner.as_ptr(),
            };
            config.model_config.tokens = strings.tokens.as_ptr();
            config.model_config.num_threads = model.num_threads;
            config.model_config.provider = strings.cpu.as_ptr();
            config.model_config.model_type = strings.model_type.as_ptr();
            config.decoding_method = strings.decoding.as_ptr();
            config.max_active_paths = 4;
            let recognizer = create_recognizer(&config);
            if recognizer.is_null() {
                return Err("Sherpa no pudo crear OfflineRecognizer para Parakeet TDT.".into());
            }
            let mut vad_config = VadConfig::default();
            vad_config.silero_vad = VadFamily {
                model: strings.vad.as_ptr(),
                threshold: 0.5,
                min_silence_duration: 0.5,
                min_speech_duration: 0.25,
                window_size: 512,
                max_speech_duration: 20.0,
            };
            vad_config.sample_rate = SPEECH_SAMPLE_RATE as i32;
            vad_config.num_threads = 1;
            vad_config.provider = strings.cpu.as_ptr();
            let vad = create_vad(&vad_config, 30.0);
            if vad.is_null() {
                (api.destroy_recognizer)(recognizer);
                return Err("Sherpa no pudo crear Silero VAD.".into());
            }
            Ok(Self {
                _library: library,
                recognizer,
                vad,
                api,
                _strings: strings,
                audio_history: VecDeque::with_capacity(VAD_HISTORY_SAMPLES),
                history_start_sample: 0,
            })
        }
    }

    fn drain_segments(&mut self) -> Result<String, String> {
        let mut texts = Vec::new();
        unsafe {
            while (self.api.vad_empty)(self.vad) == 0 {
                let segment = (self.api.vad_front)(self.vad);
                if segment.is_null() {
                    return Err("Silero VAD devolvio un segmento invalido.".into());
                }
                let raw = &*segment;
                if raw.n > 0 && !raw.samples.is_null() {
                    let stream = (self.api.create_stream)(self.recognizer);
                    if stream.is_null() {
                        (self.api.destroy_segment)(segment);
                        return Err("No se pudo crear el stream offline.".into());
                    }
                    let segment_start = i64::from(raw._start).max(0);
                    let padded_start = segment_start.saturating_sub(VAD_PRE_SPEECH_SAMPLES as i64);
                    let mut padded_samples = collect_history_range(
                        &self.audio_history,
                        self.history_start_sample,
                        padded_start,
                        segment_start,
                    );
                    padded_samples
                        .extend_from_slice(std::slice::from_raw_parts(raw.samples, raw.n as usize));
                    let padded_n = i32::try_from(padded_samples.len())
                        .map_err(|_| "El segmento de voz es demasiado grande.".to_string())?;
                    (self.api.accept_offline)(
                        stream,
                        SPEECH_SAMPLE_RATE as i32,
                        padded_samples.as_ptr(),
                        padded_n,
                    );
                    (self.api.decode)(self.recognizer, stream);
                    let result = (self.api.get_result)(stream);
                    if !result.is_null() && !(*result).text.is_null() {
                        let text = CStr::from_ptr((*result).text)
                            .to_string_lossy()
                            .trim()
                            .to_string();
                        if !text.is_empty() {
                            texts.push(text);
                        }
                    }
                    if !result.is_null() {
                        (self.api.destroy_result)(result);
                    }
                    (self.api.destroy_stream)(stream);
                }
                (self.api.destroy_segment)(segment);
                (self.api.vad_pop)(self.vad);
            }
        }
        Ok(texts.join(" "))
    }
}

impl StreamingRecognizer for OfflineVadRecognizer {
    fn accept_waveform(&mut self, samples: &[f32]) -> Result<RecognitionUpdate, String> {
        let n =
            i32::try_from(samples.len()).map_err(|_| "Lote PCM demasiado grande.".to_string())?;
        self.audio_history.extend(samples.iter().copied());
        while self.audio_history.len() > VAD_HISTORY_SAMPLES {
            self.audio_history.pop_front();
            self.history_start_sample = self.history_start_sample.saturating_add(1);
        }
        unsafe { (self.api.vad_accept)(self.vad, samples.as_ptr(), n) };
        let text = self.drain_segments()?;
        Ok(RecognitionUpdate {
            endpoint_detected: !text.is_empty(),
            text,
        })
    }
    fn finish(&mut self) -> Result<RecognitionUpdate, String> {
        unsafe { (self.api.vad_flush)(self.vad) };
        Ok(RecognitionUpdate {
            text: self.drain_segments()?,
            endpoint_detected: true,
        })
    }
    fn reset_after_endpoint(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn reset_session(&mut self) -> Result<(), String> {
        unsafe { (self.api.vad_reset)(self.vad) };
        self.audio_history.clear();
        self.history_start_sample = 0;
        Ok(())
    }
}

fn collect_history_range(
    history: &VecDeque<f32>,
    history_start: i64,
    requested_start: i64,
    requested_end: i64,
) -> Vec<f32> {
    let start = requested_start
        .max(history_start)
        .saturating_sub(history_start) as usize;
    let end = requested_end
        .max(history_start)
        .saturating_sub(history_start) as usize;
    if start >= history.len() || start >= end {
        return Vec::new();
    }
    history
        .range(start..end.min(history.len()))
        .copied()
        .collect()
}

// The native handles are exclusively owned and only accessed by the speech
// worker after a move between threads. sherpa-onnx supports this ownership model.
unsafe impl Send for OfflineVadRecognizer {}

impl Drop for OfflineVadRecognizer {
    fn drop(&mut self) {
        unsafe {
            (self.api.destroy_vad)(self.vad);
            (self.api.destroy_recognizer)(self.recognizer);
        }
    }
}

fn path_string(path: &Path) -> Result<CString, String> {
    CString::new(path.to_string_lossy().as_bytes()).map_err(|_| "Ruta de modelo invalida.".into())
}
unsafe fn symbol<T: Copy>(
    library: &crate::services::sherpa_runtime::LoadedSherpaLibrary,
    name: &[u8],
) -> Result<T, String> {
    unsafe {
        library.get::<T>(name).map(|s| *s).map_err(|e| {
            format!(
                "Falta simbolo sherpa {}: {e}",
                String::from_utf8_lossy(name)
            )
        })
    }
}

#[cfg(all(test, target_os = "windows"))]
mod native_smoke_tests {
    use super::{collect_history_range, OfflineNemoTransducerConfig, OfflineVadRecognizer};
    use std::{collections::VecDeque, path::PathBuf};

    #[test]
    fn collects_available_audio_before_the_vad_segment_start() {
        let history = (0..100).map(|value| value as f32).collect::<VecDeque<_>>();
        assert_eq!(
            collect_history_range(&history, 0, 70, 80),
            (70..80).map(|value| value as f32).collect::<Vec<_>>()
        );
        assert_eq!(
            collect_history_range(&history, 50, 40, 55),
            (0..5).map(|value| value as f32).collect::<Vec<_>>()
        );
    }

    #[test]
    #[ignore = "requires the speech installer assets and loads the full Parakeet model"]
    fn loads_and_drops_packaged_runtime_without_native_crash() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let runtime = root.join("resources/speech/runtime/windows-x86_64/sherpa-onnx-c-api.dll");
        let models = root.join("resources/speech/models/es-parakeet-tdt-v3");
        let recognizer = OfflineVadRecognizer::load(
            &runtime,
            &OfflineNemoTransducerConfig {
                encoder: models.join("encoder.onnx"),
                decoder: models.join("decoder.onnx"),
                joiner: models.join("joiner.onnx"),
                tokens: models.join("tokens.txt"),
                vad: models.join("silero_vad.onnx"),
                num_threads: 2,
            },
        )
        .expect("load packaged Parakeet and Silero models");
        drop(recognizer);
    }
}
