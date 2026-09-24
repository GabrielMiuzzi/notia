#![cfg(any(target_os = "windows", target_os = "android"))]

//! Parakeet TDT 0.6B v3 through the sherpa-onnx `OfflineRecognizer` C API.
//! Silero VAD delimits utterances: each finished VAD segment is decoded once
//! and confirmed. While a live session is speaking, the audio of the ongoing
//! utterance is decoded again at an interval adapted to the decoding cost so
//! the preview follows the speaker. The transducer is non-autoregressive, so
//! both passes stay far below real time on CPU.

use crate::services::spanish_transcript::normalize_spanish_transcript;
use crate::services::speech_audio::SPEECH_SAMPLE_RATE;
use crate::services::speech_worker::{RecognitionUpdate, SampleSpan, StreamingRecognizer};
use std::collections::VecDeque;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const SAMPLE_RATE: usize = SPEECH_SAMPLE_RATE as usize;
const VAD_PRE_SPEECH_SAMPLES: usize = SAMPLE_RATE / 4;
const VAD_HISTORY_SAMPLES: usize = SAMPLE_RATE * 30;
const VAD_WINDOW_SAMPLES: usize = 512;
// Short answers such as "Sí." last about 200 ms; a longer minimum drops them.
const VAD_MIN_SPEECH_SECONDS: f32 = 0.1;
const VAD_MIN_SILENCE_SECONDS: f32 = 0.5;
const VAD_MAX_SPEECH_SECONDS: f32 = 20.0;
const VAD_BUFFER_SECONDS: f32 = 30.0;
// sherpa-onnx marks the start of a detected utterance two windows plus the
// minimum speech duration before the audio that triggered it. The worker also
// feeds 200 ms batches, so detection may have happened one batch earlier.
const SPEECH_START_LOOKBACK_SAMPLES: usize = VAD_PRE_SPEECH_SAMPLES
    + 2 * VAD_WINDOW_SAMPLES
    + (VAD_MIN_SPEECH_SECONDS * SAMPLE_RATE as f32) as usize
    + SAMPLE_RATE / 5;
const MIN_PARTIAL_INTERVAL: Duration = Duration::from_millis(400);
// Parakeet detects the language of each decoded chunk and has no way to fix
// it. On chunks shorter than a second it sometimes picks English ("¿Qué es?"
// becomes "Kiss"). Each chunk is decoded after the last seconds of speech
// already confirmed, so the model keeps the language being spoken; the tokens
// that start inside that context are discarded by their timestamp.
const LANGUAGE_CONTEXT_SAMPLES: usize = SAMPLE_RATE * 3;
const CONTEXT_CUTOFF_TOLERANCE_SECONDS: f32 = 0.04;
const MIN_PARTIAL_SAMPLES: usize = SAMPLE_RATE / 2;
pub const MAX_ASR_THREADS: i32 = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OfflineNemoTransducerConfig {
    pub encoder: PathBuf,
    pub decoder: PathBuf,
    pub joiner: PathBuf,
    pub tokens: PathBuf,
    pub vad: PathBuf,
    pub num_threads: i32,
    /// Only selects the text normalization: Parakeet detects the language.
    pub language: String,
}

type Ptr = *const c_char;
// The structs below mirror `sherpa-onnx/c-api/c-api.h` of sherpa-onnx 1.13.4
// field by field. Unused model families stay zeroed (null paths).
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
    start: i32,
    samples: *mut f32,
    n: i32,
}
/// Leading fields of `SherpaOnnxOfflineRecognizerResult`; the result is
/// always released by sherpa, so the trailing fields are never touched.
#[repr(C)]
struct OfflineResult {
    text: Ptr,
    /// Start of each token in seconds, parallel to `tokens_arr`; may be null.
    timestamps: *const f32,
    count: i32,
    tokens: Ptr,
    tokens_arr: *const Ptr,
}

struct Decoded {
    text: String,
    /// Tokens with their start in seconds, when the model reports them.
    tokens: Option<Vec<(String, f32)>>,
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
    vad_detected: unsafe extern "C" fn(*const c_void) -> i32,
    vad_front: unsafe extern "C" fn(*const c_void) -> *const SpeechSegment,
    vad_pop: unsafe extern "C" fn(*const c_void),
    vad_reset: unsafe extern "C" fn(*const c_void),
    destroy_segment: unsafe extern "C" fn(*const SpeechSegment),
    vad_flush: unsafe extern "C" fn(*const c_void),
}

