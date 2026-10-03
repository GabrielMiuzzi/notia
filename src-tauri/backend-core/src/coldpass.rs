//! ColdPass vault content: the decrypted Markdown table of credentials, its
//! metadata block, edits with password history, the health of each password
//! and CSV import. Encryption and storage live in the platform adapter.

use serde::{Deserialize, Serialize};

use crate::error::BackendError;

const METADATA_START: &str = "<!-- NOTIA_COLDPASS_METADATA";
const METADATA_END: &str = "NOTIA_COLDPASS_METADATA -->";
const HEADER: &str = "| name | website | username | secondary_username | password | notes |\n| --- | --- | --- | --- | --- | --- |";
const CSV_COLUMNS: [&str; 6] = ["name", "website", "username", "secondary_username", "password", "notes"];
pub const MAX_COLDPASS_ENTRIES: usize = 10_000;
/// Start of every ColdPass header: the sealed vaults (Owner and legacy) and
/// the metadata of an opened one.
const VAULT_MARKER: &str = "<!-- NOTIA_COLDPASS_";
const MAX_FIELD_CHARS: usize = 10_000;
const MAX_PASSWORD_HISTORY: usize = 50;
/// A password shorter than this is weak whatever it contains.
const MIN_STRONG_PASSWORD_CHARS: usize = 10;
/// Bits of a brute-force search below which a password is weak.
const MIN_STRONG_PASSWORD_BITS: f64 = 50.0;
/// Fewer distinct characters than this make a password weak («aaaaaaaaaa1»).
const MIN_DISTINCT_PASSWORD_CHARS: usize = 5;
/// Words of the name, site or user shorter than this are not searched in it.
const MIN_PERSONAL_WORD_CHARS: usize = 4;
/// A password unchanged for longer than a year should be rotated.
const ROTATE_AFTER_MS: i64 = 365 * 24 * 60 * 60 * 1000;
/// Notes the form accepts; longer notes from an import are kept while they
/// are not edited.
pub const MAX_NOTES_CHARS: usize = 500;
/// Longest password the form's strength meter rates, as any other field.
pub const MAX_RATED_PASSWORD_CHARS: usize = MAX_FIELD_CHARS;

/// A replaced password and when it was replaced. Vaults written before the
/// dates were kept store plain strings, read here without a date.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "StoredPasswordRecord")]
pub struct ColdPassPasswordRecord {
    pub password: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaced_at: Option<i64>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum StoredPasswordRecord {
    Undated(String),
    #[serde(rename_all = "camelCase")]
    Dated {
        password: String,
        #[serde(default)]
        replaced_at: Option<i64>,
    },
}

impl From<StoredPasswordRecord> for ColdPassPasswordRecord {
    fn from(stored: StoredPasswordRecord) -> Self {
        match stored {
            StoredPasswordRecord::Undated(password) => Self { password, replaced_at: None },
            StoredPasswordRecord::Dated { password, replaced_at } => Self { password, replaced_at },
        }
    }
}

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
    /// Newest first.
    #[serde(default)]
    pub password_history: Vec<ColdPassPasswordRecord>,
    /// When the current password was set (Unix ms); unknown for credentials
    /// saved before the dates were kept or imported from a CSV.
    #[serde(default)]
    pub password_changed_at: Option<i64>,
}

/// How safe the current password looks: `Weak` (short, guessable or made of
/// the credential's own name, site or user) wins over `Old` (unchanged for
/// more than a year).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ColdPassHealth {
    Strong,
    Weak,
    Old,
}

/// A credential as the vault view shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColdPassEntryView {
    #[serde(flatten)]
    pub entry: ColdPassEntryDto,
    pub health: ColdPassHealth,
}

pub fn coldpass_entry_views(entries: &[ColdPassEntryDto], now_ms: i64) -> Vec<ColdPassEntryView> {
    entries
        .iter()
        .map(|entry| ColdPassEntryView { entry: entry.clone(), health: password_health(entry, now_ms) })
        .collect()
}

