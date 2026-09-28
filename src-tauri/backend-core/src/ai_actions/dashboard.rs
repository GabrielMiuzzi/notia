//! The dashboard of AI actions, computed whole here: the state chip of
//! every action, the day's metrics, the columns by kind and the «Hoy»
//! timeline with every run of the day, past and future.

use std::collections::BTreeSet;

use jiff::tz::TimeZone;
use serde::{Deserialize, Serialize};

use super::labels::{in_label, long_date, minutes_until, moment_label, next_label, schedule_label, short_date, time_label};
use super::schedule::{day_bounds, local_date, next_after, occurrences_between};
use super::scheduler::DUE_GRACE_MS;
use super::{fold, time_zone, AiAction, AiActionKind, AiActionRun, AiSchedule, RunStatus, RunTrigger};

/// Runs listed in the history of an action.
pub const MAX_HISTORY_RUNS: usize = 50;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DashboardFilter {
    #[default]
    All,
    Reminder,
    OneShot,
    Recurring,
}

impl DashboardFilter {
    fn shows(self, kind: AiActionKind) -> bool {
        match self {
            Self::All => true,
            Self::Reminder => kind == AiActionKind::Reminder,
            Self::OneShot => kind == AiActionKind::OneShot,
            Self::Recurring => kind == AiActionKind::Recurring,
        }
    }
}

