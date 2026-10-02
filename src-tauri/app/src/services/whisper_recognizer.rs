#![cfg(any(target_os = "windows", target_os = "android"))]

//! Whisper large-v3-turbo (whisper.cpp) streamed by local agreement. Silero
//! VAD delimits utterances. While one is spoken, its audio so far is decoded
//! again each time enough new audio arrived, and LocalAgreement-2 commits the
//! words two consecutive decodes agree on: the preview grows without
//! rewriting what it already showed as stable. When VAD closes the utterance,
//! a decode of all of its audio becomes the confirmed line. While the worker
//! is behind the capture, closed utterances wait and are decoded together
//! (one decode window holds 30 s), so a slow CPU spends one encoder pass on
//! several short utterances. Where a decode takes longer than 2 s (a tablet
//! CPU), there are no previews: the lines arrive as utterances close.

use crate::services::local_agreement::LocalAgreement;
use crate::services::sherpa_vad::{SileroVad, VadSettings, VoicedRange};
use crate::services::spanish_transcript::normalize_spanish_transcript;
use crate::services::speech_audio::SPEECH_SAMPLE_RATE;
use crate::services::speech_worker::{RecognitionUpdate, SampleSpan, StreamingRecognizer};
use crate::services::whisper_runtime::WhisperEngine;
use std::collections::VecDeque;
use std::ffi::CString;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const SAMPLE_RATE: usize = SPEECH_SAMPLE_RATE as usize;
const VAD_PRE_SPEECH_SAMPLES: usize = SAMPLE_RATE / 4;
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
/// Whisper decodes at most 30 s at once; the margin keeps a lead-in inside.
const MAX_DECODE_SAMPLES: usize = SAMPLE_RATE * 28;
/// A longer utterance is cut at its quietest 20 ms after this much audio.
const MIN_PIECE_SAMPLES: usize = SAMPLE_RATE * 14;
/// Closed utterances waiting while the worker is behind are decoded once
/// they reach this much audio.
const BATCH_SAMPLES: usize = SAMPLE_RATE * 20;
/// Audio kept for the utterances not decoded yet, beyond one decode window.
const HISTORY_SAMPLES: usize = SAMPLE_RATE * 60;
const MIN_PARTIAL_SAMPLES: usize = SAMPLE_RATE / 2;
/// New audio that makes a new hypothesis of the utterance worth decoding.
const MIN_PREVIEW_STEP_SAMPLES: usize = SAMPLE_RATE / 2;
const MIN_PARTIAL_INTERVAL: Duration = Duration::from_millis(400);
/// Decoding slower than this leaves no time for previews: a tablet CPU takes
/// about 10 s per decode, which the confirmed lines need.
const MAX_PREVIEW_DECODE_COST: Duration = Duration::from_secs(2);
/// Beam search for the confirmed line only on a GPU, where it costs nothing:
/// on the probe recordings it matched greedy decoding within 0.5 points of
/// WER, and on a tablet CPU it took 35 % longer.
const GPU_FINAL_BEAM_SIZE: i32 = 5;
/// Characters of the session's confirmed text given to Whisper as prompt.
const PROMPT_CHARACTERS: usize = 200;
const CONTEXT_CHARACTERS: usize = 1_000;
const SPANISH_STYLE_PROMPT: &str = "Transcripción en español, con signos de puntuación.";
// Every chunk is decoded at a steady level: -20 dBFS for the loud frames, up
// to +30 dB. Whisper's log-mel features shift with the input level, and the
// computer audio arrives very quiet.
const LEVEL_FRAME_SAMPLES: usize = SAMPLE_RATE / 50;
const DECODE_LEVEL: f32 = 0.1;
const DECODE_MAX_GAIN: f32 = 31.6;
const DECODE_MAX_PEAK: f32 = 0.95;
/// On the Snapdragon 8 Gen 3 tablet 4 threads decoded faster than 6, and 8
/// (with the efficiency cores) took twice as long.
#[cfg(target_os = "android")]
pub const MAX_ASR_THREADS: i32 = 4;
#[cfg(not(target_os = "android"))]
pub const MAX_ASR_THREADS: i32 = 6;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WhisperAsrConfig {
    pub model: PathBuf,
    pub vad: PathBuf,
    pub num_threads: i32,
    /// Language code Whisper transcribes in ("es", "en", ...) or "auto".
    pub language: String,
}

