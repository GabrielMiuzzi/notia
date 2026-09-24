#![cfg(any(target_os = "windows", target_os = "android"))]

//! The ASR engines Notia can run. The speech session, the preload cache,
//! Telegram voice notes and diarization turns only see this type.

use crate::services::qwen3_asr_service::{Qwen3AsrModelConfig, Qwen3AsrRecognizer};
use crate::services::sherpa_offline::{OfflineNemoTransducerConfig, OfflineVadRecognizer};
use crate::services::speech_audio::PcmBufferStats;
use crate::services::speech_worker::{RecognitionUpdate, StreamingRecognizer};
use crate::host::AppHandle;

#[derive(Debug, Clone)]
pub enum AsrModelConfig {
    Parakeet(OfflineNemoTransducerConfig),
    Qwen3(Qwen3AsrModelConfig),
}

pub enum AsrRecognizer {
    Parakeet(OfflineVadRecognizer),
    Qwen3(Qwen3AsrRecognizer),
}

impl AsrRecognizer {
    pub fn load(app: &AppHandle, config: &AsrModelConfig) -> Result<Self, String> {
        match config {
            AsrModelConfig::Parakeet(model) => {
                let runtime = crate::services::sherpa_runtime::resolve_platform_runtime_path(app)?;
                OfflineVadRecognizer::load(&runtime, model).map(Self::Parakeet)
            }
            AsrModelConfig::Qwen3(model) => Qwen3AsrRecognizer::load(app, model).map(Self::Qwen3),
        }
    }

    pub fn matches(&self, config: &AsrModelConfig) -> bool {
        match (self, config) {
            (Self::Parakeet(recognizer), AsrModelConfig::Parakeet(model)) => {
                recognizer.matches(model)
            }
            (Self::Qwen3(recognizer), AsrModelConfig::Qwen3(model)) => recognizer.matches(model),
            _ => false,
        }
    }

    /// Previews of the ongoing utterance for a live session. Qwen3-ASR always
    /// produces them; Parakeet only when a person is watching the text.
    pub fn enable_live_partials(&mut self) {
        if let Self::Parakeet(recognizer) = self {
            recognizer.enable_live_partials();
        }
    }
}

impl StreamingRecognizer for AsrRecognizer {
    fn update_capture_stats(&mut self, stats: PcmBufferStats) {
        match self {
            Self::Parakeet(recognizer) => recognizer.update_capture_stats(stats),
            Self::Qwen3(recognizer) => recognizer.update_capture_stats(stats),
        }
    }

    fn accept_waveform(&mut self, samples: &[f32]) -> Result<RecognitionUpdate, String> {
        match self {
            Self::Parakeet(recognizer) => recognizer.accept_waveform(samples),
            Self::Qwen3(recognizer) => recognizer.accept_waveform(samples),
        }
    }

    fn finish(&mut self) -> Result<RecognitionUpdate, String> {
        match self {
            Self::Parakeet(recognizer) => recognizer.finish(),
            Self::Qwen3(recognizer) => recognizer.finish(),
        }
    }

    fn reset_after_endpoint(&mut self) -> Result<(), String> {
        match self {
            Self::Parakeet(recognizer) => recognizer.reset_after_endpoint(),
            Self::Qwen3(recognizer) => recognizer.reset_after_endpoint(),
        }
    }

    fn reset_session(&mut self) -> Result<(), String> {
        match self {
            Self::Parakeet(recognizer) => recognizer.reset_session(),
            Self::Qwen3(recognizer) => recognizer.reset_session(),
        }
    }
}
