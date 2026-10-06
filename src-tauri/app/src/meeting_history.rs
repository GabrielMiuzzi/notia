//! «Reuniones anteriores»: the meetings saved as notes of a library. Saving
//! the note also writes the whole meeting to `.notia/meetings/<id>.json`
//! (see `meeting::write_note_here`); the history lists those whose note is
//! still in the library, newest first, and opens one again as the current,
//! finished meeting. A client of Host mode reads them from the host, where
//! the library is.

use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, TimeZone};
use notia_backend_core::meeting::{archive_path, MeetingArchive, MEETING_ARCHIVE_FOLDER};
use notia_backend_core::meeting_ai::MeetingAiContext;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::backend::{BackendError, BackendErrorCode};
use crate::host::AppHandle;

const MAX_QUERY_CHARS: usize = 200;
const MONTHS: [&str; 12] = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SHORT_MONTHS: [&str; 12] = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKDAYS: [&str; 7] = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingHistoryPayload {
    library_id: String,
    #[serde(default)]
    query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingSavedPayload {
    library_id: String,
    meeting_id: String,
}

/// The context a saved meeting's AI consulted, as the history shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingHistoryContextDto {
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingHistoryItemDto {
    id: String,
    title: String,
    /// `HOY`, `AYER`, `ESTA SEMANA` or the month, on the first meeting of
    /// each group.
    #[serde(skip_serializing_if = "Option::is_none")]
    group: Option<String>,
    /// `10:15` today and yesterday, `Lun` this week, else `28 sep`.
    time_label: String,
    duration_ms: u64,
    speaker_count: usize,
    pending_tasks: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    context: Option<MeetingHistoryContextDto>,
}

/// The saved meetings of the library whose note is still there, newest
/// first, that mention `query`.
pub(crate) async fn meeting_history(app: AppHandle, payload: MeetingHistoryPayload) -> Result<Vec<MeetingHistoryItemDto>, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        if crate::meeting::uses_host(&app) {
            return crate::host_client::call_host_blocking(&app, "meeting_history", json!({ "payload": payload }));
        }
        let query = payload.query.trim().chars().take(MAX_QUERY_CHARS).collect::<String>().to_lowercase();
        let mut archives = saved_archives(&app, &payload.library_id)?;
        archives.retain(|archive| archive.record.mentions(&query));
        archives.sort_by_key(|archive| std::cmp::Reverse(archive.record.start.unix_ms));
        let catalog = crate::library_graph::context_tags(&app, &payload.library_id);
        Ok(history_items(&archives, &catalog, Local::now().naive_local()))
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudieron leer las reuniones anteriores.", true))?
}

/// Opens the saved meeting `meetingId` as the current one.
pub(crate) async fn meeting_open_saved(app: AppHandle, payload: MeetingSavedPayload) -> Result<(), BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let archive = if crate::meeting::uses_host(&app) {
            crate::host_client::call_host_blocking::<MeetingArchive>(&app, "meeting_saved_archive", json!({ "payload": payload }))?
        } else {
            read_archive(&app, &payload.library_id, &payload.meeting_id)?
        };
        crate::meeting::open_saved(&app, archive)
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo abrir la reunión.", true))?
}

/// The archive of a saved meeting of this device's library, for a client.
pub(crate) async fn meeting_saved_archive(app: AppHandle, payload: MeetingSavedPayload) -> Result<MeetingArchive, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || read_archive(&app, &payload.library_id, &payload.meeting_id))
        .await
        .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo abrir la reunión.", true))?
}

fn read_archive(app: &AppHandle, library_id: &str, meeting_id: &str) -> Result<MeetingArchive, BackendError> {
    let path = archive_path(meeting_id)?;
    let text = crate::library_documents::with_documents(app, library_id, |documents| documents.read(&path))?
        .ok_or_else(|| BackendError::new(BackendErrorCode::NotFound, "La reunión ya no está guardada.", false))?;
    let archive = MeetingArchive::parse(&text)?;
    if archive.record.id != meeting_id {
        return Err(BackendError::invalid_input("La reunión guardada no se puede leer."));
    }
    Ok(archive)
}

/// The archives of the library whose note still exists; an unreadable one
/// is skipped.
fn saved_archives(app: &AppHandle, library_id: &str) -> Result<Vec<MeetingArchive>, BackendError> {
    let paths = crate::library_documents::inventory_paths(app, library_id, MEETING_ARCHIVE_FOLDER)?;
    crate::library_documents::with_documents(app, library_id, |documents| {
        let mut archives = Vec::new();
        for path in paths.iter().filter(|path| path.ends_with(".json")) {
            let Some(archive) = documents.read(path)?.and_then(|text| MeetingArchive::parse(&text).ok()) else {
                log::warn!("[notia:meeting] a saved meeting could not be read");
                continue;
            };
            let Some(note) = archive.record.saved_note.as_ref() else { continue };
            if documents.adapter.exists_locator(&documents.locator(&note.logical_path)?)? {
                archives.push(archive);
            }
        }
        Ok(archives)
    })
}