/// The utterance Silero VAD has not closed yet and its hypotheses.
#[derive(Default)]
struct LiveUtterance {
    /// Absolute sample where the utterance approximately starts.
    start_sample: Option<i64>,
    agreement: LocalAgreement,
    /// End of the audio the last hypothesis covered.
    decoded_until: i64,
    last_decoded_at: Option<Instant>,
}

/// Utterances already closed and not decoded yet.
struct PendingSpeech {
    /// First sample decoded, with a lead-in before the first utterance.
    audio_start: i64,
    span: SampleSpan,
    /// Hypotheses of the first utterance, made while it was spoken.
    agreement: LocalAgreement,
}

pub struct WhisperVadRecognizer {
    engine: WhisperEngine,
    vad: SileroVad,
    config: WhisperAsrConfig,
    language: CString,
    audio_history: VecDeque<f32>,
    history_start_sample: i64,
    total_samples: i64,
    /// End of the audio already decoded: the lead-in of the next utterance
    /// never reaches back into it, so no word is decoded twice.
    decoded_until_sample: i64,
    live_partials: bool,
    /// The worker is behind the capture: previews wait and closed
    /// utterances are decoded together.
    backlogged: bool,
    live: LiveUtterance,
    pending: Option<PendingSpeech>,
    /// Latest text confirmed in the session; its end prompts the decoder.
    context: String,
    /// What the last decode took. It describes the device, so it outlives
    /// sessions; on a CPU it starts unknown and previews wait for a measure.
    decode_cost: Duration,
}

impl WhisperVadRecognizer {
    pub fn load(runtime: &Path, sherpa_runtime: &Path, config: &WhisperAsrConfig) -> Result<Self, String> {
        if !(1..=MAX_ASR_THREADS).contains(&config.num_threads) {
            return Err("Cantidad de threads ASR invalida.".into());
        }
        let language = CString::new(whisper_language(&config.language))
            .map_err(|_| "El idioma del reconocimiento de voz no es valido.".to_string())?;
        let engine = WhisperEngine::load(runtime, &config.model, cfg!(target_os = "windows"), config.num_threads)?;
        if !engine.supports_language(&language)? {
            return Err(format!("Whisper no reconoce el idioma «{}».", config.language));
        }
        log::info!("[notia:speech] whisper loaded backend={}", engine.backend());
        let engine_on_gpu = engine.uses_gpu();
        let vad = SileroVad::load(
            sherpa_runtime,
            &config.vad,
            &VadSettings {
                threshold: 0.5,
                min_silence_seconds: VAD_MIN_SILENCE_SECONDS,
                min_speech_seconds: VAD_MIN_SPEECH_SECONDS,
                max_speech_seconds: VAD_MAX_SPEECH_SECONDS,
                window_samples: VAD_WINDOW_SAMPLES as i32,
                buffer_seconds: VAD_BUFFER_SECONDS,
            },
        )?;
        Ok(Self {
            engine,
            vad,
            config: config.clone(),
            language,
            audio_history: VecDeque::with_capacity(HISTORY_SAMPLES),
            history_start_sample: 0,
            total_samples: 0,
            decoded_until_sample: 0,
            live_partials: false,
            backlogged: false,
            live: LiveUtterance::default(),
            pending: None,
            context: String::new(),
            decode_cost: if engine_on_gpu { Duration::ZERO } else { Duration::MAX },
        })
    }

    pub fn matches(&self, config: &WhisperAsrConfig) -> bool {
        self.config == *config
    }

    /// Enables previews of the ongoing utterance for a live session. Batch
    /// transcription keeps them off so each utterance is decoded only once.
    /// `reset_session` turns them off again before recycling.
    pub fn enable_live_partials(&mut self) {
        self.live_partials = true;
    }

