//! Format of the chat history documents (`chat/chats/*.md`): frontmatter
//! settings, one block per message delimited by HTML comments and attachments
//! stored as Base64 JSON in a hidden marker. The adapter reads and writes the
//! files; everything that interprets their content lives here.

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::error::BackendError;

pub const CHAT_ROOT_DIRECTORY: &str = "chat";
pub const CHAT_HISTORY_DIRECTORY: &str = "chat/chats";
pub const DEFAULT_IMAGE_PREVIEW_LIMIT: usize = 24;
const MAX_IMAGE_PREVIEW_LIMIT: usize = 200;
const MAX_MESSAGES: usize = 5_000;

const MESSAGE_MARKER_PREFIX: &str = "<!-- NOTIA_CHAT_MESSAGE role:";
const ATTACHMENTS_MARKER_PREFIX: &str = "<!-- NOTIA_CHAT_ATTACHMENTS:";
const MARKER_SUFFIX: &str = " -->";
const CONFIDENTIAL_CONTEXT: &str = "#Confidencial";
const RENDERABLE_IMAGE_MIME_TYPES: [&str; 6] =
    ["image/avif", "image/bmp", "image/gif", "image/jpeg", "image/png", "image/webp"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
}

impl ChatRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatAttachmentKind {
    Image,
    Pdf,
    Text,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredChatAttachment {
    pub name: String,
    pub mime_type: String,
    pub base64: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub additional_base64: Vec<String>,
    pub kind: ChatAttachmentKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extracted_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_count: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredChatMessage {
    pub role: ChatRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<StoredChatAttachment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ChatContextMode {
    #[default]
    Direct,
    Index,
}

impl ChatContextMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Index => "index",
        }
    }
}

fn agent_memory_default() -> bool {
    true
}

fn library_rag_default() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredChatDocument {
    pub title: String,
    /// Whether turns of this chat use the agent memory (`memory.md`).
    /// Chosen when the chat is created; missing in older chats, which use it.
    #[serde(default = "agent_memory_default")]
    pub agent_memory_enabled: bool,
    pub context_memory_enabled: bool,
    pub context_memory_message_count: u32,
    pub context_scope_key: Option<String>,
    #[serde(default)]
    pub selected_context_mode: ChatContextMode,
    #[serde(default)]
    pub selected_context_files: Vec<String>,
    /// Folders whose files (subfolders included) the chat uses as context.
    #[serde(default)]
    pub selected_context_folders: Vec<String>,
    /// Whether the agent may search the whole library; missing in older
    /// chats, which could.
    #[serde(default = "library_rag_default")]
    pub library_rag_enabled: bool,
    #[serde(default)]
    pub messages: Vec<StoredChatMessage>,
}

impl StoredChatDocument {
    /// Empty chat with the given settings.
    pub fn new(title: String, agent_memory: bool, context_memory: bool, context_count: u32) -> Self {
        Self {
            title,
            agent_memory_enabled: agent_memory,
            context_memory_enabled: context_memory,
            context_memory_message_count: clamp_context_count(i64::from(context_count)),
            context_scope_key: None,
            selected_context_mode: ChatContextMode::Direct,
            selected_context_files: Vec::new(),
            selected_context_folders: Vec::new(),
            library_rag_enabled: true,
            messages: Vec::new(),
        }
    }

