//! Task Manager board as the interface sees it.
//!
//! The board names boards, groups and tasks the way the Markdown workspace
//! shows them: board and group names, ticket paths and parent file names.
//! This module is the single place that resolves those names to store
//! identities, applies the board rules (default board, name sanitation,
//! duplicate names, activity hours, default context, Pomodoro accounting)
//! and projects a snapshot into the view the interface renders. The
//! interface only sends intents and renders [`TaskBoardViewDto`].

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::error::{BackendError, BackendErrorCode};
use crate::pomodoro_log::{PomodoroEntryDto, PomodoroEntryInput};
use crate::task_manager_tools::{
    TaskBoardDto, TaskManagerLibrarySnapshotDto, TaskManagerSnapshotReadDto, TaskMutationDto,
    TaskPriority, TaskState, TaskTicketDto, TaskUpdateFieldsDto,
};

pub const DEFAULT_BOARD_NAME: &str = "default";
pub const DEFAULT_BOARD_COLOR: &str = "#2e6db0";
pub const DEFAULT_CONTEXT_TAG: &str = "#Personal";
pub const FINISHED_PANEL_ID: &str = "__finished__";
pub const CANCELLED_PANEL_ID: &str = "__cancelled__";
/// Order of tickets that were never arranged; they sort after arranged ones.
const UNARRANGED_ORDER: f64 = 999_999.0;
const MAX_ACTIVITY_HOURS: f64 = 24.0;
const MAX_ARRANGEMENT_UPDATES: usize = 2_000;
/// Gap between consecutive task orders, so a move usually rewrites one task.
const ORDER_STEP: f64 = 10.0;

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskBoardSettingsDto {
    pub name: String,
    pub color: String,
    pub activity_hours_per_day: f64,
    pub contexto: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGroupSettingsDto {
    pub name: String,
    pub color: String,
    pub board: String,
}

/// One task card, named like the Markdown frontmatter names it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskItemViewDto {
    pub id: String,
    /// Logical path, the identity every intent uses.
    pub file_path: String,
    /// Path of the ticket as the explorer shows it (to open it).
    pub path: String,
    pub file_name: String,
    pub title: String,
    pub detail: String,
    pub state: TaskState,
    pub start_date: String,
    pub end_date: String,
    pub dynamic_end_date: bool,
    pub board: String,
    pub group: String,
    pub priority: TaskPriority,
    pub dedicated_hours: f64,
    pub estimated_hours: f64,
    pub deviation_hours: f64,
    pub parent_task_name: String,
    pub order: f64,
    pub preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contexto: Option<String>,
    pub related_documents: Vec<String>,
    pub related_tasks: Vec<String>,
}

/// Everything the board renders, derived from one snapshot generation.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskBoardViewDto {
    pub generation: u64,
    pub boards: Vec<TaskBoardSettingsDto>,
    pub groups: Vec<TaskGroupSettingsDto>,
    pub tasks: Vec<TaskItemViewDto>,
    pub pomodoro_entries: Vec<PomodoroEntryDto>,
    /// Ticket paths of each panel (board name, finished or cancelled), as
    /// the explorer shows them; the chat scope of the visible panel.
    pub panel_paths: BTreeMap<String, Vec<String>>,
}

/// Replaces the logical ticket paths meant for display with the paths the
/// client shows (explorer paths, or the published alias).
pub fn show_board_paths(view: &mut TaskBoardViewDto, visible: impl Fn(&str) -> String) {
    for task in &mut view.tasks {
        task.path = visible(&task.file_path);
    }
    for paths in view.panel_paths.values_mut() {
        for path in paths.iter_mut() {
            *path = visible(path);
        }
    }
}

fn file_name_of(logical_path: &str) -> String {
    let name = logical_path.rsplit('/').next().unwrap_or_default();
    name.strip_suffix(".md")
        .or_else(|| name.strip_suffix(".MD"))
        .unwrap_or(name)
        .to_string()
}

fn activity_hours(snapshot: &TaskManagerLibrarySnapshotDto, board: &TaskBoardDto) -> f64 {
    let hours = &snapshot.config.activity_hours_per_day;
    hours
        .get(&board.board_id)
        .or_else(|| hours.get(&board.name))
        .copied()
        .unwrap_or(MAX_ACTIVITY_HOURS)
}

/// Projects a snapshot into the board view. The default board comes first;
/// groups keep the store order inside each board.
pub fn project_board_view(
    snapshot: &TaskManagerLibrarySnapshotDto,
    pomodoro_entries: Vec<PomodoroEntryDto>,
) -> TaskBoardViewDto {
    let board_names = snapshot
        .boards
        .iter()
        .map(|board| (board.board_id.as_str(), board.name.as_str()))
        .collect::<HashMap<_, _>>();
    let group_names = snapshot
        .groups
        .iter()
        .map(|group| (group.group_id.as_str(), group.name.as_str()))
        .collect::<HashMap<_, _>>();
    let file_names = snapshot
        .tickets
        .iter()
        .map(|ticket| {
            (
                ticket.summary.ticket_id.as_str(),
                file_name_of(&ticket.summary.logical_path),
            )
        })
        .collect::<HashMap<_, _>>();

    let mut boards = snapshot
        .boards
        .iter()
        .map(|board| TaskBoardSettingsDto {
            name: board.name.clone(),
            color: board.color.clone(),
            activity_hours_per_day: activity_hours(snapshot, board),
            contexto: board
                .context
                .clone()
                .unwrap_or_else(|| DEFAULT_CONTEXT_TAG.to_string()),
        })
        .collect::<Vec<_>>();
    boards.sort_by_key(|board| board.name != DEFAULT_BOARD_NAME);

    let groups = snapshot
        .groups
        .iter()
        .map(|group| TaskGroupSettingsDto {
            name: group.name.clone(),
            color: group.color.clone(),
            board: board_names
                .get(group.board_id.as_str())
                .map(|name| name.to_string())
                .unwrap_or_else(|| group.board_id.clone()),
        })
        .collect::<Vec<_>>();

    let mut panel_paths = BTreeMap::<String, Vec<String>>::new();
    let tasks = snapshot
        .tickets
        .iter()
        .map(|ticket| {
            let summary = &ticket.summary;
            let board = board_names
                .get(summary.board_id.as_str())
                .map(|name| name.to_string())
                .unwrap_or_else(|| summary.board_id.clone());
            let panel = match summary.state {
                TaskState::Completed => FINISHED_PANEL_ID.to_string(),
                TaskState::Cancelled => CANCELLED_PANEL_ID.to_string(),
                _ => board.clone(),
            };
            panel_paths
                .entry(panel)
                .or_default()
                .push(summary.logical_path.clone());
            TaskItemViewDto {
                id: summary.ticket_id.clone(),
                file_path: summary.logical_path.clone(),
                path: summary.logical_path.clone(),
                file_name: file_name_of(&summary.logical_path),
                title: summary.title.clone(),
                detail: ticket.content.clone(),
                state: summary.state,
                start_date: ticket.start_date.clone(),
                end_date: ticket.end_date.clone(),
                dynamic_end_date: ticket.dynamic_end_date,
                board,
                group: summary
                    .group_id
                    .as_deref()
                    .map(|id| {
                        group_names
                            .get(id)
                            .map(|name| name.to_string())
                            .unwrap_or_else(|| id.to_string())
                    })
                    .unwrap_or_default(),
                priority: summary.priority,
                dedicated_hours: ticket.dedicated_hours,
                estimated_hours: ticket.estimated_hours,
                deviation_hours: ticket.deviation_hours,
                parent_task_name: summary
                    .parent_ticket_id
                    .as_deref()
                    .and_then(|id| file_names.get(id).cloned())
                    .unwrap_or_default(),
                order: ticket.order,
                preview: summary.detail_preview.clone(),
                contexto: ticket.context.clone(),
                related_documents: ticket.related_documents.clone(),
                related_tasks: ticket.related_tasks.clone(),
            }
        })
        .collect::<Vec<_>>();
    for paths in panel_paths.values_mut() {
        paths.sort();
    }

    TaskBoardViewDto {
        generation: snapshot.generation,
        boards,
        groups,
        tasks,
        pomodoro_entries,
        panel_paths,
    }
}

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq)]
struct TaskArrangementDto {
    task_path: String,
    order: f64,
    group: Option<String>,
    parent_task_name: Option<String>,
}

