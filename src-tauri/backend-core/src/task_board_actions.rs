//! Card actions of the Task Manager board and the rules they follow:
//! the running time of a task, undo of finish/cancel/delete, the
//! «Bloqueado» column, duplicates with their subtasks, projects and people
//! of the board, subtasks and dependencies without cycles.
//!
//! [`resolve_board_actions`] turns an intent into the mutations the store
//! validates and applies; the interface only sends the intent.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::error::BackendError;
use crate::task_planner::creates_cycle;
use crate::task_board_plan::{fold, next_palette_color, TaskBoardMemberDto, TaskBoardProjectDto, BOARD_PALETTE};
use crate::task_manager_tools::{
    TaskBoardPlanDto, TaskColumnKind, TaskManagerLibrarySnapshotDto, TaskMutationDto, TaskPriority, TaskState,
    TaskTicketDto, TaskUpdateFieldsDto, MAX_TASK_ORDER, MAX_TASK_TAGS,
};
use crate::task_manager_ui::{
    activity_hours, conflict, invalid, round_hours, BoardResolver, TaskBoardIntent, ORDER_STEP,
};

/// How long an undo token stays valid, in milliseconds.
pub const UNDO_WINDOW_MS: i64 = 5_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BoardUndoKind {
    Finish,
    Cancel,
    Delete,
}

/// Mutations that put a finished, cancelled or deleted task back.
#[derive(Debug, Clone, PartialEq)]
pub struct BoardUndoPlan {
    pub kind: BoardUndoKind,
    pub title: String,
    pub mutations: Vec<TaskMutationDto>,
}

/// What an intent produces.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct BoardIntentOutcome {
    pub mutations: Vec<TaskMutationDto>,
    pub undo: Option<BoardUndoPlan>,
    /// Ticket the board highlights (created, duplicated or moved).
    pub focus_ticket_id: Option<String>,
}

impl BoardIntentOutcome {
    fn of(mutations: Vec<TaskMutationDto>) -> Self {
        Self { mutations, ..Self::default() }
    }
}

/// Names the board view and the actions need about who is looking.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BoardViewer {
    /// Display name of the person looking at the board.
    pub name: Option<String>,
    /// Display name of the library Owner, who owns every board.
    pub owner_name: Option<String>,
    /// Local date, for the sprint and division hints.
    pub today: Option<jiff::civil::Date>,
}

// ---------------------------------------------------------------------------
// Board calendar, people and projects
// ---------------------------------------------------------------------------

/// Workday, sprints and divisions of a board: the saved ones, or the
/// defaults with the board's activity hours.
pub fn board_plan(snapshot: &TaskManagerLibrarySnapshotDto, board_id: &str) -> TaskBoardPlanDto {
    snapshot
        .config
        .boards
        .get(board_id)
        .and_then(|config| config.plan.clone())
        .unwrap_or_else(|| {
            let hours = snapshot
                .boards
                .iter()
                .find(|board| board.board_id == board_id)
                .map(|board| activity_hours(snapshot, board))
                .unwrap_or(24.0);
            TaskBoardPlanDto::from_activity_hours(hours)
        })
}

/// People of a board. A board that never saved them has its owner and the
/// people its tickets are assigned to, colored in palette order.
pub fn board_members(
    snapshot: &TaskManagerLibrarySnapshotDto,
    board_id: &str,
    owner_name: Option<&str>,
) -> Vec<TaskBoardMemberDto> {
    if let Some(members) = snapshot.config.boards.get(board_id).and_then(|config| config.members.clone()) {
        return members;
    }
    let mut members = Vec::<TaskBoardMemberDto>::new();
    if let Some(owner) = owner_name.map(str::trim).filter(|name| !name.is_empty()) {
        members.push(TaskBoardMemberDto { name: owner.to_string(), color: BOARD_PALETTE[0].to_string(), is_owner: true });
    }
    let mut names = snapshot
        .tickets
        .iter()
        .filter(|ticket| ticket.summary.board_id == board_id)
        .flat_map(|ticket| ticket.assignees.iter().cloned())
        .collect::<Vec<_>>();
    names.sort_by_key(|name| fold(name));
    for name in names {
        if !members.iter().any(|member| fold(&member.name) == fold(&name)) {
            let color = BOARD_PALETTE[members.len() % BOARD_PALETTE.len()].to_string();
            members.push(TaskBoardMemberDto { name, color, is_owner: false });
        }
    }
    members
}

/// Projects of a board. A board that never saved them has the projects of
/// its tickets.
pub fn board_projects(snapshot: &TaskManagerLibrarySnapshotDto, board_id: &str) -> Vec<TaskBoardProjectDto> {
    if let Some(projects) = snapshot.config.boards.get(board_id).and_then(|config| config.projects.clone()) {
        return projects;
    }
    let mut names = snapshot
        .tickets
        .iter()
        .filter(|ticket| ticket.summary.board_id == board_id)
        .filter_map(|ticket| ticket.project.clone())
        .collect::<Vec<_>>();
    names.sort_by_key(|name| fold(name));
    let mut projects = Vec::<TaskBoardProjectDto>::new();
    for name in names {
        if !projects.iter().any(|project| fold(&project.name) == fold(&name)) {
            let color = next_palette_color(projects.iter().map(|project| project.color.as_str()));
            projects.push(TaskBoardProjectDto { name, color });
        }
    }
    projects
}

/// Color the next person of a board gets: the palette in rotation.
pub fn next_member_color(members: &[TaskBoardMemberDto]) -> String {
    BOARD_PALETTE[members.len() % BOARD_PALETTE.len()].to_string()
}

/// Color the next project gets: the first one no project uses.
pub fn next_project_color(projects: &[TaskBoardProjectDto]) -> String {
    next_palette_color(projects.iter().map(|project| project.color.as_str()))
}

/// Initials a person shows on an avatar: the first letter of the first two
/// words, or the first two letters of a single word.
pub fn initials(name: &str) -> String {
    let words = name.split_whitespace().collect::<Vec<_>>();
    let letters = match words.as_slice() {
        [] => String::new(),
        [single] => single.chars().take(2).collect(),
        [first, second, ..] => first.chars().take(1).chain(second.chars().take(1)).collect(),
    };
    letters.to_uppercase()
}

