use std::collections::HashSet;
use std::fs;
use std::fs::OpenOptions;
use std::io;
use std::path::{Path, PathBuf};

use crate::notia_timer::NotiaTimer;

use super::helpers::{
    canonical_or_original, collect_directory_signature, copy_entry_recursive,
    has_invalid_entry_name, is_same_or_nested_path, read_directory_tree,
    read_markdown_files_in_directory, search_library_files_in_directory,
};
use super::types::{
    content_revision, FileNode, FilesystemConflict, IsDirectoryPathResult, MarkdownFileDocument,
    OperationResult, PathExistsResult, ReadLibraryFileResult, ReadLibraryTreePayload,
    ReadMarkdownFilesPayload, SearchLibraryFilesPayload, SearchLibraryFilesResult,
    WriteBinaryFilePayload, WriteLibraryFileResult,
};

pub(crate) fn read_library_tree(payload: ReadLibraryTreePayload) -> Vec<FileNode> {
    let _timer = NotiaTimer::new("desktop.read_library_tree")
        .with_meta(format!("path={}", payload.directory_path));
    let directory_path = PathBuf::from(payload.directory_path);
    let mut visited_directories = HashSet::new();
    let result = read_directory_tree(&directory_path, &mut visited_directories);
    log::debug!(
        "[notia:perf] desktop.read_library_tree node_count={}",
        result.len()
    );
    result
}

pub(crate) fn read_library_tree_signature(payload: ReadLibraryTreePayload) -> String {
    let _timer = NotiaTimer::new("desktop.read_library_tree_signature")
        .with_meta(format!("path={}", payload.directory_path));
    if payload.directory_path.trim().is_empty() {
        return String::new();
    }

    let directory_path = PathBuf::from(payload.directory_path);
    let mut visited_directories = HashSet::new();
    let mut signature_hash: u32 = 2_166_136_261;
    collect_directory_signature(
        &directory_path,
        &mut visited_directories,
        &mut signature_hash,
    );
    format!("{:08x}", signature_hash)
}

pub(crate) fn read_library_file(file_path: &str) -> ReadLibraryFileResult {
    match fs::read_to_string(file_path) {
        Ok(content) => ReadLibraryFileResult {
            ok: true,
            revision: Some(content_revision(&content)),
            content,
            error: None,
        },
        Err(_) => ReadLibraryFileResult {
            ok: false,
            revision: None,
            content: String::new(),
            error: Some("Could not read file.".to_string()),
        },
    }
}

pub(crate) fn search_library_files(payload: SearchLibraryFilesPayload) -> SearchLibraryFilesResult {
    let _timer = NotiaTimer::new("desktop.search_library_files")
        .with_meta(format!("path={}", payload.directory_path));
    let normalized_query = payload.query.trim().to_lowercase();
    if payload.directory_path.trim().is_empty() || normalized_query.is_empty() {
        return SearchLibraryFilesResult { paths: Vec::new() };
    }

    let directory_path = PathBuf::from(payload.directory_path);
    let mut visited_directories = HashSet::new();
    let mut matched_file_paths: Vec<String> = Vec::new();

    search_library_files_in_directory(
        &directory_path,
        &normalized_query,
        &mut visited_directories,
        &mut matched_file_paths,
    );

    matched_file_paths.sort_by_key(|path| path.to_lowercase());
    SearchLibraryFilesResult {
        paths: matched_file_paths,
    }
}

pub(crate) fn read_markdown_files(payload: ReadMarkdownFilesPayload) -> Vec<MarkdownFileDocument> {
    let _timer = NotiaTimer::new("desktop.read_markdown_files")
        .with_meta(format!("path={}", payload.directory_path));
    if payload.directory_path.trim().is_empty() {
        return Vec::new();
    }

    let directory_path = PathBuf::from(payload.directory_path);
    let mut visited_directories = HashSet::new();
    let mut documents = Vec::new();

    read_markdown_files_in_directory(&directory_path, &mut visited_directories, &mut documents);
    documents.sort_by_key(|document| document.path.to_lowercase());
    documents
}