/// What the person did on the board. Boards and groups are named, tasks
/// are identified by their ticket path.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum TaskBoardIntent {
    CreateTask {
        board: String,
        title: String,
        #[serde(default)]
        detail: String,
        #[serde(default)]
        group: String,
        #[serde(default)]
        priority: Option<TaskPriority>,
        state: TaskState,
        #[serde(default)]
        parent_task_name: String,
        #[serde(default)]
        end_date: String,
        #[serde(default = "default_true")]
        dynamic_end_date: bool,
        #[serde(default)]
        estimated_hours: f64,
    },
    EditTask {
        task_path: String,
        title: String,
        #[serde(default)]
        detail: String,
        state: TaskState,
        #[serde(default)]
        priority: Option<TaskPriority>,
        #[serde(default)]
        group: String,
        #[serde(default)]
        end_date: String,
        #[serde(default = "default_true")]
        dynamic_end_date: bool,
        #[serde(default)]
        estimated_hours: f64,
        #[serde(default)]
        parent_task_name: String,
    },
    ChangeState {
        task_path: String,
        state: TaskState,
    },
    ChangePriority {
        task_path: String,
        priority: TaskPriority,
    },
    SetDedicatedHours {
        task_path: String,
        hours: f64,
    },
    MarkUrgent {
        task_path: String,
    },
    DeleteTask {
        task_path: String,
    },
    AddComment {
        task_path: String,
        comment: String,
    },
    /// A task dropped into a column (group) or under a parent task.
    /// `ordered_paths` is the destination list as displayed after the drop,
    /// including the moved task.
    PlaceTask {
        task_path: String,
        ordered_paths: Vec<String>,
        #[serde(default)]
        group: String,
        #[serde(default)]
        parent_task_name: String,
    },
    CreateBoard {
        name: String,
        #[serde(default)]
        color: String,
        activity_hours_per_day: f64,
        #[serde(default)]
        contexto: String,
    },
    UpdateBoard {
        previous_name: String,
        name: String,
        #[serde(default)]
        color: String,
        activity_hours_per_day: f64,
        #[serde(default)]
        contexto: String,
    },
    DeleteBoard {
        name: String,
    },
    CreateGroup {
        board: String,
        name: String,
        #[serde(default)]
        color: String,
    },
    UpdateGroup {
        previous_board: String,
        previous_name: String,
        name: String,
        #[serde(default)]
        color: String,
    },
    DeleteGroup {
        board: String,
        name: String,
    },
    ReorderGroups {
        board: String,
        group_names: Vec<String>,
    },
}

fn invalid(message: impl Into<String>) -> BackendError {
    BackendError::invalid_input(message)
}

fn conflict(message: impl Into<String>) -> BackendError {
    BackendError::new(BackendErrorCode::Conflict, message, false)
}

fn not_found(message: impl Into<String>) -> BackendError {
    BackendError::new(BackendErrorCode::NotFound, message, false)
}

fn normalize_name(value: &str) -> String {
    value.trim().to_lowercase()
}

fn normalize_path(value: &str) -> String {
    value
        .replace('\\', "/")
        .trim_matches('/')
        .to_lowercase()
}

fn paths_match(left: &str, right: &str) -> bool {
    left == right || left.ends_with(&format!("/{right}")) || right.ends_with(&format!("/{left}"))
}

/// Board names become workspace folders: separators and reserved
/// characters are replaced and the name is lowercase.
pub fn sanitize_board_name(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '#' | '^' | '[' | ']' => '-',
            other => other,
        })
        .collect::<String>()
        .trim()
        .to_lowercase()
}

/// `#Tag` without spaces; a bare word gets its `#`.
pub fn normalize_context_tag(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let tag = if trimmed.starts_with('#') {
        trimmed.to_string()
    } else {
        format!("#{trimmed}")
    };
    let valid = tag.len() > 1 && !tag[1..].contains(['#']) && !tag.chars().any(char::is_whitespace);
    valid.then_some(tag)
}

fn board_color(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        DEFAULT_BOARD_COLOR.to_string()
    } else {
        value.to_string()
    }
}

/// Two decimals, as the board shows hours.
pub fn round_hours(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn normalize_activity_hours(value: f64) -> f64 {
    if !value.is_finite() {
        return MAX_ACTIVITY_HOURS;
    }
    round_hours(value).clamp(0.0, MAX_ACTIVITY_HOURS)
}

struct BoardResolver<'a> {
    read: &'a TaskManagerSnapshotReadDto,
}