/// What the planner needs about one board: its open root tasks in column
/// order, its calendar and its people, at the device's local `now`.
pub fn planner_input(
    snapshot: &TaskManagerLibrarySnapshotDto,
    board_name: &str,
    now: jiff::civil::DateTime,
    now_ms: i64,
    viewer: &BoardViewer,
) -> Result<crate::task_planner::PlannerInput, BackendError> {
    let board = snapshot
        .boards
        .iter()
        .find(|board| board.name == board_name || fold(&board.name) == fold(board_name))
        .ok_or_else(|| crate::task_manager_ui::not_found(format!("El tablero «{board_name}» no existe.")))?;
    let mut groups = snapshot.groups.iter().filter(|group| group.board_id == board.board_id).collect::<Vec<_>>();
    groups.sort_by_key(|group| group.order);
    let mut tasks = Vec::new();
    for group in groups {
        let mut column = snapshot
            .tickets
            .iter()
            .filter(|ticket| {
                ticket.summary.board_id == board.board_id
                    && ticket.summary.parent_ticket_id.is_none()
                    && ticket.summary.group_id.as_deref() == Some(group.group_id.as_str())
                    && !matches!(ticket.summary.state, TaskState::Completed | TaskState::Cancelled)
            })
            .collect::<Vec<_>>();
        column.sort_by(|left, right| left.order.total_cmp(&right.order).then_with(|| left.summary.title.cmp(&right.summary.title)));
        for ticket in column {
            tasks.push(crate::task_planner::PlannerTask {
                id: ticket.summary.ticket_id.clone(),
                task_path: ticket.summary.logical_path.clone(),
                title: ticket.summary.title.clone(),
                column_kind: group.column_kind(),
                column_name: group.name.clone(),
                column_color: group.color.clone(),
                priority: ticket.summary.priority,
                in_progress: ticket.summary.state == TaskState::InProgress,
                blocked: ticket.summary.state == TaskState::Blocked,
                estimate_hours: (ticket.estimated_hours > 0.0).then_some(ticket.estimated_hours),
                spent_hours: live_dedicated_hours(ticket, now_ms),
                people: ticket.assignees.clone(),
                depends_on: ticket.dependencies.clone(),
            });
        }
    }
    Ok(crate::task_planner::PlannerInput {
        tasks,
        plan: board_plan(snapshot, &board.board_id),
        now,
        members: board_members(snapshot, &board.board_id, viewer.owner_name.as_deref()),
        viewer: viewer.name.clone(),
    })
}

// ---------------------------------------------------------------------------
// Running time
// ---------------------------------------------------------------------------

/// Dedicated hours of a ticket, counting the time it has been running.
pub fn live_dedicated_hours(ticket: &TaskTicketDto, now_ms: i64) -> f64 {
    match (ticket.summary.state, ticket.started_at_unix_ms) {
        (TaskState::InProgress, Some(started)) => {
            round_hours(ticket.dedicated_hours + (now_ms - started).max(0) as f64 / 3_600_000.0)
        }
        _ => ticket.dedicated_hours,
    }
}

/// Fields that take a ticket to `state` at `now_ms`: starting sets the
/// running time; any other state adds it to the dedicated hours. Finishing
/// and cancelling stamp the closing date; reopening clears it.
pub fn state_change_fields(ticket: &TaskTicketDto, state: TaskState, now_ms: i64) -> TaskUpdateFieldsDto {
    let mut fields = TaskUpdateFieldsDto { state: Some(state), ..TaskUpdateFieldsDto::default() };
    let running = ticket.summary.state == TaskState::InProgress && ticket.started_at_unix_ms.is_some();
    if state == TaskState::InProgress {
        if !running {
            fields.started_at_unix_ms = Some(Some(now_ms));
        }
    } else {
        if running {
            fields.dedicated_hours = Some(live_dedicated_hours(ticket, now_ms));
        }
        if ticket.started_at_unix_ms.is_some() {
            fields.started_at_unix_ms = Some(None);
        }
    }
    if matches!(state, TaskState::Completed | TaskState::Cancelled) {
        fields.closed_at_unix_ms = Some(Some(now_ms));
    } else if ticket.closed_at_unix_ms.is_some() {
        fields.closed_at_unix_ms = Some(None);
    }
    fields
}

/// Fields that put a ticket back as it was before a finish or a cancel.
fn restore_fields(ticket: &TaskTicketDto) -> TaskUpdateFieldsDto {
    TaskUpdateFieldsDto {
        state: Some(ticket.summary.state),
        dedicated_hours: Some(ticket.dedicated_hours),
        started_at_unix_ms: Some(ticket.started_at_unix_ms),
        closed_at_unix_ms: Some(ticket.closed_at_unix_ms),
        ..TaskUpdateFieldsDto::default()
    }
}