    /// Rejects documents that could not be written back faithfully.
    pub fn validate(&self) -> Result<(), BackendError> {
        let single_line = |value: &str| !value.contains(['\n', '\r']);
        if self.title.trim().is_empty()
            || self.title.chars().count() > 300
            || !single_line(&self.title)
            || self.messages.len() > MAX_MESSAGES
            || self.selected_context_files.len() > 1_000
            || self.selected_context_files.iter().any(|path| !single_line(path))
            || self.context_scope_key.as_deref().is_some_and(|key| !single_line(key))
        {
            return Err(BackendError::invalid_input("El chat no es válido."));
        }
        for attachment in self.messages.iter().flat_map(|message| &message.attachments) {
            if !single_line(&attachment.name) || !single_line(&attachment.mime_type) {
                return Err(BackendError::invalid_input("Un adjunto del chat no es válido."));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatImagePreview {
    pub name: String,
    pub mime_type: String,
    pub base64: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_number: Option<usize>,
}

fn clamp_context_count(value: i64) -> u32 {
    value.clamp(1, 200) as u32
}

// ---------------------------------------------------------------------------
// Frontmatter (the subset chat documents use)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
enum Scalar {
    Null,
    Bool(bool),
    Number(f64),
    Text(String),
}

fn parse_scalar(raw: &str) -> Scalar {
    let value = raw.trim();
    match value {
        "null" | "~" => return Scalar::Null,
        "true" => return Scalar::Bool(true),
        "false" => return Scalar::Bool(false),
        _ => {}
    }
    let numeric = !value.is_empty()
        && value.trim_start_matches('-').chars().all(|character| character.is_ascii_digit() || character == '.')
        && value.chars().filter(|character| *character == '.').count() <= 1
        && value.chars().any(|character| character.is_ascii_digit());
    if numeric {
        if let Ok(number) = value.parse::<f64>() {
            return Scalar::Number(number);
        }
    }
    if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        if let Ok(text) = serde_json::from_str::<String>(value) {
            return Scalar::Text(text);
        }
        return Scalar::Text(value[1..value.len() - 1].to_string());
    }
    if value.len() >= 2 && value.starts_with('\'') && value.ends_with('\'') {
        return Scalar::Text(value[1..value.len() - 1].replace("''", "'"));
    }
    Scalar::Text(value.to_string())
}

#[derive(Debug, Clone, PartialEq)]
enum Value {
    Scalar(Scalar),
    List(Vec<Scalar>),
}

fn split_document(source: &str) -> (Vec<(String, Value)>, String) {
    let normalized = source.replace("\r\n", "\n");
    let Some(rest) = normalized.strip_prefix("---\n") else {
        return (Vec::new(), normalized);
    };
    let lines = rest.split('\n').collect::<Vec<_>>();
    let Some(closing) = lines.iter().position(|line| line.trim() == "---") else {
        return (Vec::new(), normalized);
    };
    let mut entries = Vec::new();
    let mut index = 0;
    while index < closing {
        let line = lines[index];
        index += 1;
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let valid_key = key.chars().next().is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
            && key.chars().all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-');
        if !valid_key || line.starts_with(char::is_whitespace) {
            continue;
        }
        let value = value.trim();
        if value.is_empty() {
            let mut items = Vec::new();
            while index < closing {
                let Some(item) = lines[index].trim_start().strip_prefix("- ") else {
                    break;
                };
                items.push(parse_scalar(item));
                index += 1;
            }
            entries.push((key.to_string(), if items.is_empty() { Value::Scalar(Scalar::Text(String::new())) } else { Value::List(items) }));
        } else if value.starts_with('[') && value.ends_with(']') && !value.starts_with("[[") {
            let inner = value[1..value.len() - 1].trim();
            let items = if inner.is_empty() { Vec::new() } else { inner.split(',').map(parse_scalar).collect() };
            entries.push((key.to_string(), Value::List(items)));
        } else {
            entries.push((key.to_string(), Value::Scalar(parse_scalar(value))));
        }
    }
    (entries, lines[closing + 1..].join("\n"))
}

fn serialize_text(value: &str) -> String {
    let needs_quotes = value.is_empty()
        || value.starts_with(char::is_whitespace)
        || value.ends_with(char::is_whitespace)
        || value.starts_with(['-', '?'])
        || value.contains([':', '#', '{', '}', '[', ']', ',', '\t', '\n', '\r']);
    if needs_quotes {
        serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
    } else {
        value.to_string()
    }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

fn decode_attachments(encoded: &str) -> Option<Vec<StoredChatAttachment>> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded.trim()).ok()?;
    let values = serde_json::from_slice::<Vec<serde_json::Value>>(&bytes).ok()?;
    Some(values.into_iter().filter_map(|value| serde_json::from_value(value).ok()).collect())
}

fn encode_attachments(attachments: &[StoredChatAttachment]) -> String {
    let json = serde_json::to_vec(attachments).unwrap_or_default();
    base64::engine::general_purpose::STANDARD.encode(json)
}

fn marker_content<'a>(line: &'a str, prefix: &str) -> Option<&'a str> {
    line.strip_prefix(prefix)?.strip_suffix(MARKER_SUFFIX)
}