    fn push_history(&mut self, samples: &[f32]) {
        self.audio_history.extend(samples.iter().copied());
        self.total_samples = self.total_samples.saturating_add(samples.len() as i64);
        let overflow = self.audio_history.len().saturating_sub(HISTORY_SAMPLES);
        if overflow > 0 {
            self.audio_history.drain(..overflow);
            self.history_start_sample = self.history_start_sample.saturating_add(overflow as i64);
        }
    }

    /// Text of `samples` (at most `MAX_DECODE_SAMPLES`) brought to a steady
    /// level and prompted with `preceding`, without known hallucinations.
    fn decode(&mut self, samples: &[f32], preceding: &str, beam_size: i32, reason: &str) -> Result<String, String> {
        let gain = speech_gain(samples);
        let audio = samples.iter().map(|sample| sample * gain).collect::<Vec<_>>();
        let prompt = self.prompt(preceding);
        let started_at = Instant::now();
        let text = self.engine.transcribe(&audio, &self.language, &prompt, beam_size)?;
        self.decode_cost = started_at.elapsed();
        log::info!(
            "[notia:speech:inference] engine=whisper backend={} reason={reason} audio_ms={} inference_ms={}",
            self.engine.backend(),
            samples.len() * 1_000 / SAMPLE_RATE,
            self.decode_cost.as_millis(),
        );
        Ok(drop_known_hallucinations(text.trim()))
    }

    /// The end of the text that precedes the audio. In Spanish it follows a
    /// punctuated sentence: Whisper copies the style of its prompt, and one
    /// utterance transcribed in lowercase without punctuation otherwise
    /// carries that style to the rest of the session.
    fn prompt(&self, preceding: &str) -> String {
        let tail = prompt_tail(preceding);
        if self.spanish() {
            format!("{SPANISH_STYLE_PROMPT} {tail}").trim_end().to_string()
        } else {
            tail.to_string()
        }
    }

    fn spanish(&self) -> bool {
        whisper_language(&self.config.language) == "es"
    }

    fn normalize(&self, text: &str) -> String {
        if self.spanish() {
            normalize_spanish_transcript(text)
        } else {
            text.to_string()
        }
    }

    /// Queues every utterance Silero VAD closed and decodes the queue when the
    /// worker is not behind, when it fills, or when the session finishes.
    /// Returns the confirmed text with the samples it spans.
    fn collect_closed(&mut self, finishing: bool) -> Result<(String, Option<SampleSpan>), String> {
        let mut texts = Vec::new();
        let mut span: Option<SampleSpan> = None;
        while let Some(VoicedRange { start, end }) = self.vad.pop_closed()? {
            if end <= start {
                continue;
            }
            // The preview belonged to this utterance.
            let live = std::mem::take(&mut self.live);
            if self
                .pending
                .as_ref()
                .is_some_and(|pending| end - pending.audio_start > MAX_DECODE_SAMPLES as i64)
            {
                self.decode_pending(&mut texts, &mut span)?;
            }
            match self.pending.as_mut() {
                Some(pending) => pending.span.end = end as u64,
                None => {
                    let audio_start = (start - VAD_PRE_SPEECH_SAMPLES as i64)
                        .max(self.decoded_until_sample)
                        .max(self.history_start_sample);
                    self.pending = Some(PendingSpeech {
                        audio_start,
                        span: SampleSpan { start: start as u64, end: end as u64 },
                        agreement: live.agreement,
                    });
                }
            }
        }
        let ready = self.pending.as_ref().is_some_and(|pending| {
            finishing
                || !self.backlogged
                || pending.span.end as i64 - pending.audio_start >= BATCH_SAMPLES as i64
        });
        if ready {
            self.decode_pending(&mut texts, &mut span)?;
        }
        Ok((texts.join(" "), span))
    }

