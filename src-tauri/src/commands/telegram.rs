use serde::Deserialize;

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
    )
    .await
}

#[tauri::command]
pub async fn answer_telegram_callback(payload: TelegramCallbackPayload) -> Result<(), String> {
    crate::services::telegram_service::answer_callback(&payload.token, &payload.callback_query_id)
        .await
}
