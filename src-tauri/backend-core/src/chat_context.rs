//! Library context of a chat turn: the files and folders the person chose,
//! whether the agent may search the whole library (RAG) and the text block
//! that carries the chosen files to the agent. The adapter reads the
//! inventory and the files; everything that decides the result lives here.

use std::collections::{BTreeMap, HashSet};

use crate::catalog::{canonical_tool_catalog, tool_policy, ToolPolicy};
use crate::protocol::ToolDefinition;
use crate::chat_history::ChatContextMode;

/// Characters of file content a turn carries in direct mode.
pub const MAX_DIRECT_CONTEXT_CHARS: usize = 30_000;
/// Files and characters a turn lists in reference mode.
pub const MAX_INDEX_FILES: usize = 50;
pub const MAX_INDEX_CHARS: usize = 6_000;
/// Files a turn takes from the chosen files and folders together.
pub const MAX_CONTEXT_FILES: usize = 500;

/// A folder of the library with the files it holds, subfolders included.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibraryFolder {
    /// Logical path inside the library, without a trailing slash.
    pub path: String,
    pub file_count: usize,
}

/// Every folder that holds at least one file of the inventory, sorted by
/// path. `inventory` holds logical file paths.
pub fn library_folders(inventory: &[String]) -> Vec<LibraryFolder> {
    let mut counts = BTreeMap::<String, usize>::new();
    for file in inventory {
        let mut end = 0;
        while let Some(offset) = file[end..].find('/') {
            end += offset;
            *counts.entry(file[..end].to_string()).or_default() += 1;
            end += 1;
        }
    }
    counts
        .into_iter()
        .map(|(path, file_count)| LibraryFolder { path, file_count })
        .collect()
}

fn normalized_folder(folder: &str) -> Option<String> {
    let trimmed = folder.trim().trim_matches('/');
    (!trimmed.is_empty()).then(|| format!("{trimmed}/"))
}

/// The files a turn uses: the chosen files, then the inventory files under
/// each chosen folder and its subfolders. Paths are logical; repeated files
/// appear once, in that order, up to [`MAX_CONTEXT_FILES`].
pub fn expand_context_files(files: &[String], folders: &[String], inventory: &[String]) -> Vec<String> {
    let prefixes = folders.iter().filter_map(|folder| normalized_folder(folder)).collect::<Vec<_>>();
    let under_folders = prefixes.iter().flat_map(|prefix| inventory.iter().filter(move |file| file.starts_with(prefix.as_str())));
    let mut seen = HashSet::new();
    files
        .iter()
        .map(|file| file.trim())
        .filter(|file| !file.is_empty())
        .chain(under_folders.map(String::as_str))
        .filter(|file| seen.insert(file.to_string()))
        .take(MAX_CONTEXT_FILES)
        .map(str::to_string)
        .collect()
}

/// A chosen file and, in direct mode, its content (`None` when it could not
/// be read).
pub struct ContextFile {
    pub path: String,
    pub content: Option<String>,
}

/// Text that carries the chosen files to the agent, or `None` when there is
/// nothing to say: no files and the library search is on.
pub fn context_block(mode: ChatContextMode, library_rag: bool, files: &[ContextFile]) -> Option<String> {
    let mut sections = Vec::new();
    if !library_rag {
        sections.push(if files.is_empty() {
            "La búsqueda en la librería está desactivada para este chat: no tenés acceso a los archivos de la librería. Respondé con la conversación y lo que te den en el mensaje.".to_string()
        } else {
            "La búsqueda en la librería está desactivada para este chat: usá solo los archivos elegidos a continuación y no busques otros.".to_string()
        });
    }
    if !files.is_empty() {
        sections.push(match mode {
            ChatContextMode::Direct => direct_block(files),
            ChatContextMode::Index => index_block(files, library_rag),
        });
    }
    (!sections.is_empty()).then(|| sections.join("\n\n"))
}

fn direct_block(files: &[ContextFile]) -> String {
    let mut used = 0;
    let mut parts = vec!["Archivos elegidos por la persona como contexto (contenido completo):".to_string()];
    let mut left_out = Vec::new();
    for file in files {
        let Some(content) = file.content.as_deref() else {
            left_out.push(format!("{} (no se pudo leer)", file.path));
            continue;
        };
        let length = content.chars().count();
        if used + length > MAX_DIRECT_CONTEXT_CHARS {
            left_out.push(format!("{} (no entra en el límite de contexto)", file.path));
            continue;
        }
        used += length;
        parts.push(format!("### {}\n{}", file.path, content.trim_end()));
    }
    if !left_out.is_empty() {
        parts.push(format!("Archivos elegidos que no se incluyen:\n{}", left_out.iter().map(|item| format!("- {item}")).collect::<Vec<_>>().join("\n")));
    }
    parts.join("\n\n")
}

