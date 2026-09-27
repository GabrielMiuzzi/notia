//! Home: a dashboard of the library built from the other modules. It shows
//! the Agenda's next seven days and its notepad, the Task Manager's columns
//! and most urgent tickets, the month of Finanzas, today's habits of Rutina,
//! and the chats, notes and meeting to go back to. Rust reads and sums up
//! every source; a card whose source fails carries the reason and the other
//! cards still show. React renders the DTO and sends each change to the
//! module that owns it (Agenda, Rutina, Pomodoro).

use chrono::{Datelike, Local, NaiveDate, TimeZone, Timelike};
use notia_backend_core::chat_list::ChatClock;
use notia_backend_core::{TaskBoardViewDto, TaskPriority, TaskState};
use serde::{Deserialize, Serialize};

use crate::agenda::{AgendaContext, AgendaPriority, HomeAgendaData};
use crate::agenda_view::{month_name, time_label, weekday_index, WEEKDAY_LONG, WEEKDAY_SHORT};
use crate::backend::{BackendError, BackendErrorCode};
use crate::host::AppHandle;
use crate::library_catalog::CatalogLibrary;

const OWNER: &str = "user-owner";
const AGENDA_DAYS: u32 = 7;
const URGENT_TASKS: usize = 5;
const RECENT_ITEMS: usize = 5;
/// Folder shortcuts under the recent items.
const FOLDER_SHORTCUTS: usize = 8;
/// Folders at the root that belong to Notia rather than to the notes.
const SYSTEM_FOLDERS: [&str; 3] = ["chat", "task-manager", "task-mannager"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeDashboardPayload {
    library_id: String,
}

/// A card's data, or why its source could not be read.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeCard<T> {
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl<T> HomeCard<T> {
    fn from(result: Result<T, String>) -> Self {
        match result {
            Ok(data) => Self { data: Some(data), error: None },
            Err(error) => Self { data: None, error: Some(error) },
        }
    }

    fn data(&self) -> Option<&T> {
        self.data.as_ref()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeDashboardDto {
    /// «Sábado 26 de septiembre · gaia».
    date_label: String,
    greeting: &'static str,
    /// «3 eventos en los próximos 7 días · 4 hábitos pendientes hoy · …».
    summary: String,
    agenda: HomeCard<HomeAgenda>,
    tasks: HomeCard<HomeTasks>,
    finance: HomeCard<HomeFinance>,
    routine: HomeCard<HomeRoutine>,
    notes: HomeCard<HomeNotes>,
    recent: HomeRecent,
}

// --- Agenda -----------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeAgendaDay {
    date: String,
    weekday: &'static str,
    day: u32,
    /// «sábado 26».
    label: String,
    is_today: bool,
    has_events: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeAgendaEvent {
    id: String,
    date: String,
    /// «Lun 28», or «Vie 2 oct» in another month.
    day_label: String,
    time: String,
    /// «09:00 – 09:45».
    range: String,
    title: String,
    priority: AgendaPriority,
    priority_label: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeAgenda {
    days: Vec<HomeAgendaDay>,
    events: Vec<HomeAgendaEvent>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeNote {
    id: String,
    text: String,
    done: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeNotes {
    items: Vec<HomeNote>,
    pending: usize,
}

fn month_short(date: NaiveDate) -> String {
    month_name(date).chars().take(3).collect()
}

/// «sábado 26».
fn day_label(date: NaiveDate) -> String {
    format!("{} {}", WEEKDAY_LONG[weekday_index(date)], date.day())
}

fn agenda_summary(data: &HomeAgendaData) -> HomeAgenda {
    let days = (0..i64::from(AGENDA_DAYS))
        .map(|offset| data.today + chrono::Duration::days(offset))
        .map(|date| HomeAgendaDay {
            date: crate::agenda_view::date_key(date),
            weekday: WEEKDAY_SHORT[weekday_index(date)],
            day: date.day(),
            label: day_label(date),
            is_today: date == data.today,
            has_events: data.events.iter().any(|event| event.date == date),
        })
        .collect();
    let events = data
        .events
        .iter()
        .map(|event| {
            let short = format!("{} {}", WEEKDAY_SHORT[weekday_index(event.date)], event.date.day());
            HomeAgendaEvent {
                id: event.id.clone(),
                date: crate::agenda_view::date_key(event.date),
                day_label: if event.date.month() == data.today.month() { short } else { format!("{short} {}", month_short(event.date)) },
                time: time_label(event.start_minute),
                range: format!("{} – {}", time_label(event.start_minute), time_label(event.end_minute)),
                title: event.title.clone(),
                priority: event.priority,
                priority_label: event.priority.label(),
            }
        })
        .collect();
    HomeAgenda { days, events }
}

fn notes_summary(data: &HomeAgendaData) -> HomeNotes {
    HomeNotes {
        pending: data.notes.iter().filter(|note| !note.done).count(),
        items: data
            .notes
            .iter()
            .map(|note| HomeNote { id: note.id.clone(), text: note.text.clone(), done: note.done })
            .collect(),
    }
}

// --- Tasks ------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum HomeTaskChip {
    Urgent,
    High,
    Medium,
    Low,
    Blocked,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeTask {
    /// Logical path: the ticket's identity for the Pomodoro.
    file_path: String,
    /// Path the explorer shows, to open the ticket.
    path: String,
    title: String,
    /// «Sprint actual · Pendiente».
    meta: String,
    chip: HomeTaskChip,
    chip_label: &'static str,
}

/// Ticket the Pomodoro of Home works on: the one the timer has selected, or
/// the most urgent open ticket until one is chosen.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeFocus {
    file_path: String,
    title: String,
    /// The timer already has it selected.
    selected: bool,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeTasks {
    completed: usize,
    sprint: usize,
    review: usize,
    blocked: usize,
    /// Open tickets with urgent priority.
    urgent_count: usize,
    /// Open tickets, most urgent first.
    urgent: Vec<HomeTask>,
    focus: Option<HomeFocus>,
}

/// Group name without case or accents, to recognize the usual columns.
fn folded(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .map(|character| match character {
            'á' => 'a',
            'é' => 'e',
            'í' => 'i',
            'ó' => 'o',
            'ú' | 'ü' => 'u',
            other => other,
        })
        .collect()
}

/// Blocked by its state or by the column it sits in.
fn is_blocked(task: &notia_backend_core::task_manager_ui::TaskItemViewDto) -> bool {
    task.state == TaskState::Blocked || folded(&task.group).starts_with("bloquead")
}

fn priority_rank(priority: TaskPriority) -> u8 {
    match priority {
        TaskPriority::Urgent => 0,
        TaskPriority::High => 1,
        TaskPriority::Medium => 2,
        TaskPriority::Low => 3,
    }
}

fn state_label(state: TaskState) -> &'static str {
    match state {
        TaskState::Pending => "Pendiente",
        TaskState::InProgress => "En progreso",
        TaskState::Completed => "Finalizada",
        TaskState::Cancelled => "Cancelada",
        TaskState::Blocked => "Bloqueada",
    }
}

fn tasks_summary(view: &TaskBoardViewDto, pomodoro_task: Option<&str>) -> HomeTasks {
    let open = view
        .tasks
        .iter()
        .filter(|task| matches!(task.state, TaskState::Pending | TaskState::InProgress | TaskState::Blocked))
        .collect::<Vec<_>>();
    let in_group = |name: &str| open.iter().filter(|task| folded(&task.group) == name).count();
    let mut ranked = open.clone();
    ranked.sort_by(|left, right| {
        priority_rank(left.priority)
            .cmp(&priority_rank(right.priority))
            .then_with(|| (left.end_date.is_empty(), &left.end_date).cmp(&(right.end_date.is_empty(), &right.end_date)))
            .then_with(|| left.title.cmp(&right.title))
    });
    let selected = pomodoro_task.and_then(|path| view.tasks.iter().find(|task| task.file_path == path));
    let focus = match selected {
        Some(task) => Some(HomeFocus { file_path: task.file_path.clone(), title: task.title.clone(), selected: true }),
        None => ranked.first().map(|task| HomeFocus { file_path: task.file_path.clone(), title: task.title.clone(), selected: false }),
    };
    HomeTasks {
        completed: view.tasks.iter().filter(|task| task.state == TaskState::Completed).count(),
        sprint: in_group("sprint actual"),
        review: in_group("en revision"),
        blocked: open.iter().filter(|task| is_blocked(task)).count(),
        urgent_count: open.iter().filter(|task| task.priority == TaskPriority::Urgent).count(),
        urgent: ranked
            .into_iter()
            .take(URGENT_TASKS)
            .map(|task| {
                let (chip, chip_label) = if is_blocked(task) {
                    (HomeTaskChip::Blocked, "Bloqueada")
                } else {
                    match task.priority {
                        TaskPriority::Urgent => (HomeTaskChip::Urgent, "Urgente"),
                        TaskPriority::High => (HomeTaskChip::High, "Alta"),
                        TaskPriority::Medium => (HomeTaskChip::Medium, "Media"),
                        TaskPriority::Low => (HomeTaskChip::Low, "Baja"),
                    }
                };
                let place = if task.group.trim().is_empty() { task.board.trim() } else { task.group.trim() };
                HomeTask {
                    file_path: task.file_path.clone(),
                    path: task.path.clone(),
                    title: task.title.clone(),
                    meta: if place.is_empty() { state_label(task.state).to_string() } else { format!("{place} · {}", state_label(task.state)) },
                    chip,
                    chip_label,
                }
            })
            .collect(),
        focus,
    }
}

// --- Finance ----------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeFinance {
    /// `YYYY-MM`.
    month: String,
    /// «septiembre».
    month_label: &'static str,
    #[serde(flatten)]
    summary: crate::finance_screen::FinanceHomeSummary,
}

// --- Routine ----------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeRoutineDay {
    /// L, M, X, J, V, S, D.
    letter: &'static str,
    /// «Lunes 21: 5 de 6».
    label: String,
    done: u32,
    total: u32,
    pct: Option<u8>,
    is_today: bool,
    is_future: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeHabit {
    id: String,
    name: String,
    category: String,
    done: bool,
    streak: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeRoutineGroup {
    id: String,
    name: String,
    done: usize,
    total: usize,
    habits: Vec<HomeHabit>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeRoutine {
    /// `YYYY-MM-DD`, the day a habit is checked for.
    today: String,
    month_label: &'static str,
    month_pct: Option<u8>,
    week_pct: Option<u8>,
    best_streak: u32,
    pending_today: u32,
    week: Vec<HomeRoutineDay>,
    routines: Vec<HomeRoutineGroup>,
}

fn day_letter(day_name: &str) -> &'static str {
    match folded(day_name).as_str() {
        "lunes" => "L",
        "martes" => "M",
        "miercoles" => "X",
        "jueves" => "J",
        "viernes" => "V",
        "sabado" => "S",
        _ => "D",
    }
}

fn routine_summary(dashboard: &crate::routine_dashboard::RoutineDashboard, today: NaiveDate) -> HomeRoutine {
    let today_key = crate::agenda_view::date_key(today);
    let week = dashboard
        .current_week
        .all
        .days
        .iter()
        .map(|day| {
            let day_of_month = NaiveDate::parse_from_str(&day.date, "%Y-%m-%d").map_or(0, |date| date.day());
            HomeRoutineDay {
                letter: day_letter(day.day_name),
                label: format!("{} {}: {} de {}", day.day_name, day_of_month, day.done, day.total),
                done: day.done,
                total: day.total,
                pct: day.pct,
                is_today: day.is_today,
                is_future: day.date > today_key,
            }
        })
        .collect();
    let routines = dashboard
        .routines
        .iter()
        .map(|routine| {
            let today_tasks = dashboard
                .current_week
                .routines
                .iter()
                .find(|week| week.routine_id.as_deref() == Some(routine.id.as_str()))
                .and_then(|week| week.days.iter().find(|day| day.is_today))
                .map(|day| day.tasks.as_slice())
                .unwrap_or_default();
            let habits = today_tasks
                .iter()
                .map(|task| {
                    let details = dashboard.tasks.iter().find(|candidate| candidate.id == task.task_id);
                    HomeHabit {
                        id: task.task_id.clone(),
                        name: task.name.clone(),
                        category: details.map(|details| details.category.clone()).unwrap_or_default(),
                        done: task.completed,
                        streak: details.map_or(0, |details| details.streak),
                    }
                })
                .collect::<Vec<_>>();
            HomeRoutineGroup {
                id: routine.id.clone(),
                name: routine.name.clone(),
                done: habits.iter().filter(|habit| habit.done).count(),
                total: habits.len(),
                habits,
            }
        })
        .collect();
    HomeRoutine {
        today: today_key,
        month_label: month_name(today),
        month_pct: dashboard.nav.month_pct,
        week_pct: dashboard.nav.week_pct,
        best_streak: dashboard.nav.best_streak,
        pending_today: dashboard.nav.today_total.saturating_sub(dashboard.nav.today_done),
        week,
        routines,
    }
}

// --- Recent -----------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum HomeRecentKind {
    Chat,
    Note,
    Meeting,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeRecentItem {
    kind: HomeRecentKind,
    title: String,
    meta: String,
    /// «Hoy», «Ayer», «Esta semana» or «12 sep».
    when: String,
    /// Path the explorer shows (chats and notes).
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    /// Prompt file the chat talks with, to open it with that agent.
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_file: Option<String>,
    #[serde(skip)]
    at_local_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeFolder {
    name: String,
    path: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeRecent {
    items: Vec<HomeRecentItem>,
    folders: Vec<HomeFolder>,
}

/// When something happened, from its local time: «Hoy», «Ayer», «Esta
/// semana» or «12 sep».
fn when_label(today: NaiveDate, at_local_ms: i64) -> String {
    let Some(date) = chrono::DateTime::from_timestamp_millis(at_local_ms).map(|moment| moment.date_naive()) else {
        return String::new();
    };
    match (today - date).num_days() {
        days if days <= 0 => "Hoy".to_string(),
        1 => "Ayer".to_string(),
        days if days < 7 => "Esta semana".to_string(),
        _ => format!("{} {}", date.day(), month_short(date)),
    }
}

/// «Chat · agente Task Manager», or «Chat · Agente IA de Notia» when the
/// name already says it.
fn chat_meta(agent: &str) -> String {
    if folded(agent).starts_with("agente") {
        format!("Chat · {agent}")
    } else {
        format!("Chat · agente {agent}")
    }
}

fn is_system_folder(name: &str) -> bool {
    name.starts_with('.') || SYSTEM_FOLDERS.contains(&name.to_lowercase().as_str())
}

fn meeting_meta(snapshot: &notia_backend_core::meeting::MeetingSnapshotDto) -> String {
    use notia_backend_core::meeting::MeetingStatus;
    let speakers = match snapshot.speakers.len() {
        0 => String::new(),
        1 => " · 1 hablante".to_string(),
        count => format!(" · {count} hablantes"),
    };
    let state = match snapshot.status {
        MeetingStatus::Live => "grabando",
        MeetingStatus::Processing => "procesando",
        MeetingStatus::Completed if snapshot.saved_note_path.is_some() => "guardada como nota",
        MeetingStatus::Completed if snapshot.insights.summary.is_none() && snapshot.insights.key_points.is_empty() => "lista para pasar por IA",
        MeetingStatus::Completed => "terminada",
    };
    format!("Meeting{speakers} · {state}")
}

// --- Header -----------------------------------------------------------------

fn greeting(hour: u32) -> &'static str {
    match hour {
        5..=11 => "Buen día",
        12..=19 => "Buenas tardes",
        _ => "Buenas noches",
    }
}

fn date_label(today: NaiveDate, library_name: &str) -> String {
    let weekday = WEEKDAY_LONG[weekday_index(today)];
    let mut letters = weekday.chars();
    let capitalized = letters.next().map(|first| first.to_uppercase().collect::<String>() + letters.as_str()).unwrap_or_default();
    format!("{capitalized} {} de {} · {library_name}", today.day(), month_name(today))
}

fn counted(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

fn summary_line(events: Option<usize>, pending_habits: Option<(u32, u32)>, urgent_tasks: Option<usize>) -> String {
    let mut parts = Vec::new();
    if let Some(events) = events {
        parts.push(if events == 0 {
            "Sin eventos en los próximos 7 días".to_string()
        } else {
            format!("{} en los próximos 7 días", counted(events, "evento", "eventos"))
        });
    }
    if let Some((pending, _)) = pending_habits.filter(|(_, total)| *total > 0) {
        parts.push(match pending {
            0 => "todos los hábitos de hoy hechos".to_string(),
            1 => "1 hábito pendiente hoy".to_string(),
            count => format!("{count} hábitos pendientes hoy"),
        });
    }
    if let Some(urgent) = urgent_tasks {
        parts.push(if urgent == 0 { "sin tareas urgentes".to_string() } else { counted(urgent, "tarea urgente", "tareas urgentes") });
    }
    let line = parts.join(" · ");
    let mut letters = line.chars();
    letters.next().map(|first| first.to_uppercase().collect::<String>() + letters.as_str()).unwrap_or_default()
}

// --- Command ----------------------------------------------------------------

fn local_clock() -> ChatClock {
    let now = Local::now();
    ChatClock { now_ms: now.timestamp_millis(), utc_offset_minutes: now.offset().local_minus_utc() / 60 }
}

fn utc_to_local_ms(utc_ms: i64) -> i64 {
    Local
        .timestamp_millis_opt(utc_ms)
        .single()
        .map_or(utc_ms, |moment| utc_ms + i64::from(moment.offset().local_minus_utc()) * 1_000)
}

/// The dashboard of `libraryId`, from every module's data.
pub(crate) async fn home_dashboard(app: AppHandle, payload: HomeDashboardPayload) -> Result<HomeDashboardDto, BackendError> {
    let library = crate::library_catalog::catalog_library(&app, &payload.library_id)
        .ok_or_else(|| BackendError::new(BackendErrorCode::NotFound, "La biblioteca no está en el catálogo.", false))?;
    let clock = local_clock();
    let chats = crate::chat_history::recent_chats(&app, &library.id, clock, RECENT_ITEMS)
        .await
        .map_err(|error| error.message);
    crate::host::async_runtime::spawn_blocking(move || build(&app, &library, chats))
        .await
        .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo armar el inicio.", true))
}

fn build(
    app: &AppHandle,
    library: &CatalogLibrary,
    chats: Result<Vec<crate::chat_history::RecentChat>, String>,
) -> HomeDashboardDto {
    let now = Local::now();
    let today = now.date_naive();
    let agenda_data = crate::agenda::home_data(
        app,
        &AgendaContext {
            library_path: library.path.clone(),
            android_directory_uri: library.android_tree_uri.clone(),
            actor_library_user_id: OWNER.to_string(),
        },
        AGENDA_DAYS,
    )
    .map_err(|error| error.message);
    let agenda = HomeCard::from(agenda_data.as_ref().map(agenda_summary).map_err(Clone::clone));
    let notes = HomeCard::from(agenda_data.as_ref().map(notes_summary).map_err(Clone::clone));
    let tasks = HomeCard::from(
        crate::task_manager_commands::owner_board_view(app, &library.id)
            .map(|view| tasks_summary(&view, crate::task_manager_commands::owner_pomodoro_task(app, &library.id).as_deref()))
            .map_err(|error| error.message),
    );
    let month = today.format("%Y-%m").to_string();
    let finance = HomeCard::from(
        crate::finance_screen::home_summary(
            app,
            &crate::finance::FinanceContext {
                library_path: library.path.clone(),
                android_directory_uri: library.android_tree_uri.clone(),
                actor_library_user_id: OWNER.to_string(),
                source: "app".to_string(),
            },
            &month,
        )
        .map(|summary| HomeFinance { month: month.clone(), month_label: month_name(today), summary })
        .map_err(|error| error.message),
    );
    let routine = HomeCard::from(
        crate::routine::routine_get_dashboard(
            app.clone(),
            crate::routine::RoutineContext {
                library_path: library.path.clone(),
                android_directory_uri: library.android_tree_uri.clone(),
                actor_library_user_id: OWNER.to_string(),
                source: "app".to_string(),
            },
        )
        .map(|dashboard| routine_summary(&dashboard, today))
        .map_err(|error| error.message),
    );
    let recent = recent_summary(app, library, today, chats);
    let summary = summary_line(
        agenda.data().map(|agenda| agenda.events.len()),
        routine.data().map(|routine| (routine.pending_today, routine.week.iter().find(|day| day.is_today).map_or(0, |day| day.total))),
        tasks.data().map(|tasks| tasks.urgent_count),
    );
    HomeDashboardDto {
        date_label: date_label(today, &library.name),
        greeting: greeting(now.hour()),
        summary,
        agenda,
        tasks,
        finance,
        routine,
        notes,
        recent,
    }
}

fn recent_summary(
    app: &AppHandle,
    library: &CatalogLibrary,
    today: NaiveDate,
    chats: Result<Vec<crate::chat_history::RecentChat>, String>,
) -> HomeRecent {
    let mut items = Vec::new();
    for chat in chats.unwrap_or_default() {
        let agent_file = chat.agent.clone().unwrap_or_else(|| notia_backend_core::agent_workspace::DEFAULT_PROMPT_FILE.to_string());
        let agent = crate::chat_agents::chat_agents(app, &library.id, std::slice::from_ref(&agent_file))
            .into_iter()
            .next()
            .map(|agent| agent.name)
            .unwrap_or_else(|| agent_file.trim_end_matches(".md").to_string());
        let at_local_ms = chat.activity_local_ms.unwrap_or_default();
        items.push(HomeRecentItem {
            kind: HomeRecentKind::Chat,
            title: chat.title,
            meta: chat_meta(&agent),
            when: if chat.activity_local_ms.is_some() { when_label(today, at_local_ms) } else { String::new() },
            path: Some(chat.file_path),
            agent_file: Some(agent_file),
            at_local_ms,
        });
    }
    // Notes that still exist: the list may name a note removed since.
    let existing = crate::library_inventory::inventory_files(app, &library.id)
        .map(|(files, _)| files.into_iter().collect::<std::collections::HashSet<_>>())
        .ok();
    let notes = crate::recent_documents::list(app, &library.id)
        .into_iter()
        .filter(|document| existing.as_ref().is_none_or(|files| files.contains(&document.logical_path)))
        .take(RECENT_ITEMS);
    for document in notes {
        let name = document.logical_path.rsplit('/').next().unwrap_or(&document.logical_path);
        let folder = document.logical_path.rsplit_once('/').map_or(library.name.as_str(), |(parent, _)| parent.rsplit('/').next().unwrap_or(parent));
        let at_local_ms = utc_to_local_ms(document.opened_at_ms);
        items.push(HomeRecentItem {
            kind: HomeRecentKind::Note,
            title: name.strip_suffix(".md").unwrap_or(name).to_string(),
            meta: format!("Nota · {folder}"),
            when: when_label(today, at_local_ms),
            path: Some(notia_backend_core::library_tree::library_visible_path(&library.path, &document.logical_path)),
            agent_file: None,
            at_local_ms,
        });
    }
    if let Some((snapshot, start_ms)) = crate::meeting::current_meeting(app) {
        let at_local_ms = utc_to_local_ms(i64::try_from(start_ms).unwrap_or_default());
        items.push(HomeRecentItem {
            kind: HomeRecentKind::Meeting,
            meta: meeting_meta(&snapshot),
            title: snapshot.title,
            when: when_label(today, at_local_ms),
            path: None,
            agent_file: None,
            at_local_ms,
        });
    }
    items.sort_by(|left, right| right.at_local_ms.cmp(&left.at_local_ms));
    items.truncate(RECENT_ITEMS);
    let folders = crate::library_inventory::root_folders(app, &library.id)
        .unwrap_or_default()
        .into_iter()
        .filter(|name| !is_system_folder(name))
        .take(FOLDER_SHORTCUTS)
        .map(|name| HomeFolder {
            path: notia_backend_core::library_tree::library_visible_path(&library.path, &name),
            name,
        })
        .collect();
    HomeRecent { items, folders }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notia_backend_core::task_manager_ui::TaskItemViewDto;

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("date")
    }

    #[test]
    fn the_header_greets_by_the_hour_and_names_the_day() {
        assert_eq!(greeting(8), "Buen día");
        assert_eq!(greeting(15), "Buenas tardes");
        assert_eq!(greeting(23), "Buenas noches");
        assert_eq!(greeting(3), "Buenas noches");
        assert_eq!(date_label(date("2026-09-26"), "gaia"), "Sábado 26 de septiembre · gaia");
        assert_eq!(
            summary_line(Some(3), Some((4, 7)), Some(3)),
            "3 eventos en los próximos 7 días · 4 hábitos pendientes hoy · 3 tareas urgentes"
        );
        assert_eq!(summary_line(Some(0), Some((0, 2)), Some(1)), "Sin eventos en los próximos 7 días · todos los hábitos de hoy hechos · 1 tarea urgente");
        assert_eq!(summary_line(None, Some((1, 0)), None), "");
    }

    #[test]
    fn the_agenda_lists_seven_days_and_labels_events_of_another_month() {
        let event = |id: &str, day: &str, start: u16, end: u16, priority| crate::agenda::EventRecord {
            id: id.into(),
            date: date(day),
            start_minute: start,
            end_minute: end,
            title: format!("Evento {id}"),
            priority,
        };
        let data = HomeAgendaData {
            today: date("2026-09-26"),
            events: vec![
                event("a", "2026-09-28", 540, 585, AgendaPriority::Medium),
                event("b", "2026-10-02", 660, 690, AgendaPriority::Urgent),
            ],
            notes: vec![
                crate::agenda::NoteRecord { id: "n1".into(), text: "Responder mails".into(), done: false },
                crate::agenda::NoteRecord { id: "n2".into(), text: "Preparar reunión".into(), done: true },
            ],
        };
        let agenda = agenda_summary(&data);
        assert_eq!(agenda.days.len(), 7);
        assert_eq!((agenda.days[0].weekday, agenda.days[0].day, agenda.days[0].is_today), ("Sáb", 26, true));
        assert_eq!(agenda.days[0].label, "sábado 26");
        assert!(agenda.days[2].has_events && !agenda.days[1].has_events);
        assert_eq!(agenda.events[0].day_label, "Lun 28");
        assert_eq!(agenda.events[0].range, "09:00 – 09:45");
        assert_eq!(agenda.events[1].day_label, "Vie 2 oct");
        assert_eq!(agenda.events[1].priority_label, "Urgente");
        let notes = notes_summary(&data);
        assert_eq!((notes.items.len(), notes.pending), (2, 1));
    }

    fn task(title: &str, group: &str, state: TaskState, priority: TaskPriority) -> TaskItemViewDto {
        TaskItemViewDto {
            id: title.into(),
            file_path: format!("task-manager/{title}.md"),
            path: format!("C:/lib/task-manager/{title}.md"),
            file_name: title.into(),
            title: title.into(),
            detail: String::new(),
            state,
            start_date: String::new(),
            end_date: String::new(),
            dynamic_end_date: false,
            board: "Trabajo".into(),
            group: group.into(),
            priority,
            dedicated_hours: 0.0,
            estimated_hours: 0.0,
            deviation_hours: 0.0,
            parent_task_name: String::new(),
            order: 0.0,
            preview: String::new(),
            contexto: None,
            related_documents: Vec::new(),
            related_tasks: Vec::new(),
        }
    }

    #[test]
    fn tasks_count_the_usual_columns_and_list_the_most_urgent_first() {
        let view = TaskBoardViewDto {
            generation: 1,
            boards: Vec::new(),
            groups: Vec::new(),
            pomodoro_entries: Vec::new(),
            panel_paths: Default::default(),
            tasks: vec![
                task("Informe", "Sprint actual", TaskState::Pending, TaskPriority::Medium),
                task("Performance", "Sprint actual", TaskState::InProgress, TaskPriority::Urgent),
                task("Revisar PR", "En revisión", TaskState::Pending, TaskPriority::High),
                task("Pago de tarjetas", "Bloqueado", TaskState::Pending, TaskPriority::Low),
                task("Esperando al cliente", "Próximo Q", TaskState::Blocked, TaskPriority::Low),
                task("Hecha", "Sprint actual", TaskState::Completed, TaskPriority::Urgent),
                task("Descartada", "Sprint actual", TaskState::Cancelled, TaskPriority::Urgent),
            ],
        };
        let tasks = tasks_summary(&view, None);
        assert_eq!((tasks.completed, tasks.sprint, tasks.review, tasks.blocked, tasks.urgent_count), (1, 2, 1, 2, 1));
        assert_eq!(
            tasks.focus,
            Some(HomeFocus { file_path: "task-manager/Performance.md".into(), title: "Performance".into(), selected: false })
        );
        let chosen = tasks_summary(&view, Some("task-manager/Informe.md")).focus.expect("focus");
        assert_eq!((chosen.title.as_str(), chosen.selected), ("Informe", true));
        let missing = tasks_summary(&view, Some("task-manager/Borrada.md")).focus.expect("focus");
        assert_eq!((missing.title.as_str(), missing.selected), ("Performance", false));
        let titles = tasks.urgent.iter().map(|task| task.title.as_str()).collect::<Vec<_>>();
        assert_eq!(titles, ["Performance", "Revisar PR", "Informe", "Esperando al cliente", "Pago de tarjetas"]);
        assert_eq!(tasks.urgent[3].meta, "Próximo Q · Bloqueada");
        assert_eq!(tasks.urgent[0].meta, "Sprint actual · En progreso");
        assert_eq!((tasks.urgent[0].chip, tasks.urgent[0].chip_label), (HomeTaskChip::Urgent, "Urgente"));
        assert_eq!((tasks.urgent[4].chip, tasks.urgent[4].chip_label), (HomeTaskChip::Blocked, "Bloqueada"));
        assert_eq!(tasks.urgent[0].file_path, "task-manager/Performance.md");
    }

    #[test]
    fn recent_items_say_when_they_happened_and_system_folders_are_left_out() {
        let today = date("2026-09-26");
        let at = |day: &str| date(day).and_hms_opt(10, 0, 0).expect("time").and_utc().timestamp_millis();
        assert_eq!(when_label(today, at("2026-09-26")), "Hoy");
        assert_eq!(when_label(today, at("2026-09-25")), "Ayer");
        assert_eq!(when_label(today, at("2026-09-21")), "Esta semana");
        assert_eq!(when_label(today, at("2026-09-12")), "12 sep");
        assert!(is_system_folder(".agent") && is_system_folder("chat") && is_system_folder("Task-Manager"));
        assert!(!is_system_folder("Facultad"));
        assert_eq!(chat_meta("Task Manager"), "Chat · agente Task Manager");
        assert_eq!(chat_meta("Agente IA de Notia"), "Chat · Agente IA de Notia");
        assert_eq!(day_letter("Miércoles"), "X");
        assert_eq!(day_letter("Sábado"), "S");
    }
}