/// Progress of the utterance that Silero VAD has not closed yet.
#[derive(Default)]
struct LiveUtterance {
    /// Absolute sample where the ongoing utterance approximately starts.
    start_sample: Option<i64>,
    text: String,
    last_decoded_at: Option<Instant>,
    last_decode_cost: Duration,
}

pub struct OfflineVadRecognizer {
    _library: crate::services::sherpa_runtime::LoadedSherpaLibrary,
    recognizer: *const c_void,
    vad: *const c_void,
    api: Api,
    _strings: Strings,
    config: OfflineNemoTransducerConfig,
    audio_history: VecDeque<f32>,
    history_start_sample: i64,
    total_samples: i64,
    live_partials: bool,
    live: LiveUtterance,
    /// Latest confirmed speech, prefixed to every decode as language context.
    language_context: VecDeque<f32>,
}

impl OfflineVadRecognizer {
    pub fn load(runtime: &Path, model: &OfflineNemoTransducerConfig) -> Result<Self, String> {
        if !(1..=MAX_ASR_THREADS).contains(&model.num_threads) {
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
                vad_detected: symbol(&library, b"SherpaOnnxVoiceActivityDetectorDetected\0")?,
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
                return Err("sherpa-onnx no pudo crear el reconocedor Parakeet TDT.".into());
            }
            let mut vad_config = VadConfig::default();
            vad_config.silero_vad = VadFamily {
                model: strings.vad.as_ptr(),
                threshold: 0.5,
                min_silence_duration: VAD_MIN_SILENCE_SECONDS,
                min_speech_duration: VAD_MIN_SPEECH_SECONDS,
                window_size: VAD_WINDOW_SAMPLES as i32,
                max_speech_duration: VAD_MAX_SPEECH_SECONDS,
            };
            vad_config.sample_rate = SPEECH_SAMPLE_RATE as i32;
            vad_config.num_threads = 1;
            vad_config.provider = strings.cpu.as_ptr();
            let vad = create_vad(&vad_config, VAD_BUFFER_SECONDS);
            if vad.is_null() {
                (api.destroy_recognizer)(recognizer);
                return Err("sherpa-onnx no pudo crear Silero VAD.".into());
            }
            Ok(Self {
                _library: library,
                recognizer,
                vad,
                api,
                _strings: strings,
                config: model.clone(),
                audio_history: VecDeque::with_capacity(VAD_HISTORY_SAMPLES),
                history_start_sample: 0,
                total_samples: 0,
                live_partials: false,
                live: LiveUtterance::default(),
                language_context: VecDeque::with_capacity(LANGUAGE_CONTEXT_SAMPLES),
            })
        }
    }

    pub fn matches(&self, config: &OfflineNemoTransducerConfig) -> bool {
        self.config == *config
    }

    /// Enables previews of the ongoing utterance for a live session. Batch
    /// transcription keeps them off so each utterance is decoded only once.
    /// `reset_session` turns them off again before recycling.
    pub fn enable_live_partials(&mut self) {
        self.live_partials = true;
    }

    /// Transcribes a chunk after the language context and keeps only the
    /// text spoken inside the chunk.
    fn transcribe(&self, samples: &[f32]) -> Result<String, String> {
        if self.language_context.is_empty() {
            return Ok(self.normalize(self.decode(samples)?.text));
        }
        let mut audio = Vec::with_capacity(self.language_context.len() + samples.len());
        audio.extend(self.language_context.iter().copied());
        audio.extend_from_slice(samples);
        let cutoff = self.language_context.len() as f32 / SAMPLE_RATE as f32
            - CONTEXT_CUTOFF_TOLERANCE_SECONDS;
        let text = match self.decode(&audio)?.tokens {
            Some(tokens) => text_after(&tokens, cutoff),
            // Without timestamps the context text cannot be removed.
            None => self.decode(samples)?.text,
        };
        Ok(self.normalize(text))
    }

    fn remember_language_context(&mut self, samples: &[f32]) {
        let keep = samples.len().min(LANGUAGE_CONTEXT_SAMPLES);
        self.language_context
            .extend(samples[samples.len() - keep..].iter().copied());
        let overflow = self
            .language_context
            .len()
            .saturating_sub(LANGUAGE_CONTEXT_SAMPLES);
        self.language_context.drain(..overflow);
    }

    fn decode(&self, samples: &[f32]) -> Result<Decoded, String> {
        let n = i32::try_from(samples.len())
            .map_err(|_| "El segmento de voz es demasiado grande.".to_string())?;
        unsafe {
            let stream = (self.api.create_stream)(self.recognizer);
            if stream.is_null() {
                return Err("No se pudo crear el stream offline de Parakeet.".into());
            }
            (self.api.accept_offline)(stream, SPEECH_SAMPLE_RATE as i32, samples.as_ptr(), n);
            (self.api.decode)(self.recognizer, stream);
            let result = (self.api.get_result)(stream);
            let decoded = if result.is_null() {
                Decoded {
                    text: String::new(),
                    tokens: Some(Vec::new()),
                }
            } else {
                read_result(&*result)
            };
            if !result.is_null() {
                (self.api.destroy_result)(result);
            }
            (self.api.destroy_stream)(stream);
            Ok(decoded)
        }
    }

    fn normalize(&self, text: String) -> String {
        if self.config.language == "es" {
            normalize_spanish_transcript(&text)
        } else {
            text
        }
    }

    /// Decodes every utterance Silero VAD has closed and joins their text,
    /// with the samples of the session they span.
    fn drain_segments(&mut self) -> Result<(String, Option<SampleSpan>), String> {
        let mut texts = Vec::new();
        let mut span: Option<SampleSpan> = None;
        unsafe {
            while (self.api.vad_empty)(self.vad) == 0 {
                let segment = (self.api.vad_front)(self.vad);
                if segment.is_null() {
                    return Err("Silero VAD devolvio un segmento invalido.".into());
                }
                let raw = &*segment;
                if raw.n > 0 && !raw.samples.is_null() {
                    let segment_start = i64::from(raw.start).max(0);
                    let mut padded_samples = collect_history_range(
                        &self.audio_history,
                        self.history_start_sample,
                        segment_start.saturating_sub(VAD_PRE_SPEECH_SAMPLES as i64),
                        segment_start,
                    );
                    padded_samples
                        .extend_from_slice(std::slice::from_raw_parts(raw.samples, raw.n as usize));
                    let decoded = self.transcribe(&padded_samples);
                    (self.api.destroy_segment)(segment);
                    (self.api.vad_pop)(self.vad);
                    let text = decoded?;
                    if !text.is_empty() {
                        self.remember_language_context(&padded_samples);
                        texts.push(text);
                        let start = segment_start as u64;
                        let end = start.saturating_add(raw.n as u64);
                        span = Some(match span {
                            Some(previous) => SampleSpan { start: previous.start, end },
                            None => SampleSpan { start, end },
                        });
                    }
                } else {
                    (self.api.destroy_segment)(segment);
                    (self.api.vad_pop)(self.vad);
                }
            }
        }
        Ok((texts.join(" "), span))
    }

    /// Refreshes the preview of the utterance that VAD has not closed yet.
    fn update_live_utterance(&mut self) -> Result<(), String> {
        let speaking = unsafe { (self.api.vad_detected)(self.vad) } != 0;
        if !speaking {
            self.live = LiveUtterance::default();
            return Ok(());
        }
        let start = *self.live.start_sample.get_or_insert_with(|| {
            self.total_samples
                .saturating_sub(SPEECH_START_LOOKBACK_SAMPLES as i64)
                .max(self.history_start_sample)
        });
        let due = self.live.last_decoded_at.is_none_or(|decoded_at| {
            decoded_at.elapsed() >= partial_interval(self.live.last_decode_cost)
        });
        if !self.live_partials
            || !due
            || self.total_samples.saturating_sub(start) < MIN_PARTIAL_SAMPLES as i64
        {
            return Ok(());
        }
        let samples = collect_history_range(
            &self.audio_history,
            self.history_start_sample,
            start,
            self.total_samples,
        );
        let started_at = Instant::now();
        let text = self.transcribe(&samples)?;
        let cost = started_at.elapsed();
        log::info!(
            "[notia:speech:inference] engine=parakeet reason=partial audio_ms={} inference_ms={}",
            samples.len() * 1_000 / SAMPLE_RATE,
            cost.as_millis(),
        );
        self.live.last_decoded_at = Some(Instant::now());
        self.live.last_decode_cost = cost;
        if !text.is_empty() {
            self.live.text = text;
        }
        Ok(())
    }
}