/// The rows of the history: `archives` newest first, with their group,
/// time and context labels as of `now` (local time).
fn history_items(archives: &[MeetingArchive], catalog: &[(String, String)], now: NaiveDateTime) -> Vec<MeetingHistoryItemDto> {
    let mut previous_group = None;
    archives
        .iter()
        .map(|archive| {
            let record = &archive.record;
            let at = Local
                .timestamp_millis_opt(record.start.unix_ms as i64)
                .single()
                .map_or(now, |moment| moment.naive_local());
            let (group, time_label) = moment_labels(now, at);
            let first_of_group = previous_group.as_ref() != Some(&group);
            previous_group = Some(group.clone());
            MeetingHistoryItemDto {
                id: record.id.clone(),
                title: record.title(),
                group: first_of_group.then_some(group),
                time_label,
                duration_ms: record.duration_ms,
                speaker_count: record.speaker_count(),
                pending_tasks: record.pending_task_count(),
                context: archive.ai_context.as_ref().and_then(|context| context_label(context, catalog)),
            }
        })
        .collect()
}

/// The group and the time of a meeting that started `at`, seen `now`.
fn moment_labels(now: NaiveDateTime, at: NaiveDateTime) -> (String, String) {
    let today = now.date();
    let day = at.date();
    let week_start = today - chrono::Duration::days(i64::from(today.weekday().num_days_from_monday()));
    let clock = at.format("%H:%M").to_string();
    if day == today {
        return ("HOY".to_string(), clock);
    }
    if Some(day) == today.pred_opt() {
        return ("AYER".to_string(), clock);
    }
    if day >= week_start && day < today {
        return ("ESTA SEMANA".to_string(), WEEKDAYS[day.weekday().num_days_from_monday() as usize].to_string());
    }
    let month = month_index(day);
    let same_year = day.year() == today.year();
    let group = if same_year { MONTHS[month].to_uppercase() } else { format!("{} {}", MONTHS[month].to_uppercase(), day.year()) };
    let time = if same_year {
        format!("{} {}", day.day(), SHORT_MONTHS[month])
    } else {
        format!("{} {} {}", day.day(), SHORT_MONTHS[month], day.year())
    };
    (group, time)
}

fn month_index(day: NaiveDate) -> usize {
    day.month0() as usize
}

/// A folder by its name; a single context by its tag and color. The whole
/// library, or several contexts, show none.
fn context_label(context: &MeetingAiContext, catalog: &[(String, String)]) -> Option<MeetingHistoryContextDto> {
    if let Some(folder) = context.folder.as_deref().filter(|folder| !folder.is_empty()) {
        let label = folder.rsplit('/').next().unwrap_or(folder).to_string();
        return Some(MeetingHistoryContextDto { label, color: None });
    }
    let [tag] = context.contexts.as_deref()? else { return None };
    let color = catalog.iter().find(|(known, _)| known.eq_ignore_ascii_case(tag)).map(|(_, color)| color.clone());
    let label = tag.trim_start_matches('#').to_string();
    (!label.is_empty()).then_some(MeetingHistoryContextDto { label, color })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(date: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(date, "%Y-%m-%d %H:%M").expect("date")
    }

    #[test]
    fn meetings_group_by_today_yesterday_this_week_and_month() {
        // Wednesday, 7 October 2026.
        let now = at("2026-10-07 18:00");
        let labels = |date: &str| moment_labels(now, at(date));
        assert_eq!(labels("2026-10-07 10:15"), ("HOY".into(), "10:15".into()));
        assert_eq!(labels("2026-10-06 16:00"), ("AYER".into(), "16:00".into()));
        assert_eq!(labels("2026-10-05 09:30"), ("ESTA SEMANA".into(), "Lun".into()));
        assert_eq!(labels("2026-10-04 09:30"), ("OCTUBRE".into(), "4 oct".into()));
        assert_eq!(labels("2026-09-28 11:00"), ("SEPTIEMBRE".into(), "28 sep".into()));
        assert_eq!(labels("2025-12-01 11:00"), ("DICIEMBRE 2025".into(), "1 dic 2025".into()));
    }

    #[test]
    fn a_context_shows_a_folder_or_one_tag_with_its_color() {
        let catalog = vec![("#Laboral".to_string(), "#6C8EFF".to_string())];
        let context = |folder: Option<&str>, contexts: Option<Vec<&str>>| MeetingAiContext {
            library_id: "l1".into(),
            folder: folder.map(Into::into),
            contexts: contexts.map(|tags| tags.into_iter().map(Into::into).collect()),
        };
        assert_eq!(
            context_label(&context(None, Some(vec!["#Laboral"])), &catalog),
            Some(MeetingHistoryContextDto { label: "Laboral".into(), color: Some("#6C8EFF".into()) })
        );
        assert_eq!(
            context_label(&context(Some("Facultad/Cursos"), None), &catalog),
            Some(MeetingHistoryContextDto { label: "Cursos".into(), color: None })
        );
        assert_eq!(context_label(&context(None, None), &catalog), None);
        assert_eq!(context_label(&context(None, Some(vec!["#Laboral", "#Personal"])), &catalog), None);
    }
}
