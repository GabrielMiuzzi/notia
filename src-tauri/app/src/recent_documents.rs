//! Notes the person opened in the editor, most recent first, per library on
//! this device: the notes of Home's «Seguir donde quedaste». The editor's
//! read of a note (`markdownDefaults`) records it. The inventory cannot
//! order recent notes by itself because SAF lists carry no modification time.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::host::{AppHandle, Manager};

/// Notes kept per library.
const MAX_RECENT_DOCUMENTS: usize = 30;
const DIRECTORY: &str = "home";

/// Serializes every read-modify-write of the lists of this process.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentDocument {
    pub logical_path: String,
    pub opened_at_ms: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RecentFile {
    #[serde(default)]
    documents: Vec<RecentDocument>,
}

fn list_file(app: &AppHandle, library_id: &str) -> Option<PathBuf> {
    let key = library_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(64).collect::<String>();
    if key.is_empty() {
        return None;
    }
    Some(app.path().app_data_dir().ok()?.join(DIRECTORY).join(format!("recent-{key}.json")))
}

fn read(path: &std::path::Path) -> Vec<RecentDocument> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<RecentFile>(&text).ok())
        .map(|file| file.documents)
        .unwrap_or_default()
}

/// The list with `logical_path` opened at `now_ms` first, once.
fn with_opened(mut documents: Vec<RecentDocument>, logical_path: &str, now_ms: i64) -> Vec<RecentDocument> {
    documents.retain(|document| document.logical_path != logical_path);
    documents.insert(0, RecentDocument { logical_path: logical_path.to_string(), opened_at_ms: now_ms });
    documents.truncate(MAX_RECENT_DOCUMENTS);
    documents
}

/// Records that the editor opened `logical_path`. A failure only loses the
/// entry: opening the note does not depend on it.
pub(crate) fn record(app: &AppHandle, library_id: &str, logical_path: &str) {
    let Some(path) = list_file(app, library_id) else { return };
    let Ok(_guard) = LOCK.lock() else { return };
    let now_ms = chrono::Utc::now().timestamp_millis();
    let documents = with_opened(read(&path), logical_path, now_ms);
    let Ok(text) = serde_json::to_string(&RecentFile { documents }) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let temporary = path.with_extension("json.tmp");
    if std::fs::write(&temporary, text).is_ok() {
        let _ = std::fs::rename(&temporary, &path);
    }
}

/// Notes opened in the library, most recent first.
pub(crate) fn list(app: &AppHandle, library_id: &str) -> Vec<RecentDocument> {
    let Some(path) = list_file(app, library_id) else { return Vec::new() };
    let Ok(_guard) = LOCK.lock() else { return Vec::new() };
    read(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_opened_note_goes_first_once_and_the_list_is_bounded() {
        let mut documents = Vec::new();
        for index in 0..(MAX_RECENT_DOCUMENTS + 5) {
            documents = with_opened(documents, &format!("nota-{index}.md"), index as i64);
        }
        assert_eq!(documents.len(), MAX_RECENT_DOCUMENTS);
        assert_eq!(documents[0].logical_path, format!("nota-{}.md", MAX_RECENT_DOCUMENTS + 4));
        let documents = with_opened(documents, "nota-10.md", 1_000);
        assert_eq!(documents[0], RecentDocument { logical_path: "nota-10.md".into(), opened_at_ms: 1_000 });
        assert_eq!(documents.iter().filter(|document| document.logical_path == "nota-10.md").count(), 1);
    }
}