impl<'a> BoardResolver<'a> {
    fn library(&self) -> &'a TaskManagerLibrarySnapshotDto {
        &self.read.snapshot
    }

    fn board(&self, name: &str) -> Result<&'a TaskBoardDto, BackendError> {
        let requested = name.trim();
        let boards = &self.library().boards;
        boards
            .iter()
            .find(|board| board.name == requested || board.board_id == requested)
            .or_else(|| {
                let normalized = normalize_name(requested);
                boards.iter().find(|board| {
                    normalize_name(&board.name) == normalized
                        || normalize_name(&board.board_id) == normalized
                })
            })
            .ok_or_else(|| not_found(format!("El tablero \"{requested}\" no existe.")))
    }

    fn board_exists(&self, name: &str) -> bool {
        let normalized = normalize_name(name);
        self.library()
            .boards
            .iter()
            .any(|board| normalize_name(&board.name) == normalized)
    }

    /// Group id by name inside a board; an empty name means "no group".
    fn group(&self, board_id: &str, name: &str) -> Result<Option<String>, BackendError> {
        let requested = name.trim();
        if requested.is_empty() {
            return Ok(None);
        }
        let normalized = normalize_name(requested);
        self.library()
            .groups
            .iter()
            .find(|group| {
                group.board_id == board_id
                    && (group.name == requested
                        || group.group_id == requested
                        || normalize_name(&group.name) == normalized)
            })
            .map(|group| Some(group.group_id.clone()))
            .ok_or_else(|| {
                not_found(format!(
                    "El grupo \"{requested}\" no existe en el tablero solicitado."
                ))
            })
    }

    fn ticket(&self, task_path: &str) -> Result<&'a TaskTicketDto, BackendError> {
        let requested = normalize_path(task_path);
        if requested.is_empty() {
            return Err(invalid("Falta la ruta de la tarea."));
        }
        let mut ids = self
            .read
            .routes
            .iter()
            .filter(|route| route.entity_type == "ticket")
            .filter(|route| paths_match(&normalize_path(&route.logical_path), &requested))
            .map(|route| route.entity_id.as_str())
            .collect::<HashSet<_>>();
        ids.extend(
            self.library()
                .tickets
                .iter()
                .filter(|ticket| {
                    paths_match(&normalize_path(&ticket.summary.logical_path), &requested)
                })
                .map(|ticket| ticket.summary.ticket_id.as_str()),
        );
        if ids.len() > 1 {
            return Err(conflict("La ruta de la tarea es ambigua."));
        }
        let id = ids
            .into_iter()
            .next()
            .ok_or_else(|| not_found("La tarea ya no existe o no está disponible."))?;
        self.library()
            .tickets
            .iter()
            .find(|ticket| ticket.summary.ticket_id == id)
            .ok_or_else(|| not_found("La tarea ya no existe o no está disponible."))
    }

    /// Parent ticket by title or file name (`[[name]]` accepted); an empty
    /// reference clears the parent.
    fn parent(
        &self,
        reference: &str,
        current_ticket_id: Option<&str>,
    ) -> Result<Option<String>, BackendError> {
        let reference = reference.trim();
        let reference = reference
            .strip_prefix("[[")
            .and_then(|value| value.strip_suffix("]]"))
            .unwrap_or(reference);
        let normalized = normalize_name(reference);
        if normalized.is_empty() {
            return Ok(None);
        }
        let file_suffix = format!("/{normalized}.md");
        self.library()
            .tickets
            .iter()
            .filter(|ticket| Some(ticket.summary.ticket_id.as_str()) != current_ticket_id)
            .find(|ticket| {
                normalize_name(&ticket.summary.title) == normalized
                    || normalize_path(&ticket.summary.logical_path).ends_with(&file_suffix)
            })
            .map(|ticket| Some(ticket.summary.ticket_id.clone()))
            .ok_or_else(|| not_found("La tarea padre no existe."))
    }

    fn group_name_taken(&self, board_id: &str, name: &str, except: Option<&str>) -> bool {
        self.library().groups.iter().any(|group| {
            group.board_id == board_id && group.name == name && Some(group.group_id.as_str()) != except
        })
    }
}

fn schedule_fields(
    end_date: &str,
    dynamic_end_date: bool,
    estimated_hours: f64,
) -> Result<TaskUpdateFieldsDto, BackendError> {
    if !estimated_hours.is_finite() || estimated_hours < 0.0 {
        return Err(invalid("La estimación de la tarea no es válida."));
    }
    Ok(TaskUpdateFieldsDto {
        end_date: Some(end_date.trim().to_string()),
        dynamic_end_date: Some(dynamic_end_date),
        estimated_hours: Some(estimated_hours),
        ..TaskUpdateFieldsDto::default()
    })
}

fn update(ticket_id: &str, fields: TaskUpdateFieldsDto) -> TaskMutationDto {
    TaskMutationDto::UpdateTicket {
        ticket_id: ticket_id.to_string(),
        fields,
    }
}

