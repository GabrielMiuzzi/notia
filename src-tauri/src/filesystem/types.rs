use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) path: Option<String>,
    #[serde(rename = "type")]
    pub(crate) node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) expanded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) children: Option<Vec<FileNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) modified_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) next_page: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) previous_page: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub(crate) ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadLibraryFileResult {
    pub(crate) ok: bool,
    pub(crate) content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteLibraryFileResult {
    pub(crate) ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLibraryFilesResult {
    pub(crate) paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownFileDocument {
    pub(crate) path: String,
    pub(crate) content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadLibraryTreePayload {
    pub(crate) directory_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadLibraryFilePayload {
    pub(crate) file_path: String,
    #[serde(default)]
    pub(crate) directory_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteLibraryFilePayload {
    pub(crate) file_path: String,
    pub(crate) content: String,
    #[serde(default)]
    pub(crate) directory_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLibraryFilePayload {
    pub(crate) file_path: String,
    pub(crate) content: String,
    #[serde(default)]
    pub(crate) directory_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLibraryDirectoryPayload {
    pub(crate) directory_path: String,
    #[serde(default)]
    pub(crate) directory_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathExistsPayload {
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) directory_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteBinaryFilePayload {
    pub(crate) file_path: String,
    pub(crate) data: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLibraryEntryPayload {
    pub(crate) directory_path: String,
    #[serde(default)]
    pub(crate) directory_uri: Option<String>,
    pub(crate) name: String,
    pub(crate) kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLibraryFilesPayload {
    pub(crate) directory_path: String,
    pub(crate) query: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathExistsResult {
    pub(crate) exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IsDirectoryPathResult {
    pub(crate) is_directory: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadMarkdownFilesPayload {
    pub(crate) directory_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntryOperationPayload {
    pub(crate) action: String,
    pub(crate) target_path: Option<String>,
    pub(crate) new_name: Option<String>,
    pub(crate) source_path: Option<String>,
    pub(crate) target_directory_path: Option<String>,
    pub(crate) mode: Option<String>,
    #[serde(default)]
    pub(crate) directory_uri: Option<String>,
}