fn update(ticket_id: &str, fields: TaskUpdateFieldsDto) -> TaskMutationDto {
    TaskMutationDto::UpdateTicket { ticket_id: ticket_id.to_string(), fields }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

fn group_kind(snapshot: &TaskManagerLibrarySnapshotDto, group_id: Option<&str>) -> Option<TaskColumnKind> {
    let group_id = group_id?;
    snapshot.groups.iter().find(|group| group.group_id == group_id).map(|group| group.column_kind())
}

/// Order after every open root ticket of a column.
fn end_of_column(snapshot: &TaskManagerLibrarySnapshotDto, board_id: &str, group_id: Option<&str>, except: &str) -> f64 {
    let last = snapshot
        .tickets
        .iter()
        .filter(|ticket| {
            ticket.summary.board_id == board_id
                && ticket.summary.group_id.as_deref() == group_id
                && ticket.summary.parent_ticket_id.is_none()
                && ticket.summary.ticket_id != except
                && ticket.order < 999_999.0
        })
        .map(|ticket| ticket.order)
        .fold(0.0_f64, f64::max);
    (last + ORDER_STEP).min(MAX_TASK_ORDER)
}

/// State a ticket takes when it lands in a column: «Bloqueado» blocks it
/// and leaving it unblocks it.
fn column_state(ticket: &TaskTicketDto, target: Option<TaskColumnKind>) -> Option<TaskState> {
    let into_blocked = target == Some(TaskColumnKind::Blocked);
    match ticket.summary.state {
        TaskState::Blocked if !into_blocked => Some(TaskState::Pending),
        state if into_blocked && state != TaskState::Blocked => Some(TaskState::Blocked),
        _ => None,
    }
}

/// Moves the subtasks of a task to the column the task went to, so a column
/// never keeps subtasks of tasks that live elsewhere.
pub(crate) fn subtasks_to_column(
    snapshot: &TaskManagerLibrarySnapshotDto,
    parent_id: &str,
    group_id: Option<&str>,
) -> Vec<TaskMutationDto> {
    // The store reads a missing group as «keep it».
    let Some(group_id) = group_id else {
        return Vec::new();
    };
    snapshot
        .tickets
        .iter()
        .filter(|child| child.summary.parent_ticket_id.as_deref() == Some(parent_id))
        .filter(|child| child.summary.group_id.as_deref() != Some(group_id))
        .map(|child| {
            update(
                &child.summary.ticket_id,
                TaskUpdateFieldsDto { group_id: Some(group_id.to_string()), ..TaskUpdateFieldsDto::default() },
            )
        })
        .collect()
}

/// Adds the column rule to the fields of a ticket that changes column.
pub(crate) fn apply_column_rule(
    snapshot: &TaskManagerLibrarySnapshotDto,
    ticket: &TaskTicketDto,
    target_group: Option<&str>,
    fields: &mut TaskUpdateFieldsDto,
    now_ms: i64,
) {
    if let Some(state) = column_state(ticket, group_kind(snapshot, target_group)) {
        let change = state_change_fields(ticket, state, now_ms);
        fields.state = change.state;
        fields.dedicated_hours = change.dedicated_hours.or(fields.dedicated_hours);
        fields.started_at_unix_ms = change.started_at_unix_ms;
    }
}

fn clean_title(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn depends_on_map(snapshot: &TaskManagerLibrarySnapshotDto) -> HashMap<String, Vec<String>> {
    let ids = snapshot.tickets.iter().map(|ticket| ticket.summary.ticket_id.as_str()).collect::<HashSet<_>>();
    snapshot
        .tickets
        .iter()
        .map(|ticket| {
            let dependencies = ticket.dependencies.iter().filter(|id| ids.contains(id.as_str())).cloned().collect();
            (ticket.summary.ticket_id.clone(), dependencies)
        })
        .collect()
}

fn member_named<'a>(members: &'a [TaskBoardMemberDto], name: &str) -> Option<&'a TaskBoardMemberDto> {
    members.iter().find(|member| fold(&member.name) == fold(name))
}