/// Resolves an intent against the snapshot the person was looking at. The
/// store still validates each mutation against its current revisions.
/// `new_id` supplies backend identifiers and `now_unix_ms` stamps comments.
pub fn resolve_board_intent(
    read: &TaskManagerSnapshotReadDto,
    intent: &TaskBoardIntent,
    new_id: &mut dyn FnMut() -> String,
    now_unix_ms: i64,
) -> Result<Vec<TaskMutationDto>, BackendError> {
    let resolver = BoardResolver { read };
    let mutations = match intent {
        TaskBoardIntent::CreateTask {
            board,
            title,
            detail,
            group,
            priority,
            state,
            parent_task_name,
            end_date,
            dynamic_end_date,
            estimated_hours,
        } => {
            let board = resolver.board(board)?;
            let mut initial_fields = schedule_fields(end_date, *dynamic_end_date, *estimated_hours)?;
            initial_fields.context = Some(
                board
                    .context
                    .clone()
                    .unwrap_or_else(|| DEFAULT_CONTEXT_TAG.to_string()),
            );
            vec![TaskMutationDto::CreateTicket {
                board_id: board.board_id.clone(),
                ticket_id: new_id(),
                group_id: resolver.group(&board.board_id, group)?,
                title: title.trim().to_string(),
                content: detail.clone(),
                state: *state,
                priority: priority.unwrap_or(TaskPriority::Medium),
                parent_ticket_id: resolver.parent(parent_task_name, None)?,
                tags: Vec::new(),
                initial_fields: Some(initial_fields),
            }]
        }
        TaskBoardIntent::EditTask {
            task_path,
            title,
            detail,
            state,
            priority,
            group,
            end_date,
            dynamic_end_date,
            estimated_hours,
            parent_task_name,
        } => {
            let ticket = resolver.ticket(task_path)?;
            let ticket_id = ticket.summary.ticket_id.as_str();
            let title = title.trim();
            if title.is_empty() {
                return Err(invalid("El título de la tarea no es válido."));
            }
            let mut fields = schedule_fields(end_date, *dynamic_end_date, *estimated_hours)?;
            fields.title = Some(title.to_string());
            fields.content = Some(detail.clone());
            fields.state = Some(*state);
            fields.priority = *priority;
            fields.group_id = resolver.group(&ticket.summary.board_id, group)?;
            fields.parent_ticket_id = Some(resolver.parent(parent_task_name, Some(ticket_id))?);
            vec![update(ticket_id, fields)]
        }
        TaskBoardIntent::ChangeState { task_path, state } => vec![TaskMutationDto::ChangeState {
            ticket_id: resolver.ticket(task_path)?.summary.ticket_id.clone(),
            state: *state,
        }],
        TaskBoardIntent::ChangePriority {
            task_path,
            priority,
        } => vec![TaskMutationDto::ChangePriority {
            ticket_id: resolver.ticket(task_path)?.summary.ticket_id.clone(),
            priority: *priority,
        }],
        TaskBoardIntent::SetDedicatedHours { task_path, hours } => {
            if !hours.is_finite() {
                return Err(invalid("Las horas dedicadas no son válidas."));
            }
            let ticket = resolver.ticket(task_path)?;
            vec![update(
                &ticket.summary.ticket_id,
                TaskUpdateFieldsDto {
                    dedicated_hours: Some(round_hours(hours.max(0.0))),
                    ..TaskUpdateFieldsDto::default()
                },
            )]
        }
        TaskBoardIntent::MarkUrgent { task_path } => {
            let ticket = resolver.ticket(task_path)?;
            let state = if ticket.summary.state == TaskState::Pending {
                TaskState::InProgress
            } else {
                ticket.summary.state
            };
            vec![update(
                &ticket.summary.ticket_id,
                TaskUpdateFieldsDto {
                    priority: Some(TaskPriority::Urgent),
                    state: Some(state),
                    ..TaskUpdateFieldsDto::default()
                },
            )]
        }
        TaskBoardIntent::DeleteTask { task_path } => vec![TaskMutationDto::DeleteTicket {
            ticket_id: resolver.ticket(task_path)?.summary.ticket_id.clone(),
        }],
        TaskBoardIntent::AddComment { task_path, comment } => {
            let body = comment.trim();
            if body.is_empty() {
                return Ok(Vec::new());
            }
            vec![TaskMutationDto::AddComment {
                ticket_id: resolver.ticket(task_path)?.summary.ticket_id.clone(),
                comment_id: new_id(),
                body: body.to_string(),
                created_at_unix_ms: now_unix_ms,
            }]
        }
        TaskBoardIntent::PlaceTask {
            task_path,
            ordered_paths,
            group,
            parent_task_name,
        } => place_task(&resolver, task_path, ordered_paths, group, parent_task_name)?,
        TaskBoardIntent::CreateBoard {
            name,
            color,
            activity_hours_per_day,
            contexto,
        } => {
            let name = sanitize_board_name(name);
            if name.is_empty() {
                return Err(invalid("El tablero necesita un nombre válido."));
            }
            if resolver.board_exists(&name) {
                return Err(conflict(format!("Ya existe un tablero llamado \"{name}\".")));
            }
            vec![TaskMutationDto::CreateBoard {
                board_id: name.clone(),
                name,
                color: board_color(color),
                context: Some(
                    normalize_context_tag(contexto)
                        .unwrap_or_else(|| DEFAULT_CONTEXT_TAG.to_string()),
                ),
                activity_hours_per_day: Some(normalize_activity_hours(*activity_hours_per_day)),
            }]
        }
        TaskBoardIntent::UpdateBoard {
            previous_name,
            name,
            color,
            activity_hours_per_day,
            contexto,
        } => {
            let board = resolver.board(previous_name)?;
            let requested_name = sanitize_board_name(name);
            if requested_name.is_empty() {
                return Err(invalid("El tablero necesita un nombre válido."));
            }
            // The default board keeps its name and color.
            let is_default = board.name == DEFAULT_BOARD_NAME;
            let next_name = if is_default {
                board.name.clone()
            } else {
                requested_name
            };
            let next_color = if is_default {
                board.color.clone()
            } else {
                board_color(color)
            };
            if next_name != board.name && resolver.board_exists(&next_name) {
                return Err(conflict(format!(
                    "Ya existe un tablero llamado \"{next_name}\"."
                )));
            }
            vec![TaskMutationDto::UpdateBoard {
                board_id: board.board_id.clone(),
                name: (next_name != board.name).then_some(next_name),
                color: (next_color != board.color).then_some(next_color),
                context: Some(
                    normalize_context_tag(contexto)
                        .unwrap_or_else(|| DEFAULT_CONTEXT_TAG.to_string()),
                ),
                activity_hours_per_day: Some(normalize_activity_hours(*activity_hours_per_day)),
            }]
        }
        TaskBoardIntent::DeleteBoard { name } => {
            let board = resolver.board(name)?;
            if board.name == DEFAULT_BOARD_NAME {
                return Err(invalid("El tablero principal no se puede eliminar."));
            }
            vec![TaskMutationDto::DeleteBoard {
                board_id: board.board_id.clone(),
            }]
        }
        TaskBoardIntent::CreateGroup { board, name, color } => {
            let name = name.trim();
            if name.is_empty() {
                return Err(invalid("El grupo necesita un nombre válido."));
            }
            let board = resolver.board(if board.trim().is_empty() {
                DEFAULT_BOARD_NAME
            } else {
                board
            })?;
            if resolver.group_name_taken(&board.board_id, name, None) {
                return Err(conflict(format!(
                    "Ya existe un grupo llamado \"{name}\" en \"{}\".",
                    board.name
                )));
            }
            vec![TaskMutationDto::CreateGroup {
                board_id: board.board_id.clone(),
                group_id: new_id(),
                name: name.to_string(),
                color: board_color(color),
            }]
        }
        TaskBoardIntent::UpdateGroup {
            previous_board,
            previous_name,
            name,
            color,
        } => {
            let name = name.trim();
            if name.is_empty() {
                return Err(invalid("El grupo necesita un nombre válido."));
            }
            let board = resolver.board(previous_board)?;
            let group_id = resolver
                .group(&board.board_id, previous_name)?
                .ok_or_else(|| not_found("El grupo solicitado no existe."))?;
            if resolver.group_name_taken(&board.board_id, name, Some(&group_id)) {
                return Err(conflict(format!(
                    "Ya existe un grupo llamado \"{name}\" en \"{}\".",
                    board.name
                )));
            }
            vec![TaskMutationDto::UpdateGroup {
                board_id: board.board_id.clone(),
                group_id,
                name: name.to_string(),
                color: board_color(color),
            }]
        }
        TaskBoardIntent::DeleteGroup { board, name } => {
            let board = resolver.board(board)?;
            let group_id = resolver
                .group(&board.board_id, name)?
                .ok_or_else(|| not_found("El grupo solicitado no existe."))?;
            vec![TaskMutationDto::DeleteGroup {
                board_id: board.board_id.clone(),
                group_id,
            }]
        }
        TaskBoardIntent::ReorderGroups { board, group_names } => {
            let board = resolver.board(board)?;
            let mut seen = HashSet::new();
            let mut group_ids = Vec::new();
            for name in group_names.iter().map(|name| name.trim()) {
                if name.is_empty() || !seen.insert(name.to_string()) {
                    continue;
                }
                if let Ok(Some(group_id)) = resolver.group(&board.board_id, name) {
                    group_ids.push(group_id);
                }
            }
            let current = resolver
                .library()
                .groups
                .iter()
                .filter(|group| group.board_id == board.board_id)
                .map(|group| group.group_id.clone())
                .collect::<Vec<_>>();
            if group_ids.is_empty() || current.starts_with(&group_ids) {
                return Ok(Vec::new());
            }
            vec![TaskMutationDto::ReorderGroups {
                board_id: board.board_id.clone(),
                group_ids,
            }]
        }
    };
    Ok(mutations)
}

