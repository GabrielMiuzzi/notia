//! Interface files served from a folder on disk (the `dist` of the build).

use std::path::{Component, Path, PathBuf};

use crate::host::{Asset, AssetSource};

pub(crate) struct DirectoryAssets {
    root: PathBuf,
}

impl DirectoryAssets {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self { root }
    }
}

impl AssetSource for DirectoryAssets {
    fn get(&self, path: &str) -> Option<Asset> {
        let relative = safe_relative_path(path)?;
        let file = self.root.join(relative);
        if !file.is_file() {
            return None;
        }
        let bytes = std::fs::read(&file).ok()?;
        Some(Asset::new(bytes, mime_type(path).to_string()))
    }
}

/// Relative path made only of normal segments; anything that could leave
/// the folder (`..`, roots, drive prefixes) is refused.
fn safe_relative_path(path: &str) -> Option<PathBuf> {
    let trimmed = path.trim_start_matches('/');
    if trimmed.is_empty() || trimmed.contains('\\') {
        return None;
    }
    let candidate = Path::new(trimmed);
    candidate
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
        .then(|| candidate.to_path_buf())
}

pub(crate) fn mime_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_files_inside_the_folder_only() {
        let root = std::env::temp_dir().join(format!("notia-assets-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("assets")).expect("assets folder");
        std::fs::write(root.join("assets/app.js"), b"ok").expect("asset");
        let assets = DirectoryAssets::new(root.clone());
        let asset = assets.get("/assets/app.js").expect("asset served");
        assert_eq!(asset.bytes(), b"ok");
        assert_eq!(asset.mime_type(), "text/javascript");
        assert!(assets.get("../secret.txt").is_none());
        assert!(assets.get("assets/../../secret.txt").is_none());
        assert!(assets.get("assets\\app.js").is_none());
        assert!(assets.get("missing.js").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }
}
