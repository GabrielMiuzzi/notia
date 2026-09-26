//! GitBook blocks in notes: `{% … %}` tags, `<details>`, card tables and the
//! inline HTML GitBook writes for buttons, icons, expressions and images.
//! The editor draws them; this module owns what depends on the library:
//! page and space variables, expressions and conditions, references
//! relative to the note, reusable content and what an export shows.

mod export;
mod expression;

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::library_tools::LogicalPathDto;
use crate::page_links::frontmatter_value;
use crate::prompt::strip_frontmatter;

pub use export::expand_for_export;
pub use expression::{evaluate, Evaluation, ExpressionError, Value, MAX_EXPRESSION_CHARS};

/// Section variables of a library, as GitBook keeps them.
pub const SPACE_VARIABLES_PATH: &str = ".gitbook/vars.yaml";
/// Reusable content that includes other reusable content stops here.
pub const MAX_INCLUDE_DEPTH: usize = 3;
/// Markdown of reusable content the editor previews.
pub const MAX_INCLUDE_PREVIEW_CHARS: usize = 20_000;
/// Items of each kind one request resolves.
pub const MAX_RESOLVE_ITEMS: usize = 200;
const MAX_REFERENCE_CHARS: usize = 1_000;

/// `page.vars` (the note's `vars:` frontmatter) and `space.vars`
/// (`.gitbook/vars.yaml`). GitBook variables are text.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Variables {
    pub page: BTreeMap<String, String>,
    pub space: BTreeMap<String, String>,
}

impl Variables {
    pub fn read(source: &str, space_yaml: Option<&str>) -> Self {
        Self { page: page_variables(source), space: space_yaml.map(space_variables).unwrap_or_default() }
    }
}

/// Variable names start with a letter and hold letters, digits and `_`.
fn is_variable_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|first| first.is_ascii_alphabetic())
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

/// A YAML scalar written on one line: quoted, or plain up to a comment.
fn yaml_scalar(value: &str) -> String {
    let value = value.trim();
    if let Some(inner) = value.strip_prefix('"').and_then(|rest| rest.strip_suffix('"')) {
        return inner.replace("\\\"", "\"").replace("\\n", "\n").replace("\\\\", "\\");
    }
    if let Some(inner) = value.strip_prefix('\'').and_then(|rest| rest.strip_suffix('\'')) {
        return inner.replace("''", "'");
    }
    match value.find(" #") {
        Some(comment) => value[..comment].trim_end().to_string(),
        None => value.to_string(),
    }
}

fn variable_line(line: &str) -> Option<(String, String)> {
    let (name, value) = line.trim().split_once(':')?;
    let name = name.trim();
    is_variable_name(name).then(|| (name.to_string(), yaml_scalar(value)))
}

/// The `vars:` map of the note's frontmatter.
pub fn page_variables(source: &str) -> BTreeMap<String, String> {
    let normalized = source.strip_prefix('\u{feff}').unwrap_or(source).replace("\r\n", "\n");
    let mut variables = BTreeMap::new();
    let Some(body) = normalized.strip_prefix("---\n") else {
        return variables;
    };
    let end = if body.starts_with("---") { 0 } else { body.find("\n---").unwrap_or(0) };
    let mut inside = false;
    for line in body[..end].lines() {
        if !line.starts_with([' ', '\t']) {
            inside = line.trim_end() == "vars:";
            continue;
        }
        if let Some((name, value)) = inside.then(|| variable_line(line)).flatten() {
            variables.insert(name, value);
        }
    }
    variables
}

/// Top-level `name: value` lines of `.gitbook/vars.yaml`.
pub fn space_variables(yaml: &str) -> BTreeMap<String, String> {
    yaml.lines()
        .filter(|line| !line.starts_with([' ', '\t', '#']))
        .filter_map(variable_line)
        .collect()
}

/// Where a reference written in a note points.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reference {
    /// A web or mail address, opened outside Notia.
    External(String),
    /// A file of the library, by its logical path.
    Library(String),
    Invalid,
}