impl StreamingRecognizer for OfflineVadRecognizer {
    fn accept_waveform(&mut self, samples: &[f32]) -> Result<RecognitionUpdate, String> {
        let n =
            i32::try_from(samples.len()).map_err(|_| "Lote PCM demasiado grande.".to_string())?;
        self.audio_history.extend(samples.iter().copied());
        self.total_samples = self.total_samples.saturating_add(samples.len() as i64);
        let overflow = self.audio_history.len().saturating_sub(VAD_HISTORY_SAMPLES);
        if overflow > 0 {
            self.audio_history.drain(..overflow);
            self.history_start_sample = self.history_start_sample.saturating_add(overflow as i64);
        }
        unsafe { (self.api.vad_accept)(self.vad, samples.as_ptr(), n) };
        let (confirmed, span) = self.drain_segments()?;
        if !confirmed.is_empty() {
            // The preview belonged to the utterance that was just confirmed.
            self.live = LiveUtterance::default();
            return Ok(RecognitionUpdate {
                text: confirmed,
                endpoint_detected: true,
                span,
            });
        }
        self.update_live_utterance()?;
        Ok(RecognitionUpdate {
            text: self.live.text.clone(),
            endpoint_detected: false,
            span: None,
        })
    }

    fn finish(&mut self) -> Result<RecognitionUpdate, String> {
        unsafe { (self.api.vad_flush)(self.vad) };
        self.live = LiveUtterance::default();
        let (text, span) = self.drain_segments()?;
        Ok(RecognitionUpdate {
            text,
            endpoint_detected: false,
            span,
        })
    }