/// New order of the moved task between its neighbours, or a renumbering of
/// the whole list when there is no room left between them.
fn place_task(
    resolver: &BoardResolver<'_>,
    task_path: &str,
    ordered_paths: &[String],
    group: &str,
    parent_task_name: &str,
) -> Result<Vec<TaskMutationDto>, BackendError> {
    if ordered_paths.len() > MAX_ARRANGEMENT_UPDATES {
        return Err(invalid("La reorganización supera el límite de tareas."));
    }
    let moved = normalize_path(task_path);
    let moved_index = ordered_paths
        .iter()
        .position(|path| normalize_path(path) == moved)
        .ok_or_else(|| invalid("La tarea movida no está en la lista de destino."))?;
    let orders = ordered_paths
        .iter()
        .map(|path| resolver.ticket(path).map(|ticket| ticket.order))
        .collect::<Result<Vec<_>, _>>()?;
    let previous = moved_index.checked_sub(1).map(|index| orders[index]);
    let next = orders.get(moved_index + 1).copied();
    let single_order = match (previous, next) {
        (None, None) => Some(ORDER_STEP),
        (None, Some(next)) if next.is_finite() => Some(next - ORDER_STEP),
        (Some(previous), None) if previous.is_finite() => Some(previous + ORDER_STEP),
        (Some(previous), Some(next))
            if previous.is_finite() && next.is_finite() && previous < next =>
        {
            let middle = (previous + next) / 2.0;
            (middle != previous && middle != next).then_some(middle)
        }
        _ => None,
    };
    let arrangement = |path: &str, order: f64| TaskArrangementDto {
        task_path: path.to_string(),
        order,
        group: Some(group.trim().to_string()),
        parent_task_name: Some(parent_task_name.trim().to_string()),
    };
    let updates = match single_order {
        Some(order) => vec![arrangement(task_path, order)],
        None => ordered_paths
            .iter()
            .enumerate()
            .map(|(index, path)| arrangement(path, (index as f64 + 1.0) * ORDER_STEP))
            .collect(),
    };
    arrange_tasks(resolver, &updates)
}

/// Keeps the last update of each ticket and only the ones that change its
/// order, group or parent.
fn arrange_tasks(
    resolver: &BoardResolver<'_>,
    updates: &[TaskArrangementDto],
) -> Result<Vec<TaskMutationDto>, BackendError> {
    if updates.len() > MAX_ARRANGEMENT_UPDATES {
        return Err(invalid("La reorganización supera el límite de tareas."));
    }
    let mut latest = Vec::<(String, &TaskArrangementDto)>::new();
    for update in updates {
        let key = normalize_path(&update.task_path);
        if key.is_empty() {
            continue;
        }
        latest.retain(|(existing, _)| existing != &key);
        latest.push((key, update));
    }

    let library = resolver.library();
    let group_names = library
        .groups
        .iter()
        .map(|group| (group.group_id.as_str(), group.name.as_str()))
        .collect::<HashMap<_, _>>();
    let file_names = library
        .tickets
        .iter()
        .map(|ticket| {
            (
                ticket.summary.ticket_id.as_str(),
                file_name_of(&ticket.summary.logical_path),
            )
        })
        .collect::<HashMap<_, _>>();

    let mut mutations = Vec::new();
    for (_, arrangement) in latest {
        let ticket = resolver.ticket(&arrangement.task_path)?;
        let order = if arrangement.order.is_finite() {
            arrangement.order
        } else {
            UNARRANGED_ORDER
        };
        let current_group = ticket
            .summary
            .group_id
            .as_deref()
            .and_then(|id| group_names.get(id).copied())
            .unwrap_or_default();
        let current_parent = ticket
            .summary
            .parent_ticket_id
            .as_deref()
            .and_then(|id| file_names.get(id).cloned())
            .unwrap_or_default();
        let parent = arrangement.parent_task_name.as_deref().map(str::trim);
        let group_changed = arrangement
            .group
            .as_deref()
            .is_some_and(|group| group != current_group);
        let parent_changed = parent.is_some_and(|parent| parent != current_parent);
        if ticket.order == order && !group_changed && !parent_changed {
            continue;
        }
        let mut fields = TaskUpdateFieldsDto {
            order: Some(order),
            ..TaskUpdateFieldsDto::default()
        };
        if let Some(group) = arrangement.group.as_deref() {
            fields.group_id = resolver.group(&ticket.summary.board_id, group)?;
        }
        if let Some(parent) = parent {
            fields.parent_ticket_id =
                Some(resolver.parent(parent, Some(&ticket.summary.ticket_id))?);
        }
        mutations.push(update(&ticket.summary.ticket_id, fields));
    }
    Ok(mutations)
}