/// Resolves `reference` as GitBook does: relative to the note at `current`,
/// or to the library root when it starts with `/`. A folder means its
/// `README.md`. Nothing may climb above the library root.
pub fn resolve_reference(reference: &str, current: &str) -> Reference {
    let trimmed = reference.trim().trim_start_matches('<').trim_end_matches('>').trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_REFERENCE_CHARS || trimmed.chars().any(char::is_control) {
        return Reference::Invalid;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:") {
        return Reference::External(trimmed.to_string());
    }
    let without_fragment = trimmed.split(['#', '?']).next().unwrap_or_default();
    if without_fragment.is_empty() {
        // `#section`: a place in the same note.
        return LogicalPathDto::new(current).map_or(Reference::Invalid, |path| Reference::Library(path.as_str().to_string()));
    }
    let Some(decoded) = percent_decode(without_fragment) else {
        return Reference::Invalid;
    };
    let decoded = decoded.replace('\\', "/");
    // Any other scheme, or a Windows drive, is not a library file.
    if decoded.split('/').next().is_some_and(|first| first.contains(':')) {
        return Reference::Invalid;
    }
    let mut segments: Vec<&str> = if decoded.starts_with('/') {
        Vec::new()
    } else {
        current.split('/').collect::<Vec<_>>().split_last().map(|(_, folder)| folder.to_vec()).unwrap_or_default()
    };
    let is_folder = decoded.is_empty() || decoded.ends_with('/') || decoded == "." || decoded.ends_with("/.");
    for segment in decoded.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.pop().is_none() {
                    return Reference::Invalid;
                }
            }
            segment => segments.push(segment),
        }
    }
    if is_folder {
        segments.push("README.md");
    }
    match LogicalPathDto::new(&segments.join("/")) {
        Ok(path) => Reference::Library(path.as_str().to_string()),
        Err(_) => Reference::Invalid,
    }
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = value.get(index + 1..index + 3)?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

/// Title a link card shows: the `title` property, the first heading, or the
/// file name without its extension.
pub fn document_title(source: &str, logical_path: &str) -> String {
    if let Some(title) = frontmatter_value(source, "title").filter(|title| !title.trim().is_empty()) {
        return title.trim().to_string();
    }
    let heading = strip_frontmatter(source).lines().find_map(|line| {
        let title = line.trim_start().strip_prefix("# ")?.trim();
        (!title.is_empty()).then(|| title.to_string())
    });
    heading.unwrap_or_else(|| {
        let name = logical_path.rsplit('/').next().unwrap_or(logical_path);
        name.rsplit_once('.').map_or(name, |(stem, _)| stem).to_string()
    })
}

/// Whether the content of a `{% if %}` block shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConditionState {
    Satisfied,
    NotSatisfied,
    /// It reads data only a published reader has (`visitor.*`).
    DependsOnReader,
    Invalid,
}

pub fn condition_state(expression: &str, variables: &Variables) -> ConditionState {
    match evaluate(expression, variables) {
        Err(_) => ConditionState::Invalid,
        Ok(evaluation) if evaluation.depends_on_reader => ConditionState::DependsOnReader,
        Ok(evaluation) if evaluation.value.truthy() => ConditionState::Satisfied,
        Ok(_) => ConditionState::NotSatisfied,
    }
}

/// The files and variables the blocks of a note read.
pub trait BlockLibrary {
    fn read_text(&mut self, logical_path: &str) -> Option<String>;
    fn exists(&mut self, logical_path: &str) -> bool;
    /// The path the explorer shows, which the editor opens.
    fn visible_path(&self, logical_path: &str) -> String;
}