fn extract_messages(body: &str) -> Vec<StoredChatMessage> {
    let mut messages = Vec::new();
    let mut role: Option<ChatRole> = None;
    let mut buffer = Vec::<&str>::new();
    let mut attachments = Vec::new();
    let mut flush = |role: &mut Option<ChatRole>, buffer: &mut Vec<&str>, attachments: &mut Vec<StoredChatAttachment>| {
        if let Some(current) = role.take() {
            let content = buffer.join("\n").trim().to_string();
            if !content.is_empty() || !attachments.is_empty() {
                messages.push(StoredChatMessage { role: current, content, attachments: std::mem::take(attachments) });
            }
        }
        buffer.clear();
        attachments.clear();
    };
    for line in body.split('\n') {
        let trimmed = line.trim();
        if let Some(token) = marker_content(trimmed, MESSAGE_MARKER_PREFIX) {
            flush(&mut role, &mut buffer, &mut attachments);
            role = match token.trim().to_lowercase().as_str() {
                "assistant" => Some(ChatRole::Assistant),
                "user" => Some(ChatRole::User),
                _ => None,
            };
            continue;
        }
        if role.is_some() {
            if let Some(encoded) = marker_content(trimmed, ATTACHMENTS_MARKER_PREFIX) {
                if let Some(decoded) = decode_attachments(encoded) {
                    attachments = decoded;
                }
                continue;
            }
            buffer.push(line);
        }
    }
    flush(&mut role, &mut buffer, &mut attachments);
    messages
}

