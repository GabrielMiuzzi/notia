//! Pomodoro log stored as a Markdown table (`pomodoro.md` in the Task
//! Manager workspace). Pure text transformations; the adapter supplies the
//! local date and time of each entry and performs the guarded write.

use serde::{Deserialize, Serialize};

use crate::error::BackendError;

const HEADER: &str = "# Registro Pomodoro\n\n| fecha | horario | tipo de pomodoro | duracion elegida | tarea | tiempo | desvio | finalizacion |\n| --- | --- | --- | --- | --- | --- | --- | --- |";
const MAX_TEXT_CHARS: usize = 300;
/// Entries kept readable; older rows stay in the file but are not returned.
pub const MAX_POMODORO_ENTRIES: usize = 5_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroEntryInput {
    #[serde(rename = "type")]
    pub kind: String,
    pub duration_choice: String,
    pub task: String,
    pub duration_minutes: f64,
    pub deviation_hours: f64,
    pub finalized: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroEntryDto {
    /// Line index inside the log; stable until the file changes.
    pub id: String,
    pub date: String,
    pub time: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub duration_choice: String,
    pub task: String,
    pub duration_minutes: f64,
    pub deviation_hours: f64,
    pub finalized: bool,
}

impl PomodoroEntryInput {
    pub fn validate(&self) -> Result<(), BackendError> {
        let finite = |value: f64| value.is_finite() && (-10_000.0..=10_000.0).contains(&value);
        if !finite(self.duration_minutes) || !finite(self.deviation_hours) {
            return Err(BackendError::invalid_input("La duración del pomodoro no es válida."));
        }
        for value in [&self.kind, &self.duration_choice, &self.task] {
            if value.chars().count() > MAX_TEXT_CHARS {
                return Err(BackendError::invalid_input("El texto del pomodoro es demasiado largo."));
            }
        }
        Ok(())
    }
}

fn sanitize(value: &str) -> String {
    let cleaned = value
        .replace('|', "/")
        .replace(['\r', '\n'], " ")
        .trim()
        .to_string();
    if cleaned.is_empty() {
        "-".to_string()
    } else {
        cleaned
    }
}

fn two_decimals(value: f64) -> String {
    format!("{:.2}", (value * 100.0).round() / 100.0)
}

/// Appends one row; `date_text` is `YYYY-MM-DD` and `time_text` `HH:MM` in
/// the device's local time.
pub fn append_pomodoro_entry(
    content: &str,
    date_text: &str,
    time_text: &str,
    input: &PomodoroEntryInput,
) -> Result<String, BackendError> {
    input.validate()?;
    let row = format!(
        "| {} | {} | {} | {} | {} | {} | {} | {} |",
        sanitize(date_text),
        sanitize(time_text),
        sanitize(&input.kind),
        sanitize(&input.duration_choice),
        sanitize(&input.task),
        two_decimals(input.duration_minutes),
        two_decimals(input.deviation_hours),
        if input.finalized { "true" } else { "false" },
    );
    let base = if content.trim().is_empty() {
        format!("{HEADER}\n")
    } else {
        content.to_string()
    };
    let separator = if base.ends_with('\n') { "" } else { "\n" };
    Ok(format!("{base}{separator}{row}\n"))
}

fn is_header_row(line: &str) -> bool {
    line.contains("fecha | horario | tipo de pomodoro") || line.contains("| --- |")
}

pub fn read_pomodoro_entries(content: &str) -> Vec<PomodoroEntryDto> {
    let mut entries = Vec::new();
    for (index, line) in content.lines().enumerate() {
        if entries.len() >= MAX_POMODORO_ENTRIES {
            break;
        }
        if !line.trim_start().starts_with('|') || is_header_row(line) {
            continue;
        }
        let columns = line
            .split('|')
            .map(str::trim)
            .filter(|column| !column.is_empty())
            .collect::<Vec<_>>();
        if columns.len() < 5 {
            continue;
        }
        let has_duration = columns.len() >= 7;
        let number = |value: &str| value.parse::<f64>().ok().filter(|v| v.is_finite()).unwrap_or(0.0);
        entries.push(PomodoroEntryDto {
            id: index.to_string(),
            date: columns[0].to_string(),
            time: columns[1].to_string(),
            kind: columns[2].to_string(),
            duration_choice: if has_duration { columns[3].to_string() } else { "-".to_string() },
            task: if has_duration { columns[4] } else { columns[3] }.to_string(),
            duration_minutes: if has_duration { number(columns[5]) } else { 0.0 },
            deviation_hours: number(if has_duration { columns[6] } else { columns[4] }),
            finalized: columns
                .get(7)
                .map(|value| !value.eq_ignore_ascii_case("false"))
                .unwrap_or(true),
        });
    }
    entries
}

/// Removes the row with `entry_id`; `None` when it is not a log row.
pub fn delete_pomodoro_entry(content: &str, entry_id: &str) -> Option<String> {
    let index = entry_id.parse::<usize>().ok()?;
    let lines = content.lines().collect::<Vec<_>>();
    let line = lines.get(index)?;
    if !line.trim_start().starts_with('|') || is_header_row(line) {
        return None;
    }
    let remaining = lines
        .iter()
        .enumerate()
        .filter(|(position, _)| *position != index)
        .map(|(_, line)| *line)
        .collect::<Vec<_>>();
    Some(format!("{}\n", remaining.join("\n").trim_end()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> PomodoroEntryInput {
        PomodoroEntryInput {
            kind: "work".into(),
            duration_choice: "25".into(),
            task: "Tarea | A".into(),
            duration_minutes: 25.0,
            deviation_hours: 0.125,
            finalized: true,
        }
    }

    #[test]
    fn appends_reads_and_deletes_rows_with_the_legacy_format() {
        let content = append_pomodoro_entry("", "2026-09-22", "10:05", &input()).expect("append");
        assert!(content.starts_with("# Registro Pomodoro\n"));
        assert!(content.ends_with("| 2026-09-22 | 10:05 | work | 25 | Tarea / A | 25.00 | 0.13 | true |\n"));
        let entries = read_pomodoro_entries(&content);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].task, "Tarea / A");
        assert!(delete_pomodoro_entry(&content, "0").is_none());
        let deleted = delete_pomodoro_entry(&content, &entries[0].id).expect("delete");
        assert!(read_pomodoro_entries(&deleted).is_empty());
    }

    #[test]
    fn reads_legacy_rows_without_duration_columns() {
        let entries = read_pomodoro_entries("| 2026-01-01 | 09:00 | work | tarea | 0.5 |\n");
        assert_eq!(entries[0].duration_choice, "-");
        assert_eq!(entries[0].deviation_hours, 0.5);
        assert!(entries[0].finalized);
    }

    #[test]
    fn rejects_non_finite_durations() {
        let mut bad = input();
        bad.duration_minutes = f64::NAN;
        assert!(append_pomodoro_entry("", "d", "t", &bad).is_err());
    }
}