pub fn password_health(entry: &ColdPassEntryDto, now_ms: i64) -> ColdPassHealth {
    if is_weak_password(&entry.password, &[&entry.name, &entry.website, &entry.username]) {
        ColdPassHealth::Weak
    } else if entry.password_changed_at.is_some_and(|changed| now_ms.saturating_sub(changed) > ROTATE_AFTER_MS) {
        ColdPassHealth::Old
    } else {
        ColdPassHealth::Strong
    }
}

fn is_weak_password(password: &str, personal: &[&str]) -> bool {
    let characters = password.chars().collect::<Vec<_>>();
    if characters.len() < MIN_STRONG_PASSWORD_CHARS {
        return true;
    }
    let mut distinct = characters.clone();
    distinct.sort_unstable();
    distinct.dedup();
    if distinct.len() < MIN_DISTINCT_PASSWORD_CHARS {
        return true;
    }
    let pool = [
        (characters.iter().any(char::is_ascii_lowercase), 26),
        (characters.iter().any(char::is_ascii_uppercase), 26),
        (characters.iter().any(char::is_ascii_digit), 10),
        (characters.iter().any(|character| !character.is_ascii_alphanumeric()), 33),
    ]
    .into_iter()
    .filter_map(|(present, size)| present.then_some(size))
    .sum::<u32>();
    if characters.len() as f64 * f64::from(pool).log2() < MIN_STRONG_PASSWORD_BITS {
        return true;
    }
    let lower = password.to_lowercase();
    personal
        .iter()
        .flat_map(|value| value.split(|character: char| !character.is_alphanumeric()))
        .map(str::to_lowercase)
        .any(|word| word.chars().count() >= MIN_PERSONAL_WORD_CHARS && lower.contains(&word))
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
    password_history: Vec<ColdPassPasswordRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    password_changed_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct Metadata {
    #[serde(default)]
    entries: Vec<MetadataEntry>,
}

/// Whether `content` is a sealed ColdPass vault rather than a note.
pub fn is_coldpass_vault(content: &str) -> bool {
    content.trim_start().starts_with(VAULT_MARKER)
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
                password_changed_at: stored.and_then(|entry| entry.password_changed_at),
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
                password_changed_at: entry.password_changed_at,
            })
            .collect(),
    };
    let metadata = serde_json::to_string_pretty(&metadata)
        .map_err(|_| BackendError::invalid_input("No se pudo serializar el vault."))?;
    Ok(format!("{HEADER}\n{}\n\n{METADATA_START}\n{metadata}\n{METADATA_END}", rows.join("\n")))
}

/// Adds a credential or replaces the one with `editing_id`. The history and
/// the change date come from the vault, never from the form: editing keeps
/// the id and, when the password changes, moves the old one to the front of
/// the history dated `now_ms`.
pub fn upsert_coldpass_entry(
    entries: &mut Vec<ColdPassEntryDto>,
    mut entry: ColdPassEntryDto,
    editing_id: Option<&str>,
    new_id: &mut dyn FnMut() -> String,
    now_ms: i64,
) -> Result<(), BackendError> {
    entry.validate()?;
    // The form saves only named credentials; imported rows may lack a name.
    if entry.name.trim().is_empty() {
        return Err(BackendError::invalid_input("La credencial necesita un nombre."));
    }
    if entry.password.is_empty() {
        return Err(BackendError::invalid_input("La credencial necesita una contraseña."));
    }
    let long_notes = entry.notes.chars().count() > MAX_NOTES_CHARS;
    match editing_id {
        Some(editing_id) => {
            let current = entries
                .iter_mut()
                .find(|candidate| candidate.id == editing_id)
                .ok_or_else(|| BackendError::invalid_input("La credencial ya no existe."))?;
            if long_notes && current.notes != entry.notes {
                return Err(notes_too_long());
            }
            let mut history = current.password_history.clone();
            let changed = current.password != entry.password;
            if changed && !current.password.is_empty() {
                history.insert(0, ColdPassPasswordRecord { password: current.password.clone(), replaced_at: Some(now_ms) });
            }
            history.truncate(MAX_PASSWORD_HISTORY);
            entry.id = current.id.clone();
            entry.password_history = history;
            entry.password_changed_at = if changed {
                (!entry.password.is_empty()).then_some(now_ms)
            } else {
                current.password_changed_at
            };
            *current = entry;
        }
        None => {
            if long_notes {
                return Err(notes_too_long());
            }
            if entries.len() >= MAX_COLDPASS_ENTRIES {
                return Err(BackendError::invalid_input("El vault alcanzó el máximo de credenciales."));
            }
            entry.id = new_id();
            entry.password_history = Vec::new();
            entry.password_changed_at = (!entry.password.is_empty()).then_some(now_ms);
            entries.push(entry);
        }
    }
    Ok(())
}