    fn reset_after_endpoint(&mut self) -> Result<(), String> {
        Ok(())
    }

    /// Keeps `language_context`: it only steers the language of the next
    /// chunks (diarization turns, the next session) and its text is dropped.
    fn reset_session(&mut self) -> Result<(), String> {
        unsafe { (self.api.vad_reset)(self.vad) };
        self.audio_history.clear();
        self.history_start_sample = 0;
        self.total_samples = 0;
        self.live_partials = false;
        self.live = LiveUtterance::default();
        Ok(())
    }
}

/// Copies the text and, when present, the timestamped tokens of a result.
unsafe fn read_result(result: &OfflineResult) -> Decoded {
    let text = if result.text.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(result.text) }
            .to_string_lossy()
            .trim()
            .to_string()
    };
    let count = usize::try_from(result.count).unwrap_or(0);
    let tokens = if count == 0 {
        Some(Vec::new())
    } else if result.timestamps.is_null() || result.tokens_arr.is_null() {
        None
    } else {
        let starts = unsafe { std::slice::from_raw_parts(result.timestamps, count) };
        let symbols = unsafe { std::slice::from_raw_parts(result.tokens_arr, count) };
        Some(
            symbols
                .iter()
                .zip(starts)
                .map(|(symbol, start)| {
                    let symbol = if symbol.is_null() {
                        String::new()
                    } else {
                        unsafe { CStr::from_ptr(*symbol) }
                            .to_string_lossy()
                            .into_owned()
                    };
                    (symbol, *start)
                })
                .collect(),
        )
    };
    Decoded { text, tokens }
}