/// Color and dot of a state, as the legend names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Tone {
    Done,
    Next,
    Pending,
    Scheduled,
    Failed,
    Paused,
    Running,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusChip {
    pub tone: Tone,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCard {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub kind: AiActionKind,
    pub enabled: bool,
    pub when: String,
    /// Recurring actions only: «hoy 15:00», or «—» while paused.
    pub next_label: Option<String>,
    /// Recurring actions only: «2 de 5 hoy» or «Sin ejecuciones hoy».
    pub runs_label: Option<String>,
    pub status: StatusChip,
    /// The failed run «Reintentar» retries.
    pub retry_run_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionColumn {
    pub kind: AiActionKind,
    pub title: String,
    pub subtitle: String,
    pub cards: Vec<ActionCard>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineItem {
    pub time: String,
    pub action_id: String,
    pub name: String,
    pub kind: AiActionKind,
    pub kind_label: String,
    pub tone: Tone,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum TimelineEntry {
    Now { time: String },
    Item { item: TimelineItem },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextRun {
    pub action_id: String,
    pub time: String,
    pub in_label: String,
    pub name: String,
    pub kind_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub done_today: usize,
    pub failed_today: usize,
    pub pending_today: usize,
    /// «Hasta las 21:00», or none when nothing is left today.
    pub pending_until: Option<String>,
    pub recurring_active: usize,
    pub recurring_total: usize,
    pub recurring_paused: usize,
    pub next: Option<NextRun>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindCounts {
    pub all: usize,
    pub reminder: usize,
    pub one_shot: usize,
    pub recurring: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayProgress {
    pub done: usize,
    /// Runs of the day, without those of paused actions.
    pub total: usize,
    pub percent: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiActionsDashboard {
    pub title_date: String,
    pub short_date: String,
    pub now_time: String,
    pub filter: DashboardFilter,
    pub metrics: Metrics,
    pub counts: KindCounts,
    pub columns: Vec<ActionColumn>,
    pub timeline: Vec<TimelineEntry>,
    pub progress: DayProgress,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ItemState {
    Done,
    Failed,
    Skipped,
    Running,
    Paused,
    Pending,
}

struct DayItem<'a> {
    at_ms: i64,
    run: Option<&'a AiActionRun>,
    state: ItemState,
}

struct ActionDay<'a> {
    action: &'a AiAction,
    items: Vec<DayItem<'a>>,
    /// The last attempt of the day that did not get skipped.
    last_attempt: Option<&'a AiActionRun>,
}

fn run_state(status: RunStatus) -> ItemState {
    match status {
        RunStatus::Success => ItemState::Done,
        RunStatus::Failed => ItemState::Failed,
        RunStatus::Skipped => ItemState::Skipped,
        RunStatus::Pending | RunStatus::Running => ItemState::Running,
    }
}

/// The runs of the day of an action: each occurrence with its last attempt.
fn action_day<'a>(action: &'a AiAction, runs: &'a [AiActionRun], day: (i64, i64), now_ms: i64) -> ActionDay<'a> {
    let zone = time_zone(&action.time_zone);
    let today_runs = runs
        .iter()
        .filter(|run| run.action_id.as_deref() == Some(action.id.as_str()) && run.trigger != RunTrigger::Test)
        .filter(|run| (day.0..day.1).contains(&run.scheduled_for_ms))
        .collect::<Vec<_>>();
    let mut instants = occurrences_between(&action.schedule, &zone, day.0, day.1)
        .into_iter()
        .filter(|instant| *instant >= action.active_since_ms)
        .collect::<BTreeSet<_>>();
    instants.extend(today_runs.iter().map(|run| run.scheduled_for_ms));
    let items = instants
        .into_iter()
        .map(|at_ms| {
            let run = today_runs.iter().copied().filter(|run| run.scheduled_for_ms == at_ms).max_by_key(|run| run.created_at_ms);
            let state = match run {
                Some(run) => run_state(run.status),
                None if !action.enabled => ItemState::Paused,
                None if at_ms < now_ms - DUE_GRACE_MS => ItemState::Skipped,
                None => ItemState::Pending,
            };
            DayItem { at_ms, run, state }
        })
        .collect();
    let last_attempt = today_runs.into_iter().filter(|run| run.status != RunStatus::Skipped).max_by_key(|run| run.created_at_ms);
    ActionDay { action, items, last_attempt }
}

fn finished_time(zone: &TimeZone, run: &AiActionRun) -> String {
    time_label(zone, run.finished_at_ms.or(run.started_at_ms).unwrap_or(run.scheduled_for_ms))
}

/// «Enviado», «Reintentada» or «Ejecutada», by kind and trigger.
fn done_word(kind: AiActionKind, run: &AiActionRun) -> &'static str {
    if run.trigger == RunTrigger::Retry {
        "Reintentada"
    } else if kind == AiActionKind::Reminder {
        "Enviado"
    } else {
        "Ejecutada"
    }
}

fn scheduled_word(kind: AiActionKind) -> &'static str {
    if kind == AiActionKind::Reminder {
        "Programado"
    } else {
        "Programada"
    }
}

fn chip(tone: Tone, label: String) -> StatusChip {
    StatusChip { tone, label }
}

fn card_status(day: &ActionDay<'_>, zone: &TimeZone, next: Option<(usize, i64)>, index: usize) -> (StatusChip, Option<String>) {
    let kind = day.action.kind;
    if !day.action.enabled {
        return (chip(Tone::Paused, "Pausada".into()), None);
    }
    if let Some(run) = day.last_attempt.filter(|run| run.status == RunStatus::Failed) {
        return (chip(Tone::Failed, format!("Falló · {}", time_label(zone, run.scheduled_for_ms))), Some(run.id.clone()));
    }
    if let Some(item) = day.items.iter().find(|item| item.state == ItemState::Running) {
        return (chip(Tone::Running, format!("En curso · {}", time_label(zone, item.at_ms))), None);
    }
    if let Some((_, at_ms)) = next.filter(|(next_index, _)| *next_index == index) {
        return (chip(Tone::Next, format!("Próxima · {}", time_label(zone, at_ms))), None);
    }
    if let Some(run) = day.last_attempt.filter(|run| run.status == RunStatus::Success) {
        return (chip(Tone::Done, format!("{} · {}", done_word(kind, run), finished_time(zone, run))), None);
    }
    if let Some(item) = day.items.iter().find(|item| item.state == ItemState::Pending) {
        return (chip(Tone::Pending, format!("Pendiente · {}", time_label(zone, item.at_ms))), None);
    }
    (chip(Tone::Scheduled, scheduled_word(kind).into()), None)
}

fn column_texts(kind: AiActionKind) -> (&'static str, &'static str) {
    match kind {
        AiActionKind::Reminder => ("Recordatorios", "Te avisa con un mensaje"),
        AiActionKind::OneShot => ("Horarios", "Una vez, a hora exacta"),
        AiActionKind::Recurring => ("Recurrentes", "Cada X tiempo"),
    }
}

fn matches_query(action: &AiAction, query: &str) -> bool {
    let query = fold(query.trim());
    query.is_empty() || fold(&action.name).contains(&query) || fold(&action.prompt).contains(&query)
}

/// The next occurrence of an action from now on that counts.
fn next_occurrence(action: &AiAction, now_ms: i64) -> Option<i64> {
    next_after(&action.schedule, &time_zone(&action.time_zone), now_ms.max(action.active_since_ms - 1))
}

pub fn build_dashboard(
    actions: &[AiAction],
    runs: &[AiActionRun],
    now_ms: i64,
    zone: &TimeZone,
    filter: DashboardFilter,
    query: &str,
) -> AiActionsDashboard {
    let today = local_date(zone, now_ms);
    let day = day_bounds(zone, today);
    let days = actions.iter().map(|action| action_day(action, runs, day, now_ms)).collect::<Vec<_>>();

    // The next run of the day among the active actions.
    let next = days
        .iter()
        .enumerate()
        .filter(|(_, day)| day.action.enabled)
        .filter_map(|(index, day)| day.items.iter().find(|item| item.state == ItemState::Pending).map(|item| (index, item.at_ms)))
        .min_by(|left, right| left.1.cmp(&right.1).then_with(|| days[left.0].action.name.cmp(&days[right.0].action.name)));

    // Timeline.
    let mut items = Vec::<(i64, TimelineItem)>::new();
    for (index, action_day) in days.iter().enumerate() {
        let action = action_day.action;
        let total = action_day.items.len();
        for (position, item) in action_day.items.iter().enumerate() {
            let count_note = (action.kind == AiActionKind::Recurring && total > 1).then(|| format!("{} de {total}", position + 1));
            let is_next = next == Some((index, item.at_ms));
            let (tone, note) = match item.state {
                ItemState::Done => {
                    let run = item.run.expect("a done item has its run");
                    let note = if run.trigger == RunTrigger::Retry {
                        format!("Reintentada {}", finished_time(zone, run))
                    } else if action.kind == AiActionKind::Reminder {
                        "Enviado".to_string()
                    } else {
                        count_note.clone().unwrap_or_else(|| format!("Ejecutada {}", finished_time(zone, run)))
                    };
                    (Tone::Done, Some(note))
                }
                ItemState::Failed => (Tone::Failed, Some(item.run.and_then(|run| run.error.clone()).unwrap_or_else(|| "Falló".into()))),
                ItemState::Skipped => (Tone::Skipped, Some("Omitida".into())),
                ItemState::Running => (Tone::Running, Some("En curso".into())),
                ItemState::Paused => (Tone::Paused, Some("Pausada".into())),
                ItemState::Pending if is_next => (Tone::Next, Some(in_label(minutes_until(now_ms, item.at_ms)))),
                ItemState::Pending => (Tone::Pending, count_note),
            };
            items.push((
                item.at_ms,
                TimelineItem {
                    time: time_label(zone, item.at_ms),
                    action_id: action.id.clone(),
                    name: action.name.clone(),
                    kind: action.kind,
                    kind_label: action.kind.label().to_string(),
                    tone,
                    note,
                },
            ));
        }
    }
    items.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.name.cmp(&right.1.name)));
    let now_position = items.iter().position(|(at_ms, _)| *at_ms > now_ms).unwrap_or(items.len());

    let count = |tone: Tone| items.iter().filter(|(_, item)| item.tone == tone).count();
    let done_today = count(Tone::Done);
    let failed_today = count(Tone::Failed);
    let pending_today = count(Tone::Pending) + count(Tone::Next);
    let pending_until = items
        .iter()
        .rev()
        .find(|(_, item)| matches!(item.tone, Tone::Pending | Tone::Next))
        .map(|(_, item)| format!("Hasta las {}", item.time));
    let total = items.iter().filter(|(_, item)| item.tone != Tone::Paused).count();
    let progress = DayProgress { done: done_today, total, percent: if total == 0 { 0 } else { (done_today * 100 + total / 2) / total } };

    let recurring = actions.iter().filter(|action| action.kind == AiActionKind::Recurring).collect::<Vec<_>>();
    let recurring_active = recurring.iter().filter(|action| action.enabled).count();
    let next_run = next.map(|(index, at_ms)| NextRun {
        action_id: days[index].action.id.clone(),
        time: time_label(zone, at_ms),
        in_label: in_label(minutes_until(now_ms, at_ms)),
        name: days[index].action.name.clone(),
        kind_label: days[index].action.kind.label().to_string(),
    });

    // Cards.
    let mut counts = KindCounts::default();
    let mut columns = super::AiActionKind::ALL
        .into_iter()
        .filter(|kind| filter.shows(*kind))
        .map(|kind| {
            let (title, subtitle) = column_texts(kind);
            ActionColumn { kind, title: title.into(), subtitle: subtitle.into(), cards: Vec::new() }
        })
        .collect::<Vec<_>>();
    let mut sorted = Vec::<(AiActionKind, bool, i64, ActionCard)>::new();
    for (index, action_day) in days.iter().enumerate() {
        let action = action_day.action;
        if let AiSchedule::Once { at_ms } = action.schedule {
            if at_ms < day.0 {
                continue;
            }
        }
        if !matches_query(action, query) {
            continue;
        }
        counts.all += 1;
        match action.kind {
            AiActionKind::Reminder => counts.reminder += 1,
            AiActionKind::OneShot => counts.one_shot += 1,
            AiActionKind::Recurring => counts.recurring += 1,
        }
        if !filter.shows(action.kind) {
            continue;
        }
        let (status, retry_run_id) = card_status(action_day, zone, next, index);
        let recurring = action.kind == AiActionKind::Recurring;
        let next_at = next_occurrence(action, now_ms);
        let done = action_day.items.iter().filter(|item| item.state == ItemState::Done).count();
        let card = ActionCard {
            id: action.id.clone(),
            name: action.name.clone(),
            prompt: action.prompt.clone(),
            kind: action.kind,
            enabled: action.enabled,
            when: schedule_label(&action.schedule, zone, today),
            next_label: recurring.then(|| match next_at.filter(|_| action.enabled) {
                Some(at_ms) => next_label(zone, at_ms, today),
                None => "—".to_string(),
            }),
            runs_label: recurring.then(|| match action_day.items.len() {
                0 => "Sin ejecuciones hoy".to_string(),
                total => format!("{done} de {total} hoy"),
            }),
            status,
            retry_run_id,
        };
        let today_at = action_day
            .items
            .iter()
            .find(|item| item.state == ItemState::Pending)
            .or_else(|| action_day.items.first())
            .map(|item| item.at_ms);
        let sort_at = today_at.or(next_at).unwrap_or(i64::MAX);
        sorted.push((action.kind, today_at.is_none(), sort_at, card));
    }
    sorted.sort_by(|left, right| left.1.cmp(&right.1).then_with(|| left.2.cmp(&right.2)).then_with(|| left.3.name.cmp(&right.3.name)));
    for (kind, _, _, card) in sorted {
        if let Some(column) = columns.iter_mut().find(|column| column.kind == kind) {
            column.cards.push(card);
        }
    }

    let now_time = time_label(zone, now_ms);
    let mut timeline = items.into_iter().map(|(_, item)| TimelineEntry::Item { item }).collect::<Vec<_>>();
    timeline.insert(now_position, TimelineEntry::Now { time: now_time.clone() });

    AiActionsDashboard {
        title_date: long_date(today),
        short_date: short_date(today),
        now_time,
        filter,
        metrics: Metrics {
            done_today,
            failed_today,
            pending_today,
            pending_until,
            recurring_active,
            recurring_total: recurring.len(),
            recurring_paused: recurring.len() - recurring_active,
            next: next_run,
        },
        counts,
        columns,
        timeline,
        progress,
    }
}

/// One run in the history of an action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRow {
    pub id: String,
    pub when: String,
    pub trigger: String,
    pub status: StatusChip,
    pub note: Option<String>,
}

/// The history of an action, the newest first.
pub fn run_history(action_id: &str, runs: &[AiActionRun], now_ms: i64, zone: &TimeZone) -> Vec<RunRow> {
    let today = local_date(zone, now_ms);
    let mut rows = runs.iter().filter(|run| run.action_id.as_deref() == Some(action_id)).collect::<Vec<_>>();
    rows.sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
    rows.into_iter()
        .take(MAX_HISTORY_RUNS)
        .map(|run| {
            let (tone, label) = match run.status {
                RunStatus::Success => (Tone::Done, format!("{} · {}", done_word(run.kind, run), finished_time(zone, run))),
                RunStatus::Failed => (Tone::Failed, "Falló".to_string()),
                RunStatus::Skipped => (Tone::Skipped, "Omitida".to_string()),
                RunStatus::Running => (Tone::Running, "En curso".to_string()),
                RunStatus::Pending => (Tone::Pending, "En espera".to_string()),
            };
            RunRow {
                id: run.id.clone(),
                when: moment_label(zone, run.scheduled_for_ms, today),
                trigger: match run.trigger {
                    RunTrigger::Scheduled => "Programada",
                    RunTrigger::Manual => "Manual",
                    RunTrigger::Retry => "Reintento",
                    RunTrigger::Test => "Prueba",
                }
                .to_string(),
                status: chip(tone, label),
                note: run.error.clone().or_else(|| run.output_summary.clone()),
            }
        })
        .collect()
}