fn notes_too_long() -> BackendError {
    BackendError::invalid_input(format!("Las notas admiten hasta {MAX_NOTES_CHARS} caracteres."))
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
            password_changed_at: None,
        };
        if entry.fields().iter().all(|value| value.trim().is_empty()) {
            skipped += 1;
            continue;
        }
        entries.push(ColdPassEntryDto { id: new_id(), ..entry });
    }
    Ok(ColdPassCsvImport { entries, skipped_row_count: skipped })
}

/// Options of the password generator. Lowercase letters always go in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordOptions {
    pub length: u32,
    #[serde(default = "include_by_default")]
    pub include_uppercase: bool,
    pub include_numbers: bool,
    pub include_special_characters: bool,
    /// Leaves out characters that are easy to confuse (0 O l 1 I).
    #[serde(default)]
    pub avoid_ambiguous: bool,
}

fn include_by_default() -> bool {
    true
}

const PASSWORD_LOWER: &str = "abcdefghijklmnopqrstuvwxyz";
const PASSWORD_UPPER: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PASSWORD_NUMBERS: &str = "0123456789";
const PASSWORD_SPECIAL: &str = "!@#$%^&*()-_=+[]{};:,.<>/?";
const AMBIGUOUS_CHARACTERS: &str = "0Ol1I";
/// Guesses per second of the attacker the estimate assumes.
const GUESSES_PER_SECOND: f64 = 10_000_000_000.0;

/// Between 8 and 64 characters.
pub fn password_length(options: &PasswordOptions) -> usize {
    options.length.clamp(8, 64) as usize
}

/// The character classes the options ask for, each without the ambiguous
/// characters when they are avoided.
fn password_pools(options: &PasswordOptions) -> Vec<Vec<char>> {
    [
        (true, PASSWORD_LOWER),
        (options.include_uppercase, PASSWORD_UPPER),
        (options.include_numbers, PASSWORD_NUMBERS),
        (options.include_special_characters, PASSWORD_SPECIAL),
    ]
    .into_iter()
    .filter(|(included, _)| *included)
    .map(|(_, characters)| {
        characters
            .chars()
            .filter(|character| !options.avoid_ambiguous || !AMBIGUOUS_CHARACTERS.contains(*character))
            .collect()
    })
    .collect()
}

pub fn password_charset(options: &PasswordOptions) -> Vec<char> {
    password_pools(options).concat()
}

/// A password of the chosen length with at least one character of each
/// chosen class; `index(n)` returns a uniform random index below `n`.
pub fn generate_password(options: &PasswordOptions, index: &mut dyn FnMut(usize) -> usize) -> String {
    let pools = password_pools(options);
    let charset = pools.concat();
    let mut password = pools.iter().map(|pool| pool[index(pool.len())]).collect::<Vec<_>>();
    while password.len() < password_length(options) {
        password.push(charset[index(charset.len())]);
    }
    for position in (1..password.len()).rev() {
        password.swap(position, index(position + 1));
    }
    password.into_iter().collect()
}