/// Resolves the card and board actions; `None` when the intent is not one
/// of them.
pub(crate) fn resolve_board_actions(
    resolver: &BoardResolver<'_>,
    intent: &TaskBoardIntent,
    new_id: &mut dyn FnMut() -> String,
    now_ms: i64,
    viewer: &BoardViewer,
) -> Option<Result<BoardIntentOutcome, BackendError>> {
    let is_action = matches!(
        intent,
        TaskBoardIntent::ChangeState { .. }
            | TaskBoardIntent::StartTask { .. }
            | TaskBoardIntent::PauseTask { .. }
            | TaskBoardIntent::UnblockTask { .. }
            | TaskBoardIntent::FinishTask { .. }
            | TaskBoardIntent::CancelTask { .. }
            | TaskBoardIntent::DeleteTask { .. }
            | TaskBoardIntent::RenameTask { .. }
            | TaskBoardIntent::MoveTask { .. }
            | TaskBoardIntent::DuplicateTask { .. }
            | TaskBoardIntent::SetTaskProject { .. }
            | TaskBoardIntent::SetTaskPeople { .. }
            | TaskBoardIntent::SetTaskTime { .. }
            | TaskBoardIntent::SetBlockNote { .. }
            | TaskBoardIntent::AddSubtask { .. }
            | TaskBoardIntent::ToggleSubtask { .. }
            | TaskBoardIntent::SetDependencies { .. }
            | TaskBoardIntent::RestoreTasks { .. }
            | TaskBoardIntent::DeleteTasks { .. }
            | TaskBoardIntent::AddBoardMember { .. }
            | TaskBoardIntent::RemoveBoardMember { .. }
            | TaskBoardIntent::AddBoardProject { .. }
            | TaskBoardIntent::RemoveBoardProject { .. }
            | TaskBoardIntent::MoveGroup { .. }
    );
    if !is_action {
        return None;
    }
    let snapshot = resolver.library();
    let ticket_of = |path: &str| resolver.ticket(path);
    let outcome = (|| -> Result<BoardIntentOutcome, BackendError> {
        Ok(match intent {
            TaskBoardIntent::ChangeState { task_path, state } => {
                let ticket = ticket_of(task_path)?;
                transition(ticket, *state, now_ms)
            }
            TaskBoardIntent::StartTask { task_path } => transition(ticket_of(task_path)?, TaskState::InProgress, now_ms),
            TaskBoardIntent::PauseTask { task_path } | TaskBoardIntent::UnblockTask { task_path } => {
                transition(ticket_of(task_path)?, TaskState::Pending, now_ms)
            }
            TaskBoardIntent::FinishTask { task_path } => transition(ticket_of(task_path)?, TaskState::Completed, now_ms),
            TaskBoardIntent::CancelTask { task_path } => transition(ticket_of(task_path)?, TaskState::Cancelled, now_ms),
            TaskBoardIntent::DeleteTask { task_path } => {
                let ticket = ticket_of(task_path)?;
                let comments = snapshot
                    .comments
                    .iter()
                    .filter(|comment| comment.ticket_id == ticket.summary.ticket_id)
                    .cloned()
                    .collect();
                BoardIntentOutcome {
                    mutations: vec![TaskMutationDto::DeleteTicket { ticket_id: ticket.summary.ticket_id.clone() }],
                    undo: Some(BoardUndoPlan {
                        kind: BoardUndoKind::Delete,
                        title: ticket.summary.title.clone(),
                        mutations: vec![TaskMutationDto::RestoreDeletedTicket {
                            ticket: Box::new(ticket.clone()),
                            comments,
                        }],
                    }),
                    focus_ticket_id: None,
                }
            }
            TaskBoardIntent::RenameTask { task_path, title } => {
                let ticket = ticket_of(task_path)?;
                let title = clean_title(title);
                if title.is_empty() || title == ticket.summary.title {
                    return Ok(BoardIntentOutcome::default());
                }
                BoardIntentOutcome {
                    mutations: vec![update(
                        &ticket.summary.ticket_id,
                        TaskUpdateFieldsDto { title: Some(title), ..TaskUpdateFieldsDto::default() },
                    )],
                    undo: None,
                    focus_ticket_id: Some(ticket.summary.ticket_id.clone()),
                }
            }
            TaskBoardIntent::MoveTask { task_path, group } => {
                let ticket = ticket_of(task_path)?;
                if ticket.summary.parent_ticket_id.is_some() {
                    return Err(invalid("Las subtareas se mueven con su tarea."));
                }
                let group_id = resolver.group(&ticket.summary.board_id, group)?;
                if group_id.is_none() {
                    return Err(invalid("Elegí la columna a la que va la tarea."));
                }
                if group_id == ticket.summary.group_id {
                    return Ok(BoardIntentOutcome::default());
                }
                let mut fields = TaskUpdateFieldsDto {
                    group_id: group_id.clone(),
                    order: Some(end_of_column(snapshot, &ticket.summary.board_id, group_id.as_deref(), &ticket.summary.ticket_id)),
                    ..TaskUpdateFieldsDto::default()
                };
                apply_column_rule(snapshot, ticket, group_id.as_deref(), &mut fields, now_ms);
                let mut mutations = vec![update(&ticket.summary.ticket_id, fields)];
                mutations.extend(subtasks_to_column(snapshot, &ticket.summary.ticket_id, group_id.as_deref()));
                BoardIntentOutcome {
                    mutations,
                    undo: None,
                    focus_ticket_id: Some(ticket.summary.ticket_id.clone()),
                }
            }
            TaskBoardIntent::DuplicateTask { task_path } => duplicate(resolver, ticket_of(task_path)?, new_id)?,
            TaskBoardIntent::SetTaskProject { task_path, project } => {
                let ticket = ticket_of(task_path)?;
                let requested = clean_title(project);
                let mut mutations = Vec::new();
                let name = if requested.is_empty() {
                    String::new()
                } else {
                    let mut projects = board_projects(snapshot, &ticket.summary.board_id);
                    match projects.iter().find(|candidate| fold(&candidate.name) == fold(&requested)) {
                        Some(existing) => existing.name.clone(),
                        None => {
                            let color = next_project_color(&projects);
                            projects.push(TaskBoardProjectDto { name: requested.clone(), color });
                            mutations.push(people_update(&ticket.summary.board_id, None, Some(projects), Vec::new(), Vec::new()));
                            requested
                        }
                    }
                };
                if ticket.project.clone().unwrap_or_default() != name {
                    mutations.push(update(
                        &ticket.summary.ticket_id,
                        TaskUpdateFieldsDto { project: Some(name), ..TaskUpdateFieldsDto::default() },
                    ));
                }
                BoardIntentOutcome { mutations, undo: None, focus_ticket_id: Some(ticket.summary.ticket_id.clone()) }
            }
            TaskBoardIntent::SetTaskPeople { task_path, people } => {
                let ticket = ticket_of(task_path)?;
                let members = board_members(snapshot, &ticket.summary.board_id, viewer.owner_name.as_deref());
                let mut names = Vec::new();
                for name in people.iter().map(|name| name.trim()).filter(|name| !name.is_empty()) {
                    let member = member_named(&members, name)
                        .ok_or_else(|| invalid(format!("«{name}» no está en el tablero. Agregala desde Personas y proyectos.")))?;
                    if !names.contains(&member.name) {
                        names.push(member.name.clone());
                    }
                }
                BoardIntentOutcome::of(vec![update(
                    &ticket.summary.ticket_id,
                    TaskUpdateFieldsDto { assignees: Some(names), ..TaskUpdateFieldsDto::default() },
                )])
            }
            TaskBoardIntent::SetTaskTime { task_path, estimated_hours, dedicated_hours } => {
                let ticket = ticket_of(task_path)?;
                let hours = |value: f64, field: &str| -> Result<f64, BackendError> {
                    if value.is_finite() {
                        Ok(round_hours(value.max(0.0)))
                    } else {
                        Err(invalid(format!("Las horas {field} no son válidas.")))
                    }
                };
                let mut fields = TaskUpdateFieldsDto::default();
                if let Some(value) = estimated_hours {
                    fields.estimated_hours = Some(hours(*value, "estimadas")?);
                }
                if let Some(value) = dedicated_hours {
                    fields.dedicated_hours = Some(hours(*value, "dedicadas")?);
                    // A running task keeps running from the new total.
                    if ticket.summary.state == TaskState::InProgress && ticket.started_at_unix_ms.is_some() {
                        fields.started_at_unix_ms = Some(Some(now_ms));
                    }
                }
                if fields.is_empty() {
                    return Ok(BoardIntentOutcome::default());
                }
                BoardIntentOutcome::of(vec![update(&ticket.summary.ticket_id, fields)])
            }
            TaskBoardIntent::SetBlockNote { task_path, note } => {
                let ticket = ticket_of(task_path)?;
                BoardIntentOutcome::of(vec![update(
                    &ticket.summary.ticket_id,
                    TaskUpdateFieldsDto { block_note: Some(note.trim().to_string()), ..TaskUpdateFieldsDto::default() },
                )])
            }
            TaskBoardIntent::AddSubtask { task_path, title } => {
                let ticket = ticket_of(task_path)?;
                if ticket.summary.parent_ticket_id.is_some() {
                    return Err(invalid("Las subtareas no tienen subtareas propias."));
                }
                let title = clean_title(title);
                if title.is_empty() {
                    return Ok(BoardIntentOutcome::default());
                }
                BoardIntentOutcome::of(vec![TaskMutationDto::AddSubtask {
                    parent_ticket_id: ticket.summary.ticket_id.clone(),
                    ticket_id: new_id(),
                    title,
                    content: String::new(),
                    priority: TaskPriority::Medium,
                }])
            }
            TaskBoardIntent::ToggleSubtask { task_path } => {
                let ticket = ticket_of(task_path)?;
                let state = if ticket.summary.state == TaskState::Completed { TaskState::Pending } else { TaskState::Completed };
                BoardIntentOutcome::of(vec![update(&ticket.summary.ticket_id, state_change_fields(ticket, state, now_ms))])
            }
            TaskBoardIntent::SetDependencies { task_path, dependency_paths } => {
                let ticket = ticket_of(task_path)?;
                let mut ids = Vec::new();
                for path in dependency_paths {
                    let dependency = ticket_of(path)?;
                    if dependency.summary.board_id != ticket.summary.board_id {
                        return Err(invalid("Una tarea solo depende de tareas de su tablero."));
                    }
                    if !ids.contains(&dependency.summary.ticket_id) {
                        ids.push(dependency.summary.ticket_id.clone());
                    }
                }
                if ids.len() > MAX_TASK_TAGS {
                    return Err(invalid("Una tarea depende de 20 tareas como máximo."));
                }
                let mut depends_on = depends_on_map(snapshot);
                depends_on.insert(ticket.summary.ticket_id.clone(), Vec::new());
                if let Some(cycle) = ids.iter().find(|id| creates_cycle(&depends_on, &ticket.summary.ticket_id, id)) {
                    let title = snapshot
                        .tickets
                        .iter()
                        .find(|candidate| &candidate.summary.ticket_id == cycle)
                        .map(|candidate| candidate.summary.title.clone())
                        .unwrap_or_default();
                    return Err(invalid(format!("Crearía un ciclo: «{title}» ya espera a esta tarea.")));
                }
                BoardIntentOutcome::of(vec![update(
                    &ticket.summary.ticket_id,
                    TaskUpdateFieldsDto { dependencies: Some(ids), ..TaskUpdateFieldsDto::default() },
                )])
            }
            TaskBoardIntent::RestoreTasks { task_paths } => {
                let mut mutations = Vec::new();
                for path in task_paths {
                    let ticket = ticket_of(path)?;
                    mutations.push(update(&ticket.summary.ticket_id, state_change_fields(ticket, TaskState::Pending, now_ms)));
                }
                BoardIntentOutcome::of(mutations)
            }
            TaskBoardIntent::DeleteTasks { task_paths } => {
                let mut mutations = Vec::new();
                let mut deleted = HashSet::new();
                for path in task_paths {
                    let ticket = ticket_of(path)?;
                    // Subtasks go first: a ticket with subtasks cannot be deleted.
                    for child in snapshot
                        .tickets
                        .iter()
                        .filter(|child| child.summary.parent_ticket_id.as_deref() == Some(ticket.summary.ticket_id.as_str()))
                    {
                        if deleted.insert(child.summary.ticket_id.clone()) {
                            mutations.push(TaskMutationDto::DeleteTicket { ticket_id: child.summary.ticket_id.clone() });
                        }
                    }
                    if deleted.insert(ticket.summary.ticket_id.clone()) {
                        mutations.push(TaskMutationDto::DeleteTicket { ticket_id: ticket.summary.ticket_id.clone() });
                    }
                }
                BoardIntentOutcome::of(mutations)
            }
            TaskBoardIntent::AddBoardMember { board, name } => {
                let board = resolver.board(board)?;
                let name = clean_title(name);
                if name.is_empty() {
                    return Err(invalid("Escribí el nombre de la persona."));
                }
                let mut members = board_members(snapshot, &board.board_id, viewer.owner_name.as_deref());
                if member_named(&members, &name).is_some() {
                    return Err(conflict("Esa persona ya está en el tablero."));
                }
                let color = next_member_color(&members);
                members.push(TaskBoardMemberDto { name, color, is_owner: false });
                BoardIntentOutcome::of(vec![people_update(&board.board_id, Some(members), None, Vec::new(), Vec::new())])
            }
            TaskBoardIntent::RemoveBoardMember { board, name } => {
                let board = resolver.board(board)?;
                let mut members = board_members(snapshot, &board.board_id, viewer.owner_name.as_deref());
                let member = member_named(&members, name).cloned().ok_or_else(|| invalid("Esa persona no está en el tablero."))?;
                if member.is_owner {
                    return Err(invalid("El propietario no se puede quitar del tablero."));
                }
                members.retain(|candidate| fold(&candidate.name) != fold(&member.name));
                BoardIntentOutcome::of(vec![people_update(&board.board_id, Some(members), None, vec![member.name], Vec::new())])
            }
            TaskBoardIntent::AddBoardProject { board, name, color } => {
                let board = resolver.board(board)?;
                let name = clean_title(name);
                if name.is_empty() {
                    return Err(invalid("Escribí el nombre del proyecto."));
                }
                let mut projects = board_projects(snapshot, &board.board_id);
                if projects.iter().any(|project| fold(&project.name) == fold(&name)) {
                    return Err(conflict("Ya existe un proyecto con ese nombre."));
                }
                let color = if crate::task_board_plan::is_hex_color(color.trim()) {
                    color.trim().to_ascii_uppercase()
                } else {
                    next_project_color(&projects)
                };
                projects.push(TaskBoardProjectDto { name, color });
                BoardIntentOutcome::of(vec![people_update(&board.board_id, None, Some(projects), Vec::new(), Vec::new())])
            }
            TaskBoardIntent::RemoveBoardProject { board, name } => {
                let board = resolver.board(board)?;
                let mut projects = board_projects(snapshot, &board.board_id);
                let project = projects
                    .iter()
                    .find(|project| fold(&project.name) == fold(name))
                    .cloned()
                    .ok_or_else(|| invalid("Ese proyecto no está en el tablero."))?;
                projects.retain(|candidate| fold(&candidate.name) != fold(&project.name));
                BoardIntentOutcome::of(vec![people_update(&board.board_id, None, Some(projects), Vec::new(), vec![project.name])])
            }
            TaskBoardIntent::MoveGroup { board, name, direction } => {
                let board = resolver.board(board)?;
                let group_id = resolver.group(&board.board_id, name)?.ok_or_else(|| invalid("El grupo no existe."))?;
                let mut order = snapshot
                    .groups
                    .iter()
                    .filter(|group| group.board_id == board.board_id)
                    .map(|group| group.group_id.clone())
                    .collect::<Vec<_>>();
                let Some(index) = order.iter().position(|id| *id == group_id) else {
                    return Ok(BoardIntentOutcome::default());
                };
                let target = match direction.as_str() {
                    "left" if index > 0 => index - 1,
                    "right" if index + 1 < order.len() => index + 1,
                    _ => return Ok(BoardIntentOutcome::default()),
                };
                order.swap(index, target);
                BoardIntentOutcome::of(vec![TaskMutationDto::ReorderGroups { board_id: board.board_id.clone(), group_ids: order }])
            }
            _ => BoardIntentOutcome::default(),
        })
    })();
    Some(outcome)
}

