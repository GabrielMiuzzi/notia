use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramTokenPayload {
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramUpdatesPayload {
    token: String,
    offset: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramButton {
    label: String,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramSendPayload {
    token: String,
    chat_id: i64,
    text: String,
    #[serde(default)]
    buttons: Vec<TelegramButton>,
    parse_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramTranscribePayload {
    token: String,
    audio: crate::services::telegram_service::TelegramAudio,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramDownloadPhotoPayload {
    token: String,
    photo: crate::services::telegram_service::TelegramPhoto,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramDownloadedPhoto {
    file_id: String,
    mime_type: String,
    base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramCallbackPayload {
    token: String,
    callback_query_id: String,
}

#[tauri::command]
pub async fn check_telegram_bot(
    payload: TelegramTokenPayload,
) -> Result<crate::services::telegram_service::TelegramIdentity, String> {
    crate::services::telegram_service::check_bot(&payload.token).await
}

#[tauri::command]
pub async fn poll_telegram_updates(
    payload: TelegramUpdatesPayload,
) -> Result<Vec<crate::services::telegram_service::IncomingTelegramUpdate>, String> {
    crate::services::telegram_service::get_updates(&payload.token, payload.offset).await
}

#[tauri::command]
pub async fn send_telegram_message(payload: TelegramSendPayload) -> Result<(), String> {
    crate::services::telegram_service::send_message(
        &payload.token,
        payload.chat_id,
        &payload.text,
        payload
            .buttons
            .into_iter()
            .map(|button| (button.label, button.data))
            .collect(),
        payload.parse_mode.as_deref(),
    )
    .await
}

#[tauri::command]
#[cfg(any(target_os = "windows", target_os = "android"))]
pub async fn transcribe_telegram_audio(
    payload: TelegramTranscribePayload,
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::services::speech_service::SpeechRuntimeState>,
) -> Result<String, String> {
    let bytes =
        crate::services::telegram_service::download_audio(&payload.token, &payload.audio).await?;
    if state
        .phase
        .lock()
        .map_err(|_| "No se pudo consultar el estado de voz.".to_string())?
        .is_active()
    {
        return Err("El dictado local esta usando el reconocedor de voz.".to_string());
    }
    let recognizer_cache = crate::services::speech_service::recognizer_cache(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let samples = crate::services::telegram_audio::decode_telegram_ogg_opus(bytes)?;
        crate::services::speech_service::transcribe_external_audio(
            &app,
            &recognizer_cache,
            &samples,
        )
    })
    .await
    .map_err(|_| "Fallo el worker de transcripcion de Telegram.".to_string())?
}

#[tauri::command]
pub async fn download_telegram_photo(
    payload: TelegramDownloadPhotoPayload,
) -> Result<TelegramDownloadedPhoto, String> {
    let bytes =
        crate::services::telegram_service::download_photo(&payload.token, &payload.photo).await?;
    Ok(TelegramDownloadedPhoto {
        file_id: payload.photo.file_id,
        mime_type: "image/jpeg".to_string(),
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[tauri::command]
#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub async fn transcribe_telegram_audio(
    payload: TelegramTranscribePayload,
    _app: tauri::AppHandle,
    _state: tauri::State<'_, crate::services::speech_service::SpeechRuntimeState>,
) -> Result<String, String> {
    let _ = payload;
    Err("La transcripcion de audios de Telegram no esta disponible en esta plataforma.".to_string())
}

#[tauri::command]
pub async fn answer_telegram_callback(payload: TelegramCallbackPayload) -> Result<(), String> {
    crate::services::telegram_service::answer_callback(&payload.token, &payload.callback_query_id)
        .await
}
