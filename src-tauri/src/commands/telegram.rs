//! Telegram commands of the interface. The bot itself runs in the backend
//! (`telegram_worker.rs`); the WebView only validates a token before the
//! user saves it, so it never sends messages or reads updates.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramTokenPayload {
    token: String,
}

#[tauri::command]
pub async fn check_telegram_bot(
    payload: TelegramTokenPayload,
) -> Result<crate::services::telegram_service::TelegramIdentity, String> {
    crate::services::telegram_service::check_bot(&payload.token).await
}
