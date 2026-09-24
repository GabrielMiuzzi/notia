use serde::Deserialize;
use crate::host::{AppHandle, Manager, State};

use crate::services::qwen3_tts_service::{self, Qwen3TtsRuntimeState, Qwen3TtsStatusDto};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Qwen3TtsSynthesisInput {
    text: String,
    voice: String,
    language: String,
    speed: f32,
    model: String,
    device: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareQwen3TtsInput {
    model: String,
    device: String,
}

pub async fn prepare_qwen3_tts(app: AppHandle, input: PrepareQwen3TtsInput) -> Result<(), String> {
    let worker_app = app.clone();
    crate::host::async_runtime::spawn_blocking(move || {
        let state = worker_app.state::<Qwen3TtsRuntimeState>();
        qwen3_tts_service::prepare(&worker_app, &state, &input.model, &input.device)
    })
    .await
    .map_err(|error| format!("Falló la preparación de Qwen3-TTS: {error}"))?
}

pub fn get_qwen3_tts_status(state: State<'_, Qwen3TtsRuntimeState>) -> Qwen3TtsStatusDto {
    qwen3_tts_service::status(&state)
}

pub fn reload_qwen3_tts(state: State<'_, Qwen3TtsRuntimeState>) -> Result<(), String> {
    qwen3_tts_service::reload(&state)
}

pub async fn synthesize_qwen3_tts_speech(
    app: AppHandle,
    input: Qwen3TtsSynthesisInput,
) -> Result<Vec<u8>, String> {
    let worker_app = app.clone();
    crate::host::async_runtime::spawn_blocking(move || {
        let state = worker_app.state::<Qwen3TtsRuntimeState>();
        qwen3_tts_service::synthesize(
            &worker_app,
            &state,
            &input.text,
            &input.voice,
            &input.language,
            input.speed,
            &input.model,
            &input.device,
        )
    })
    .await
    .map_err(|error| format!("Fallo la tarea de sintesis Qwen3-TTS: {error}"))?
}

/// Texts to synthesize, in order, for an answer written in Markdown.
pub fn qwen3_tts_speech_plan(markdown: String) -> Vec<String> {
    notia_backend_core::speech_text::speech_plan(&markdown)
}