    fn decode_pending(&mut self, texts: &mut Vec<String>, span: &mut Option<SampleSpan>) -> Result<(), String> {
        let Some(pending) = self.pending.take() else {
            return Ok(());
        };
        let audio = collect_history_range(
            &self.audio_history,
            self.history_start_sample,
            pending.audio_start,
            pending.span.end as i64,
        );
        self.decoded_until_sample = self.decoded_until_sample.max(pending.span.end as i64);
        let beam_size = if self.engine.uses_gpu() { GPU_FINAL_BEAM_SIZE } else { 1 };
        let mut preceding = self.context.clone();
        let mut decoded = String::new();
        // Silero VAD does not always cut a long utterance at its maximum: one
        // longer than a decode window is decoded in pieces cut in its pauses.
        // Audio already gone from the history leaves nothing to decode.
        let pieces = quiet_pieces(&audio, MIN_PIECE_SAMPLES, MAX_DECODE_SAMPLES);
        for piece in pieces.into_iter().filter(|piece| !piece.is_empty()) {
            let text = self.decode(&audio[piece], &preceding, beam_size, "final")?;
            remember(&mut preceding, &text);
            remember(&mut decoded, &text);
        }
        let text = self.normalize(&pending.agreement.finish(&decoded));
        if text.is_empty() {
            return Ok(());
        }
        remember(&mut self.context, &text);
        texts.push(text);
        *span = Some(match *span {
            Some(previous) => SampleSpan { start: previous.start, end: pending.span.end },
            None => pending.span,
        });
        Ok(())
    }

    /// Decodes the utterance in progress again when enough new audio arrived
    /// and the last decode left time for it.
    fn update_live_utterance(&mut self) -> Result<(), String> {
        if !self.vad.speaking() {
            self.live = LiveUtterance::default();
            return Ok(());
        }
        let floor = self
            .history_start_sample
            .max(self.decoded_until_sample)
            .max(self.pending.as_ref().map_or(0, |pending| pending.span.end as i64));
        let start = *self.live.start_sample.get_or_insert_with(|| {
            self.total_samples.saturating_sub(SPEECH_START_LOOKBACK_SAMPLES as i64).max(floor)
        });
        let new_audio = self.total_samples - self.live.decoded_until.max(start);
        let due = self.decode_cost <= MAX_PREVIEW_DECODE_COST
            && self
                .live
                .last_decoded_at
                .is_none_or(|decoded_at| decoded_at.elapsed() >= partial_interval(self.decode_cost));
        if !self.live_partials
            || self.backlogged
            || self.pending.is_some()
            || !due
            || new_audio < MIN_PREVIEW_STEP_SAMPLES as i64
            || self.total_samples - start < MIN_PARTIAL_SAMPLES as i64
            // Past one decode window the preview waits for the utterance to close.
            || self.total_samples - start > MAX_DECODE_SAMPLES as i64
        {
            return Ok(());
        }
        let samples = collect_history_range(&self.audio_history, self.history_start_sample, start, self.total_samples);
        let context = self.context.clone();
        let hypothesis = self.decode(&samples, &context, 1, "partial")?;
        self.live.last_decoded_at = Some(Instant::now());
        self.live.decoded_until = self.total_samples;
        self.live.agreement.insert(&hypothesis);
        Ok(())
    }
}

impl StreamingRecognizer for WhisperVadRecognizer {
    fn accept_waveform(&mut self, samples: &[f32]) -> Result<RecognitionUpdate, String> {
        self.push_history(samples);
        self.vad.accept(samples)?;
        let (confirmed, span) = self.collect_closed(false)?;
        if !confirmed.is_empty() {
            return Ok(RecognitionUpdate {
                text: confirmed,
                endpoint_detected: true,
                span,
            });
        }
        self.update_live_utterance()?;
        Ok(RecognitionUpdate {
            text: self.normalize(&self.live.agreement.preview()),
            endpoint_detected: false,
            span: None,
        })
    }

    fn finish(&mut self) -> Result<RecognitionUpdate, String> {
        self.vad.flush();
        let (text, span) = self.collect_closed(true)?;
        self.live = LiveUtterance::default();
        Ok(RecognitionUpdate {
            text,
            endpoint_detected: false,
            span,
        })
    }