fn index_block(files: &[ContextFile], library_rag: bool) -> String {
    let heading = if library_rag {
        "Archivos elegidos por la persona como referencia (solo nombres y rutas; leelos con tus herramientas si hacen falta):"
    } else {
        "Archivos elegidos por la persona como referencia (solo nombres y rutas; su contenido no está disponible):"
    };
    let mut lines = vec![heading.to_string()];
    let mut used = heading.len();
    let mut listed = 0;
    for file in files.iter().take(MAX_INDEX_FILES) {
        let line = format!("- {}", file.path);
        if used + line.len() > MAX_INDEX_CHARS {
            break;
        }
        used += line.len();
        listed += 1;
        lines.push(line);
    }
    if listed < files.len() {
        lines.push(format!("(y {} archivos más)", files.len() - listed));
    }
    lines.join("\n")
}

/// The prompt of a turn followed by its library context, when there is one.
pub fn prompt_with_context(prompt: String, block: Option<String>) -> String {
    match block {
        Some(block) => format!("{prompt}\n\nContexto de la librería para esta consulta:\n{block}"),
        None => prompt,
    }
}

/// Tools of a turn without library search: the catalog tools among `names`
/// except the ones that read or search the library.
pub fn tools_without_library_rag<'a>(names: impl IntoIterator<Item = &'a str>) -> Vec<ToolDefinition> {
    let names = names.into_iter().collect::<HashSet<_>>();
    canonical_tool_catalog()
        .into_iter()
        .filter(|tool| names.contains(tool.name.as_str()) && tool_policy(&tool.name) != ToolPolicy::LibraryRead)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn folders_count_their_files_and_subfolders() {
        let folders = library_folders(&paths(&["a.md", "notas/x.md", "notas/2026/y.md", "notas/2026/z.md"]));
        assert_eq!(
            folders,
            vec![
                LibraryFolder { path: "notas".into(), file_count: 3 },
                LibraryFolder { path: "notas/2026".into(), file_count: 2 },
            ]
        );
    }

    #[test]
    fn folders_expand_to_their_files_without_repeating_or_leaking() {
        let inventory = paths(&["notas/x.md", "notas/2026/y.md", "notasviejas/z.md", "otro.md"]);
        let expanded = expand_context_files(&paths(&["otro.md", "notas/x.md"]), &paths(&["notas/"]), &inventory);
        assert_eq!(expanded, paths(&["otro.md", "notas/x.md", "notas/2026/y.md"]));
        assert!(expand_context_files(&[], &paths(&[" ", "/"]), &inventory).is_empty());
    }

    #[test]
    fn direct_context_carries_contents_within_the_limit() {
        let big = "x".repeat(MAX_DIRECT_CONTEXT_CHARS);
        let block = context_block(
            ChatContextMode::Direct,
            true,
            &[
                ContextFile { path: "a.md".into(), content: Some("hola".into()) },
                ContextFile { path: "b.md".into(), content: Some(big) },
                ContextFile { path: "c.md".into(), content: None },
            ],
        )
        .expect("block");
        assert!(block.contains("### a.md\nhola"));
        assert!(block.contains("- b.md (no entra en el límite de contexto)"));
        assert!(block.contains("- c.md (no se pudo leer)"));
        assert!(!block.contains("desactivada"));
    }

    #[test]
    fn without_rag_the_agent_is_told_and_library_reads_are_removed() {
        assert_eq!(context_block(ChatContextMode::Direct, true, &[]), None);
        assert!(context_block(ChatContextMode::Direct, false, &[]).expect("block").contains("no tenés acceso"));
        let index = context_block(ChatContextMode::Index, false, &[ContextFile { path: "a.md".into(), content: None }]).expect("block");
        assert!(index.contains("usá solo los archivos elegidos") && index.contains("- a.md"));
        let tools = tools_without_library_rag(["search_library_documents", "read_library_documents", "search_web", "create_library_note", "not_a_tool"]);
        let mut names = tools.iter().map(|tool| tool.name.clone()).collect::<Vec<_>>();
        names.sort();
        assert_eq!(names, paths(&["create_library_note", "search_web"]));
    }
}
