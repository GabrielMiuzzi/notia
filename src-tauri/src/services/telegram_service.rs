use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const TELEGRAM_API_BASE: &str = "https://api.telegram.org";
const MAX_MESSAGE_CHARS: usize = 4_000;
const MAX_AUDIO_BYTES: u64 = 20 * 1024 * 1024;
const MAX_AUDIO_DURATION_SECONDS: u32 = 15 * 60;
const MAX_PHOTO_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PHOTO_PIXELS: u64 = 16_000_000;
const MAX_DOCUMENT_BYTES: u64 = 15 * 1024 * 1024;

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
    caption: Option<String>,
    photo: Option<Vec<TelegramPhoto>>,
    document: Option<TelegramDocument>,
    voice: Option<TelegramAudio>,
    audio: Option<TelegramAudio>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramAudio {
    #[serde(alias = "file_id")]
    file_id: String,
    duration: u32,
    #[serde(alias = "mime_type")]
    mime_type: Option<String>,
    #[serde(alias = "file_size")]
    file_size: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TelegramPhoto {
    #[serde(alias = "file_id")]
    pub file_id: String,
    #[serde(alias = "file_size")]
    pub file_size: Option<u64>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TelegramDocument {
    #[serde(alias = "file_id")]
    pub file_id: String,
    #[serde(alias = "file_name")]
    pub file_name: Option<String>,
    #[serde(alias = "mime_type")]
    pub mime_type: Option<String>,
    #[serde(alias = "file_size")]
    pub file_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TelegramFile {
    file_path: Option<String>,
    file_size: Option<u64>,
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
    pub audio: Option<TelegramAudio>,
    pub photo: Option<TelegramPhoto>,
    pub document: Option<TelegramDocument>,
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
                    text: message.text.or(message.caption),
                    audio: message.voice.or(message.audio),
                    photo: message.photo.and_then(|photos| {
                        photos
                            .into_iter()
                            .max_by_key(|photo| u64::from(photo.width) * u64::from(photo.height))
                    }),
                    document: message.document,
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
                audio: None,
                photo: None,
                document: None,
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
    parse_mode: Option<&str>,
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
    if let Some(parse_mode) = parse_mode {
        if parse_mode != "HTML" {
            return Err("El formato del mensaje de Telegram no es valido.".to_string());
        }
        body["parse_mode"] = serde_json::Value::String(parse_mode.to_string());
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

pub async fn download_audio(token: &str, audio: &TelegramAudio) -> Result<Vec<u8>, String> {
    if audio.file_id.is_empty() || audio.file_id.len() > 256 {
        return Err("El identificador del audio de Telegram no es valido.".to_string());
    }
    if audio.duration == 0 || audio.duration > MAX_AUDIO_DURATION_SECONDS {
        return Err("El audio de Telegram supera los quince minutos permitidos.".to_string());
    }
    if audio
        .file_size
        .is_some_and(|size| size == 0 || size > MAX_AUDIO_BYTES)
    {
        return Err("El audio de Telegram supera el tamaño permitido.".to_string());
    }
    if let Some(mime_type) = audio.mime_type.as_deref() {
        if !matches!(mime_type, "audio/ogg" | "audio/opus" | "application/ogg") {
            return Err("Por ahora Telegram solo admite notas de voz OGG/Opus.".to_string());
        }
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .post(endpoint(token, "getFile")?)
        .json(&serde_json::json!({ "file_id": audio.file_id }))
        .send()
        .await
        .map_err(|_| "No se pudo consultar el audio en Telegram.".to_string())?;
    let file = decode::<TelegramFile>(response).await?;
    if file
        .file_size
        .is_some_and(|size| size == 0 || size > MAX_AUDIO_BYTES)
    {
        return Err("El audio de Telegram supera el tamaño permitido.".to_string());
    }
    let file_path = file
        .file_path
        .filter(|path| {
            !path.is_empty()
                && path.len() <= 512
                && path
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"/_.-".contains(&byte))
                && !path.split('/').any(|component| component == "..")
        })
        .ok_or_else(|| "Telegram devolvio una ruta de audio no valida.".to_string())?;
    let download_url = format!("{TELEGRAM_API_BASE}/file/bot{}/{file_path}", token.trim());
    let response = client
        .get(download_url)
        .send()
        .await
        .map_err(|_| "No se pudo descargar el audio de Telegram.".to_string())?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > MAX_AUDIO_BYTES)
    {
        return Err("Telegram rechazo la descarga del audio.".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "Se interrumpio la descarga del audio de Telegram.".to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_AUDIO_BYTES {
        return Err("El audio descargado tiene un tamaño no valido.".to_string());
    }
    Ok(bytes.to_vec())
}

pub async fn download_photo(token: &str, photo: &TelegramPhoto) -> Result<Vec<u8>, String> {
    if photo.file_id.is_empty()
        || photo.file_id.len() > 256
        || photo.width == 0
        || photo.height == 0
        || u64::from(photo.width) * u64::from(photo.height) > MAX_PHOTO_PIXELS
    {
        return Err("La imagen de Telegram no es valida.".to_string());
    }
    if photo
        .file_size
        .is_some_and(|size| size == 0 || size > MAX_PHOTO_BYTES)
    {
        return Err("La imagen de Telegram supera el tamaño permitido.".to_string());
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .post(endpoint(token, "getFile")?)
        .json(&serde_json::json!({ "file_id": photo.file_id }))
        .send()
        .await
        .map_err(|_| "No se pudo consultar la imagen en Telegram.".to_string())?;
    let file = decode::<TelegramFile>(response).await?;
    if file
        .file_size
        .is_some_and(|size| size == 0 || size > MAX_PHOTO_BYTES)
    {
        return Err("La imagen de Telegram supera el tamaño permitido.".to_string());
    }
    let file_path = file
        .file_path
        .filter(|path| {
            !path.is_empty()
                && path.len() <= 512
                && path
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"/_.-".contains(&byte))
                && !path.split('/').any(|component| component == "..")
        })
        .ok_or_else(|| "Telegram devolvio una ruta de imagen no valida.".to_string())?;
    let download_url = format!("{TELEGRAM_API_BASE}/file/bot{}/{file_path}", token.trim());
    let response = client
        .get(download_url)
        .send()
        .await
        .map_err(|_| "No se pudo descargar la imagen de Telegram.".to_string())?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > MAX_PHOTO_BYTES)
    {
        return Err("Telegram rechazo la descarga de la imagen.".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "Se interrumpio la descarga de la imagen de Telegram.".to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_PHOTO_BYTES {
        return Err("La imagen descargada tiene un tamaño no valido.".to_string());
    }
    Ok(bytes.to_vec())
}

pub async fn download_document(
    token: &str,
    document: &TelegramDocument,
) -> Result<Vec<u8>, String> {
    if document.file_id.is_empty() || document.file_id.len() > 256 {
        return Err("El identificador del documento de Telegram no es valido.".to_string());
    }
    let file_name = document.file_name.as_deref().unwrap_or("");
    let is_pdf = file_name.to_ascii_lowercase().ends_with(".pdf")
        || document.mime_type.as_deref() == Some("application/pdf");
    if !is_pdf {
        return Err("Por ahora Telegram solo admite documentos PDF para Finanzas.".to_string());
    }
    if document
        .file_size
        .is_some_and(|size| size == 0 || size > MAX_DOCUMENT_BYTES)
    {
        return Err("El PDF de Telegram supera el tamaño permitido.".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "No se pudo iniciar la descarga del documento.".to_string())?;
    let response = client
        .post(endpoint(token, "getFile")?)
        .json(&serde_json::json!({ "file_id": document.file_id }))
        .send()
        .await
        .map_err(|_| "No se pudo consultar el documento en Telegram.".to_string())?;
    let file = decode::<TelegramFile>(response).await?;
    if file
        .file_size
        .is_some_and(|size| size == 0 || size > MAX_DOCUMENT_BYTES)
    {
        return Err("El PDF de Telegram supera el tamaño permitido.".to_string());
    }
    let file_path = file
        .file_path
        .filter(|path| {
            !path.is_empty()
                && path.len() <= 512
                && path
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"/_.-".contains(&byte))
                && !path.split('/').any(|component| component == "..")
        })
        .ok_or_else(|| "Telegram devolvio una ruta de documento no valida.".to_string())?;
    let response = client
        .get(format!(
            "{TELEGRAM_API_BASE}/file/bot{}/{file_path}",
            token.trim()
        ))
        .send()
        .await
        .map_err(|_| "No se pudo descargar el PDF de Telegram.".to_string())?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > MAX_DOCUMENT_BYTES)
    {
        return Err("Telegram rechazo la descarga del PDF.".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "Se interrumpio la descarga del PDF de Telegram.".to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("El PDF descargado tiene un tamaño no valido.".to_string());
    }
    Ok(bytes.to_vec())
}

pub fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    let document = lopdf::Document::load_mem(bytes)
        .map_err(|_| "El documento de Telegram no es un PDF válido.".to_string())?;
    let page_numbers: Vec<u32> = document.get_pages().into_keys().collect();
    if page_numbers.is_empty() {
        return Err("El PDF de Telegram no contiene páginas.".to_string());
    }
    let mut text = String::new();
    for page_number in page_numbers {
        let page_text = document
            .extract_text(&[page_number])
            .map_err(|_| "No se pudo leer el texto del PDF de Telegram.".to_string())?;
        text.push_str(&page_text);
        if text.len() > 120_000 {
            return Err("El texto extraído del PDF supera el límite permitido.".to_string());
        }
    }
    if text.trim().is_empty() {
        return Err("El PDF no contiene texto seleccionable.".to_string());
    }
    Ok(text)
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
    use super::{endpoint, TelegramAudio, TelegramDocument, TelegramPhoto};

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

    #[test]
    fn telegram_audio_accepts_bot_api_fields_and_serializes_camel_case() {
        let audio: TelegramAudio = serde_json::from_str(
            r#"{"file_id":"voice-1","duration":12,"mime_type":"audio/ogg","file_size":345}"#,
        )
        .expect("deserialize Telegram audio");
        let value = serde_json::to_value(audio).expect("serialize frontend audio");

        assert_eq!(value["fileId"], "voice-1");
        assert_eq!(value["mimeType"], "audio/ogg");
        assert_eq!(value["fileSize"], 345);
    }

    #[test]
    fn telegram_photo_accepts_bot_api_fields_and_serializes_camel_case() {
        let photo: TelegramPhoto = serde_json::from_str(
            r#"{"file_id":"photo-1","file_size":678,"width":1280,"height":720}"#,
        )
        .expect("deserialize Telegram photo");
        let value = serde_json::to_value(photo).expect("serialize frontend photo");

        assert_eq!(value["fileId"], "photo-1");
        assert_eq!(value["fileSize"], 678);
        assert_eq!(value["width"], 1280);
        assert_eq!(value["height"], 720);
    }

    #[test]
    fn telegram_document_accepts_pdf_fields_and_serializes_camel_case() {
        let document: TelegramDocument = serde_json::from_str(
            r#"{"file_id":"doc-1","file_name":"sueldo.pdf","mime_type":"application/pdf","file_size":678}"#,
        ).expect("deserialize Telegram document");
        let value = serde_json::to_value(document).expect("serialize frontend document");
        assert_eq!(value["fileId"], "doc-1");
        assert_eq!(value["fileName"], "sueldo.pdf");
        assert_eq!(value["mimeType"], "application/pdf");
    }
}
