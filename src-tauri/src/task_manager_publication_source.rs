//! What the Task Manager publication serves, built by the backend from the
//! Task Manager store, the device preferences (published boards, port,
//! client limit) and the library configuration (AI settings). Publishing
//! from the interface and restoring the publication at start use the same
//! source, so neither depends on the WebView's copy of the boards.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::backend::{TaskPriority, TaskState};

const OWNER: &str = "user-owner";
const DEFAULT_ACTIVITY_HOURS: f64 = 8.0;
#[cfg(target_os = "windows")]
const AUTOSTART_DELAY: std::time::Duration = std::time::Duration::from_secs(8);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishPayload {
    library_id: String,
    #[serde(default)]
    theme: Option<String>,
}

fn label<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value).ok().and_then(|value| value.as_str().map(str::to_string)).unwrap_or_default()
}

fn ai_preferences(config: &Value) -> Value {
    let ia = config.get("ia").cloned().unwrap_or(Value::Null);
    let text = |key: &str| ia.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
    json!({
        "ollamaUrl": text("ollamaUrl"),
        "apiKey": text("apiKey"),
        "selectedModel": text("selectedModel"),
        "thinkingEnabled": ia.get("thinkingEnabled").and_then(Value::as_bool) != Some(false),
        "thinkingLevel": ia.get("thinkingLevel").and_then(Value::as_str).unwrap_or("medium"),
    })
}

