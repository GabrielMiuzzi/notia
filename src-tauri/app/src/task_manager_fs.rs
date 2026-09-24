//! File access used by the Task Manager Markdown store. The store keeps
//! working with `Path`s; this module maps them onto the real storage of the
//! library binding: `std::fs` under the canonical desktop root, or SAF
//! documents under the granted Android tree.
//!
//! The backend for the current operation is installed with [`scoped`]; the
//! store's helpers call the free functions below, which default to desktop.

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

/// Kind of a directory entry, without following symlinks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntryKind {
    Directory,
    File,
    Other,
}

pub(crate) trait TaskFileSystem {
    fn is_dir(&self, path: &Path) -> bool;
    fn read(&self, path: &Path) -> Option<Vec<u8>>;
    fn list_dir(&self, path: &Path) -> Result<Vec<(PathBuf, EntryKind)>, ()>;
    fn create_dir_all(&self, path: &Path) -> Result<(), ()>;
    /// Atomic replacement guarded by the platform revision of the content
    /// the caller read (`None` = unconditional).
    fn write_text(&self, path: &Path, content: &str, expected_revision: Option<&str>) -> bool;
    /// Creates a file that must not exist yet.
    fn create_text(&self, path: &Path, content: &str) -> bool;
    fn remove_file(&self, path: &Path) -> bool;
}

struct DesktopTaskFileSystem;

impl TaskFileSystem for DesktopTaskFileSystem {
    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn read(&self, path: &Path) -> Option<Vec<u8>> {
        std::fs::read(path).ok()
    }

    fn list_dir(&self, path: &Path) -> Result<Vec<(PathBuf, EntryKind)>, ()> {
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(path).map_err(|_| ())? {
            let entry = entry.map_err(|_| ())?;
            let metadata = std::fs::symlink_metadata(entry.path()).map_err(|_| ())?;
            let kind = if metadata.file_type().is_symlink() {
                EntryKind::Other
            } else if metadata.is_dir() {
                EntryKind::Directory
            } else if metadata.is_file() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            entries.push((entry.path(), kind));
        }
        Ok(entries)
    }

    fn create_dir_all(&self, path: &Path) -> Result<(), ()> {
        std::fs::create_dir_all(path).map_err(|_| ())
    }

    fn write_text(&self, path: &Path, content: &str, expected_revision: Option<&str>) -> bool {
        crate::filesystem::desktop::write_library_file(
            path.to_string_lossy().as_ref(),
            content,
            expected_revision,
        )
        .ok
    }

    fn create_text(&self, path: &Path, content: &str) -> bool {
        crate::filesystem::desktop::create_library_file(path.to_string_lossy().as_ref(), content).ok
    }

    fn remove_file(&self, path: &Path) -> bool {
        std::fs::remove_file(path).is_ok()
    }
}

thread_local! {
    static CURRENT: RefCell<Option<Rc<dyn TaskFileSystem>>> = const { RefCell::new(None) };
}

/// Runs `operation` with `file_system` as the storage of every helper below.
pub(crate) fn scoped<R>(file_system: Rc<dyn TaskFileSystem>, operation: impl FnOnce() -> R) -> R {
    struct Restore(Option<Rc<dyn TaskFileSystem>>);
    impl Drop for Restore {
        fn drop(&mut self) {
            let previous = self.0.take();
            CURRENT.with(|current| *current.borrow_mut() = previous);
        }
    }
    let previous = CURRENT.with(|current| current.borrow_mut().replace(file_system));
    let _restore = Restore(previous);
    operation()
}

fn current() -> Rc<dyn TaskFileSystem> {
    CURRENT
        .with(|current| current.borrow().clone())
        .unwrap_or_else(|| Rc::new(DesktopTaskFileSystem))
}

pub(crate) fn desktop() -> Rc<dyn TaskFileSystem> {
    Rc::new(DesktopTaskFileSystem)
}

pub(crate) fn is_dir(path: &Path) -> bool {
    current().is_dir(path)
}

pub(crate) fn read(path: &Path) -> Option<Vec<u8>> {
    current().read(path)
}

pub(crate) fn read_to_string(path: &Path) -> Option<String> {
    read(path).and_then(|bytes| String::from_utf8(bytes).ok())
}

pub(crate) fn list_dir(path: &Path) -> Result<Vec<(PathBuf, EntryKind)>, ()> {
    current().list_dir(path)
}

