use serde::Deserialize;
use tauri::{AppHandle, Manager, State};

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

#[tauri::command]
pub async fn prepare_qwen3_tts(app: AppHandle, input: PrepareQwen3TtsInput) -> Result<(), String> {
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = worker_app.state::<Qwen3TtsRuntimeState>();
        qwen3_tts_service::prepare(&worker_app, &state, &input.model, &input.device)
    })
    .await
    .map_err(|error| format!("Falló la preparación de Qwen3-TTS: {error}"))?
}

#[tauri::command]
pub fn get_qwen3_tts_status(state: State<'_, Qwen3TtsRuntimeState>) -> Qwen3TtsStatusDto {
    qwen3_tts_service::status(&state)
}

#[tauri::command]
pub fn reload_qwen3_tts(state: State<'_, Qwen3TtsRuntimeState>) -> Result<(), String> {
    qwen3_tts_service::reload(&state)
}

#[tauri::command]
pub async fn synthesize_qwen3_tts_speech(
    app: AppHandle,
    input: Qwen3TtsSynthesisInput,
) -> Result<Vec<u8>, String> {
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
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