/// Publication payload of the published boards of a library.
fn build_payload(app: &AppHandle, library_id: &str, theme: &str) -> Result<Value, String> {
    let library = crate::library_catalog::catalog_library(app, library_id)
        .ok_or_else(|| "No hay una biblioteca activa para publicar.".to_string())?;
    let preferences = crate::device_preferences::section(app, "taskManagerPublication");
    let published = preferences["publishedBoardNames"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_lowercase)
        .collect::<Vec<_>>();
    if published.is_empty() {
        return Err("Seleccioná al menos un tablero para publicar.".to_string());
    }
    let read = crate::task_manager_commands::task_manager_snapshot_for_publication(
        app,
        app.state::<crate::task_manager_commands::TaskManagerBackendState>().inner(),
        app.state::<crate::library_registry::LibraryBindingRegistry>().inner(),
        library_id,
        OWNER,
        Vec::new(),
    )
    .map_err(|error| error.message)?;
    let snapshot = read.snapshot;
    let is_published = |name: &str| published.contains(&name.trim().to_lowercase());
    let boards = snapshot.boards.iter().filter(|board| is_published(&board.name)).collect::<Vec<_>>();
    if boards.is_empty() {
        return Err("Los tableros elegidos para publicar no existen en esta biblioteca.".to_string());
    }
    let board_name = |board_id: &str| snapshot.boards.iter().find(|board| board.board_id == board_id).map(|board| board.name.clone());
    let group_name = |group_id: Option<&String>| {
        group_id
            .and_then(|id| snapshot.groups.iter().find(|group| &group.group_id == id))
            .map(|group| group.name.clone())
            .unwrap_or_default()
    };
    let ticket_title = |ticket_id: Option<&String>| {
        ticket_id
            .and_then(|id| snapshot.tickets.iter().find(|ticket| &ticket.summary.ticket_id == id))
            .map(|ticket| ticket.summary.title.clone())
            .unwrap_or_default()
    };
    let activity_hours = |board: &crate::backend::TaskBoardDto| {
        let hours = &snapshot.config.activity_hours_per_day;
        hours.get(&board.name).or_else(|| hours.get(&board.board_id)).copied().unwrap_or(DEFAULT_ACTIVITY_HOURS)
    };
    let settings_boards = boards
        .iter()
        .map(|board| json!({ "name": board.name, "color": board.color, "activityHoursPerDay": activity_hours(board), "contexto": board.context }))
        .collect::<Vec<_>>();
    let settings_groups = snapshot
        .groups
        .iter()
        .filter_map(|group| {
            let board = board_name(&group.board_id)?;
            is_published(&board).then(|| json!({ "name": group.name, "color": group.color, "board": board }))
        })
        .collect::<Vec<_>>();
    let published_boards = boards
        .iter()
        .map(|board| {
            let mut tasks = snapshot
                .tickets
                .iter()
                .filter(|ticket| ticket.summary.board_id == board.board_id)
                .filter(|ticket| !matches!(ticket.summary.state, TaskState::Completed | TaskState::Cancelled))
                .map(|ticket| {
                    json!({
                        "title": ticket.summary.title,
                        "detail": ticket.summary.detail_preview,
                        "state": label(&ticket.summary.state),
                        "startDate": ticket.start_date,
                        "endDate": ticket.end_date,
                        "group": group_name(ticket.summary.group_id.as_ref()),
                        "priority": label::<TaskPriority>(&ticket.summary.priority),
                        "dedicatedHours": ticket.dedicated_hours,
                        "estimatedHours": ticket.estimated_hours,
                        "deviationHours": ticket.deviation_hours,
                        "parentTaskName": ticket_title(ticket.summary.parent_ticket_id.as_ref()),
                        "order": ticket.order,
                    })
                })
                .collect::<Vec<_>>();
            tasks.sort_by(|left, right| left["order"].as_f64().partial_cmp(&right["order"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
            json!({
                "name": board.name,
                "color": board.color,
                "groups": snapshot.groups.iter().filter(|group| group.board_id == board.board_id).map(|group| json!({ "name": group.name, "color": group.color })).collect::<Vec<_>>(),
                "tasks": tasks,
            })
        })
        .collect::<Vec<_>>();
    let config = crate::library_config::read_library_config(app, library_id).ok().flatten().unwrap_or(Value::Null);
    Ok(json!({
        "libraryId": library_id,
        "vaultPath": library.path,
        "theme": if theme == "light" { "light" } else { "dark" },
        "maxClients": preferences["maxClients"],
        "port": preferences["port"],
        "aiPreferences": ai_preferences(&config),
        "settings": {
            "activeVaultPath": null,
            "boards": settings_boards,
            "groups": settings_groups,
            "pomodoro": {
                "phase": "work", "runState": "idle", "remainingSeconds": 0, "endTimestamp": null, "completedWorkCycles": 0,
                "selectedTaskPath": null, "isDeviationActive": false, "deviationStartedAt": null, "deviationBaseRemainingSeconds": 0,
                "phaseDeviationSeconds": 0, "durations": { "workMinutes": 25, "shortBreakMinutes": 5, "longBreakMinutes": 15 },
            },
            "activeTab": boards[0].name,
        },
        "boards": published_boards,
    }))
}

fn publish(app: &AppHandle, library_id: &str, theme: &str) -> Result<String, String> {
    let payload = serde_json::from_value::<crate::task_manager_publication::TaskManagerPublicationPayload>(
        build_payload(app, library_id, theme)?,
    )
    .map_err(|_| "No se pudo preparar la publicación de los tableros.".to_string())?;
    crate::task_manager_publication::publish_task_manager_boards(app.clone(), app.state(), app.state(), payload)
}

/// Publishes the boards chosen in the device preferences.
#[tauri::command]
pub(crate) async fn backend_publish_task_manager(app: AppHandle, payload: PublishPayload) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || publish(&app, &payload.library_id, payload.theme.as_deref().unwrap_or("dark")))
        .await
        .map_err(|_| "No se pudo publicar los tableros.".to_string())?
}

/// Plugin that restores the publication of the selected library at start
/// (Windows), whether or not the interface is visible.
pub(crate) fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("task-manager-publication-autostart")
        .setup(|app, _api| {
            #[cfg(target_os = "windows")]
            {
                let app = app.clone();
                let _ = std::thread::Builder::new().name("notia-publication-autostart".into()).spawn(move || {
                    std::thread::sleep(AUTOSTART_DELAY);
                    let Some(library_id) = crate::library_catalog::selected_library_id(&app) else {
                        return;
                    };
                    if let Err(error) = publish(&app, &library_id, "dark") {
                        log::info!("[notia] publication autostart skipped: {error}");
                    }
                });
            }
            #[cfg(not(target_os = "windows"))]
            let _ = app;
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    #[test]
    fn built_tasks_match_the_publication_contract() {
        let task = serde_json::json!({
            "title": "T", "detail": "", "state": "Pendiente", "startDate": "", "endDate": "", "group": "",
            "priority": "Alta", "dedicatedHours": 0.0, "estimatedHours": 0.0, "deviationHours": 0.0,
            "parentTaskName": "", "order": 1.0,
        });
        assert!(serde_json::from_value::<crate::task_manager_publication::PublishedTask>(task).is_ok());
    }
}