pub(crate) fn create_dir_all(path: &Path) -> Result<(), ()> {
    current().create_dir_all(path)
}

pub(crate) fn write_text(path: &Path, content: &str, expected_revision: Option<&str>) -> bool {
    current().write_text(path, content, expected_revision)
}

pub(crate) fn create_text(path: &Path, content: &str) -> bool {
    current().create_text(path, content)
}

pub(crate) fn remove_file(path: &Path) -> bool {
    current().remove_file(path)
}

/// Virtual root that stands for an Android library inside the store. Paths
/// under it are translated to `tree/<logical path>` for SAF.
pub(crate) const SAF_VIRTUAL_ROOT: &str = "/notia-saf-library";

#[cfg(target_os = "android")]
pub(crate) use saf::SafTaskFileSystem;

#[cfg(any(target_os = "android", test))]
fn logical_components(virtual_root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(virtual_root).ok()?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            std::path::Component::Normal(part) => parts.push(part.to_str()?.to_string()),
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    Some(parts.join("/"))
}

#[cfg(target_os = "android")]
mod saf {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};

    use crate::host::{AppHandle, Manager};

    use super::{logical_components, EntryKind, TaskFileSystem};
    use crate::filesystem::android_saf;
    use crate::mobile_directory_picker::{read_android_flat_entries, AndroidDirectoryPickerState};

    /// SAF view of one granted tree. The tree is listed once per operation
    /// and the listing is updated by this operation's own writes.
    pub(crate) struct SafTaskFileSystem {
        app: AppHandle,
        tree_uri: String,
        virtual_root: PathBuf,
        listing: RefCell<Option<HashMap<String, bool>>>,
    }

    impl SafTaskFileSystem {
        pub(crate) fn new(app: AppHandle, tree_uri: String) -> Self {
            Self {
                app,
                tree_uri,
                virtual_root: PathBuf::from(super::SAF_VIRTUAL_ROOT),
                listing: RefCell::new(None),
            }
        }

        fn state(&self) -> crate::host::State<'_, AndroidDirectoryPickerState> {
            self.app.state::<AndroidDirectoryPickerState>()
        }

        fn logical(&self, path: &Path) -> Option<String> {
            logical_components(&self.virtual_root, path)
        }

        fn saf_path(&self, logical: &str) -> String {
            if logical.is_empty() {
                self.tree_uri.clone()
            } else {
                format!("{}/{}", self.tree_uri.trim_end_matches('/'), logical)
            }
        }

        /// Logical path → is directory, for every entry of the tree.
        fn with_listing<R>(&self, read: impl FnOnce(&HashMap<String, bool>) -> R) -> Option<R> {
            if self.listing.borrow().is_none() {
                let entries = read_android_flat_entries(self.state().inner(), &self.tree_uri).ok()?;
                let prefix = format!("{}/", self.tree_uri.trim_end_matches('/'));
                let listing = entries
                    .into_iter()
                    .filter_map(|entry| {
                        let logical = entry.path.strip_prefix(&prefix)?.to_string();
                        Some((logical, entry.node_type == "folder"))
                    })
                    .collect::<HashMap<_, _>>();
                *self.listing.borrow_mut() = Some(listing);
            }
            self.listing.borrow().as_ref().map(read)
        }

        fn remember(&self, logical: &str, is_dir: bool) {
            if let Some(listing) = self.listing.borrow_mut().as_mut() {
                listing.insert(logical.to_string(), is_dir);
            }
        }
    }

    impl TaskFileSystem for SafTaskFileSystem {
        fn is_dir(&self, path: &Path) -> bool {
            match self.logical(path) {
                Some(logical) if logical.is_empty() => true,
                Some(logical) => self
                    .with_listing(|listing| listing.get(&logical).copied().unwrap_or(false))
                    .unwrap_or(false),
                None => false,
            }
        }

        fn read(&self, path: &Path) -> Option<Vec<u8>> {
            let logical = self.logical(path).filter(|logical| !logical.is_empty())?;
            let result = android_saf::read_library_file(
                self.state().inner(),
                &self.saf_path(&logical),
                Some(&self.tree_uri),
            )?;
            result.ok.then(|| result.content.into_bytes())
        }

        fn list_dir(&self, path: &Path) -> Result<Vec<(PathBuf, EntryKind)>, ()> {
            let logical = self.logical(path).ok_or(())?;
            let parent_prefix = if logical.is_empty() {
                String::new()
            } else {
                format!("{logical}/")
            };
            self.with_listing(|listing| {
                listing
                    .iter()
                    .filter_map(|(entry, is_dir)| {
                        let name = entry.strip_prefix(&parent_prefix)?;
                        (!name.is_empty() && !name.contains('/')).then(|| {
                            (
                                path.join(name),
                                if *is_dir { EntryKind::Directory } else { EntryKind::File },
                            )
                        })
                    })
                    .collect()
            })
            .ok_or(())
        }

        fn create_dir_all(&self, path: &Path) -> Result<(), ()> {
            let logical = self.logical(path).ok_or(())?;
            let mut prefix = String::new();
            for part in logical.split('/').filter(|part| !part.is_empty()) {
                if !prefix.is_empty() {
                    prefix.push('/');
                }
                prefix.push_str(part);
                let exists = self
                    .with_listing(|listing| listing.get(&prefix).copied() == Some(true))
                    .unwrap_or(false);
                if exists {
                    continue;
                }
                let created = android_saf::create_library_directory(
                    self.state().inner(),
                    &self.saf_path(&prefix),
                    Some(&self.tree_uri),
                )
                .map(|result| result.ok || result.error.as_deref().is_some_and(|error| error.contains("already exists")))
                .unwrap_or(false);
                if !created {
                    return Err(());
                }
                self.remember(&prefix, true);
            }
            Ok(())
        }

        fn write_text(&self, path: &Path, content: &str, expected_revision: Option<&str>) -> bool {
            let Some(logical) = self.logical(path).filter(|logical| !logical.is_empty()) else {
                return false;
            };
            android_saf::write_library_file(
                self.state().inner(),
                &self.saf_path(&logical),
                content,
                expected_revision,
                Some(&self.tree_uri),
            )
            .is_some_and(|result| result.ok)
        }

        fn create_text(&self, path: &Path, content: &str) -> bool {
            let Some(logical) = self.logical(path).filter(|logical| !logical.is_empty()) else {
                return false;
            };
            let created = android_saf::create_library_file(
                self.state().inner(),
                &self.saf_path(&logical),
                content,
                Some(&self.tree_uri),
            )
            .is_some_and(|result| result.ok);
            if created {
                self.remember(&logical, false);
            }
            created
        }

        fn remove_file(&self, path: &Path) -> bool {
            let Some(logical) = self.logical(path).filter(|logical| !logical.is_empty()) else {
                return false;
            };
            let removed = android_saf::delete_entry(
                self.state().inner(),
                &self.saf_path(&logical),
                Some(&self.tree_uri),
            )
            .is_some_and(|result| result.ok);
            if removed {
                if let Some(listing) = self.listing.borrow_mut().as_mut() {
                    listing.remove(&logical);
                }
            }
            removed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saf_paths_map_to_logical_components_without_traversal() {
        let root = Path::new(SAF_VIRTUAL_ROOT);
        assert_eq!(logical_components(root, root).as_deref(), Some(""));
        assert_eq!(
            logical_components(root, &root.join("task-manager/tasks/a.md")).as_deref(),
            Some("task-manager/tasks/a.md")
        );
        assert_eq!(logical_components(root, &root.join("../x")), None);
        assert_eq!(logical_components(root, Path::new("/otro/a.md")), None);
    }

    #[test]
    fn scoped_backend_is_restored_after_the_operation() {
        struct Fake;
        impl TaskFileSystem for Fake {
            fn is_dir(&self, _: &Path) -> bool { true }
            fn read(&self, _: &Path) -> Option<Vec<u8>> { None }
            fn list_dir(&self, _: &Path) -> Result<Vec<(PathBuf, EntryKind)>, ()> { Ok(Vec::new()) }
            fn create_dir_all(&self, _: &Path) -> Result<(), ()> { Ok(()) }
            fn write_text(&self, _: &Path, _: &str, _: Option<&str>) -> bool { false }
            fn create_text(&self, _: &Path, _: &str) -> bool { false }
            fn remove_file(&self, _: &Path) -> bool { false }
        }
        let missing = Path::new("/definitely/missing/notia");
        assert!(scoped(Rc::new(Fake), || is_dir(missing)));
        assert!(!is_dir(missing));
    }
}