fn people_update(
    board_id: &str,
    members: Option<Vec<TaskBoardMemberDto>>,
    projects: Option<Vec<TaskBoardProjectDto>>,
    removed_members: Vec<String>,
    removed_projects: Vec<String>,
) -> TaskMutationDto {
    TaskMutationDto::UpdateBoardPeople { board_id: board_id.to_string(), members, projects, removed_members, removed_projects }
}

/// A state change with its running time; finish and cancel can be undone.
fn transition(ticket: &TaskTicketDto, state: TaskState, now_ms: i64) -> BoardIntentOutcome {
    if ticket.summary.state == state {
        return BoardIntentOutcome::default();
    }
    let undo_kind = match state {
        TaskState::Completed => Some(BoardUndoKind::Finish),
        TaskState::Cancelled => Some(BoardUndoKind::Cancel),
        _ => None,
    };
    BoardIntentOutcome {
        mutations: vec![update(&ticket.summary.ticket_id, state_change_fields(ticket, state, now_ms))],
        undo: undo_kind.map(|kind| BoardUndoPlan {
            kind,
            title: ticket.summary.title.clone(),
            mutations: vec![update(&ticket.summary.ticket_id, restore_fields(ticket))],
        }),
        focus_ticket_id: None,
    }
}

/// A copy right below the source with «(copia)», no hours, the same people,
/// project and dependencies, and its subtasks unchecked.
fn duplicate(
    resolver: &BoardResolver<'_>,
    source: &TaskTicketDto,
    new_id: &mut dyn FnMut() -> String,
) -> Result<BoardIntentOutcome, BackendError> {
    let snapshot = resolver.library();
    if source.summary.parent_ticket_id.is_some() {
        return Err(invalid("Las subtareas no se duplican solas: duplicá su tarea."));
    }
    let copy_id = new_id();
    let next_order = snapshot
        .tickets
        .iter()
        .filter(|ticket| {
            ticket.summary.board_id == source.summary.board_id
                && ticket.summary.group_id == source.summary.group_id
                && ticket.summary.parent_ticket_id.is_none()
                && ticket.order > source.order
        })
        .map(|ticket| ticket.order)
        .fold(f64::INFINITY, f64::min);
    let order = if next_order.is_finite() && next_order < 999_999.0 {
        (source.order + next_order) / 2.0
    } else {
        source.order + ORDER_STEP
    }
    .min(MAX_TASK_ORDER);
    let state = if source.summary.state == TaskState::Blocked { TaskState::Blocked } else { TaskState::Pending };
    let mut mutations = vec![
        TaskMutationDto::DuplicateTicket {
            ticket_id: source.summary.ticket_id.clone(),
            new_ticket_id: copy_id.clone(),
            title: Some(format!("{} (copia)", source.summary.title).chars().take(180).collect()),
        },
        update(
            &copy_id,
            TaskUpdateFieldsDto {
                state: Some(state),
                dedicated_hours: Some(0.0),
                deviation_hours: Some(0.0),
                started_at_unix_ms: Some(None),
                closed_at_unix_ms: Some(None),
                order: Some(order),
                ..TaskUpdateFieldsDto::default()
            },
        ),
    ];
    let mut children = snapshot
        .tickets
        .iter()
        .filter(|ticket| ticket.summary.parent_ticket_id.as_deref() == Some(source.summary.ticket_id.as_str()))
        .collect::<Vec<_>>();
    children.sort_by(|left, right| left.order.total_cmp(&right.order).then_with(|| left.summary.title.cmp(&right.summary.title)));
    for child in children {
        mutations.push(TaskMutationDto::AddSubtask {
            parent_ticket_id: copy_id.clone(),
            ticket_id: new_id(),
            title: child.summary.title.clone(),
            content: child.content.clone(),
            priority: child.summary.priority,
        });
    }
    Ok(BoardIntentOutcome { mutations, undo: None, focus_ticket_id: Some(copy_id) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_manager_tools::{
        InMemoryTaskManager, TaskBoardDto, TaskGroupDto, TaskManagerContextDto, TaskManagerMutationPort,
        TaskManagerSnapshotReadDto, TaskMutationApplyRequestDto, TaskMutationRequestDto, TaskTicketSummaryDto,
    };
    use crate::task_manager_ui::resolve_board_intent_outcome;

    const HOUR: i64 = 3_600_000;

    fn group(id: &str, name: &str, order: u32) -> TaskGroupDto {
        TaskGroupDto {
            library_id: "lib".into(),
            group_id: id.into(),
            board_id: "work".into(),
            name: name.into(),
            color: "#4FD1C5".into(),
            revision: 1,
            order,
            kind: None,
        }
    }

    fn ticket(id: &str, title: &str, group: &str, order: f64) -> TaskTicketDto {
        TaskTicketDto {
            summary: TaskTicketSummaryDto {
                library_id: "lib".into(),
                ticket_id: id.into(),
                board_id: "work".into(),
                group_id: Some(group.into()),
                title: title.into(),
                state: TaskState::Pending,
                priority: TaskPriority::Medium,
                parent_ticket_id: None,
                detail_preview: String::new(),
                revision: 1,
                logical_path: format!("task-manager/tasks/work/{id}.md"),
            },
            content: String::new(),
            tags: Vec::new(),
            dependencies: Vec::new(),
            checklist: Vec::new(),
            start_date: String::new(),
            end_date: String::new(),
            dynamic_end_date: true,
            dedicated_hours: 1.0,
            estimated_hours: 4.0,
            deviation_hours: 0.0,
            order,
            context: None,
            related_documents: Vec::new(),
            related_tasks: Vec::new(),
            project: None,
            assignees: vec!["Doris".into()],
            started_at_unix_ms: None,
            closed_at_unix_ms: None,
            block_note: None,
        }
    }

    fn setup() -> (InMemoryTaskManager, TaskManagerContextDto) {
        let manager = InMemoryTaskManager::new();
        manager.add_library("lib").unwrap();
        manager.add_user("lib", "user-owner").unwrap();
        manager
            .seed_board(TaskBoardDto {
                library_id: "lib".into(),
                board_id: "work".into(),
                name: "work".into(),
                color: "#123456".into(),
                context: None,
                revision: 1,
            })
            .unwrap();
        manager.seed_group(group("sprint", "Sprint actual", 0)).unwrap();
        manager.seed_group(group("blocked", "Bloqueado", 1)).unwrap();
        manager.seed_ticket(ticket("a", "Informe", "sprint", 10.0)).unwrap();
        manager.seed_ticket(ticket("b", "Revisión", "sprint", 20.0)).unwrap();
        let mut child = ticket("a1", "Primer paso", "sprint", 10.0);
        child.summary.parent_ticket_id = Some("a".into());
        child.summary.state = TaskState::Completed;
        manager.seed_ticket(child).unwrap();
        (manager, TaskManagerContextDto::new("lib", "user-owner").unwrap())
    }

    fn viewer() -> BoardViewer {
        BoardViewer { name: Some("Gabriel".into()), owner_name: Some("Gabriel".into()), today: None }
    }

    fn run(
        manager: &InMemoryTaskManager,
        context: &TaskManagerContextDto,
        intent: TaskBoardIntent,
        now: i64,
    ) -> Result<BoardIntentOutcome, BackendError> {
        let read = TaskManagerSnapshotReadDto::from_snapshot(context.clone(), manager.read_snapshot(context)?)?;
        let mut counter = 0;
        let mut new_id = || {
            counter += 1;
            format!("new-{counter}")
        };
        let outcome = resolve_board_intent_outcome(&read, &intent, &mut new_id, now, &viewer())?;
        apply(manager, context, outcome.mutations.clone())?;
        Ok(outcome)
    }

    fn apply(manager: &InMemoryTaskManager, context: &TaskManagerContextDto, mutations: Vec<TaskMutationDto>) -> Result<(), BackendError> {
        static OPERATION: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        for mutation in mutations {
            let key = format!("op-{}", OPERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst));
            manager.preview_mutation(&TaskMutationRequestDto {
                context: context.clone(),
                operation_id: key.clone(),
                idempotency_key: key.clone(),
                mutation,
            })?;
            manager.apply_mutation(&TaskMutationApplyRequestDto {
                context: context.clone(),
                operation_id: key.clone(),
                idempotency_key: key,
                confirmed: true,
            })?;
        }
        Ok(())
    }

    fn get(manager: &InMemoryTaskManager, context: &TaskManagerContextDto, id: &str) -> TaskTicketDto {
        manager
            .read_snapshot(context)
            .unwrap()
            .tickets
            .into_iter()
            .find(|ticket| ticket.summary.ticket_id == id)
            .unwrap()
    }

    fn path(id: &str) -> String {
        format!("task-manager/tasks/work/{id}.md")
    }

    #[test]
    fn the_running_time_adds_up_when_the_task_pauses() {
        let (manager, context) = setup();
        run(&manager, &context, TaskBoardIntent::StartTask { task_path: path("a") }, 0).unwrap();
        let running = get(&manager, &context, "a");
        assert_eq!((running.summary.state, running.started_at_unix_ms), (TaskState::InProgress, Some(0)));
        run(&manager, &context, TaskBoardIntent::PauseTask { task_path: path("a") }, 2 * HOUR).unwrap();
        let paused = get(&manager, &context, "a");
        assert_eq!((paused.summary.state, paused.dedicated_hours, paused.started_at_unix_ms), (TaskState::Pending, 3.0, None));
    }

    #[test]
    fn finishing_can_be_undone_as_it_was() {
        let (manager, context) = setup();
        run(&manager, &context, TaskBoardIntent::StartTask { task_path: path("a") }, 0).unwrap();
        let outcome = run(&manager, &context, TaskBoardIntent::FinishTask { task_path: path("a") }, HOUR).unwrap();
        let finished = get(&manager, &context, "a");
        assert_eq!(
            (finished.summary.state, finished.dedicated_hours, finished.closed_at_unix_ms),
            (TaskState::Completed, 2.0, Some(HOUR))
        );
        let undo = outcome.undo.unwrap();
        assert_eq!((undo.kind, undo.title.as_str()), (BoardUndoKind::Finish, "Informe"));
        apply(&manager, &context, undo.mutations).unwrap();
        let back = get(&manager, &context, "a");
        assert_eq!(
            (back.summary.state, back.dedicated_hours, back.started_at_unix_ms, back.closed_at_unix_ms),
            (TaskState::InProgress, 1.0, Some(0), None)
        );
    }

    #[test]
    fn a_deleted_task_comes_back_with_the_same_id() {
        let (manager, context) = setup();
        let outcome = run(&manager, &context, TaskBoardIntent::DeleteTask { task_path: path("b") }, 0).unwrap();
        assert!(manager.read_snapshot(&context).unwrap().tickets.iter().all(|ticket| ticket.summary.ticket_id != "b"));
        apply(&manager, &context, outcome.undo.unwrap().mutations).unwrap();
        assert_eq!(get(&manager, &context, "b").summary.title, "Revisión");
    }

    #[test]
    fn the_blocked_column_blocks_and_leaving_it_unblocks() {
        let (manager, context) = setup();
        run(&manager, &context, TaskBoardIntent::StartTask { task_path: path("b") }, 0).unwrap();
        run(&manager, &context, TaskBoardIntent::MoveTask { task_path: path("b"), group: "Bloqueado".into() }, HOUR).unwrap();
        let blocked = get(&manager, &context, "b");
        assert_eq!(
            (blocked.summary.state, blocked.dedicated_hours, blocked.started_at_unix_ms),
            (TaskState::Blocked, 2.0, None)
        );
        assert_eq!(blocked.summary.group_id.as_deref(), Some("blocked"));
        run(&manager, &context, TaskBoardIntent::MoveTask { task_path: path("b"), group: "Sprint actual".into() }, HOUR).unwrap();
        let moved = get(&manager, &context, "b");
        assert_eq!((moved.summary.state, moved.order), (TaskState::Pending, 20.0));
    }

    #[test]
    fn a_duplicate_copies_people_and_unchecked_subtasks_without_hours() {
        let (manager, context) = setup();
        let outcome = run(&manager, &context, TaskBoardIntent::DuplicateTask { task_path: path("a") }, 0).unwrap();
        let copy_id = outcome.focus_ticket_id.unwrap();
        let copy = get(&manager, &context, &copy_id);
        assert_eq!(copy.summary.title, "Informe (copia)");
        assert_eq!((copy.dedicated_hours, copy.order, copy.assignees.clone()), (0.0, 15.0, vec!["Doris".to_string()]));
        let children = manager
            .read_snapshot(&context)
            .unwrap()
            .tickets
            .into_iter()
            .filter(|ticket| ticket.summary.parent_ticket_id.as_deref() == Some(copy_id.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(children.len(), 1);
        assert_eq!((children[0].summary.title.as_str(), children[0].summary.state), ("Primer paso", TaskState::Pending));
    }

    #[test]
    fn people_must_belong_to_the_board_and_unknown_projects_are_created() {
        let (manager, context) = setup();
        let nobody = TaskBoardIntent::SetTaskPeople { task_path: path("a"), people: vec!["Nadie".into()] };
        assert!(run(&manager, &context, nobody, 0).is_err());
        let people = TaskBoardIntent::SetTaskPeople { task_path: path("a"), people: vec!["gabriel".into(), "Doris".into()] };
        run(&manager, &context, people, 0).unwrap();
        assert_eq!(get(&manager, &context, "a").assignees, vec!["Gabriel".to_string(), "Doris".to_string()]);
        run(&manager, &context, TaskBoardIntent::SetTaskProject { task_path: path("a"), project: " Remesas ".into() }, 0).unwrap();
        let snapshot = manager.read_snapshot(&context).unwrap();
        assert_eq!(board_projects(&snapshot, "work")[0].name, "Remesas");
        assert_eq!(get(&manager, &context, "a").project.as_deref(), Some("Remesas"));
    }

    #[test]
    fn removing_people_and_projects_clears_them_from_the_tasks() {
        let (manager, context) = setup();
        run(&manager, &context, TaskBoardIntent::SetTaskProject { task_path: path("a"), project: "Remesas".into() }, 0).unwrap();
        let owner = TaskBoardIntent::RemoveBoardMember { board: "work".into(), name: "Gabriel".into() };
        assert!(run(&manager, &context, owner, 0).is_err());
        run(&manager, &context, TaskBoardIntent::RemoveBoardMember { board: "work".into(), name: "doris".into() }, 0).unwrap();
        run(&manager, &context, TaskBoardIntent::RemoveBoardProject { board: "work".into(), name: "remesas".into() }, 0).unwrap();
        let ticket = get(&manager, &context, "a");
        assert!(ticket.assignees.is_empty());
        assert_eq!(ticket.project, None);
        let snapshot = manager.read_snapshot(&context).unwrap();
        assert_eq!(board_members(&snapshot, "work", None).len(), 1);
        let duplicate = TaskBoardIntent::AddBoardMember { board: "work".into(), name: "GABRIEL".into() };
        assert!(run(&manager, &context, duplicate, 0).is_err());
    }

    #[test]
    fn a_dependency_that_closes_a_cycle_is_rejected() {
        let (manager, context) = setup();
        let first = TaskBoardIntent::SetDependencies { task_path: path("a"), dependency_paths: vec![path("b")] };
        run(&manager, &context, first, 0).unwrap();
        assert_eq!(get(&manager, &context, "a").dependencies, vec!["b".to_string()]);
        let cycle = TaskBoardIntent::SetDependencies { task_path: path("b"), dependency_paths: vec![path("a")] };
        let error = run(&manager, &context, cycle, 0).unwrap_err();
        assert!(error.message.contains("Crearía un ciclo"));
    }

    #[test]
    fn the_running_time_follows_a_new_dedicated_total() {
        let (manager, context) = setup();
        run(&manager, &context, TaskBoardIntent::StartTask { task_path: path("a") }, 0).unwrap();
        let time = TaskBoardIntent::SetTaskTime { task_path: path("a"), estimated_hours: Some(8.0), dedicated_hours: Some(5.0) };
        run(&manager, &context, time, HOUR).unwrap();
        let ticket = get(&manager, &context, "a");
        assert_eq!((ticket.estimated_hours, ticket.dedicated_hours, ticket.started_at_unix_ms), (8.0, 5.0, Some(HOUR)));
        assert_eq!(live_dedicated_hours(&ticket, 2 * HOUR), 6.0);
        assert_eq!(initials("Doris Moreno Vera"), "DM");
        assert_eq!(initials("Gabriel"), "GA");
    }

    #[test]
    fn a_column_with_only_finished_tasks_can_be_deleted_and_they_stay_without_a_column() {
        let (manager, context) = setup();
        run(&manager, &context, TaskBoardIntent::MoveTask { task_path: path("b"), group: "Bloqueado".into() }, 0).unwrap();
        run(&manager, &context, TaskBoardIntent::FinishTask { task_path: path("b") }, 0).unwrap();
        run(&manager, &context, TaskBoardIntent::DeleteGroup { board: "work".into(), name: "Bloqueado".into() }, 0).unwrap();
        let finished = get(&manager, &context, "b");
        assert_eq!((finished.summary.group_id, finished.summary.state), (None, TaskState::Completed));
        let open = run(&manager, &context, TaskBoardIntent::DeleteGroup { board: "work".into(), name: "Sprint actual".into() }, 0)
            .unwrap_err();
        assert!(open.message.contains("1 tarea abierta"), "{}", open.message);
    }

    #[test]
    fn subtasks_follow_their_task_to_another_column() {
        let (manager, context) = setup();
        run(&manager, &context, TaskBoardIntent::MoveTask { task_path: path("a"), group: "Bloqueado".into() }, 0).unwrap();
        assert_eq!(get(&manager, &context, "a1").summary.group_id.as_deref(), Some("blocked"));
        let place = TaskBoardIntent::PlaceTask {
            task_path: path("a"),
            ordered_paths: vec![path("b"), path("a")],
            group: "Sprint actual".into(),
            parent_task_name: String::new(),
        };
        run(&manager, &context, place, 0).unwrap();
        assert_eq!(get(&manager, &context, "a1").summary.group_id.as_deref(), Some("sprint"));
    }
}
