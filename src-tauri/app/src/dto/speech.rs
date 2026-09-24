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
    /// The computer audio can be captured (Windows).
    pub system_audio_supported: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSpeechSessionPayload {
    pub language: String,
    pub diarization_enabled: bool,
    pub max_duration_seconds: u32,
    #[serde(default)]
    pub capture_system_audio: bool,
    #[serde(default = "default_true")]
    pub capture_microphone: bool,
    /// Speakers the diarization must find; `None` lets it decide.
    #[serde(default)]
    pub expected_speakers: Option<u32>,
    /// The session records a Meeting.
    #[serde(default)]
    pub meeting: Option<MeetingSessionOptions>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSessionOptions {
    #[serde(default)]
    pub live_answers: bool,
    /// Provider preferences for the live answers.
    #[serde(default)]
    pub settings: Option<notia_backend_core::ai_settings::AiSettingsInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMonitorPayload {
    pub microphone: bool,
    pub system: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMonitorStopPayload {
    pub monitor_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMonitorResultDto {
    pub monitor_id: String,
}

/// Loudness from 0 to 1 of each open source; `None` for a closed one.
#[cfg_attr(not(any(target_os = "windows", target_os = "android")), allow(dead_code))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechLevelsEventDto {
    pub session_id: String,
    pub microphone: Option<f32>,
    pub system: Option<f32>,
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

#[derive(Debug, Clone)]
pub struct DiarizedTranscriptDto {
    pub text: String,
    pub segments: Vec<SpeechTranscriptSegmentDto>,
    pub speaker_count: u32,
}

/// Serialized with `formattedText`: the text labelled by speaker that the
/// interface shows and inserts.
impl Serialize for DiarizedTranscriptDto {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let segments = self
            .segments
            .iter()
            .map(|segment| (segment.speaker_id.as_deref(), segment.text.as_str()))
            .collect::<Vec<_>>();
        let formatted = notia_backend_core::speech_text::format_diarized(&self.text, &segments, self.speaker_count);
        let mut state = serializer.serialize_struct("DiarizedTranscriptDto", 4)?;
        state.serialize_field("text", &self.text)?;
        state.serialize_field("segments", &self.segments)?;
        state.serialize_field("speakerCount", &self.speaker_count)?;
        state.serialize_field("formattedText", &formatted)?;
        state.end()
    }
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
        /// `transcribing`, `detecting-speakers` or `assigning-turns`.
        #[serde(skip_serializing_if = "Option::is_none")]
        stage: Option<&'static str>,
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