pub(crate) fn write_library_file(
    file_path: &str,
    content: &str,
    expected_revision: Option<&str>,
) -> WriteLibraryFileResult {
    if let Some(expected_revision) = expected_revision {
        let current_revision = fs::read_to_string(file_path)
            .ok()
            .map(|current| content_revision(&current));
        if current_revision.as_deref() != Some(expected_revision) {
            return WriteLibraryFileResult {
                ok: false,
                error: Some("CONFLICT: el archivo cambió desde la última lectura.".to_string()),
                conflict: Some(FilesystemConflict {
                    kind: "revision",
                    expected_revision: expected_revision.to_string(),
                    current_revision,
                }),
            };
        }
    }
    let target = Path::new(file_path);
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let temporary_path = parent.join(format!(".{}.notia-tmp-{}", file_name, uuid::Uuid::new_v4()));

    let result = (|| -> std::io::Result<()> {
        let mut temporary_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)?;
        use std::io::Write;
        temporary_file.write_all(content.as_bytes())?;
        temporary_file.sync_all()?;
        drop(temporary_file);
        replace_file_atomically(&temporary_path, target)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }

    match result {
        Ok(()) => WriteLibraryFileResult {
            ok: true,
            error: None,
            conflict: None,
        },
        Err(_) => WriteLibraryFileResult {
            ok: false,
            error: Some("Could not write file atomically.".to_string()),
            conflict: None,
        },
    }
}

pub(crate) fn create_library_file(file_path: &str, content: &str) -> OperationResult {
    let target = Path::new(file_path);
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let temporary_path = parent.join(format!(
        ".{}.notia-create-tmp-{}",
        file_name,
        uuid::Uuid::new_v4()
    ));

    let result = (|| -> std::io::Result<()> {
        let mut temporary_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)?;
        use std::io::Write;
        temporary_file.write_all(content.as_bytes())?;
        temporary_file.sync_all()?;
        drop(temporary_file);
        if target.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "target already exists",
            ));
        }
        replace_file_atomically(&temporary_path, target)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }

    match result {
        Ok(()) => OperationResult {
            ok: true,
            error: None,
        },
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => OperationResult {
            ok: false,
            error: Some("An entry with that name already exists.".to_string()),
        },
        Err(_) => OperationResult {
            ok: false,
            error: Some("Could not create file atomically.".to_string()),
        },
    }
}

fn replace_file_atomically(source: &Path, target: &Path) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        use std::iter;
        use std::os::windows::ffi::OsStrExt;
        use std::time::Duration;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };

        let source_wide = source
            .as_os_str()
            .encode_wide()
            .chain(iter::once(0))
            .collect::<Vec<_>>();
        let target_wide = target
            .as_os_str()
            .encode_wide()
            .chain(iter::once(0))
            .collect::<Vec<_>>();
        const ATOMIC_REPLACE_ATTEMPTS: usize = 5;
        for attempt in 0..ATOMIC_REPLACE_ATTEMPTS {
            // SAFETY: both buffers are owned, UTF-16 encoded, and explicitly NUL-terminated
            // for the duration of the synchronous Windows API call.
            let result = unsafe {
                MoveFileExW(
                    PCWSTR(source_wide.as_ptr()),
                    PCWSTR(target_wide.as_ptr()),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            };
            match result {
                Ok(()) => return Ok(()),
                Err(error) if attempt + 1 < ATOMIC_REPLACE_ATTEMPTS => {
                    // Antivirus scanners, the editor and the filesystem watcher can briefly
                    // hold the destination after a read. Keep the atomic replacement contract
                    // and absorb only this short, transient contention window.
                    std::thread::sleep(Duration::from_millis(25 * (attempt as u64 + 1)));
                    let _ = error;
                }
                Err(error) => return Err(io::Error::other(error.to_string())),
            }
        }
        Err(io::Error::other("Could not replace file atomically."))
    }

    #[cfg(not(target_os = "windows"))]
    {
        fs::rename(source, target)
    }
}

pub(crate) fn create_library_directory(directory_path: &str) -> OperationResult {
    match fs::create_dir_all(directory_path) {
        Ok(()) => OperationResult {
            ok: true,
            error: None,
        },
        Err(error) => {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                return OperationResult {
                    ok: true,
                    error: None,
                };
            }

            OperationResult {
                ok: false,
                error: Some(format!("Could not create directory: {}", error)),
            }
        }
    }
}

pub(crate) fn path_exists(path: &str) -> PathExistsResult {
    PathExistsResult {
        exists: Path::new(path).exists(),
    }
}

pub(crate) fn is_directory_path(path: &str) -> IsDirectoryPathResult {
    IsDirectoryPathResult {
        is_directory: Path::new(path).is_dir(),
    }
}

pub(crate) fn write_binary_file(payload: WriteBinaryFilePayload) -> OperationResult {
    match fs::write(payload.file_path, payload.data) {
        Ok(()) => OperationResult {
            ok: true,
            error: None,
        },
        Err(_) => OperationResult {
            ok: false,
            error: Some("Could not write file.".to_string()),
        },
    }
}