    fn reset_after_endpoint(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn set_backlogged(&mut self, backlogged: bool) {
        self.backlogged = backlogged;
    }

    fn reset_session(&mut self) -> Result<(), String> {
        self.vad.reset();
        self.audio_history.clear();
        self.history_start_sample = 0;
        self.total_samples = 0;
        self.decoded_until_sample = 0;
        self.live_partials = false;
        self.backlogged = false;
        self.live = LiveUtterance::default();
        self.pending = None;
        self.context.clear();
        Ok(())
    }
}

/// Whisper's code for a configured language: the primary subtag ("es-AR"
/// transcribes as "es").
fn whisper_language(language: &str) -> String {
    language.split(['-', '_']).next().unwrap_or_default().to_ascii_lowercase()
}

/// Appends confirmed text to the session context, keeping only its end.
fn remember(context: &mut String, text: &str) {
    if !context.is_empty() {
        context.push(' ');
    }
    context.push_str(text);
    let excess = context.chars().count().saturating_sub(CONTEXT_CHARACTERS);
    if excess > 0 {
        let cut = context.char_indices().nth(excess).map_or(context.len(), |(index, _)| index);
        context.drain(..cut);
    }
}

/// The last `PROMPT_CHARACTERS` of the context, starting at a whole word.
fn prompt_tail(context: &str) -> &str {
    let characters = context.chars().count();
    if characters <= PROMPT_CHARACTERS {
        return context;
    }
    let start = context
        .char_indices()
        .nth(characters - PROMPT_CHARACTERS)
        .map_or(context.len(), |(index, _)| index);
    let tail = &context[start..];
    tail.find(' ').map_or(tail, |space| &tail[space + 1..])
}

/// Removes the sentences Whisper is known to invent over silence or noise:
/// subtitle credits and video sign-offs learned from its training data, and
/// its own style prompt repeated.
fn drop_known_hallucinations(text: &str) -> String {
    const SENTENCES: &[&str] = &[
        "transcripción en español con signos de puntuación",
        "gracias por ver el video",
        "gracias por ver",
        "suscríbete al canal",
        "suscríbete",
        "no olvides suscribirte",
        "thank you for watching",
        "thanks for watching",
    ];
    let mut kept = Vec::new();
    let mut sentence_start = 0;
    // A period inside a word ("Amara.org") does not end a sentence.
    let boundaries = text
        .char_indices()
        .filter(|&(index, character)| {
            matches!(character, '.' | '!' | '?' | '…')
                && text[index + character.len_utf8()..].chars().next().is_none_or(char::is_whitespace)
        })
        .map(|(index, character)| index + character.len_utf8())
        .chain(std::iter::once(text.len()));
    for end in boundaries {
        let sentence = &text[sentence_start..end];
        sentence_start = end;
        let words = sentence
            .split(|character: char| !character.is_alphanumeric())
            .filter(|word| !word.is_empty())
            .map(str::to_lowercase)
            .collect::<Vec<_>>()
            .join(" ");
        let invented = words.contains("amara org")
            || words.starts_with("subtítulos por")
            || words.starts_with("subtitulado por")
            || SENTENCES.contains(&words.as_str());
        if !invented && !sentence.trim().is_empty() {
            kept.push(sentence.trim());
        }
    }
    kept.join(" ")
}

/// Gain that brings the 90th percentile of the 20 ms frame levels of
/// `samples` to `DECODE_LEVEL`, up to `DECODE_MAX_GAIN` and never clipping.
fn speech_gain(samples: &[f32]) -> f32 {
    let mut levels = samples
        .chunks_exact(LEVEL_FRAME_SAMPLES)
        .map(|frame| (frame.iter().map(|sample| sample * sample).sum::<f32>() / frame.len() as f32).sqrt())
        .collect::<Vec<_>>();
    if levels.is_empty() {
        return 1.0;
    }
    levels.sort_by(f32::total_cmp);
    let level = levels[levels.len() * 9 / 10];
    let peak = samples.iter().fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
    if level <= f32::EPSILON || peak <= f32::EPSILON {
        return 1.0;
    }
    (DECODE_LEVEL / level).min(DECODE_MAX_GAIN).min(DECODE_MAX_PEAK / peak)
}

/// Ranges that cover `samples` in pieces of at most `max` samples. Every piece
/// but the last lasts at least `min` and ends in the middle of the quietest
/// 20 ms frame after that, which is usually a pause between words.
fn quiet_pieces(samples: &[f32], min: usize, max: usize) -> Vec<Range<usize>> {
    let energy = |frame: usize| -> f32 {
        samples[frame..frame + LEVEL_FRAME_SAMPLES].iter().map(|sample| sample * sample).sum()
    };
    let mut pieces = Vec::new();
    let mut start = 0;
    while samples.len() - start > max {
        let last_frame = start + max - LEVEL_FRAME_SAMPLES;
        let quietest = (start + min..=last_frame)
            .step_by(LEVEL_FRAME_SAMPLES)
            .min_by(|left, right| energy(*left).total_cmp(&energy(*right)))
            .unwrap_or(last_frame);
        let end = quietest + LEVEL_FRAME_SAMPLES / 2;
        pieces.push(start..end);
        start = end;
    }
    pieces.push(start..samples.len());
    pieces
}

/// Waits at least twice the last decoding cost so previews never take more
/// than half of the time available to the worker.
fn partial_interval(last_decode_cost: Duration) -> Duration {
    MIN_PARTIAL_INTERVAL.max(last_decode_cost.saturating_mul(2))
}

fn collect_history_range(
    history: &VecDeque<f32>,
    history_start: i64,
    requested_start: i64,
    requested_end: i64,
) -> Vec<f32> {
    let start = requested_start.max(history_start).saturating_sub(history_start) as usize;
    let end = requested_end.max(history_start).saturating_sub(history_start) as usize;
    if start >= history.len() || start >= end {
        return Vec::new();
    }
    history.range(start..end.min(history.len())).copied().collect()
}

#[cfg(test)]
mod tests {
    use super::{
        collect_history_range, drop_known_hallucinations, partial_interval, prompt_tail, quiet_pieces, remember,
        speech_gain, whisper_language, CONTEXT_CHARACTERS, DECODE_MAX_GAIN, DECODE_MAX_PEAK, MIN_PARTIAL_INTERVAL, PROMPT_CHARACTERS,
        SAMPLE_RATE,
    };
    use std::collections::VecDeque;
    use std::time::Duration;

