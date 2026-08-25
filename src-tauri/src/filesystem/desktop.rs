use std::collections::HashSet;
use std::fs;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};

use crate::notia_timer::NotiaTimer;

use super::helpers::{
    canonical_or_original, collect_directory_signature, copy_entry_recursive,
    has_invalid_entry_name, is_same_or_nested_path, read_directory_tree,
    read_markdown_files_in_directory, search_library_files_in_directory,
};
use super::types::{
    FileNode, IsDirectoryPathResult, MarkdownFileDocument, OperationResult, PathExistsResult,
    ReadLibraryFileResult, ReadLibraryTreePayload, ReadMarkdownFilesPayload,
    SearchLibraryFilesPayload, SearchLibraryFilesResult, WriteBinaryFilePayload,
    WriteLibraryFileResult,
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
            content,
            error: None,
        },
        Err(_) => ReadLibraryFileResult {
            ok: false,
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

    matched_file_paths.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
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
    documents.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    documents
}

pub(crate) fn write_library_file(file_path: &str, content: &str) -> WriteLibraryFileResult {
    match fs::write(file_path, content) {
        Ok(()) => WriteLibraryFileResult {
            ok: true,
            error: None,
        },
        Err(_) => WriteLibraryFileResult {
            ok: false,
            error: Some("Could not write file.".to_string()),
        },
    }
}

pub(crate) fn create_library_file(file_path: &str, content: &str) -> OperationResult {
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(file_path)
    {
        Ok(mut file) => {
            use std::io::Write;

            let write_result = file.write_all(content.as_bytes());
            match write_result {
                Ok(()) => OperationResult {
                    ok: true,
                    error: None,
                },
                Err(_) => OperationResult {
                    ok: false,
                    error: Some("Could not create file.".to_string()),
                },
            }
        }
        Err(error) => {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                return OperationResult {
                    ok: false,
                    error: Some("An entry with that name already exists.".to_string()),
                };
            }

            OperationResult {
                ok: false,
                error: Some("Could not create file.".to_string()),
            }
        }
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

    use super::{paste_entry, rename_entry};

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
