//! Native file and folder pickers, provided by the host. A host without
//! pickers (headless) behaves as if the person cancelled.

use std::path::PathBuf;

use super::{AppHandle, Error};

/// Location returned by a picker: a local path on desktop or an opaque
/// document URI (SAF `content://`) on Android.
#[derive(Debug, Clone)]
pub enum FilePath {
    Path(PathBuf),
    Url(Url),
}

impl FilePath {
    pub fn into_path(self) -> Result<PathBuf, Error> {
        match self {
            Self::Path(path) => Ok(path),
            Self::Url(_) => Err(Error::UnknownPath),
        }
    }
}

/// Opaque URI kept exactly as the platform returned it.
#[derive(Debug, Clone)]
pub struct Url(String);

impl Url {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// File filter shown by the picker.
#[derive(Debug, Clone)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// Blocking pickers of the host.
pub trait DialogPort: Send + Sync {
    fn pick_folder(&self, title: Option<&str>) -> Option<FilePath>;
    fn pick_file(&self, title: Option<&str>, filters: &[DialogFilter]) -> Option<FilePath>;
}

pub trait DialogExt {
    fn dialog(&self) -> Dialog;
}

impl DialogExt for AppHandle {
    fn dialog(&self) -> Dialog {
        Dialog { port: self.dialogs() }
    }
}

pub struct Dialog {
    port: Option<std::sync::Arc<dyn DialogPort>>,
}

impl Dialog {
    pub fn file(&self) -> FileDialogBuilder {
        FileDialogBuilder {
            port: self.port.clone(),
            title: None,
            filters: Vec::new(),
        }
    }
}

pub struct FileDialogBuilder {
    port: Option<std::sync::Arc<dyn DialogPort>>,
    title: Option<String>,
    filters: Vec<DialogFilter>,
}

impl FileDialogBuilder {
    pub fn set_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn add_filter(mut self, name: impl Into<String>, extensions: &[&str]) -> Self {
        self.filters.push(DialogFilter {
            name: name.into(),
            extensions: extensions.iter().map(|extension| extension.to_string()).collect(),
        });
        self
    }

    pub fn blocking_pick_folder(self) -> Option<FilePath> {
        self.port?.pick_folder(self.title.as_deref())
    }

    pub fn blocking_pick_file(self) -> Option<FilePath> {
        self.port?.pick_file(self.title.as_deref(), &self.filters)
    }
}