pub(crate) fn create_library_entry(
    directory_path: &str,
    normalized_name: &str,
    kind: &str,
) -> OperationResult {
    let target_path = PathBuf::from(directory_path).join(normalized_name);

    let operation_result = if kind == "folder" {
        fs::create_dir(target_path)
    } else {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target_path)
            .map(|_| ())
    };

    match operation_result {
        Ok(()) => OperationResult {
            ok: true,
            error: None,
        },
        Err(error) => {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                return OperationResult {
                    ok: false,
                    error: Some("An entry with that name already exists.".to_string()),
                };
            }

            OperationResult {
                ok: false,
                error: Some("Could not create entry.".to_string()),
            }
        }
    }
}

pub(crate) fn delete_entry(target_path: &str) -> OperationResult {
    let target_path = PathBuf::from(target_path);
    let operation_result = if target_path.is_dir() {
        fs::remove_dir_all(target_path)
    } else {
        fs::remove_file(target_path)
    };

    match operation_result {
        Ok(()) => OperationResult {
            ok: true,
            error: None,
        },
        Err(_) => OperationResult {
            ok: false,
            error: Some("Could not delete entry.".to_string()),
        },
    }
}

pub(crate) fn rename_entry(target_path: &str, new_name: &str) -> OperationResult {
    if has_invalid_entry_name(new_name) {
        return OperationResult {
            ok: false,
            error: Some("Invalid rename data.".to_string()),
        };
    }

    let target_path = PathBuf::from(target_path);
    let Some(parent_directory) = target_path.parent() else {
        return OperationResult {
            ok: false,
            error: Some("Could not rename entry.".to_string()),
        };
    };

    let next_path = parent_directory.join(new_name.trim());
    if next_path.exists() {
        return OperationResult {
            ok: false,
            error: Some("An entry with that name already exists.".to_string()),
        };
    }

    match fs::rename(target_path, next_path) {
        Ok(()) => OperationResult {
            ok: true,
            error: None,
        },
        Err(_) => OperationResult {
            ok: false,
            error: Some("Could not rename entry.".to_string()),
        },
    }
}

