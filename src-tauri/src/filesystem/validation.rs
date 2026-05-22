use super::helpers::has_invalid_entry_name;
use super::types::{
    CreateLibraryEntryPayload, LibraryEntryOperationPayload, OperationResult,
};

pub(crate) enum ValidatedLibraryEntryOperation<'a> {
    Delete {
        target_path: &'a str,
    },
    Rename {
        target_path: &'a str,
        new_name: &'a str,
    },
    Paste {
        source_path: &'a str,
        target_directory_path: &'a str,
        mode: &'a str,
    },
}

pub(crate) fn normalize_library_entry_name(kind: &str, name: &str) -> String {
    let trimmed_name = name.trim();
    if kind == "note" && !trimmed_name.to_lowercase().ends_with(".md") {
        format!("{}.md", trimmed_name)
    } else if kind == "inkdoc" && !trimmed_name.to_lowercase().ends_with(".inkdoc") {
        format!("{}.inkdoc", trimmed_name)
    } else if kind == "mermaid" && !trimmed_name.to_lowercase().ends_with(".mmd") {
        format!("{}.mmd", trimmed_name)
    } else {
        trimmed_name.to_string()
    }
}

pub(crate) fn validate_create_library_entry_payload(
    payload: &CreateLibraryEntryPayload,
) -> Result<String, OperationResult> {
    if payload.directory_path.trim().is_empty() {
        return Err(operation_error("Invalid entry data."));
    }

    if payload.kind != "folder" && payload.kind != "note" && payload.kind != "inkdoc" && payload.kind != "mermaid" {
        return Err(operation_error("Invalid entry type."));
    }

    if has_invalid_entry_name(&payload.name) {
        return Err(operation_error("Invalid name."));
    }

    Ok(normalize_library_entry_name(&payload.kind, &payload.name))
}

pub(crate) fn validate_library_entry_operation_payload(
    payload: &LibraryEntryOperationPayload,
) -> Result<ValidatedLibraryEntryOperation<'_>, OperationResult> {
    match payload.action.as_str() {
        "delete" => {
            let Some(target_path) = payload.target_path.as_deref() else {
                return Err(operation_error("Invalid target path."));
            };

            Ok(ValidatedLibraryEntryOperation::Delete { target_path })
        }
        "rename" => {
            let Some(target_path) = payload.target_path.as_deref() else {
                return Err(operation_error("Invalid rename data."));
            };
            let Some(new_name) = payload.new_name.as_deref() else {
                return Err(operation_error("Invalid rename data."));
            };

            if has_invalid_entry_name(new_name) {
                return Err(operation_error("Invalid rename data."));
            }

            Ok(ValidatedLibraryEntryOperation::Rename {
                target_path,
                new_name,
            })
        }
        "paste" => {
            let Some(source_path) = payload.source_path.as_deref() else {
                return Err(operation_error("Invalid paste data."));
            };
            let Some(target_directory_path) = payload.target_directory_path.as_deref() else {
                return Err(operation_error("Invalid paste data."));
            };
            let Some(mode) = payload.mode.as_deref() else {
                return Err(operation_error("Invalid paste data."));
            };

            if mode != "copy" && mode != "move" {
                return Err(operation_error("Invalid paste data."));
            }

            Ok(ValidatedLibraryEntryOperation::Paste {
                source_path,
                target_directory_path,
                mode,
            })
        }
        _ => Err(operation_error("Unknown action.")),
    }
}

fn operation_error(message: &str) -> OperationResult {
    OperationResult {
        ok: false,
        error: Some(message.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_library_entry_name, validate_create_library_entry_payload,
        validate_library_entry_operation_payload, ValidatedLibraryEntryOperation,
    };
    use crate::filesystem::types::{CreateLibraryEntryPayload, LibraryEntryOperationPayload};

    #[test]
    fn normalize_library_entry_name_adds_expected_extensions() {
        assert_eq!(normalize_library_entry_name("note", "hola"), "hola.md");
        assert_eq!(normalize_library_entry_name("inkdoc", "dibujo"), "dibujo.inkdoc");
        assert_eq!(normalize_library_entry_name("folder", "carpeta"), "carpeta");
        assert_eq!(normalize_library_entry_name("note", "ya.md"), "ya.md");
    }

    #[test]
    fn validate_create_library_entry_payload_rejects_invalid_input() {
        let invalid_name = CreateLibraryEntryPayload {
            directory_path: "/tmp".to_string(),
            directory_uri: None,
            name: "../hola".to_string(),
            kind: "note".to_string(),
        };
        let invalid_kind = CreateLibraryEntryPayload {
            directory_path: "/tmp".to_string(),
            directory_uri: None,
            name: "hola".to_string(),
            kind: "binary".to_string(),
        };

        assert_eq!(
            validate_create_library_entry_payload(&invalid_name)
                .unwrap_err()
                .error
                .as_deref(),
            Some("Invalid name.")
        );
        assert_eq!(
            validate_create_library_entry_payload(&invalid_kind)
                .unwrap_err()
                .error
                .as_deref(),
            Some("Invalid entry type.")
        );
    }

    #[test]
    fn validate_library_entry_operation_payload_parses_supported_actions() {
        let rename_payload = LibraryEntryOperationPayload {
            action: "rename".to_string(),
            target_path: Some("/tmp/a.md".to_string()),
            new_name: Some("b.md".to_string()),
            source_path: None,
            target_directory_path: None,
            mode: None,
            directory_uri: None,
        };
        let paste_payload = LibraryEntryOperationPayload {
            action: "paste".to_string(),
            target_path: None,
            new_name: None,
            source_path: Some("/tmp/a.md".to_string()),
            target_directory_path: Some("/tmp/b".to_string()),
            mode: Some("move".to_string()),
            directory_uri: None,
        };

        let rename_operation = validate_library_entry_operation_payload(&rename_payload).unwrap();
        let paste_operation = validate_library_entry_operation_payload(&paste_payload).unwrap();

        match rename_operation {
            ValidatedLibraryEntryOperation::Rename {
                target_path,
                new_name,
            } => {
                assert_eq!(target_path, "/tmp/a.md");
                assert_eq!(new_name, "b.md");
            }
            _ => panic!("expected rename operation"),
        }

        match paste_operation {
            ValidatedLibraryEntryOperation::Paste {
                source_path,
                target_directory_path,
                mode,
            } => {
                assert_eq!(source_path, "/tmp/a.md");
                assert_eq!(target_directory_path, "/tmp/b");
                assert_eq!(mode, "move");
            }
            _ => panic!("expected paste operation"),
        }
    }

    #[test]
    fn validate_library_entry_operation_payload_rejects_invalid_cases() {
        let invalid_rename = LibraryEntryOperationPayload {
            action: "rename".to_string(),
            target_path: Some("/tmp/a.md".to_string()),
            new_name: Some("../b.md".to_string()),
            source_path: None,
            target_directory_path: None,
            mode: None,
            directory_uri: None,
        };
        let invalid_paste = LibraryEntryOperationPayload {
            action: "paste".to_string(),
            target_path: None,
            new_name: None,
            source_path: Some("/tmp/a.md".to_string()),
            target_directory_path: Some("/tmp/b".to_string()),
            mode: Some("duplicate".to_string()),
            directory_uri: None,
        };

        assert_eq!(
            validate_library_entry_operation_payload(&invalid_rename)
                .unwrap_err()
                .error
                .as_deref(),
            Some("Invalid rename data.")
        );
        assert_eq!(
            validate_library_entry_operation_payload(&invalid_paste)
                .unwrap_err()
                .error
                .as_deref(),
            Some("Invalid paste data.")
        );
    }
}