    #[test]
    fn drops_subtitle_credits_and_sign_offs_but_keeps_real_speech() {
        assert_eq!(
            drop_known_hallucinations("Nos vemos el lunes. Subtítulos realizados por la comunidad de Amara.org"),
            "Nos vemos el lunes."
        );
        assert_eq!(drop_known_hallucinations("¡Gracias por ver el video!"), "");
        assert_eq!(drop_known_hallucinations("Suscríbete al canal."), "");
        // Thanks inside a meeting is speech.
        assert_eq!(drop_known_hallucinations("Gracias. ¿Seguimos?"), "Gracias. ¿Seguimos?");
        assert_eq!(
            drop_known_hallucinations("Gracias por ver el informe antes de la reunión."),
            "Gracias por ver el informe antes de la reunión."
        );
        assert_eq!(drop_known_hallucinations("Hola, ¿qué tal?"), "Hola, ¿qué tal?");
        assert_eq!(drop_known_hallucinations(super::SPANISH_STYLE_PROMPT), "");
    }

    #[test]
    fn a_long_utterance_is_cut_in_its_pauses_into_decode_windows() {
        // Ten seconds of speech with 100 ms pauses at 2.5 s and 6.2 s.
        let pause = |at: f32| {
            let start = (at * SAMPLE_RATE as f32) as usize;
            start..start + SAMPLE_RATE / 10
        };
        let samples = (0..SAMPLE_RATE * 10)
            .map(|index| if pause(2.5).contains(&index) || pause(6.2).contains(&index) { 0.0 } else { 0.5 })
            .collect::<Vec<_>>();
        let pieces = quiet_pieces(&samples, SAMPLE_RATE * 2, SAMPLE_RATE * 4);
        assert_eq!(pieces.len(), 3);
        assert_eq!(pieces[0].start, 0);
        assert_eq!(pieces[2].end, samples.len());
        assert!(pieces.windows(2).all(|pair| pair[0].end == pair[1].start));
        assert!(pieces.iter().all(|piece| piece.len() <= SAMPLE_RATE * 4));
        assert!(pause(2.5).contains(&pieces[0].end));
        assert!(pause(6.2).contains(&pieces[1].end));
        // An utterance that fits one window stays whole.
        assert_eq!(quiet_pieces(&samples[..SAMPLE_RATE * 4], SAMPLE_RATE * 2, SAMPLE_RATE * 4), vec![0..SAMPLE_RATE * 4]);
        assert_eq!(quiet_pieces(&[], SAMPLE_RATE * 2, SAMPLE_RATE * 4), vec![0..0]);
    }