pub(crate) fn paste_entry(
    source_path: &str,
    target_directory_path: &str,
    mode: &str,
) -> OperationResult {
    let source_path = PathBuf::from(source_path);
    let target_directory_path = PathBuf::from(target_directory_path);
    let Some(source_name) = source_path.file_name() else {
        return OperationResult {
            ok: false,
            error: Some("Invalid paste data.".to_string()),
        };
    };
    let target_path = target_directory_path.join(source_name);

    if canonical_or_original(&source_path) == canonical_or_original(&target_path) {
        return OperationResult {
            ok: false,
            error: Some("Source and destination are the same.".to_string()),
        };
    }

    if target_path.exists() {
        return OperationResult {
            ok: false,
            error: Some("An entry with that name already exists.".to_string()),
        };
    }

    if mode == "move" && is_same_or_nested_path(&source_path, &target_directory_path) {
        return OperationResult {
            ok: false,
            error: Some("Cannot move a folder into itself.".to_string()),
        };
    }

    let operation_result = if mode == "copy" {
        copy_entry_recursive(&source_path, &target_path)
    } else {
        fs::rename(&source_path, &target_path)
    };

    match operation_result {
        Ok(()) => OperationResult {
            ok: true,
            error: None,
        },
        Err(_) => OperationResult {
            ok: false,
            error: Some("Could not paste entry.".to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        create_library_file, paste_entry, read_library_file, rename_entry, write_library_file,
    };

    struct TestTempDir {
        path: PathBuf,
    }

    impl TestTempDir {
        fn new() -> Self {
            let unique_suffix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time before unix epoch")
                .as_nanos();
            let path = env::temp_dir().join(format!(
                "notia-filesystem-desktop-tests-{}-{}",
                process::id(),
                unique_suffix
            ));
            fs::create_dir_all(&path).expect("failed to create temp test directory");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestTempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn rename_entry_renames_file_successfully() {
        let temp_dir = TestTempDir::new();
        let original_path = temp_dir.path().join("source.md");
        let renamed_path = temp_dir.path().join("renamed.md");
        fs::write(&original_path, "# hola").expect("failed to seed source file");

        let result = rename_entry(
            original_path.to_str().expect("invalid utf-8 test path"),
            "renamed.md",
        );

        assert!(result.ok);
        assert!(result.error.is_none());
        assert!(!original_path.exists());
        assert!(renamed_path.exists());
    }

    #[test]
    fn rename_entry_rejects_duplicate_target_name() {
        let temp_dir = TestTempDir::new();
        let original_path = temp_dir.path().join("source.md");
        let duplicate_path = temp_dir.path().join("duplicate.md");
        fs::write(&original_path, "# hola").expect("failed to seed source file");
        fs::write(&duplicate_path, "# chau").expect("failed to seed duplicate file");

        let result = rename_entry(
            original_path.to_str().expect("invalid utf-8 test path"),
            "duplicate.md",
        );

        assert!(!result.ok);
        assert_eq!(
            result.error.as_deref(),
            Some("An entry with that name already exists.")
        );
        assert!(original_path.exists());
        assert!(duplicate_path.exists());
    }

    #[test]
    fn write_library_file_rejects_a_stale_revision_without_overwriting() {
        let temp_dir = TestTempDir::new();
        let file_path = temp_dir.path().join("shared.md");
        fs::write(&file_path, "version one").expect("failed to seed shared file");
        let initial = read_library_file(file_path.to_str().expect("invalid utf-8 test path"));
        let initial_revision = initial.revision.expect("revision for existing file");

        fs::write(&file_path, "version two").expect("failed to simulate concurrent write");
        let result = write_library_file(
            file_path.to_str().expect("invalid utf-8 test path"),
            "version three",
            Some(&initial_revision),
        );

        assert!(!result.ok);
        assert!(result
            .error
            .as_deref()
            .is_some_and(|error| error.starts_with("CONFLICT:")));
        let conflict = result.conflict.expect("structured file conflict");
        assert_eq!(conflict.kind, "revision");
        assert_eq!(conflict.expected_revision, initial_revision);
        assert_eq!(
            fs::read_to_string(file_path).expect("read shared file"),
            "version two"
        );
    }

    #[test]
    fn write_library_file_atomically_replaces_an_existing_file() {
        let temp_dir = TestTempDir::new();
        let file_path = temp_dir.path().join("shared.md");
        fs::write(&file_path, "version one").expect("failed to seed shared file");

        let result = write_library_file(
            file_path.to_str().expect("invalid utf-8 test path"),
            "version two",
            None,
        );

        assert!(result.ok);
        assert_eq!(
            fs::read_to_string(file_path).expect("read replaced file"),
            "version two"
        );
    }

    #[test]
    fn create_library_file_writes_content_before_publishing_the_target() {
        let temp_dir = TestTempDir::new();
        let file_path = temp_dir.path().join("created.md");

        let result = create_library_file(
            file_path.to_str().expect("invalid utf-8 test path"),
            "contenido completo",
        );

        assert!(result.ok);
        assert_eq!(
            fs::read_to_string(file_path).expect("read created file"),
            "contenido completo"
        );
    }

    #[test]
    fn paste_entry_copies_files_successfully() {
        let temp_dir = TestTempDir::new();
        let source_dir = temp_dir.path().join("source");
        let target_dir = temp_dir.path().join("target");
        let source_file = source_dir.join("note.md");
        let copied_file = target_dir.join("note.md");
        fs::create_dir_all(&source_dir).expect("failed to create source dir");
        fs::create_dir_all(&target_dir).expect("failed to create target dir");
        fs::write(&source_file, "# nota").expect("failed to seed source file");

        let result = paste_entry(
            source_file.to_str().expect("invalid utf-8 source path"),
            target_dir.to_str().expect("invalid utf-8 target path"),
            "copy",
        );

        assert!(result.ok);
        assert!(result.error.is_none());
        assert!(source_file.exists());
        assert!(copied_file.exists());
        assert_eq!(
            fs::read_to_string(&copied_file).expect("failed to read copied file"),
            "# nota"
        );
    }

    #[test]
    fn paste_entry_rejects_move_into_nested_directory() {
        let temp_dir = TestTempDir::new();
        let source_dir = temp_dir.path().join("source");
        let nested_target_dir = source_dir.join("nested");
        fs::create_dir_all(&nested_target_dir).expect("failed to create nested target dir");

        let result = paste_entry(
            source_dir.to_str().expect("invalid utf-8 source dir"),
            nested_target_dir
                .to_str()
                .expect("invalid utf-8 nested target dir"),
            "move",
        );

        assert!(!result.ok);
        assert_eq!(
            result.error.as_deref(),
            Some("Cannot move a folder into itself.")
        );
        assert!(source_dir.exists());
        assert!(nested_target_dir.exists());
    }
}