/// What the editor asks about the blocks it draws.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockResolveRequest {
    #[serde(default)]
    pub expressions: Vec<String>,
    #[serde(default)]
    pub conditions: Vec<String>,
    /// Page links, files and images.
    #[serde(default)]
    pub references: Vec<String>,
    /// Reusable content.
    #[serde(default)]
    pub includes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpressionResult {
    pub expression: String,
    /// `None` when the value is undefined or the expression is invalid.
    pub value: Option<String>,
    pub depends_on_reader: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionResult {
    pub expression: String,
    pub state: ConditionState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceKind {
    External,
    Library,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceResult {
    pub reference: String,
    pub kind: ReferenceKind,
    /// Web address, or the library file as the explorer shows it.
    pub target: Option<String>,
    pub exists: bool,
    /// Title of a Markdown note.
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncludeResult {
    pub reference: String,
    pub target: Option<String>,
    pub title: Option<String>,
    /// Body of the reusable content, without its properties.
    pub markdown: Option<String>,
    pub truncated: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockResolveResponse {
    pub expressions: Vec<ExpressionResult>,
    pub conditions: Vec<ConditionResult>,
    pub references: Vec<ReferenceResult>,
    pub includes: Vec<IncludeResult>,
}

fn distinct(items: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    items
        .iter()
        .filter(|item| seen.insert(item.as_str()))
        .take(MAX_RESOLVE_ITEMS)
        .cloned()
        .collect()
}

fn is_markdown(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".md")
}

/// Resolves what the editor asks for the note at `current`, whose unsaved
/// `source` provides the page variables.
pub fn resolve_blocks(
    request: &BlockResolveRequest,
    source: &str,
    current: &str,
    library: &mut dyn BlockLibrary,
) -> BlockResolveResponse {
    let needs_variables = !request.expressions.is_empty() || !request.conditions.is_empty();
    let space_yaml = if needs_variables { library.read_text(SPACE_VARIABLES_PATH) } else { None };
    let variables = Variables::read(source, space_yaml.as_deref());
    let expressions = distinct(&request.expressions)
        .into_iter()
        .map(|expression| match evaluate(&expression, &variables) {
            Ok(evaluation) => ExpressionResult {
                value: (evaluation.value != Value::Undefined).then(|| evaluation.value.display()),
                depends_on_reader: evaluation.depends_on_reader,
                error: None,
                expression,
            },
            Err(error) => ExpressionResult {
                expression,
                value: None,
                depends_on_reader: false,
                error: Some(error.message().to_string()),
            },
        })
        .collect();
    let conditions = distinct(&request.conditions)
        .into_iter()
        .map(|expression| ConditionResult { state: condition_state(&expression, &variables), expression })
        .collect();
    let references = distinct(&request.references)
        .into_iter()
        .map(|reference| match resolve_reference(&reference, current) {
            Reference::External(url) => {
                ReferenceResult { reference, kind: ReferenceKind::External, target: Some(url), exists: true, title: None }
            }
            Reference::Library(path) => {
                let text = is_markdown(&path).then(|| library.read_text(&path)).flatten();
                let exists = text.is_some() || library.exists(&path);
                ReferenceResult {
                    reference,
                    kind: ReferenceKind::Library,
                    target: Some(library.visible_path(&path)),
                    exists,
                    title: text.map(|text| document_title(&text, &path)),
                }
            }
            Reference::Invalid => {
                ReferenceResult { reference, kind: ReferenceKind::Invalid, target: None, exists: false, title: None }
            }
        })
        .collect();
    let includes = distinct(&request.includes)
        .into_iter()
        .map(|reference| resolve_include(reference, current, library))
        .collect();
    BlockResolveResponse { expressions, conditions, references, includes }
}

fn resolve_include(reference: String, current: &str, library: &mut dyn BlockLibrary) -> IncludeResult {
    let failed = |reference: String, target: Option<String>, error: &str| IncludeResult {
        reference,
        target,
        title: None,
        markdown: None,
        truncated: false,
        error: Some(error.to_string()),
    };
    let Reference::Library(path) = resolve_reference(&reference, current) else {
        return failed(reference, None, "La ruta del contenido reutilizable no es válida.");
    };
    let target = Some(library.visible_path(&path));
    if !is_markdown(&path) {
        return failed(reference, target, "El contenido reutilizable debe ser una nota Markdown.");
    }
    let Some(text) = library.read_text(&path) else {
        return failed(reference, target, "No se encontró el contenido reutilizable.");
    };
    let body = strip_frontmatter(&text).trim();
    let truncated = body.chars().count() > MAX_INCLUDE_PREVIEW_CHARS;
    let markdown = body.chars().take(MAX_INCLUDE_PREVIEW_CHARS).collect();
    IncludeResult {
        reference,
        target,
        title: Some(document_title(&text, &path)),
        markdown: Some(markdown),
        truncated,
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Library(BTreeMap<String, String>);

    impl BlockLibrary for Library {
        fn read_text(&mut self, logical_path: &str) -> Option<String> {
            self.0.get(logical_path).cloned()
        }
        fn exists(&mut self, logical_path: &str) -> bool {
            self.0.contains_key(logical_path) || logical_path.ends_with(".png")
        }
        fn visible_path(&self, logical_path: &str) -> String {
            format!("C:/lib/{logical_path}")
        }
    }

    fn library() -> Library {
        Library(BTreeMap::from([
            (SPACE_VARIABLES_PATH.to_string(), "# Section\nlatest_version: v3.0.4\ncompany: 'Acme'\n  nested: no\n".to_string()),
            ("guias/README.md".to_string(), "# Guías\n\nIntro".to_string()),
            ("guias/inicio.md".to_string(), "---\ntitle: Primeros pasos\n---\n\n# Otro".to_string()),
            (".gitbook/includes/aviso.md".to_string(), "---\ncreatedAt: 1\n---\n\n{% hint %}\nNo tocar\n{% endhint %}\n".to_string()),
        ]))
    }

    #[test]
    fn reads_page_and_space_variables() {
        let source = "---\ntitle: x\nvars:\n  page_food: orange\n  version: \"v2.1.0\" \n  bad-name: x\nlayout:\n  width: wide\n---\n\n# Nota";
        let variables = Variables::read(source, Some("food: apple # fruta\nlatest_version: v3.0.4\n  nested: x\n"));
        assert_eq!(variables.page, BTreeMap::from([("page_food".into(), "orange".into()), ("version".into(), "v2.1.0".into())]));
        assert_eq!(variables.space, BTreeMap::from([("food".into(), "apple".into()), ("latest_version".into(), "v3.0.4".into())]));
        assert!(page_variables("sin propiedades").is_empty());
        assert!(page_variables("---\n---\n").is_empty());
    }

    #[test]
    fn resolves_references_relative_to_the_note() {
        let current = "docs/guias/pagina.md";
        assert_eq!(resolve_reference("otra.md", current), Reference::Library("docs/guias/otra.md".into()));
        assert_eq!(resolve_reference("./", current), Reference::Library("docs/guias/README.md".into()));
        assert_eq!(resolve_reference("../../.gitbook/includes/a.md", current), Reference::Library(".gitbook/includes/a.md".into()));
        assert_eq!(resolve_reference("/raiz.md#titulo", current), Reference::Library("raiz.md".into()));
        assert_eq!(resolve_reference("img/Mi%20foto.png", current), Reference::Library("docs/guias/img/Mi foto.png".into()));
        assert_eq!(resolve_reference("https://x.org/a", current), Reference::External("https://x.org/a".into()));
        assert_eq!(resolve_reference("../../../fuera.md", current), Reference::Invalid);
        assert_eq!(resolve_reference("C:\\Windows\\x.md", current), Reference::Invalid);
        assert_eq!(resolve_reference("javascript:alert(1)", current), Reference::Invalid);
        assert_eq!(resolve_reference("a%2", current), Reference::Invalid);
        assert_eq!(resolve_reference("", current), Reference::Invalid);
    }

    #[test]
    fn titles_come_from_the_property_the_heading_or_the_name() {
        assert_eq!(document_title("---\ntitle: \"Hola\"\n---\n# Otro", "a.md"), "Hola");
        assert_eq!(document_title("Texto\n\n# Título", "a.md"), "Título");
        assert_eq!(document_title("Texto", "notas/idea.md"), "idea");
    }

    #[test]
    fn evaluates_conditions() {
        let variables = Variables::read("---\nvars:\n  plan: pro\n---\n", None);
        assert_eq!(condition_state("page.vars.plan === 'pro'", &variables), ConditionState::Satisfied);
        assert_eq!(condition_state("page.vars.missing", &variables), ConditionState::NotSatisfied);
        assert_eq!(condition_state("visitor.claims.unsigned.a", &variables), ConditionState::DependsOnReader);
        assert_eq!(condition_state("(", &variables), ConditionState::Invalid);
    }

    #[test]
    fn resolves_what_the_editor_asks() {
        let request = BlockResolveRequest {
            expressions: vec!["space.vars.latest_version".into(), "page.vars.none".into(), "1 +".into(), "space.vars.latest_version".into()],
            conditions: vec!["space.vars.company == 'Acme'".into()],
            references: vec!["./".into(), "inicio.md".into(), "foto.png".into(), "falta.md".into(), "https://x.org".into(), "../../x.md".into()],
            includes: vec!["../.gitbook/includes/aviso.md".into(), "falta.md".into(), "foto.png".into()],
        };
        let response = resolve_blocks(&request, "# Nota", "guias/pagina.md", &mut library());
        assert_eq!(response.expressions.len(), 3);
        assert_eq!(response.expressions[0].value.as_deref(), Some("v3.0.4"));
        assert_eq!(response.expressions[1].value, None);
        assert!(response.expressions[2].error.is_some());
        assert_eq!(response.conditions[0].state, ConditionState::Satisfied);
        let references = &response.references;
        assert_eq!(references[0].title.as_deref(), Some("Guías"));
        assert_eq!(references[0].target.as_deref(), Some("C:/lib/guias/README.md"));
        assert_eq!(references[1].title.as_deref(), Some("Primeros pasos"));
        assert!(references[2].exists && references[2].title.is_none());
        assert!(!references[3].exists);
        assert_eq!(references[4].kind, ReferenceKind::External);
        assert_eq!(references[5].kind, ReferenceKind::Invalid);
        let includes = &response.includes;
        assert_eq!(includes[0].markdown.as_deref(), Some("{% hint %}\nNo tocar\n{% endhint %}"));
        assert_eq!(includes[0].title.as_deref(), Some("aviso"));
        assert!(includes[1].error.is_some());
        assert!(includes[2].error.is_some());
    }
}