fn message_block(message: &StoredChatMessage) -> String {
    let mut lines = vec![format!("{MESSAGE_MARKER_PREFIX}{}{MARKER_SUFFIX}", message.role.as_str())];
    if !message.attachments.is_empty() {
        lines.push(format!("{ATTACHMENTS_MARKER_PREFIX}{}{MARKER_SUFFIX}", encode_attachments(&message.attachments)));
    }
    lines.push(message.content.trim().to_string());
    lines.push(String::new());
    lines.join("\n")
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

pub fn parse_chat_document(source: &str, fallback_title: &str) -> StoredChatDocument {
    let (entries, body) = split_document(source);
    let find = |key: &str| entries.iter().find(|(name, _)| name == key).map(|(_, value)| value);
    let text = |key: &str| match find(key) {
        Some(Value::Scalar(Scalar::Text(text))) if !text.trim().is_empty() => Some(text.trim().to_string()),
        _ => None,
    };
    let flag = |key: &str| !matches!(find(key), Some(Value::Scalar(Scalar::Bool(false))));
    let count = match find("contextMemoryMessageCount") {
        Some(Value::Scalar(Scalar::Number(number))) if number.is_finite() => clamp_context_count(number.round() as i64),
        _ => 10,
    };
    let list = |key: &str| match find(key) {
        Some(Value::List(items)) => items
            .iter()
            .filter_map(|item| match item {
                Scalar::Text(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    StoredChatDocument {
        title: text("title").unwrap_or_else(|| fallback_title.to_string()),
        agent_memory_enabled: flag("agentMemory"),
        context_memory_enabled: flag("contextMemory"),
        context_memory_message_count: count,
        context_scope_key: text("contextScopeKey"),
        selected_context_mode: if text("selectedContextMode").as_deref() == Some("index") {
            ChatContextMode::Index
        } else {
            ChatContextMode::Direct
        },
        selected_context_files: list("selectedContextFiles"),
        selected_context_folders: list("selectedContextFolders"),
        library_rag_enabled: flag("libraryRag"),
        messages: extract_messages(&body),
    }
}

fn chat_body(document: &StoredChatDocument, messages: &[StoredChatMessage]) -> String {
    let mut parts = vec![format!("# {}", document.title), String::new()];
    parts.extend(messages.iter().map(message_block));
    format!("{}\n", parts.join("\n").trim_end())
}

pub fn serialize_chat_document(document: &StoredChatDocument) -> String {
    let mut lines = vec![
        format!("title: {}", serialize_text(&document.title)),
        format!("contexto: {}", serialize_text(CONFIDENTIAL_CONTEXT)),
        format!("agentMemory: {}", document.agent_memory_enabled),
        format!("contextMemory: {}", document.context_memory_enabled),
        format!("contextMemoryMessageCount: {}", clamp_context_count(i64::from(document.context_memory_message_count))),
        format!(
            "contextScopeKey: {}",
            document.context_scope_key.as_deref().map_or_else(|| "null".to_string(), serialize_text)
        ),
        format!("selectedContextMode: {}", document.selected_context_mode.as_str()),
    ];
    for (key, paths) in [("selectedContextFiles", &document.selected_context_files), ("selectedContextFolders", &document.selected_context_folders)] {
        if paths.is_empty() {
            lines.push(format!("{key}: []"));
        } else {
            lines.push(format!("{key}:"));
            lines.extend(paths.iter().map(|path| format!("  - {}", serialize_text(path))));
        }
    }
    lines.push(format!("libraryRag: {}", document.library_rag_enabled));
    format!("---\n{}\n---\n\n{}", lines.join("\n"), chat_body(document, &document.messages))
}

/// Appends the last turn (the last two messages, or the only one) to an
/// existing chat file when its header matches, so a long history is not
/// rewritten on every message. `None` asks for a full rewrite.
pub fn append_chat_messages(source: &str, document: &StoredChatDocument) -> Option<String> {
    let normalized = source.replace("\r\n", "\n");
    let body_start = normalized
        .strip_prefix("---\n")
        .and_then(|rest| rest.find("\n---\n").map(|index| index + 4 + 5))
        .unwrap_or(0);
    let (header, body) = normalized.split_at(body_start);
    let trimmed_body = body.trim_end();
    let mut lines = trimmed_body.lines().map(str::trim).filter(|line| !line.is_empty());
    if lines.next() != Some(format!("# {}", document.title).as_str()) {
        return None;
    }
    let last_marker = lines.filter(|line| line.starts_with(MESSAGE_MARKER_PREFIX)).last()?;
    if marker_content(last_marker, MESSAGE_MARKER_PREFIX).is_none() {
        return None;
    }
    let count = if document.messages.len() > 2 { 2 } else { document.messages.len().min(1) };
    let tail = &document.messages[document.messages.len() - count..];
    if tail.is_empty() {
        return None;
    }
    let appended = format!("{}\n", tail.iter().map(message_block).collect::<String>().trim_end());
    Some(format!("{header}{trimmed_body}\n{appended}"))
}

fn normalize_base64(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let without_prefix = match trimmed.strip_prefix("data:") {
        Some(rest) => rest.split_once(";base64,").map(|(_, data)| data)?,
        None => trimmed,
    };
    let compact = without_prefix.split_whitespace().collect::<String>();
    let body = compact.trim_end_matches('=');
    let valid = !compact.is_empty()
        && compact.len() - body.len() <= 2
        && body.chars().all(|character| character.is_ascii_alphanumeric() || character == '+' || character == '/');
    valid.then_some(compact)
}

/// Raster images attached to the chat, capped so a long history does not
/// mount an unbounded number of images.
pub fn chat_image_previews(source: &str, limit: usize) -> Vec<ChatImagePreview> {
    let limit = limit.min(MAX_IMAGE_PREVIEW_LIMIT);
    let mut previews = Vec::new();
    for attachment in parse_chat_document(source, "").messages.iter().flat_map(|message| &message.attachments) {
        let mime_type = attachment.mime_type.trim().to_lowercase();
        if !RENDERABLE_IMAGE_MIME_TYPES.contains(&mime_type.as_str()) {
            continue;
        }
        let pages = std::iter::once(&attachment.base64).chain(&attachment.additional_base64).collect::<Vec<_>>();
        for (index, page) in pages.iter().enumerate() {
            if previews.len() >= limit {
                return previews;
            }
            if let Some(base64) = normalize_base64(page) {
                previews.push(ChatImagePreview {
                    name: attachment.name.clone(),
                    mime_type: mime_type.clone(),
                    base64,
                    page_number: (pages.len() > 1).then_some(index + 1),
                });
            }
        }
    }
    previews
}

/// File name of a new chat from a local timestamp `YYYY-MM-DD-HH-MM-SS`
/// and the title shown until the agent names it.
pub fn new_chat_names(local_stamp: &str, suffix: usize) -> Result<(String, String), BackendError> {
    let parts = local_stamp.split('-').collect::<Vec<_>>();
    let widths = [4, 2, 2, 2, 2, 2];
    if parts.len() != 6
        || parts.iter().zip(widths).any(|(part, width)| part.len() != width || !part.chars().all(|c| c.is_ascii_digit()))
    {
        return Err(BackendError::invalid_input("La fecha local del chat no es válida."));
    }
    let file_name = if suffix <= 1 {
        format!("Chat-{local_stamp}.md")
    } else {
        format!("Chat-{local_stamp}-{suffix}.md")
    };
    let title = format!(
        "Chat temporal {}-{}-{} {}:{}:{}",
        parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]
    );
    Ok((file_name, title))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attachment() -> StoredChatAttachment {
        StoredChatAttachment {
            name: "foto.png".into(),
            mime_type: "image/png".into(),
            base64: "aGVsbG8=".into(),
            additional_base64: vec!["d29ybGQ=".into()],
            kind: ChatAttachmentKind::Image,
            extracted_text: None,
            text_content: None,
            page_count: Some(2),
        }
    }

    fn document() -> StoredChatDocument {
        let mut document = StoredChatDocument::new("Mi chat: prueba".into(), false, false, 12);
        document.selected_context_files = vec!["notas/a.md".into()];
        document.selected_context_folders = vec!["notas/2026".into()];
        document.library_rag_enabled = false;
        document.context_scope_key = Some("library".into());
        document.messages = vec![
            StoredChatMessage { role: ChatRole::User, content: "Hola".into(), attachments: vec![attachment()] },
            StoredChatMessage { role: ChatRole::Assistant, content: "¿Qué tal?\n\nlínea".into(), attachments: vec![] },
        ];
        document
    }

    #[test]
    fn documents_round_trip() {
        let serialized = serialize_chat_document(&document());
        assert!(serialized.contains("title: \"Mi chat: prueba\"\ncontexto: \"#Confidencial\""));
        assert_eq!(parse_chat_document(&serialized, "x"), document());
    }

    #[test]
    fn defaults_apply_to_missing_settings() {
        let parsed = parse_chat_document("# Solo cuerpo\n", "Fallback");
        assert_eq!(parsed.title, "Fallback");
        assert!(parsed.agent_memory_enabled && parsed.context_memory_enabled && parsed.library_rag_enabled);
        assert!(parsed.selected_context_folders.is_empty());
        assert_eq!(parsed.context_memory_message_count, 10);
        assert!(parsed.messages.is_empty());
    }

    #[test]
    fn appends_the_last_turn_and_rewrites_foreign_files() {
        let mut current = document();
        let source = serialize_chat_document(&current);
        current.messages.push(StoredChatMessage { role: ChatRole::User, content: "Otra".into(), attachments: vec![] });
        current.messages.push(StoredChatMessage { role: ChatRole::Assistant, content: "Respuesta".into(), attachments: vec![] });
        let appended = append_chat_messages(&source, &current).expect("append");
        assert_eq!(parse_chat_document(&appended, "x"), current);
        assert_eq!(append_chat_messages("---\ntitle: x\n---\n\n# Otro\n", &current), None);
    }

    #[test]
    fn previews_list_image_pages_up_to_the_limit() {
        let source = serialize_chat_document(&document());
        let previews = chat_image_previews(&source, 24);
        assert_eq!(previews.len(), 2);
        assert_eq!(previews[1].page_number, Some(2));
        assert_eq!(chat_image_previews(&source, 1).len(), 1);
    }

    #[test]
    fn new_chat_names_follow_the_local_stamp() {
        let (file, title) = new_chat_names("2026-09-22-10-05-01", 2).expect("names");
        assert_eq!(file, "Chat-2026-09-22-10-05-01-2.md");
        assert_eq!(title, "Chat temporal 2026-09-22 10:05:01");
        assert!(new_chat_names("2026-9-22-10-05-01", 1).is_err());
    }
}