/// Text from the first word that reaches `cutoff` seconds. The context ends in
/// silence, so a word whose first piece is stamped slightly before the cutoff
/// still belongs to the chunk and is kept whole. SentencePiece marks the start
/// of a word with `▁`.
fn text_after(tokens: &[(String, f32)], cutoff: f32) -> String {
    let starts_word = |symbol: &str| symbol.starts_with(['\u{2581}', ' ']);
    let is_punctuation = |symbol: &str| !symbol.chars().any(char::is_alphanumeric);
    // Punctuation right after the cutoff closes the context sentence.
    let Some(first) = tokens
        .iter()
        .position(|(symbol, start)| *start >= cutoff && !is_punctuation(symbol))
    else {
        return String::new();
    };
    let word_start = if starts_word(&tokens[first].0) {
        first
    } else {
        tokens[..first]
            .iter()
            .rposition(|(symbol, _)| starts_word(symbol))
            .filter(|&index| !is_punctuation(&tokens[index].0))
            .unwrap_or(first)
    };
    tokens[word_start..]
        .iter()
        .map(|(symbol, _)| symbol.as_str())
        .collect::<String>()
        .replace('\u{2581}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Waits at least twice the last decoding cost so previews never take more
/// than half of the CPU time available to the worker.
fn partial_interval(last_decode_cost: Duration) -> Duration {
    MIN_PARTIAL_INTERVAL.max(last_decode_cost.saturating_mul(2))
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

#[cfg(test)]
mod tests {
    use super::{collect_history_range, partial_interval, text_after, MIN_PARTIAL_INTERVAL};
    use std::collections::VecDeque;
    use std::time::Duration;

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
        assert!(collect_history_range(&history, 0, 80, 70).is_empty());
    }

    #[test]
    fn drops_the_tokens_spoken_inside_the_language_context() {
        let tokens = [
            ("\u{2581}Hola".to_string(), 0.4),
            (".".to_string(), 0.8),
            ("\u{2581}¿Qu".to_string(), 3.1),
            ("é".to_string(), 3.2),
            ("\u{2581}es".to_string(), 3.3),
            ("?".to_string(), 3.5),
        ];
        assert_eq!(text_after(&tokens, 2.96), "¿Qué es?");
        assert_eq!(text_after(&tokens, 0.0), "Hola. ¿Qué es?");
        assert_eq!(text_after(&tokens, 9.0), "");
        // "Kiosco" split across the cutoff stays whole.
        let split = [
            ("\u{2581}bien".to_string(), 1.0),
            (".".to_string(), 1.2),
            ("\u{2581}Ki".to_string(), 2.9),
            ("osco".to_string(), 3.0),
            (".".to_string(), 3.3),
        ];
        assert_eq!(text_after(&split, 2.96), "Kiosco.");
        // The period of the context sentence stamped after the cutoff is not
        // a reason to repeat its last word.
        let late_period = [
            ("\u{2581}bien".to_string(), 2.5),
            (".".to_string(), 3.0),
            ("\u{2581}Sí".to_string(), 3.4),
            (".".to_string(), 3.6),
        ];
        assert_eq!(text_after(&late_period, 2.96), "Sí.");
    }

    #[test]
    fn partial_previews_back_off_when_decoding_is_slow() {
        assert_eq!(partial_interval(Duration::ZERO), MIN_PARTIAL_INTERVAL);
        assert_eq!(
            partial_interval(Duration::from_millis(900)),
            Duration::from_millis(1_800)
        );
    }
}

#[cfg(all(test, target_os = "windows"))]
mod native_smoke_tests {
    use super::{OfflineNemoTransducerConfig, OfflineVadRecognizer};
    use crate::services::speech_worker::StreamingRecognizer;
    use std::path::PathBuf;

    #[test]
    #[ignore = "requires the speech installer assets and loads the full Parakeet model"]
    fn loads_decodes_silence_and_drops_packaged_runtime() {
        let root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/.."));
        let runtime = root.join("resources/speech/runtime/windows-x86_64/sherpa-onnx-c-api.dll");
        let models = root.join("resources/speech/models/es-parakeet-tdt-v3");
        let mut recognizer = OfflineVadRecognizer::load(
            &runtime,
            &OfflineNemoTransducerConfig {
                encoder: models.join("encoder.onnx"),
                decoder: models.join("decoder.onnx"),
                joiner: models.join("joiner.onnx"),
                tokens: models.join("tokens.txt"),
                vad: models.join("silero_vad.onnx"),
                num_threads: 2,
                language: "es".to_string(),
            },
        )
        .expect("load packaged Parakeet and Silero models");
        recognizer.enable_live_partials();
        let update = recognizer
            .accept_waveform(&[0.0; 16_000])
            .expect("accept silence");
        assert!(update.text.is_empty());
        assert!(recognizer.finish().expect("finish").text.is_empty());
        recognizer.reset_session().expect("reset");
    }
}