/// How strong a password reads in the form: `level` 0 (empty) to 4.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordRating {
    pub level: u8,
    pub label: String,
    pub hint: String,
}

/// Rates a password by its estimated entropy. One that the vault would mark
/// weak (short, repetitive or made of the name, site or user in `personal`)
/// never rates above «Débil».
pub fn rate_password(password: &str, personal: &[&str]) -> PasswordRating {
    let length = password.chars().count();
    if length == 0 {
        return PasswordRating { level: 0, label: "Vacía".into(), hint: "Escribí o generá una contraseña".into() };
    }
    let bits = password_entropy_bits(password);
    let level = match bits {
        bits if bits < 45.0 => 1,
        bits if bits < 64.0 => 2,
        bits if bits < 90.0 => 3,
        _ => 4,
    };
    let level = if is_weak_password(password, personal) { 1 } else { level };
    let label = ["", "Débil", "Regular", "Fuerte", "Muy fuerte"][usize::from(level)];
    PasswordRating { level, label: label.into(), hint: crack_time_hint(bits).into() }
}

fn password_entropy_bits(password: &str) -> f64 {
    let pool = [
        (password.chars().any(|character| character.is_ascii_lowercase()), 26),
        (password.chars().any(|character| character.is_ascii_uppercase()), 26),
        (password.chars().any(|character| character.is_ascii_digit()), 10),
        (password.chars().any(|character| !character.is_ascii_alphanumeric()), 15),
    ]
    .into_iter()
    .filter_map(|(present, size)| present.then_some(size))
    .sum::<u32>()
    .max(1);
    let length = password.chars().count();
    let bits = length as f64 * f64::from(pool).log2();
    // A word followed by digits («martin2024») falls to a dictionary first.
    let letters_then_digits = password.trim_end_matches(|character: char| character.is_ascii_digit());
    if length < 12 && !letters_then_digits.is_empty() && letters_then_digits.chars().all(|character| character.is_ascii_alphabetic()) {
        bits.min(34.0)
    } else {
        bits
    }
}

fn crack_time_hint(bits: f64) -> &'static str {
    let seconds = 2f64.powf(bits) / 2.0 / GUESSES_PER_SECOND;
    if seconds < 1.0 {
        "se adivina al instante"
    } else if seconds < 3_600.0 {
        "se adivina en minutos"
    } else if seconds < 86_400.0 * 30.0 {
        "se adivina en días"
    } else if seconds < 31_536_000.0 * 100.0 {
        "resiste años de fuerza bruta"
    } else {
        "resiste siglos de fuerza bruta"
    }
}