    #[test]
    fn transcribes_a_regional_language_with_its_primary_code() {
        assert_eq!(whisper_language("es"), "es");
        assert_eq!(whisper_language("es-AR"), "es");
        assert_eq!(whisper_language("pt_BR"), "pt");
        assert_eq!(whisper_language("auto"), "auto");
    }

    #[test]
    fn the_prompt_is_the_end_of_the_confirmed_text_from_a_whole_word() {
        let mut context = String::new();
        remember(&mut context, "Hola.");
        remember(&mut context, "¿Cómo están?");
        assert_eq!(context, "Hola. ¿Cómo están?");
        assert_eq!(prompt_tail(&context), "Hola. ¿Cómo están?");
        for _ in 0..200 {
            remember(&mut context, "Revisamos el presupuesto del trimestre.");
        }
        assert!(context.chars().count() <= CONTEXT_CHARACTERS);
        let prompt = prompt_tail(&context);
        assert!(prompt.chars().count() <= PROMPT_CHARACTERS);
        let first_word = prompt.split(' ').next().unwrap_or_default();
        assert!(["Revisamos", "el", "presupuesto", "del", "trimestre."].contains(&first_word), "prompt {prompt}");
        assert!(prompt.ends_with("trimestre."));
    }

    #[test]
    fn chunks_are_decoded_at_a_steady_level() {
        // Quiet speech (-40 dBFS) with a pause: its loud frames reach -20 dBFS.
        let quiet = (0..SAMPLE_RATE * 2)
            .map(|index| if index < SAMPLE_RATE / 2 { 0.0 } else { 0.01 * (index as f32 * 0.3).sin().signum() })
            .collect::<Vec<_>>();
        assert!((speech_gain(&quiet) - 10.0).abs() < 0.01);
        // Near silence is raised at most 30 dB, loud audio is lowered, and
        // no chunk is pushed into clipping.
        assert_eq!(speech_gain(&[1e-5; 3_200]), DECODE_MAX_GAIN);
        assert!((speech_gain(&[0.5; 3_200]) - 0.2).abs() < 1e-4);
        let mut spiky = vec![0.001; 3_200];
        spiky[100] = 0.9;
        assert!(speech_gain(&spiky) * 0.9 <= DECODE_MAX_PEAK + 1e-4);
        assert_eq!(speech_gain(&[0.0; 3_200]), 1.0);
        assert_eq!(speech_gain(&[0.2; 10]), 1.0);
    }

    #[test]
    fn previews_back_off_when_decoding_is_slow() {
        assert_eq!(partial_interval(Duration::ZERO), MIN_PARTIAL_INTERVAL);
        assert_eq!(partial_interval(Duration::from_millis(900)), Duration::from_millis(1_800));
    }

    #[test]
    fn collects_available_audio_before_the_utterance_start() {
        let history = (0..100).map(|value| value as f32).collect::<VecDeque<_>>();
        assert_eq!(collect_history_range(&history, 0, 70, 80), (70..80).map(|value| value as f32).collect::<Vec<_>>());
        assert_eq!(collect_history_range(&history, 50, 40, 55), (0..5).map(|value| value as f32).collect::<Vec<_>>());
        assert!(collect_history_range(&history, 0, 80, 70).is_empty());
    }
}

#[cfg(all(test, target_os = "windows"))]
mod native_smoke_tests {
    use super::{WhisperAsrConfig, WhisperVadRecognizer};
    use crate::services::speech_worker::{RecognitionUpdate, StreamingRecognizer};
    use std::path::PathBuf;

