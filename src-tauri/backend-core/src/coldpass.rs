//! ColdPass vault content: the decrypted Markdown table of credentials, its
//! metadata block, edits with password history and CSV import. Encryption and
//! storage live in the platform adapter.

use serde::{Deserialize, Serialize};

use crate::error::BackendError;

const METADATA_START: &str = "<!-- NOTIA_COLDPASS_METADATA";
const METADATA_END: &str = "NOTIA_COLDPASS_METADATA -->";
const HEADER: &str = "| name | website | username | secondary_username | password | notes |\n| --- | --- | --- | --- | --- | --- |";
const CSV_COLUMNS: [&str; 6] = ["name", "website", "username", "secondary_username", "password", "notes"];
pub const MAX_COLDPASS_ENTRIES: usize = 10_000;
const MAX_FIELD_CHARS: usize = 10_000;
const MAX_PASSWORD_HISTORY: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColdPassEntryDto {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub website: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub secondary_username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub password_history: Vec<String>,
}

impl ColdPassEntryDto {
    fn fields(&self) -> [&str; 6] {
        [
            &self.name,
            &self.website,
            &self.username,
            &self.secondary_username,
            &self.password,
            &self.notes,
        ]
    }

    pub fn validate(&self) -> Result<(), BackendError> {
        if self.fields().iter().any(|value| value.chars().count() > MAX_FIELD_CHARS) {
            return Err(BackendError::invalid_input("Un campo de la credencial es demasiado largo."));
        }
        if self.fields().iter().all(|value| value.trim().is_empty()) {
            return Err(BackendError::invalid_input("La credencial está vacía."));
        }
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MetadataEntry {
    id: String,
    #[serde(default)]
    password_history: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct Metadata {
    #[serde(default)]
    entries: Vec<MetadataEntry>,
}

pub fn empty_coldpass_markdown() -> String {
    HEADER.to_string()
}

fn escape_cell(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', "<br>")
}

fn unescape_cell(value: &str) -> String {
    value.replace("<br>", "\n").replace("\\|", "|").trim().to_string()
}

fn split_row(row: &str) -> Vec<String> {
    let mut cells = Vec::new();
    let mut current = String::new();
    let mut escaped = false;
    for character in row.trim().chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        match character {
            '\\' => {
                current.push(character);
                escaped = true;
            }
            '|' => {
                cells.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(character),
        }
    }
    cells.push(current.trim().to_string());
    if cells.first().is_some_and(String::is_empty) {
        cells.remove(0);
    }
    if cells.last().is_some_and(String::is_empty) {
        cells.pop();
    }
    cells
}

fn metadata(markdown: &str) -> Metadata {
    let (Some(start), Some(end)) = (markdown.find(METADATA_START), markdown.find(METADATA_END)) else {
        return Metadata::default();
    };
    if end <= start {
        return Metadata::default();
    }
    serde_json::from_str(markdown[start + METADATA_START.len()..end].trim()).unwrap_or_default()
}

/// Entries of a decrypted vault. Rows without a stored id get one from
/// `new_id`, as the previous client did.
pub fn parse_coldpass_markdown(markdown: &str, new_id: &mut dyn FnMut() -> String) -> Vec<ColdPassEntryDto> {
    let metadata = metadata(markdown);
    let lines = markdown
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let Some(header) = lines
        .iter()
        .position(|line| line.starts_with('|') && line.contains("secondary_username"))
    else {
        return Vec::new();
    };
    lines
        .iter()
        .skip(header + 2)
        .filter(|line| line.starts_with('|'))
        .take(MAX_COLDPASS_ENTRIES)
        .enumerate()
        .map(|(index, line)| {
            let cells = split_row(line);
            let cell = |position: usize| cells.get(position).map(|value| unescape_cell(value)).unwrap_or_default();
            let stored = metadata.entries.get(index);
            ColdPassEntryDto {
                id: stored
                    .map(|entry| entry.id.trim().to_string())
                    .filter(|id| !id.is_empty())
                    .unwrap_or_else(&mut *new_id),
                name: cell(0),
                website: cell(1),
                username: cell(2),
                secondary_username: cell(3),
                password: cell(4),
                notes: cell(5),
                password_history: stored.map(|entry| entry.password_history.clone()).unwrap_or_default(),
            }
        })
        .collect()
}

pub fn stringify_coldpass_markdown(entries: &[ColdPassEntryDto]) -> Result<String, BackendError> {
    if entries.is_empty() {
        return Ok(empty_coldpass_markdown());
    }
    let rows = entries
        .iter()
        .map(|entry| {
            format!(
                "| {} |",
                entry.fields().iter().map(|value| escape_cell(value)).collect::<Vec<_>>().join(" | ")
            )
        })
        .collect::<Vec<_>>();
    let metadata = Metadata {
        entries: entries
            .iter()
            .map(|entry| MetadataEntry {
                id: entry.id.clone(),
                password_history: entry.password_history.clone(),
            })
            .collect(),
    };
    let metadata = serde_json::to_string_pretty(&metadata)
        .map_err(|_| BackendError::invalid_input("No se pudo serializar el vault."))?;
    Ok(format!("{HEADER}\n{}\n\n{METADATA_START}\n{metadata}\n{METADATA_END}", rows.join("\n")))
}

/// Adds a credential or replaces the one with `editing_id`. Editing keeps the
/// id and moves a changed password to the front of the history.
pub fn upsert_coldpass_entry(
    entries: &mut Vec<ColdPassEntryDto>,
    mut entry: ColdPassEntryDto,
    editing_id: Option<&str>,
    new_id: &mut dyn FnMut() -> String,
) -> Result<(), BackendError> {
    entry.validate()?;
    match editing_id {
        Some(editing_id) => {
            let current = entries
                .iter_mut()
                .find(|candidate| candidate.id == editing_id)
                .ok_or_else(|| BackendError::invalid_input("La credencial ya no existe."))?;
            let mut history = current.password_history.clone();
            if !current.password.is_empty() && current.password != entry.password {
                history.insert(0, current.password.clone());
            }
            history.truncate(MAX_PASSWORD_HISTORY);
            entry.id = current.id.clone();
            entry.password_history = history;
            *current = entry;
        }
        None => {
            if entries.len() >= MAX_COLDPASS_ENTRIES {
                return Err(BackendError::invalid_input("El vault alcanzó el máximo de credenciales."));
            }
            entry.id = new_id();
            entry.password_history.truncate(MAX_PASSWORD_HISTORY);
            entries.push(entry);
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColdPassCsvImport {
    pub entries: Vec<ColdPassEntryDto>,
    pub skipped_row_count: usize,
}

fn parse_csv_rows(content: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut characters = content.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '"' if quoted && characters.peek() == Some(&'"') => {
                cell.push('"');
                characters.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => row.push(std::mem::take(&mut cell)),
            '\r' | '\n' if !quoted => {
                if character == '\r' && characters.peek() == Some(&'\n') {
                    characters.next();
                }
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            _ => cell.push(character),
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    rows
}

/// Parses a CSV with the ColdPass columns (any order, case-insensitive).
pub fn parse_coldpass_csv(content: &str, new_id: &mut dyn FnMut() -> String) -> Result<ColdPassCsvImport, BackendError> {
    let rows = parse_csv_rows(content)
        .into_iter()
        .filter(|row| row.iter().any(|cell| !cell.trim().is_empty()))
        .collect::<Vec<_>>();
    let Some((header, data)) = rows.split_first() else {
        return Ok(ColdPassCsvImport { entries: Vec::new(), skipped_row_count: 0 });
    };
    let header = header.iter().map(|value| value.trim().to_lowercase()).collect::<Vec<_>>();
    let mut indexes = [0usize; 6];
    for (slot, column) in CSV_COLUMNS.iter().enumerate() {
        indexes[slot] = header.iter().position(|value| value == column).ok_or_else(|| {
            BackendError::invalid_input(format!("El CSV no contiene la columna requerida \"{column}\"."))
        })?;
    }
    let mut entries = Vec::new();
    let mut skipped = 0usize;
    for row in data.iter().take(MAX_COLDPASS_ENTRIES) {
        let cell = |slot: usize| {
            row.get(indexes[slot])
                .map(|value| value.trim().chars().take(MAX_FIELD_CHARS).collect::<String>())
                .unwrap_or_default()
        };
        let entry = ColdPassEntryDto {
            id: String::new(),
            name: cell(0),
            website: cell(1),
            username: cell(2),
            secondary_username: cell(3),
            password: cell(4),
            notes: cell(5),
            password_history: Vec::new(),
        };
        if entry.fields().iter().all(|value| value.trim().is_empty()) {
            skipped += 1;
            continue;
        }
        entries.push(ColdPassEntryDto { id: new_id(), ..entry });
    }
    Ok(ColdPassCsvImport { entries, skipped_row_count: skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids() -> impl FnMut() -> String {
        let mut next = 0;
        move || {
            next += 1;
            format!("id-{next}")
        }
    }

    fn entry(name: &str, password: &str) -> ColdPassEntryDto {
        ColdPassEntryDto {
            id: String::new(),
            name: name.into(),
            website: "https://a|b".into(),
            username: "ana".into(),
            secondary_username: String::new(),
            password: password.into(),
            notes: "linea 1\nlinea 2".into(),
            password_history: Vec::new(),
        }
    }

    #[test]
    fn round_trips_the_vault_markdown_with_escapes_and_metadata() {
        let mut new_id = ids();
        let mut entries = Vec::new();
        upsert_coldpass_entry(&mut entries, entry("Banco", "uno"), None, &mut new_id).expect("add");
        let markdown = stringify_coldpass_markdown(&entries).expect("stringify");
        let parsed = parse_coldpass_markdown(&markdown, &mut ids());
        assert_eq!(parsed, entries);
    }

    #[test]
    fn editing_moves_a_changed_password_to_the_history() {
        let mut new_id = ids();
        let mut entries = Vec::new();
        upsert_coldpass_entry(&mut entries, entry("Banco", "uno"), None, &mut new_id).expect("add");
        let id = entries[0].id.clone();
        upsert_coldpass_entry(&mut entries, entry("Banco", "dos"), Some(&id), &mut new_id).expect("edit");
        assert_eq!(entries[0].id, id);
        assert_eq!(entries[0].password_history, vec!["uno".to_string()]);
        assert!(upsert_coldpass_entry(&mut entries, entry("", ""), None, &mut new_id).is_err());
    }

    #[test]
    fn imports_csv_with_quotes_and_skips_empty_rows() {
        let csv = "Password,Name,Website,Username,Secondary_Username,Notes\r\n\"a,\"\"b\",Mail,,ana,,\"x\ny\"\n,,,,,\n";
        let import = parse_coldpass_csv(csv, &mut ids()).expect("csv");
        assert_eq!(import.entries.len(), 1);
        assert_eq!(import.entries[0].password, "a,\"b");
        assert_eq!(import.entries[0].notes, "x\ny");
        assert!(parse_coldpass_csv("name,password\n", &mut ids()).is_err());
    }
}
