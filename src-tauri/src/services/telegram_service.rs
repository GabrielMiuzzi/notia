use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const TELEGRAM_API_BASE: &str = "https://api.telegram.org";
const MAX_MESSAGE_CHARS: usize = 4_000;

#[derive(Debug, Deserialize)]
struct TelegramResponse<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramIdentity {
    pub id: i64,
    pub username: Option<String>,
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
struct TelegramUser {
    id: i64,
    username: Option<String>,
    first_name: String,
    last_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramChat {
    id: i64,
}

#[derive(Debug, Deserialize)]
struct TelegramMessage {
    message_id: i64,
    from: Option<TelegramUser>,
    chat: TelegramChat,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramCallbackQuery {
    id: String,
    from: TelegramUser,
    message: Option<TelegramMessage>,
    data: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramUpdate {
    update_id: i64,
    message: Option<TelegramMessage>,
    callback_query: Option<TelegramCallbackQuery>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingTelegramUpdate {
    pub update_id: i64,
    pub chat_id: i64,
    pub user: TelegramIdentity,
    pub message_id: Option<i64>,
    pub text: Option<String>,
    pub callback_query_id: Option<String>,
    pub callback_data: Option<String>,
}

fn endpoint(token: &str, method: &str) -> Result<String, String> {
    let token = token.trim();
    if token.is_empty()
        || token.len() > 256
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b":_-".contains(&byte))
    {
        return Err("El token de Telegram tiene un formato invalido.".to_string());
    }
    Ok(format!("{TELEGRAM_API_BASE}/bot{token}/{method}"))
}

fn identity(user: TelegramUser) -> TelegramIdentity {
    let display_name = match user.last_name.as_deref() {
        Some(last_name) if !last_name.trim().is_empty() => {
            format!("{} {last_name}", user.first_name)
        }
        _ => user.first_name.clone(),
    };
    TelegramIdentity {
        id: user.id,
        username: user.username,
        display_name,
    }
}

async fn decode<T: for<'de> Deserialize<'de>>(response: reqwest::Response) -> Result<T, String> {
    let payload = response
        .json::<TelegramResponse<T>>()
        .await
        .map_err(|_| "Telegram devolvio una respuesta invalida.".to_string())?;
    if !payload.ok {
        return Err(payload
            .description
            .unwrap_or_else(|| "Telegram rechazo la solicitud.".to_string()));
    }
    payload
        .result
        .ok_or_else(|| "Telegram no devolvio un resultado.".to_string())
}

pub async fn check_bot(token: &str) -> Result<TelegramIdentity, String> {
    let response = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .get(endpoint(token, "getMe")?)
        .send()
        .await
        .map_err(|_| "No se pudo conectar con Telegram.".to_string())?;
    decode::<TelegramUser>(response).await.map(identity)
}

pub async fn get_updates(token: &str, offset: i64) -> Result<Vec<IncomingTelegramUpdate>, String> {
    let response = Client::builder().timeout(Duration::from_secs(35)).build().map_err(|error| error.to_string())?
        .post(endpoint(token, "getUpdates")?)
        .json(&serde_json::json!({ "offset": offset, "timeout": 25, "allowed_updates": ["message", "callback_query"] }))
        .send().await.map_err(|_| "Se interrumpio la conexion con Telegram.".to_string())?;
    let updates = decode::<Vec<TelegramUpdate>>(response).await?;
    Ok(updates
        .into_iter()
        .filter_map(|update| {
            if let Some(message) = update.message {
                let user = message.from.map(identity)?;
                return Some(IncomingTelegramUpdate {
                    update_id: update.update_id,
                    chat_id: message.chat.id,
                    user,
                    message_id: Some(message.message_id),
                    text: message.text,
                    callback_query_id: None,
                    callback_data: None,
                });
            }
            let callback = update.callback_query?;
            let chat_id = callback.message?.chat.id;
            Some(IncomingTelegramUpdate {
                update_id: update.update_id,
                chat_id,
                user: identity(callback.from),
                message_id: None,
                text: None,
                callback_query_id: Some(callback.id),
                callback_data: callback.data,
            })
        })
        .collect())
}

pub async fn send_message(
    token: &str,
    chat_id: i64,
    text: &str,
    buttons: Vec<(String, String)>,
) -> Result<(), String> {
    let text: String = text.chars().take(MAX_MESSAGE_CHARS).collect();
    let keyboard: Vec<Vec<serde_json::Value>> = buttons
        .into_iter()
        .map(|(label, data)| vec![serde_json::json!({ "text": label, "callback_data": data })])
        .collect();
    let mut body = serde_json::json!({ "chat_id": chat_id, "text": text });
    if !keyboard.is_empty() {
        body["reply_markup"] = serde_json::json!({ "inline_keyboard": keyboard });
    }
    let response = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .post(endpoint(token, "sendMessage")?)
        .json(&body)
        .send()
        .await
        .map_err(|_| "No se pudo enviar el mensaje a Telegram.".to_string())?;
    decode::<serde_json::Value>(response).await.map(|_| ())
}

pub async fn answer_callback(token: &str, callback_query_id: &str) -> Result<(), String> {
    let response = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .post(endpoint(token, "answerCallbackQuery")?)
        .json(&serde_json::json!({ "callback_query_id": callback_query_id }))
        .send()
        .await
        .map_err(|_| "No se pudo confirmar la accion en Telegram.".to_string())?;
    decode::<bool>(response).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::endpoint;

    #[test]
    fn endpoint_rejects_tokens_with_url_characters() {
        assert!(endpoint("https://example.com", "getMe").is_err());
        assert!(endpoint("123:abc/def", "getMe").is_err());
    }

    #[test]
    fn endpoint_accepts_standard_bot_token_shape() {
        assert_eq!(
            endpoint("123456:ABC_def-9", "getMe").unwrap(),
            "https://api.telegram.org/bot123456:ABC_def-9/getMe"
        );
    }
}