    fn load(live_partials: bool) -> WhisperVadRecognizer {
        let root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/.."));
        let models = root.join("resources/speech/models/whisper-large-v3-turbo");
        let mut recognizer = WhisperVadRecognizer::load(
            &root.join("resources/whisper/runtime/windows-x86_64/notia_whisper.dll"),
            &root.join("resources/speech/runtime/windows-x86_64/sherpa-onnx-c-api.dll"),
            &WhisperAsrConfig {
                model: models.join("ggml-large-v3-turbo-q8_0.bin"),
                vad: models.join("silero_vad.onnx"),
                num_threads: 4,
                language: "es".to_string(),
            },
        )
        .expect("load the packaged Whisper model, its runtime and Silero VAD");
        if live_partials {
            recognizer.enable_live_partials();
        }
        recognizer
    }

    #[test]
    #[ignore = "requires the speech installer assets, the whisper.cpp runtime and loads the full Whisper model"]
    fn loads_decodes_silence_and_recycles() {
        let mut recognizer = load(true);
        let update = recognizer.accept_waveform(&[0.0; 16_000]).expect("accept silence");
        assert!(update.text.is_empty());
        assert!(recognizer.finish().expect("finish").text.is_empty());
        recognizer.reset_session().expect("reset");
    }

    /// Transcribes every 16 kHz mono WAV of `NOTIA_ASR_PROBE_DIR` as a live
    /// session does, in 200 ms batches, and writes the confirmed lines next
    /// to it as `<name>.out.txt` (`start_ms end_ms text` per line) and the
    /// previews as `<name>.partial.txt`.
    #[test]
    #[ignore = "requires NOTIA_ASR_PROBE_DIR and loads the full Whisper model"]
    fn transcribes_probe_recordings() {
        let Ok(dir) = std::env::var("NOTIA_ASR_PROBE_DIR") else {
            return;
        };
        let mut recognizer = load(true);
        let mut wavs = std::fs::read_dir(&dir)
            .expect("read probe dir")
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.extension().is_some_and(|extension| extension == "wav"))
            .collect::<Vec<_>>();
        wavs.sort();
        for wav in wavs {
            let samples = hound::WavReader::open(&wav)
                .expect("open probe wav")
                .into_samples::<i16>()
                .map(|sample| f32::from(sample.expect("probe sample")) / f32::from(i16::MAX))
                .collect::<Vec<_>>();
            let started_at = std::time::Instant::now();
            let mut lines = Vec::new();
            let mut partials = Vec::new();
            let keep = |update: RecognitionUpdate, lines: &mut Vec<String>| {
                if !update.text.is_empty() {
                    let (start, end) = update.span.map_or((0, 0), |span| (span.start_ms(), span.end_ms()));
                    lines.push(format!("{start} {end} {}", update.text));
                }
            };
            for batch in samples.chunks(3_200) {
                let update = recognizer.accept_waveform(batch).expect("accept probe audio");
                if update.endpoint_detected {
                    keep(update, &mut lines);
                } else if partials.last() != Some(&update.text) && !update.text.is_empty() {
                    partials.push(update.text);
                }
            }
            keep(recognizer.finish().expect("finish probe"), &mut lines);
            recognizer.reset_session().expect("reset probe");
            recognizer.enable_live_partials();
            std::fs::write(wav.with_extension("out.txt"), lines.join("\n")).expect("write probe output");
            std::fs::write(wav.with_extension("partial.txt"), partials.join("\n")).expect("write probe previews");
            eprintln!(
                "{}: {} lines, {} previews, {:.1} s audio in {:.1} s",
                wav.display(),
                lines.len(),
                partials.len(),
                samples.len() as f32 / 16_000.0,
                started_at.elapsed().as_secs_f32()
            );
        }
    }
}