/// Seconds a brute-force attack would need to try every password.
pub fn brute_force_seconds(options: &PasswordOptions) -> f64 {
    (password_charset(options).len() as f64).powi(password_length(options) as i32) / GUESSES_PER_SECOND
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
            password_changed_at: None,
        }
    }

    const DAY_MS: i64 = 24 * 60 * 60 * 1000;

    #[test]
    fn round_trips_the_vault_markdown_with_escapes_and_metadata() {
        let mut new_id = ids();
        let mut entries = Vec::new();
        upsert_coldpass_entry(&mut entries, entry("Banco", "uno"), None, &mut new_id, 1_000).expect("add");
        let id = entries[0].id.clone();
        upsert_coldpass_entry(&mut entries, entry("Banco", "dos"), Some(&id), &mut new_id, 2_000).expect("edit");
        let markdown = stringify_coldpass_markdown(&entries).expect("stringify");
        let parsed = parse_coldpass_markdown(&markdown, &mut ids());
        assert_eq!(parsed, entries);
    }

    #[test]
    fn editing_moves_a_changed_password_to_the_history_with_its_date() {
        let mut new_id = ids();
        let mut entries = Vec::new();
        let mut forged = entry("Banco", "uno");
        forged.password_history = vec![ColdPassPasswordRecord { password: "inventada".into(), replaced_at: None }];
        forged.password_changed_at = Some(5);
        upsert_coldpass_entry(&mut entries, forged, None, &mut new_id, 1_000).expect("add");
        assert!(entries[0].password_history.is_empty(), "a new credential starts without history");
        assert_eq!(entries[0].password_changed_at, Some(1_000));
        let id = entries[0].id.clone();
        upsert_coldpass_entry(&mut entries, entry("Banco", "uno"), Some(&id), &mut new_id, 1_500).expect("same password");
        assert_eq!(entries[0].password_changed_at, Some(1_000), "an edit that keeps the password keeps its date");
        upsert_coldpass_entry(&mut entries, entry("Banco", "dos"), Some(&id), &mut new_id, 2_000).expect("edit");
        assert_eq!(entries[0].id, id);
        assert_eq!(entries[0].password_history, vec![ColdPassPasswordRecord { password: "uno".into(), replaced_at: Some(2_000) }]);
        assert_eq!(entries[0].password_changed_at, Some(2_000));
        assert!(upsert_coldpass_entry(&mut entries, entry("", ""), None, &mut new_id, 3_000).is_err());
    }

    #[test]
    fn a_vault_from_before_the_dates_reads_its_history_without_them() {
        let markdown = format!(
            "{HEADER}\n| Banco | b.com | ana |  | dos |  |\n\n{METADATA_START}\n{{\"entries\":[{{\"id\":\"a\",\"passwordHistory\":[\"uno\"]}}]}}\n{METADATA_END}"
        );
        let parsed = parse_coldpass_markdown(&markdown, &mut ids());
        assert_eq!(parsed[0].password_history, vec![ColdPassPasswordRecord { password: "uno".into(), replaced_at: None }]);
        assert_eq!(parsed[0].password_changed_at, None);
    }

    #[test]
    fn health_flags_weak_passwords_before_old_ones() {
        let now = 800 * DAY_MS;
        let with = |name: &str, password: &str, changed_days_ago: Option<i64>| ColdPassEntryDto {
            name: name.into(),
            website: "mercadopago.com.ar".into(),
            username: "gabmiuzzi".into(),
            password_changed_at: changed_days_ago.map(|days| now - days * DAY_MS),
            ..entry(name, password)
        };
        assert_eq!(password_health(&with("GitHub", "r9$Lk2@pWz7!eN", Some(30)), now), ColdPassHealth::Strong);
        assert_eq!(password_health(&with("AWS", "Nube!2025deploy", Some(420)), now), ColdPassHealth::Old);
        assert_eq!(password_health(&with("Router", "Fibra#Casa22", None), now), ColdPassHealth::Strong, "no date is never old");
        // Weak wins over old.
        assert_eq!(password_health(&with("Mercado Pago", "mercado123", Some(1_000)), now), ColdPassHealth::Weak);
        assert_eq!(password_health(&with("Banco", "Ab1!Ab1!", Some(1)), now), ColdPassHealth::Weak, "short");
        assert_eq!(password_health(&with("Banco", "aaaaaaaaaaaa1", Some(1)), now), ColdPassHealth::Weak, "repeated");
        assert_eq!(password_health(&with("Banco", "zxcvbnmqwe", Some(1)), now), ColdPassHealth::Weak, "ten lowercase letters");
        assert_eq!(password_health(&with("Banco", "Gabmiuzzi#2026x", Some(1)), now), ColdPassHealth::Weak, "the user name");
        assert_eq!(password_health(&with("Banco", "", None), now), ColdPassHealth::Weak);
        let views = coldpass_entry_views(&[with("AWS", "Nube!2025deploy", Some(420))], now);
        let json = serde_json::to_value(&views[0]).expect("json");
        assert_eq!(json["health"], "old");
        assert_eq!(json["name"], "AWS");
        assert_eq!(json["passwordChangedAt"], now - 420 * DAY_MS);
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

    #[test]
    fn passwords_follow_the_options_and_their_strength_is_estimated() {
        let options = PasswordOptions {
            length: 3,
            include_uppercase: true,
            include_numbers: true,
            include_special_characters: false,
            avoid_ambiguous: false,
        };
        let mut next = 0;
        let password = generate_password(&options, &mut |size| { next = (next + 61) % size; next });
        assert_eq!(password.chars().count(), 8);
        assert!(password.chars().all(|character| character.is_ascii_alphanumeric()));
        assert_eq!(password_charset(&options).len(), 62);
        let strong = PasswordOptions { length: 64, include_special_characters: true, ..options };
        assert!(brute_force_seconds(&strong) > brute_force_seconds(&options));
    }

    #[test]
    fn generated_passwords_hold_every_chosen_class_and_can_skip_ambiguous_characters() {
        let options = PasswordOptions {
            length: 8,
            include_uppercase: true,
            include_numbers: true,
            include_special_characters: true,
            avoid_ambiguous: true,
        };
        // An index that always picks the first character still has to cover each class.
        let password = generate_password(&options, &mut |_| 0);
        assert!(password.chars().any(|character| character.is_ascii_lowercase()));
        assert!(password.chars().any(|character| character.is_ascii_uppercase()));
        assert!(password.chars().any(|character| character.is_ascii_digit()));
        assert!(password.chars().any(|character| !character.is_ascii_alphanumeric()));
        assert!(password_charset(&options).iter().all(|character| !"0Ol1I".contains(*character)));
        let lower_only = PasswordOptions { include_uppercase: false, include_numbers: false, include_special_characters: false, ..options };
        assert!(generate_password(&lower_only, &mut |size| size - 1).chars().all(|character| character.is_ascii_lowercase()));
        let legacy: PasswordOptions =
            serde_json::from_str(r#"{"length":16,"includeNumbers":true,"includeSpecialCharacters":false}"#).expect("options");
        assert!(legacy.include_uppercase && !legacy.avoid_ambiguous);
    }

    #[test]
    fn rating_follows_entropy_and_never_praises_a_weak_password() {
        assert_eq!(rate_password("", &[]).level, 0);
        assert_eq!(rate_password("", &[]).label, "Vacía");
        assert_eq!(rate_password("martin2024", &[]).label, "Débil");
        assert_eq!(rate_password("martin2024", &[]).hint, "se adivina al instante");
        assert_eq!(rate_password("Tq8!mZ2rVx#4", &[]).label, "Fuerte");
        assert_eq!(rate_password("Tq8!mZ2rVx#4kP9@wL3s", &[]).label, "Muy fuerte");
        assert_eq!(rate_password("Tq8!mZ2rVx#4kP9@wL3s", &[]).hint, "resiste siglos de fuerza bruta");
        assert_eq!(rate_password("Mercado#Pago2026xyz", &["Mercado Pago"]).label, "Débil");
    }

    #[test]
    fn saving_needs_a_password_and_notes_within_the_limit_unless_kept() {
        let mut new_id = ids();
        let mut entries = Vec::new();
        assert!(upsert_coldpass_entry(&mut entries, entry("Banco", ""), None, &mut new_id, 1_000).is_err());
        let mut long = entry("Banco", "uno");
        long.notes = "x".repeat(MAX_NOTES_CHARS + 1);
        assert!(upsert_coldpass_entry(&mut entries, long.clone(), None, &mut new_id, 1_000).is_err());
        // Notes that came longer from an import stay while they are not edited.
        entries.push(ColdPassEntryDto { id: "importada".into(), ..long.clone() });
        let kept = ColdPassEntryDto { notes: long.notes.clone(), ..entry("Banco", "dos") };
        upsert_coldpass_entry(&mut entries, kept, Some("importada"), &mut new_id, 2_000).expect("kept notes");
        let edited = ColdPassEntryDto { notes: format!("{}y", long.notes), ..entry("Banco", "dos") };
        assert!(upsert_coldpass_entry(&mut entries, edited, Some("importada"), &mut new_id, 3_000).is_err());
    }
}