// ---------------------------------------------------------------------------
// Pomodoro
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PomodoroPhase {
    Work,
    ShortBreak,
    LongBreak,
}

impl PomodoroPhase {
    fn label(self) -> &'static str {
        match self {
            Self::Work => "Trabajo",
            Self::ShortBreak => "Descanso corto",
            Self::LongBreak => "Descanso largo",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroDurationsDto {
    pub work_minutes: f64,
    pub short_break_minutes: f64,
    pub long_break_minutes: f64,
}

impl PomodoroDurationsDto {
    fn validate(&self) -> Result<(), BackendError> {
        let valid = |value: f64| value.is_finite() && (0.0..=24.0 * 60.0).contains(&value);
        if valid(self.work_minutes) && valid(self.short_break_minutes) && valid(self.long_break_minutes) {
            Ok(())
        } else {
            Err(invalid("La duración del pomodoro no es válida."))
        }
    }

    fn minutes(&self, phase: PomodoroPhase) -> f64 {
        match phase {
            PomodoroPhase::Work => self.work_minutes,
            PomodoroPhase::ShortBreak => self.short_break_minutes,
            PomodoroPhase::LongBreak => self.long_break_minutes,
        }
    }

    fn choice(&self) -> String {
        format!(
            "{}/{}/{}",
            self.work_minutes, self.short_break_minutes, self.long_break_minutes
        )
    }
}

/// What the Pomodoro timer reports. The timer itself runs in the device;
/// the backend decides what is logged and what the task accumulates.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PomodoroEvent {
    /// One or more phases ran to completion; the accumulated deviation of
    /// the phase is charged to the last one.
    PhasesCompleted {
        phases: Vec<PomodoroPhase>,
        deviation_seconds: f64,
    },
    /// The person reset the timer in the middle of a phase or a deviation.
    Reset {
        phase: PomodoroPhase,
        elapsed_seconds: f64,
        deviation_seconds: f64,
        in_deviation: bool,
    },
    /// The person came back from a deviation; `completed_work` when the
    /// work phase finished while away.
    DeviationEnded {
        elapsed_seconds: f64,
        completed_work: bool,
    },
}

/// Log rows and task hours produced by a Pomodoro event.
#[derive(Debug, Clone, PartialEq)]
pub struct PomodoroRecordPlan {
    pub entries: Vec<PomodoroEntryInput>,
    pub worked_hours: f64,
    pub deviation_hours: f64,
}

fn seconds(value: f64) -> Result<f64, BackendError> {
    if value.is_finite() && (0.0..=7.0 * 24.0 * 3600.0).contains(&value) {
        Ok(value)
    } else {
        Err(invalid("El tiempo del pomodoro no es válido."))
    }
}

pub fn plan_pomodoro_record(
    event: &PomodoroEvent,
    durations: &PomodoroDurationsDto,
    task_title: Option<&str>,
) -> Result<PomodoroRecordPlan, BackendError> {
    durations.validate()?;
    let task = task_title.unwrap_or("-").to_string();
    let entry = |kind: &str, duration_minutes: f64, deviation_hours: f64, finalized: bool| {
        PomodoroEntryInput {
            kind: kind.to_string(),
            duration_choice: durations.choice(),
            task: task.clone(),
            duration_minutes,
            deviation_hours,
            finalized,
        }
    };
    let plan = match event {
        PomodoroEvent::PhasesCompleted {
            phases,
            deviation_seconds,
        } => {
            let deviation_hours = round_hours(seconds(*deviation_seconds)? / 3600.0);
            let last = phases.len().saturating_sub(1);
            let entries = phases
                .iter()
                .enumerate()
                .map(|(index, phase)| {
                    entry(
                        phase.label(),
                        durations.minutes(*phase),
                        if index == last { deviation_hours } else { 0.0 },
                        true,
                    )
                })
                .collect();
            let work_cycles = phases
                .iter()
                .filter(|phase| **phase == PomodoroPhase::Work)
                .count() as f64;
            PomodoroRecordPlan {
                entries,
                worked_hours: round_hours(work_cycles * durations.work_minutes / 60.0),
                deviation_hours,
            }
        }
        PomodoroEvent::Reset {
            phase,
            elapsed_seconds,
            deviation_seconds,
            in_deviation,
        } => {
            let elapsed = seconds(*elapsed_seconds)?;
            let deviation_seconds = seconds(*deviation_seconds)?
                + if *in_deviation { elapsed } else { 0.0 };
            let deviation_hours = round_hours(deviation_seconds / 3600.0);
            if elapsed <= 0.0 && deviation_hours <= 0.0 {
                return Ok(PomodoroRecordPlan {
                    entries: Vec::new(),
                    worked_hours: 0.0,
                    deviation_hours: 0.0,
                });
            }
            let worked_hours = if *phase == PomodoroPhase::Work && !*in_deviation {
                round_hours(elapsed / 3600.0)
            } else {
                0.0
            };
            PomodoroRecordPlan {
                entries: vec![entry(
                    phase.label(),
                    round_hours(elapsed / 60.0),
                    deviation_hours,
                    false,
                )],
                worked_hours,
                deviation_hours,
            }
        }
        PomodoroEvent::DeviationEnded {
            elapsed_seconds,
            completed_work,
        } => {
            let elapsed = seconds(*elapsed_seconds)?;
            let deviation_hours = round_hours(elapsed / 3600.0);
            if *completed_work {
                PomodoroRecordPlan {
                    entries: vec![entry(
                        PomodoroPhase::Work.label(),
                        durations.work_minutes,
                        deviation_hours,
                        true,
                    )],
                    worked_hours: round_hours(durations.work_minutes / 60.0),
                    deviation_hours,
                }
            } else {
                PomodoroRecordPlan {
                    entries: vec![entry(
                        "Desvío parcial",
                        round_hours(elapsed / 60.0),
                        deviation_hours,
                        false,
                    )],
                    worked_hours: 0.0,
                    deviation_hours,
                }
            }
        }
    };
    Ok(plan)
}

/// Adds the planned hours to the ticket's current totals.
pub fn pomodoro_hours_update(
    ticket: &TaskTicketDto,
    plan: &PomodoroRecordPlan,
) -> Option<TaskMutationDto> {
    if plan.worked_hours <= 0.0 && plan.deviation_hours <= 0.0 {
        return None;
    }
    let mut fields = TaskUpdateFieldsDto::default();
    if plan.worked_hours > 0.0 {
        fields.dedicated_hours = Some(round_hours(ticket.dedicated_hours + plan.worked_hours));
    }
    if plan.deviation_hours > 0.0 {
        fields.deviation_hours = Some(round_hours(ticket.deviation_hours + plan.deviation_hours));
    }
    Some(update(&ticket.summary.ticket_id, fields))
}

/// Ticket of a Pomodoro selection, if it still exists.
pub fn pomodoro_ticket<'a>(
    read: &'a TaskManagerSnapshotReadDto,
    task_path: Option<&str>,
) -> Option<&'a TaskTicketDto> {
    let task_path = task_path.map(str::trim).filter(|path| !path.is_empty())?;
    BoardResolver { read }.ticket(task_path).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_manager_tools::{
        TaskDocumentRouteDto, TaskGroupDto, TaskManagerConfigDto, TaskManagerContextDto,
        TaskTicketSummaryDto, TASK_MANAGER_SNAPSHOT_READ_VERSION,
    };

    fn ticket(id: &str, title: &str, path: &str, board: &str) -> TaskTicketDto {
        TaskTicketDto {
            summary: TaskTicketSummaryDto {
                library_id: "lib".into(),
                ticket_id: id.into(),
                board_id: board.into(),
                group_id: None,
                title: title.into(),
                state: TaskState::Pending,
                priority: TaskPriority::Medium,
                parent_ticket_id: None,
                detail_preview: String::new(),
                revision: 1,
                logical_path: path.into(),
            },
            content: String::new(),
            tags: Vec::new(),
            dependencies: Vec::new(),
            checklist: Vec::new(),
            start_date: String::new(),
            end_date: String::new(),
            dynamic_end_date: true,
            dedicated_hours: 1.5,
            estimated_hours: 0.0,
            deviation_hours: 0.25,
            order: 10.0,
            context: None,
            related_documents: Vec::new(),
            related_tasks: Vec::new(),
        }
    }

    fn board(id: &str, context: Option<&str>) -> TaskBoardDto {
        TaskBoardDto {
            library_id: "lib".into(),
            board_id: id.into(),
            name: id.into(),
            color: "#123456".into(),
            context: context.map(str::to_string),
            revision: 1,
        }
    }

    fn read() -> TaskManagerSnapshotReadDto {
        let mut child = ticket("t2", "Hija", "task-mannager/work/subTasks/Hija.md", "work");
        child.summary.parent_ticket_id = Some("t1".into());
        child.summary.group_id = Some("g1".into());
        let mut done = ticket("t3", "Hecha", "task-mannager/finished/Hecha.md", "work");
        done.summary.state = TaskState::Completed;
        TaskManagerSnapshotReadDto {
            version: TASK_MANAGER_SNAPSHOT_READ_VERSION,
            context: TaskManagerContextDto {
                library_id: "lib".into(),
                library_user_id: "user-owner".into(),
                active_board_id: None,
                allowed_board_ids: Vec::new(),
            },
            snapshot: TaskManagerLibrarySnapshotDto {
                library_id: "lib".into(),
                users: Vec::new(),
                boards: vec![board("work", Some("#Laboral")), board("default", None)],
                groups: vec![TaskGroupDto {
                    library_id: "lib".into(),
                    group_id: "g1".into(),
                    board_id: "work".into(),
                    name: "Backend".into(),
                    color: "#654321".into(),
                    revision: 1,
                    order: 0,
                }],
                tickets: vec![
                    ticket("t1", "Madre", "task-mannager/work/Madre.md", "work"),
                    child,
                    done,
                ],
                comments: Vec::new(),
                generation: 7,
                config: TaskManagerConfigDto {
                    activity_hours_per_day: BTreeMap::from([("work".to_string(), 6.0)]),
                },
            },
            routes: vec![TaskDocumentRouteDto {
                entity_type: "ticket".into(),
                entity_id: "t1".into(),
                logical_path: "task-mannager/work/Madre.md".into(),
            }],
            revisions: Vec::new(),
        }
    }

    fn resolve(intent: TaskBoardIntent) -> Result<Vec<TaskMutationDto>, BackendError> {
        let mut counter = 0;
        resolve_board_intent(
            &read(),
            &intent,
            &mut || {
                counter += 1;
                format!("new-{counter}")
            },
            42,
        )
    }

    #[test]
    fn view_names_boards_groups_parents_and_panels() {
        let view = project_board_view(&read().snapshot, Vec::new());
        assert_eq!(view.generation, 7);
        assert_eq!(view.boards[0].name, "default");
        assert_eq!(view.boards[0].contexto, DEFAULT_CONTEXT_TAG);
        assert_eq!(view.boards[1].activity_hours_per_day, 6.0);
        assert_eq!(view.groups[0].board, "work");
        let child = view.tasks.iter().find(|task| task.id == "t2").unwrap();
        assert_eq!(child.parent_task_name, "Madre");
        assert_eq!(child.group, "Backend");
        assert_eq!(child.file_name, "Hija");
        assert_eq!(view.panel_paths[FINISHED_PANEL_ID], vec!["task-mannager/finished/Hecha.md"]);
        assert_eq!(view.panel_paths["work"].len(), 2);
    }

    #[test]
    fn create_task_resolves_board_group_parent_and_board_context() {
        let mutations = resolve(TaskBoardIntent::CreateTask {
            board: "WORK".into(),
            title: " Nueva ".into(),
            detail: "detalle".into(),
            group: "backend".into(),
            priority: None,
            state: TaskState::Pending,
            parent_task_name: "[[Madre]]".into(),
            end_date: "2026-10-01".into(),
            dynamic_end_date: false,
            estimated_hours: 3.0,
        })
        .unwrap();
        let TaskMutationDto::CreateTicket {
            board_id,
            ticket_id,
            group_id,
            title,
            priority,
            parent_ticket_id,
            initial_fields,
            ..
        } = &mutations[0]
        else {
            panic!("create ticket expected");
        };
        assert_eq!(board_id, "work");
        assert_eq!(ticket_id, "new-1");
        assert_eq!(group_id.as_deref(), Some("g1"));
        assert_eq!(title, "Nueva");
        assert_eq!(*priority, TaskPriority::Medium);
        assert_eq!(parent_ticket_id.as_deref(), Some("t1"));
        let fields = initial_fields.as_ref().unwrap();
        assert_eq!(fields.context.as_deref(), Some("#Laboral"));
        assert_eq!(fields.dynamic_end_date, Some(false));
    }

    #[test]
    fn unknown_group_and_ambiguous_paths_are_rejected() {
        assert!(resolve(TaskBoardIntent::CreateTask {
            board: "work".into(),
            title: "x".into(),
            detail: String::new(),
            group: "no existe".into(),
            priority: None,
            state: TaskState::Pending,
            parent_task_name: String::new(),
            end_date: String::new(),
            dynamic_end_date: true,
            estimated_hours: 0.0,
        })
        .is_err());
        let error = resolve(TaskBoardIntent::DeleteTask {
            task_path: "missing.md".into(),
        })
        .unwrap_err();
        assert_eq!(error.code, BackendErrorCode::NotFound);
    }

    #[test]
    fn mark_urgent_starts_pending_tasks() {
        let mutations = resolve(TaskBoardIntent::MarkUrgent {
            task_path: "work/Madre.md".into(),
        })
        .unwrap();
        let TaskMutationDto::UpdateTicket { fields, .. } = &mutations[0] else {
            panic!("update expected");
        };
        assert_eq!(fields.priority, Some(TaskPriority::Urgent));
        assert_eq!(fields.state, Some(TaskState::InProgress));
    }

    #[test]
    fn boards_are_sanitized_unique_and_the_default_keeps_its_identity() {
        let mutations = resolve(TaskBoardIntent::CreateBoard {
            name: " Mi/Tablero ".into(),
            color: String::new(),
            activity_hours_per_day: 30.0,
            contexto: "Laboral".into(),
        })
        .unwrap();
        assert_eq!(
            mutations[0],
            TaskMutationDto::CreateBoard {
                board_id: "mi-tablero".into(),
                name: "mi-tablero".into(),
                color: DEFAULT_BOARD_COLOR.into(),
                context: Some("#Laboral".into()),
                activity_hours_per_day: Some(24.0),
            }
        );
        assert_eq!(
            resolve(TaskBoardIntent::CreateBoard {
                name: "Work".into(),
                color: String::new(),
                activity_hours_per_day: 8.0,
                contexto: String::new(),
            })
            .unwrap_err()
            .code,
            BackendErrorCode::Conflict
        );
        let mutations = resolve(TaskBoardIntent::UpdateBoard {
            previous_name: "default".into(),
            name: "otro".into(),
            color: "#000000".into(),
            activity_hours_per_day: 8.0,
            contexto: String::new(),
        })
        .unwrap();
        let TaskMutationDto::UpdateBoard { name, color, .. } = &mutations[0] else {
            panic!("update board expected");
        };
        assert!(name.is_none() && color.is_none());
        assert!(resolve(TaskBoardIntent::DeleteBoard {
            name: "default".into()
        })
        .is_err());
    }

    #[test]
    fn placing_a_task_takes_the_gap_or_renumbers() {
        // Hija (order 10) dropped before Madre (order 10): no gap left.
        let mutations = resolve(TaskBoardIntent::PlaceTask {
            task_path: "task-mannager/work/subTasks/Hija.md".into(),
            ordered_paths: vec![
                "task-mannager/work/subTasks/Hija.md".into(),
                "task-mannager/work/Madre.md".into(),
            ],
            group: "Backend".into(),
            parent_task_name: String::new(),
        })
        .unwrap();
        let TaskMutationDto::UpdateTicket { ticket_id, fields } = &mutations[0] else {
            panic!("update expected");
        };
        assert_eq!(ticket_id, "t2");
        assert_eq!(fields.order, Some(0.0));
        assert_eq!(fields.group_id, Some("g1".to_string()));
        assert_eq!(fields.parent_ticket_id, Some(None));

        // Dropped alone into an empty column.
        let mutations = resolve(TaskBoardIntent::PlaceTask {
            task_path: "task-mannager/work/Madre.md".into(),
            ordered_paths: vec!["task-mannager/work/Madre.md".into()],
            group: String::new(),
            parent_task_name: String::new(),
        })
        .unwrap();
        assert!(mutations.is_empty(), "same order, group and parent: nothing to write");

        assert!(resolve(TaskBoardIntent::PlaceTask {
            task_path: "task-mannager/work/Madre.md".into(),
            ordered_paths: vec!["task-mannager/work/subTasks/Hija.md".into()],
            group: String::new(),
            parent_task_name: String::new(),
        })
        .is_err());
    }

    #[test]
    fn pomodoro_plans_log_rows_and_task_hours() {
        let durations = PomodoroDurationsDto {
            work_minutes: 25.0,
            short_break_minutes: 5.0,
            long_break_minutes: 15.0,
        };
        let plan = plan_pomodoro_record(
            &PomodoroEvent::PhasesCompleted {
                phases: vec![PomodoroPhase::Work, PomodoroPhase::ShortBreak],
                deviation_seconds: 900.0,
            },
            &durations,
            Some("Madre"),
        )
        .unwrap();
        assert_eq!(plan.entries.len(), 2);
        assert_eq!(plan.entries[0].kind, "Trabajo");
        assert_eq!(plan.entries[0].deviation_hours, 0.0);
        assert_eq!(plan.entries[1].deviation_hours, 0.25);
        assert_eq!(plan.entries[0].duration_choice, "25/5/15");
        assert_eq!(plan.worked_hours, 0.42);
        let read = read();
        let ticket = pomodoro_ticket(&read, Some("task-mannager/work/Madre.md")).unwrap();
        let Some(TaskMutationDto::UpdateTicket { fields, .. }) = pomodoro_hours_update(ticket, &plan)
        else {
            panic!("hours update expected");
        };
        assert_eq!(fields.dedicated_hours, Some(1.92));
        assert_eq!(fields.deviation_hours, Some(0.5));

        let reset = plan_pomodoro_record(
            &PomodoroEvent::Reset {
                phase: PomodoroPhase::Work,
                elapsed_seconds: 0.0,
                deviation_seconds: 0.0,
                in_deviation: false,
            },
            &durations,
            None,
        )
        .unwrap();
        assert!(reset.entries.is_empty());
        let partial = plan_pomodoro_record(
            &PomodoroEvent::DeviationEnded {
                elapsed_seconds: 600.0,
                completed_work: false,
            },
            &durations,
            None,
        )
        .unwrap();
        assert_eq!(partial.entries[0].kind, "Desvío parcial");
        assert_eq!(partial.entries[0].task, "-");
        assert_eq!(partial.worked_hours, 0.0);
    }
}
