use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechCapabilitiesDto {
    pub supported: bool,
    pub platform: String,
    pub architecture: String,
    pub permission: String,
    pub asr_model_installed: bool,
    pub diarization_model_installed: bool,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSpeechSessionPayload {
    pub language: String,
    pub model: String,
    pub device: String,
    pub diarization_enabled: bool,
    pub max_duration_seconds: u32,
    #[serde(default)]
    pub capture_system_audio: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSessionPayload {
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSpeechSessionResultDto {
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModelFileStatusDto {
    pub relative_path: String,
    pub expected_bytes: u64,
    pub installed: bool,
    pub valid: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModelProfileStatusDto {
    pub profile_id: String,
    pub language: String,
    pub ready: bool,
    pub asr_ready: bool,
    pub diarization_ready: bool,
    pub files: Vec<SpeechModelFileStatusDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModelStatusDto {
    pub schema_version: u32,
    pub profiles: Vec<SpeechModelProfileStatusDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechAudioInputStatusDto {
    pub supported: bool,
    pub available: bool,
    pub device_label: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SherpaRuntimeStatusDto {
    pub supported: bool,
    pub installed: bool,
    pub compatible: bool,
    pub expected_version: String,
    pub runtime_version: Option<String>,
    pub onnx_runtime_version: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechErrorDto {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechTranscriptSegmentDto {
    pub id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub speaker_id: Option<String>,
    pub text: String,
    pub is_final: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizedTranscriptDto {
    pub text: String,
    pub segments: Vec<SpeechTranscriptSegmentDto>,
    pub speaker_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SpeechSessionStateDto {
    #[allow(dead_code)]
    Idle,
    Preparing {
        #[serde(skip_serializing_if = "Option::is_none")]
        progress: Option<f32>,
    },
    Recording {
        elapsed_ms: u64,
        has_speech: bool,
    },
    Paused {
        elapsed_ms: u64,
    },
    Finalizing {
        #[serde(skip_serializing_if = "Option::is_none")]
        progress: Option<f32>,
    },
    Completed {
        transcript: DiarizedTranscriptDto,
    },
    Error {
        error: SpeechErrorDto,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSessionEventDto {
    pub session_id: String,
    pub state: SpeechSessionStateDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechPartialEventDto {
    pub session_id: String,
    pub confirmed_text: String,
    pub partial_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSegmentsEventDto {
    pub session_id: String,
    pub transcript: DiarizedTranscriptDto,
}
