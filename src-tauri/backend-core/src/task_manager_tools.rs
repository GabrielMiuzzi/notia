//! Tauri-independent contracts for Task Manager tools.
//!
//! This module deliberately stops at a domain port. It does not know about
//! Markdown, SQLite, Tauri, publication transports, or platform paths. The
//! in-memory implementation is a deterministic reference adapter for tests;
//! production adapters can map the same contracts to a library store.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};

use super::error::{BackendError, BackendErrorCode};
use super::library_tools::BoundedPage;
use super::protocol::{MutationPreviewAction, ToolDefinition};
use super::BackendScope;

pub const MAX_TASK_BOARDS: usize = 64;
pub const MAX_TASK_GROUPS: usize = 512;
pub const MAX_TASK_TICKETS: usize = 2_000;
pub const MAX_TASK_COMMENTS: usize = 100;
pub const MAX_TASK_RESULTS: usize = 100;
pub const MAX_TASK_BULK_TICKETS: usize = 50;
pub const MAX_TASK_TEXT_CHARS: usize = 30_000;
pub const MAX_TASK_TITLE_CHARS: usize = 180;
pub const MAX_TASK_NAME_CHARS: usize = 120;
pub const MAX_TASK_TAGS: usize = 20;
pub const MAX_TASK_RELATED_REFERENCES: usize = 20;
pub const MAX_TASK_REFERENCE_CHARS: usize = 512;
pub const MAX_TASK_DATE_CHARS: usize = 64;
pub const MAX_TASK_HOURS: f64 = 1_000_000.0;
pub const MAX_TASK_ORDER: f64 = 1_000_000_000.0;
pub const MAX_TASK_USERS: usize = 256;
pub const MAX_TASK_LIBRARIES: usize = 64;
pub const MAX_TASK_SNAPSHOT_BYTES: usize = 8 * 1024 * 1024;
pub const TASK_MANAGER_SNAPSHOT_VERSION: u16 = 1;
pub const TASK_MANAGER_SNAPSHOT_READ_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskManagerContextDto {
    pub library_id: String,
    pub library_user_id: String,
    #[serde(default)]
    pub active_board_id: Option<String>,
    #[serde(default)]
    pub allowed_board_ids: Vec<String>,
}

impl TaskManagerContextDto {
    pub fn new(library_id: &str, library_user_id: &str) -> Result<Self, BackendError> {
        let context = Self {
            library_id: validate_id("libraryId", library_id)?,
            library_user_id: validate_id("libraryUserId", library_user_id)?,
            active_board_id: None,
            allowed_board_ids: Vec::new(),
        };
        context.validate()?;
        Ok(context)
    }

    pub fn validate(&self) -> Result<(), BackendError> {
        validate_id("libraryId", &self.library_id)?;
        validate_id("libraryUserId", &self.library_user_id)?;
        if let Some(board_id) = &self.active_board_id {
            validate_id("activeBoardId", board_id)?;
        }
        if self.allowed_board_ids.len() > MAX_TASK_BOARDS {
            return Err(invalid(
                "El alcance de tableros supera el límite permitido.",
            ));
        }
        let mut seen = HashSet::new();
        for board_id in &self.allowed_board_ids {
            validate_id("allowedBoardId", board_id)?;
            if !seen.insert(board_id) {
                return Err(invalid("El alcance de tableros contiene duplicados."));
            }
        }
        if let Some(active_board_id) = &self.active_board_id {
            if !self.allowed_board_ids.is_empty()
                && !self
                    .allowed_board_ids
                    .iter()
                    .any(|id| id == active_board_id)
            {
                return Err(forbidden(
                    "El tablero activo no pertenece al alcance autorizado.",
                ));
            }
        }
        Ok(())
    }

    fn allows_board(&self, board_id: &str) -> bool {
        self.allowed_board_ids.is_empty()
            || self
                .allowed_board_ids
                .iter()
                .any(|allowed| allowed == board_id)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum TaskState {
    #[serde(rename = "Pendiente")]
    Pending,
    #[serde(rename = "Cancelada")]
    Cancelled,
    #[serde(rename = "En progreso")]
    InProgress,
    #[serde(rename = "Finalizada")]
    Completed,
    #[serde(rename = "Bloqueada")]
    Blocked,
}

impl TaskState {
    fn is_archived(self) -> bool {
        matches!(self, Self::Cancelled | Self::Completed)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum TaskPriority {
    #[serde(rename = "Baja")]
    Low,
    #[serde(rename = "Media")]
    Medium,
    #[serde(rename = "Alta")]
    High,
    #[serde(rename = "Urgente")]
    Urgent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskBoardDto {
    pub library_id: String,
    pub board_id: String,
    pub name: String,
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    pub revision: u64,
}

impl TaskBoardDto {
    pub fn validate(&self) -> Result<(), BackendError> {
        validate_id("libraryId", &self.library_id)?;
        validate_id("boardId", &self.board_id)?;
        validate_name("boardName", &self.name, MAX_TASK_NAME_CHARS)?;
        validate_color(&self.color)?;
        if let Some(context) = &self.context {
            validate_context(context)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGroupDto {
    pub library_id: String,
    pub group_id: String,
    pub board_id: String,
    pub name: String,
    pub color: String,
    pub revision: u64,
    #[serde(default)]
    pub order: u32,
}

impl TaskGroupDto {
    pub fn validate(&self) -> Result<(), BackendError> {
        validate_id("libraryId", &self.library_id)?;
        validate_id("groupId", &self.group_id)?;
        validate_id("boardId", &self.board_id)?;
        validate_name("groupName", &self.name, MAX_TASK_NAME_CHARS)?;
        validate_color(&self.color)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTicketSummaryDto {
    pub library_id: String,
    pub ticket_id: String,
    pub board_id: String,
    pub group_id: Option<String>,
    pub title: String,
    pub state: TaskState,
    pub priority: TaskPriority,
    pub parent_ticket_id: Option<String>,
    pub detail_preview: String,
    pub revision: u64,
    /// Stable logical location. The ticket id is authoritative; this path is
    /// only the physical Markdown location and remains compatible with old
    /// snapshots that did not persist it.
    #[serde(default)]
    pub logical_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTicketDto {
    pub summary: TaskTicketSummaryDto,
    pub content: String,
    pub tags: Vec<String>,
    pub dependencies: Vec<String>,
    pub checklist: Vec<String>,
    #[serde(default)]
    pub start_date: String,
    #[serde(default)]
    pub end_date: String,
    #[serde(default = "default_dynamic_end_date")]
    pub dynamic_end_date: bool,
    #[serde(default)]
    pub dedicated_hours: f64,
    #[serde(default)]
    pub estimated_hours: f64,
    #[serde(default)]
    pub deviation_hours: f64,
    #[serde(default = "default_task_order")]
    pub order: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(default)]
    pub related_documents: Vec<String>,
    #[serde(default)]
    pub related_tasks: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCommentDto {
    pub library_id: String,
    pub comment_id: String,
    pub ticket_id: String,
    pub author_user_id: String,
    pub body: String,
    pub created_at_unix_ms: i64,
    pub revision: u64,
    #[serde(default)]
    pub logical_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTicketReadDto {
    pub ticket: TaskTicketDto,
    pub subtasks: BoundedPage<TaskTicketSummaryDto>,
    pub comments: BoundedPage<TaskCommentDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskManagerListRequest {
    pub context: TaskManagerContextDto,
    #[serde(default)]
    pub board_id: Option<String>,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_task_limit")]
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTicketListRequest {
    pub context: TaskManagerContextDto,
    #[serde(default)]
    pub board_id: Option<String>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub states: Vec<TaskState>,
    #[serde(default)]
    pub priorities: Vec<TaskPriority>,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_task_limit")]
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTicketReadRequest {
    pub context: TaskManagerContextDto,
    pub ticket_id: String,
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default)]
    pub subtask_offset: usize,
    #[serde(default = "default_task_limit")]
    pub subtask_limit: usize,
    #[serde(default)]
    pub comment_offset: usize,
    #[serde(default = "default_task_limit")]
    pub comment_limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContextSearchRequest {
    pub context: TaskManagerContextDto,
    pub query: String,
    #[serde(default)]
    pub board_id: Option<String>,
    #[serde(default)]
    pub ticket_ids: Vec<String>,
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default = "default_task_limit")]
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContextHitDto {
    pub library_id: String,
    pub ticket_id: String,
    pub board_id: String,
    pub title: String,
    pub excerpt: String,
    pub score: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskManagerOptionsDto {
    pub library_id: String,
    pub board: Option<TaskBoardDto>,
    pub boards: BoundedPage<TaskBoardDto>,
    pub groups: BoundedPage<TaskGroupDto>,
    pub states: Vec<TaskState>,
    pub priorities: Vec<TaskPriority>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskBoardSummaryDto {
    pub library_id: String,
    pub board_id: String,
    pub total_tickets: usize,
    pub by_state: BTreeMap<TaskState, usize>,
    pub by_priority: BTreeMap<TaskPriority, usize>,
    pub by_group: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdateFieldsDto {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub state: Option<TaskState>,
    #[serde(default)]
    pub priority: Option<TaskPriority>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub dependencies: Option<Vec<String>>,
    #[serde(default)]
    pub checklist: Option<Vec<String>>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub dynamic_end_date: Option<bool>,
    #[serde(default)]
    pub dedicated_hours: Option<f64>,
    #[serde(default)]
    pub estimated_hours: Option<f64>,
    #[serde(default)]
    pub deviation_hours: Option<f64>,
    #[serde(default)]
    pub order: Option<f64>,
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub parent_ticket_id: Option<Option<String>>,
}

impl TaskUpdateFieldsDto {
    fn validate(&self) -> Result<(), BackendError> {
        if let Some(title) = &self.title {
            validate_title("title", title, MAX_TASK_TITLE_CHARS)?;
        }
        if let Some(content) = &self.content {
            validate_text("content", content, MAX_TASK_TEXT_CHARS)?;
        }
        for (field, values) in [
            ("tags", self.tags.as_ref()),
            ("dependencies", self.dependencies.as_ref()),
            ("checklist", self.checklist.as_ref()),
        ] {
            if let Some(values) = values {
                if values.len() > MAX_TASK_TAGS {
                    return Err(invalid(format!("{field} supera el límite permitido.")));
                }
                for value in values {
                    validate_text(field, value, MAX_TASK_NAME_CHARS)?;
                }
            }
        }
        for (field, value) in [("startDate", self.start_date.as_ref()), ("endDate", self.end_date.as_ref())] {
            if let Some(value) = value {
                validate_text(field, value, MAX_TASK_DATE_CHARS)?;
            }
        }
        for (field, value) in [
            ("dedicatedHours", self.dedicated_hours),
            ("estimatedHours", self.estimated_hours),
            ("deviationHours", self.deviation_hours),
        ] {
            if let Some(value) = value {
                if !value.is_finite() || !(0.0..=MAX_TASK_HOURS).contains(&value) {
                    return Err(invalid(format!("El campo {field} no es válido.")));
                }
            }
        }
        if let Some(order) = self.order {
            if !order.is_finite() || !(0.0..=MAX_TASK_ORDER).contains(&order) {
                return Err(invalid("El orden del ticket no es válido."));
            }
        }
        if let Some(context) = &self.context {
            validate_context(context)?;
        }
        Ok(())
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.content.is_none()
            && self.state.is_none()
            && self.priority.is_none()
            && self.group_id.is_none()
            && self.tags.is_none()
            && self.dependencies.is_none()
            && self.checklist.is_none()
            && self.start_date.is_none()
            && self.end_date.is_none()
            && self.dynamic_end_date.is_none()
            && self.dedicated_hours.is_none()
            && self.estimated_hours.is_none()
            && self.deviation_hours.is_none()
            && self.order.is_none()
            && self.context.is_none()
            && self.parent_ticket_id.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum TaskMutationDto {
    CreateBoard {
        board_id: String,
        name: String,
        color: String,
        context: Option<String>,
        /// Hours of work per day used to schedule the board's tickets.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        activity_hours_per_day: Option<f64>,
    },
    UpdateBoard {
        board_id: String,
        name: Option<String>,
        color: Option<String>,
        context: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        activity_hours_per_day: Option<f64>,
    },
    DeleteBoard {
        board_id: String,
    },
    CreateGroup {
        board_id: String,
        group_id: String,
        name: String,
        color: String,
    },
    DeleteGroup {
        board_id: String,
        group_id: String,
    },
    UpdateGroup {
        board_id: String,
        group_id: String,
        name: String,
        color: String,
    },
    ReorderGroups {
        board_id: String,
        group_ids: Vec<String>,
    },
    CreateTicket {
        board_id: String,
        ticket_id: String,
        group_id: Option<String>,
        title: String,
        content: String,
        state: TaskState,
        priority: TaskPriority,
        parent_ticket_id: Option<String>,
        tags: Vec<String>,
        /// Schedule, estimate and context set in the same confirmed create.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        initial_fields: Option<TaskUpdateFieldsDto>,
    },
    ReplaceTicketContent {
        ticket_id: String,
        content: String,
    },
    AddComment {
        ticket_id: String,
        comment_id: String,
        body: String,
        created_at_unix_ms: i64,
    },
    AddSubtask {
        parent_ticket_id: String,
        ticket_id: String,
        title: String,
        content: String,
        priority: TaskPriority,
    },
    MoveTicket {
        ticket_id: String,
        group_id: Option<String>,
    },
    ChangeState {
        ticket_id: String,
        state: TaskState,
    },
    ChangePriority {
        ticket_id: String,
        priority: TaskPriority,
    },
    UpdateTicket {
        ticket_id: String,
        fields: TaskUpdateFieldsDto,
    },
    BulkUpdate {
        ticket_ids: Vec<String>,
        fields: TaskUpdateFieldsDto,
    },
    DuplicateTicket {
        ticket_id: String,
        new_ticket_id: String,
        title: Option<String>,
    },
    ArchiveTicket {
        ticket_id: String,
    },
    RestoreTicket {
        ticket_id: String,
    },
    DeleteTicket {
        ticket_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMutationRequestDto {
    pub context: TaskManagerContextDto,
    pub operation_id: String,
    pub idempotency_key: String,
    pub mutation: TaskMutationDto,
}

impl TaskMutationRequestDto {
    pub fn validate(&self) -> Result<(), BackendError> {
        self.context.validate()?;
        validate_id("operationId", &self.operation_id)?;
        validate_id("idempotencyKey", &self.idempotency_key)?;
        validate_mutation_shape(&self.mutation)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMutationApplyRequestDto {
    pub context: TaskManagerContextDto,
    pub operation_id: String,
    pub idempotency_key: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEntityRevisionDto {
    pub entity_type: String,
    pub entity_id: String,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskManagerConfigDto {
    #[serde(default)]
    pub activity_hours_per_day: BTreeMap<String, f64>,
}

impl Default for TaskManagerConfigDto {
    fn default() -> Self {
        Self {
            activity_hours_per_day: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDocumentRouteDto {
    pub entity_type: String,
    pub entity_id: String,
    pub logical_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskManagerAppliedOperationDto {
    pub library_id: String,
    pub library_user_id: String,
    pub operation_id: String,
    pub idempotency_key: String,
    pub affected_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMutationPreviewDto {
    pub library_id: String,
    pub library_user_id: String,
    pub operation_id: String,
    pub idempotency_key: String,
    pub summary: String,
    pub mutation: TaskMutationDto,
    pub base_revisions: Vec<TaskEntityRevisionDto>,
    pub affected_ticket_ids: Vec<String>,
    pub affected_board_ids: Vec<String>,
    pub fingerprint: String,
    pub allowed_actions: Vec<MutationPreviewAction>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMutationReceiptDto {
    pub library_id: String,
    pub library_user_id: String,
    pub operation_id: String,
    pub idempotency_key: String,
    pub changed: bool,
    pub affected_ids: Vec<String>,
    pub revisions: Vec<TaskEntityRevisionDto>,
    pub replayed: bool,
}

/// Versioned durable state for Task Manager.
///
/// The vectors are serialized in deterministic ID order by
/// [`InMemoryTaskManager::export_snapshot`]. Previews and applied idempotency
/// receipts are deliberately not included: they are operation-scoped,
/// transient state and must not survive a store reload or be replayed against
/// a different revision of the library.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskManagerSnapshotDto {
    pub version: u16,
    pub libraries: Vec<TaskManagerLibrarySnapshotDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskManagerLibrarySnapshotDto {
    pub library_id: String,
    pub users: Vec<String>,
    pub boards: Vec<TaskBoardDto>,
    pub groups: Vec<TaskGroupDto>,
    pub tickets: Vec<TaskTicketDto>,
    pub comments: Vec<TaskCommentDto>,
    pub generation: u64,
    #[serde(default)]
    pub config: TaskManagerConfigDto,
}

/// Bounded read envelope consumed by local and published clients.
///
/// Routes and revisions are derived from the same snapshot so a consumer can
/// render and prepare a later mutation without reading the workspace itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskManagerSnapshotReadDto {
    pub version: u16,
    pub context: TaskManagerContextDto,
    pub snapshot: TaskManagerLibrarySnapshotDto,
    pub routes: Vec<TaskDocumentRouteDto>,
    pub revisions: Vec<TaskEntityRevisionDto>,
}

impl TaskManagerSnapshotReadDto {
    pub fn from_snapshot(
        context: TaskManagerContextDto,
        snapshot: TaskManagerLibrarySnapshotDto,
    ) -> Result<Self, BackendError> {
        context.validate()?;
        if snapshot.library_id != context.library_id {
            return Err(forbidden(
                "El snapshot no pertenece a la biblioteca solicitada.",
            ));
        }

        let routes = snapshot
            .tickets
            .iter()
            .map(|ticket| TaskDocumentRouteDto {
                entity_type: "ticket".to_string(),
                entity_id: ticket.summary.ticket_id.clone(),
                logical_path: ticket.summary.logical_path.clone(),
            })
            .chain(
                snapshot
                    .comments
                    .iter()
                    .map(|comment| TaskDocumentRouteDto {
                        entity_type: "comment".to_string(),
                        entity_id: comment.comment_id.clone(),
                        logical_path: comment.logical_path.clone(),
                    }),
            )
            .collect();
        let revisions = snapshot
            .boards
            .iter()
            .map(|board| TaskEntityRevisionDto {
                entity_type: "board".to_string(),
                entity_id: board.board_id.clone(),
                revision: board.revision,
            })
            .chain(snapshot.groups.iter().map(|group| TaskEntityRevisionDto {
                entity_type: "group".to_string(),
                entity_id: group.group_id.clone(),
                revision: group.revision,
            }))
            .chain(snapshot.tickets.iter().map(|ticket| TaskEntityRevisionDto {
                entity_type: "ticket".to_string(),
                entity_id: ticket.summary.ticket_id.clone(),
                revision: ticket.summary.revision,
            }))
            .collect();

        let response = Self {
            version: TASK_MANAGER_SNAPSHOT_READ_VERSION,
            context,
            snapshot,
            routes,
            revisions,
        };
        response.validate()?;
        Ok(response)
    }

    pub fn validate(&self) -> Result<(), BackendError> {
        if self.version != TASK_MANAGER_SNAPSHOT_READ_VERSION {
            return Err(invalid(
                "La versión de lectura del snapshot de Task Manager no es compatible.",
            ));
        }
        self.context.validate()?;
        if self.snapshot.library_id != self.context.library_id {
            return Err(forbidden(
                "El snapshot no pertenece a la biblioteca solicitada.",
            ));
        }
        if !self
            .snapshot
            .users
            .iter()
            .any(|user_id| user_id == &self.context.library_user_id)
        {
            return Err(BackendError::new(
                BackendErrorCode::Unauthorized,
                "El usuario no está autorizado para esta biblioteca.",
                false,
            ));
        }
        TaskManagerSnapshotDto {
            version: TASK_MANAGER_SNAPSHOT_VERSION,
            libraries: vec![self.snapshot.clone()],
        }
        .validate()?;
        if self.routes.len() > MAX_TASK_TICKETS.saturating_mul(2) {
            return Err(invalid(
                "La respuesta de Task Manager supera el límite de rutas.",
            ));
        }
        if self.revisions.len()
            > MAX_TASK_BOARDS
                .saturating_add(MAX_TASK_GROUPS)
                .saturating_add(MAX_TASK_TICKETS)
        {
            return Err(invalid(
                "La respuesta de Task Manager supera el límite de revisiones.",
            ));
        }
        let bytes = serde_json::to_vec(self).map_err(|_| {
            BackendError::new(
                BackendErrorCode::Internal,
                "No se pudo serializar la lectura de Task Manager.",
                false,
            )
        })?;
        if bytes.len() > MAX_TASK_SNAPSHOT_BYTES {
            return Err(invalid(
                "La lectura de Task Manager supera el tamaño permitido.",
            ));
        }
        Ok(())
    }
}

impl TaskManagerSnapshotDto {
    pub fn validate(&self) -> Result<(), BackendError> {
        if self.version != TASK_MANAGER_SNAPSHOT_VERSION {
            return Err(invalid(
                "La versión del snapshot de Task Manager no es compatible.",
            ));
        }
        if self.libraries.len() > MAX_TASK_LIBRARIES {
            return Err(invalid(
                "El snapshot supera el límite de bibliotecas permitido.",
            ));
        }
        let mut library_ids = HashSet::new();
        for library in &self.libraries {
            if !library_ids.insert(&library.library_id) {
                return Err(invalid("El snapshot contiene bibliotecas duplicadas."));
            }
            validate_library_snapshot(library)?;
        }
        Ok(())
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, BackendError> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|_| {
            BackendError::new(
                BackendErrorCode::Internal,
                "No se pudo serializar el snapshot de Task Manager.",
                false,
            )
        })?;
        if bytes.len() > MAX_TASK_SNAPSHOT_BYTES {
            return Err(invalid(
                "El snapshot de Task Manager supera el tamaño permitido.",
            ));
        }
        Ok(bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, BackendError> {
        if bytes.len() > MAX_TASK_SNAPSHOT_BYTES {
            return Err(invalid(
                "El snapshot de Task Manager supera el tamaño permitido.",
            ));
        }
        let snapshot: Self = serde_json::from_slice(bytes)
            .map_err(|_| invalid("El snapshot de Task Manager no tiene un formato válido."))?;
        snapshot.validate()?;
        Ok(snapshot)
    }
}

pub trait TaskManagerReadPort: Send + Sync {
    fn list_boards(
        &self,
        request: &TaskManagerListRequest,
    ) -> Result<BoundedPage<TaskBoardDto>, BackendError>;
    fn list_groups(
        &self,
        request: &TaskManagerListRequest,
    ) -> Result<BoundedPage<TaskGroupDto>, BackendError>;
    fn list_tickets(
        &self,
        request: &TaskTicketListRequest,
    ) -> Result<BoundedPage<TaskTicketSummaryDto>, BackendError>;
    fn read_ticket(
        &self,
        request: &TaskTicketReadRequest,
    ) -> Result<TaskTicketReadDto, BackendError>;
    fn search_context(
        &self,
        request: &TaskContextSearchRequest,
    ) -> Result<BoundedPage<TaskContextHitDto>, BackendError>;
    fn get_options(
        &self,
        context: &TaskManagerContextDto,
        board_id: Option<&str>,
    ) -> Result<TaskManagerOptionsDto, BackendError>;
    fn board_summary(
        &self,
        context: &TaskManagerContextDto,
        board_id: &str,
    ) -> Result<TaskBoardSummaryDto, BackendError>;
}

pub trait TaskManagerMutationPort: Send + Sync {
    fn preview_mutation(
        &self,
        request: &TaskMutationRequestDto,
    ) -> Result<TaskMutationPreviewDto, BackendError>;
    fn apply_mutation(
        &self,
        request: &TaskMutationApplyRequestDto,
    ) -> Result<TaskMutationReceiptDto, BackendError>;
}

/// Durable storage boundary for one library.
///
/// The core owns validation and mutation ordering; filesystem/SQLite adapters
/// own the actual atomic write. A store must not expose a partially written
/// snapshot after `save` returns an error.
pub trait TaskManagerSnapshotStore: Send + Sync {
    fn load(&self, library_id: &str)
        -> Result<Option<TaskManagerLibrarySnapshotDto>, BackendError>;

    fn commit(&self, request: &TaskManagerStoreCommit) -> Result<(), BackendError>;

    /// Cheap token that changes whenever the persisted workspace changes
    /// (edits from other windows, sync tools or external editors). `None`
    /// means the store cannot tell, so every access reloads.
    fn change_token(&self, _library_id: &str) -> Result<Option<String>, BackendError> {
        Ok(None)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskManagerStoreCommit {
    pub library_id: String,
    pub snapshot: TaskManagerLibrarySnapshotDto,
    pub routes: Vec<TaskDocumentRouteDto>,
    pub revisions: Vec<TaskEntityRevisionDto>,
    pub operation: TaskManagerAppliedOperationDto,
}

#[derive(Debug, Clone)]
struct LibraryState {
    users: HashSet<String>,
    boards: BTreeMap<String, TaskBoardDto>,
    groups: BTreeMap<String, TaskGroupDto>,
    tickets: BTreeMap<String, TaskTicketDto>,
    comments: BTreeMap<String, TaskCommentDto>,
    generation: u64,
    config: TaskManagerConfigDto,
}

#[derive(Debug, Clone, Default)]
struct CoreState {
    libraries: BTreeMap<String, LibraryState>,
    previews: HashMap<PreviewKey, StoredPreview>,
    applied: HashMap<IdempotencyKey, TaskMutationReceiptDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct PreviewKey {
    library_id: String,
    library_user_id: String,
    operation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct IdempotencyKey {
    library_id: String,
    library_user_id: String,
    idempotency_key: String,
}

#[derive(Debug, Clone)]
struct StoredPreview {
    preview: TaskMutationPreviewDto,
    context: TaskManagerContextDto,
}

/// Deterministic reference adapter. It is intentionally volatile and does not
/// claim persistence; adapters for filesystem/SQLite/publication implement the
/// ports without changing the DTO or validation contract.
#[derive(Debug, Clone)]
pub struct InMemoryTaskManager {
    state: Arc<RwLock<CoreState>>,
}

/// Persistent facade over the domain adapter.
///
/// A preview remains in memory and is deliberately not written to the store.
/// Applying a confirmed mutation writes the resulting durable snapshot only
/// after the core accepts it; a failed write restores the previous state.
pub struct PersistentTaskManager {
    library_id: String,
    manager: InMemoryTaskManager,
    store: std::sync::Arc<dyn TaskManagerSnapshotStore>,
    /// Token of the persisted state last loaded; serializes reloads with
    /// applies so a reload never lands between an apply and its commit.
    loaded_token: std::sync::Mutex<Option<String>>,
}

impl std::fmt::Debug for PersistentTaskManager {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PersistentTaskManager")
            .field("library_id", &self.library_id)
            .finish_non_exhaustive()
    }
}

impl PersistentTaskManager {
    pub fn open(
        library_id: &str,
        store: std::sync::Arc<dyn TaskManagerSnapshotStore>,
    ) -> Result<Self, BackendError> {
        let library_id = validate_id("libraryId", library_id)?;
        let manager = InMemoryTaskManager::new();
        if let Some(snapshot) = store.load(&library_id)? {
            if snapshot.library_id != library_id {
                return Err(invalid(
                    "El snapshot persistido no pertenece a la biblioteca solicitada.",
                ));
            }
            manager.import_snapshot(TaskManagerSnapshotDto {
                version: TASK_MANAGER_SNAPSHOT_VERSION,
                libraries: vec![snapshot],
            })?;
        } else {
            manager.add_library(&library_id)?;
        }

        let loaded_token = store.change_token(&library_id)?;
        Ok(Self {
            library_id,
            manager,
            store,
            loaded_token: std::sync::Mutex::new(loaded_token),
        })
    }

    /// Validates the context and reloads the persisted workspace when it
    /// changed outside this manager, so reads and previews never work on a
    /// stale copy. Pending previews and idempotency records survive a reload;
    /// a preview built on replaced entities fails its base-revision check.
    fn ensure_context(&self, context: &TaskManagerContextDto) -> Result<(), BackendError> {
        context.validate()?;
        if context.library_id != self.library_id {
            return Err(forbidden(
                "La operación no pertenece a la biblioteca abierta.",
            ));
        }
        let mut loaded_token = self
            .loaded_token
            .lock()
            .map_err(|_| invalid("El estado de Task Manager no está disponible."))?;
        self.refresh_locked(&mut loaded_token)
    }

    fn refresh_locked(&self, loaded_token: &mut Option<String>) -> Result<(), BackendError> {
        let token = self.store.change_token(&self.library_id)?;
        if token.is_some() && token == *loaded_token {
            return Ok(());
        }
        if let Some(snapshot) = self.store.load(&self.library_id)? {
            self.manager.refresh_library(snapshot)?;
        }
        *loaded_token = token;
        Ok(())
    }

    pub fn ensure_user(&self, library_user_id: &str) -> Result<(), BackendError> {
        let library_user_id = validate_id("libraryUserId", library_user_id)?;
        self.manager.add_user(&self.library_id, &library_user_id)
    }

    fn library_snapshot(&self) -> Result<TaskManagerLibrarySnapshotDto, BackendError> {
        let snapshot = self.manager.export_snapshot()?;
        snapshot
            .libraries
            .into_iter()
            .next()
            .ok_or_else(|| invalid("El estado persistente no contiene la biblioteca abierta."))
    }

    pub fn read_snapshot(
        &self,
        context: &TaskManagerContextDto,
    ) -> Result<TaskManagerLibrarySnapshotDto, BackendError> {
        self.ensure_context(context)?;
        self.manager.read_snapshot(context)
    }
}

impl TaskManagerReadPort for PersistentTaskManager {
    fn list_boards(
        &self,
        request: &TaskManagerListRequest,
    ) -> Result<BoundedPage<TaskBoardDto>, BackendError> {
        self.ensure_context(&request.context)?;
        self.manager.list_boards(request)
    }

    fn list_groups(
        &self,
        request: &TaskManagerListRequest,
    ) -> Result<BoundedPage<TaskGroupDto>, BackendError> {
        self.ensure_context(&request.context)?;
        self.manager.list_groups(request)
    }

    fn list_tickets(
        &self,
        request: &TaskTicketListRequest,
    ) -> Result<BoundedPage<TaskTicketSummaryDto>, BackendError> {
        self.ensure_context(&request.context)?;
        self.manager.list_tickets(request)
    }

    fn read_ticket(
        &self,
        request: &TaskTicketReadRequest,
    ) -> Result<TaskTicketReadDto, BackendError> {
        self.ensure_context(&request.context)?;
        self.manager.read_ticket(request)
    }

    fn search_context(
        &self,
        request: &TaskContextSearchRequest,
    ) -> Result<BoundedPage<TaskContextHitDto>, BackendError> {
        self.ensure_context(&request.context)?;
        self.manager.search_context(request)
    }

    fn get_options(
        &self,
        context: &TaskManagerContextDto,
        board_id: Option<&str>,
    ) -> Result<TaskManagerOptionsDto, BackendError> {
        self.ensure_context(context)?;
        self.manager.get_options(context, board_id)
    }

    fn board_summary(
        &self,
        context: &TaskManagerContextDto,
        board_id: &str,
    ) -> Result<TaskBoardSummaryDto, BackendError> {
        self.ensure_context(context)?;
        self.manager.board_summary(context, board_id)
    }
}

impl TaskManagerMutationPort for PersistentTaskManager {
    fn preview_mutation(
        &self,
        request: &TaskMutationRequestDto,
    ) -> Result<TaskMutationPreviewDto, BackendError> {
        self.ensure_context(&request.context)?;
        self.manager.preview_mutation(request)
    }

    fn apply_mutation(
        &self,
        request: &TaskMutationApplyRequestDto,
    ) -> Result<TaskMutationReceiptDto, BackendError> {
        request.context.validate()?;
        if request.context.library_id != self.library_id {
            return Err(forbidden(
                "La operación no pertenece a la biblioteca abierta.",
            ));
        }
        let mut loaded_token = self
            .loaded_token
            .lock()
            .map_err(|_| invalid("El estado de Task Manager no está disponible."))?;
        self.refresh_locked(&mut loaded_token)?;
        let before = self.manager.export_snapshot()?;
        let receipt = self.manager.apply_mutation(request)?;
        if receipt.replayed {
            return Ok(receipt);
        }
        let next_snapshot = self.library_snapshot()?;
        let routes = next_snapshot
            .tickets
            .iter()
            .map(|ticket| TaskDocumentRouteDto {
                entity_type: "ticket".to_string(),
                entity_id: ticket.summary.ticket_id.clone(),
                logical_path: ticket.summary.logical_path.clone(),
            })
            .chain(
                next_snapshot
                    .comments
                    .iter()
                    .map(|comment| TaskDocumentRouteDto {
                        entity_type: "comment".to_string(),
                        entity_id: comment.comment_id.clone(),
                        logical_path: comment.logical_path.clone(),
                    }),
            )
            .collect();
        let revisions = receipt.revisions.clone();
        let commit = TaskManagerStoreCommit {
            library_id: self.library_id.clone(),
            snapshot: next_snapshot,
            routes,
            revisions,
            operation: TaskManagerAppliedOperationDto {
                library_id: receipt.library_id.clone(),
                library_user_id: receipt.library_user_id.clone(),
                operation_id: receipt.operation_id.clone(),
                idempotency_key: receipt.idempotency_key.clone(),
                affected_ids: receipt.affected_ids.clone(),
            },
        };
        if let Err(error) = self.store.commit(&commit) {
            self.manager.replace_snapshot(before)?;
            return Err(error);
        }
        // The commit is this manager's own change: remember its token so the
        // next access does not reload what is already in memory.
        *loaded_token = self.store.change_token(&self.library_id)?;
        Ok(receipt)
    }
}

impl Default for InMemoryTaskManager {
    fn default() -> Self {
        Self::new()
    }
}

impl InMemoryTaskManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(CoreState::default())),
        }
    }

    pub fn export_snapshot(&self) -> Result<TaskManagerSnapshotDto, BackendError> {
        let state = read_state(&self.state)?;
        let libraries = state
            .libraries
            .iter()
            .map(|(library_id, library)| library_snapshot(library_id, library))
            .collect::<Vec<_>>();
        let snapshot = TaskManagerSnapshotDto {
            version: TASK_MANAGER_SNAPSHOT_VERSION,
            libraries,
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    pub fn read_snapshot(
        &self,
        context: &TaskManagerContextDto,
    ) -> Result<TaskManagerLibrarySnapshotDto, BackendError> {
        let state = read_state(&self.state)?;
        let library = self.read_library(&state, context)?;
        let mut snapshot = library_snapshot(&context.library_id, library);
        let allowed_board_ids = &context.allowed_board_ids;
        if !allowed_board_ids.is_empty() {
            snapshot
                .boards
                .retain(|board| allowed_board_ids.contains(&board.board_id));
            let visible_board_ids = snapshot
                .boards
                .iter()
                .map(|board| board.board_id.as_str())
                .collect::<HashSet<_>>();
            snapshot
                .groups
                .retain(|group| visible_board_ids.contains(group.board_id.as_str()));
            snapshot
                .tickets
                .retain(|ticket| visible_board_ids.contains(ticket.summary.board_id.as_str()));
            let visible_ticket_ids = snapshot
                .tickets
                .iter()
                .map(|ticket| ticket.summary.ticket_id.as_str())
                .collect::<HashSet<_>>();
            snapshot
                .comments
                .retain(|comment| visible_ticket_ids.contains(comment.ticket_id.as_str()));
            snapshot
                .config
                .activity_hours_per_day
                .retain(|board_id, _| visible_board_ids.contains(board_id.as_str()));
        }
        TaskManagerSnapshotDto {
            version: TASK_MANAGER_SNAPSHOT_VERSION,
            libraries: vec![snapshot.clone()],
        }
        .validate()?;
        Ok(snapshot)
    }

    pub fn export_snapshot_bytes(&self) -> Result<Vec<u8>, BackendError> {
        self.export_snapshot()?.to_bytes()
    }

    /// Imports durable state by replacing all libraries. Operation previews
    /// and applied idempotency receipts are intentionally cleared because they
    /// are not part of the snapshot contract.
    pub fn import_snapshot(&self, snapshot: TaskManagerSnapshotDto) -> Result<(), BackendError> {
        self.replace_snapshot(snapshot)
    }

    /// Replaces one library with its persisted state while keeping the known
    /// users, pending previews and idempotency records of the session.
    pub fn refresh_library(
        &self,
        snapshot: TaskManagerLibrarySnapshotDto,
    ) -> Result<(), BackendError> {
        let mut next = library_state_from_snapshot(&snapshot)?;
        let mut state = write_state(&self.state)?;
        if let Some(current) = state.libraries.get(&snapshot.library_id) {
            next.users.extend(current.users.iter().cloned());
        }
        state.libraries.insert(snapshot.library_id.clone(), next);
        Ok(())
    }

    pub fn replace_snapshot(&self, snapshot: TaskManagerSnapshotDto) -> Result<(), BackendError> {
        let libraries = snapshot_to_libraries(&snapshot)?;
        let mut state = write_state(&self.state)?;
        state.libraries = libraries;
        state.previews.clear();
        state.applied.clear();
        Ok(())
    }

    pub fn import_serialized_snapshot(&self, bytes: &[u8]) -> Result<(), BackendError> {
        self.replace_serialized_snapshot(bytes)
    }

    pub fn replace_serialized_snapshot(&self, bytes: &[u8]) -> Result<(), BackendError> {
        self.replace_snapshot(TaskManagerSnapshotDto::from_bytes(bytes)?)
    }

    pub fn add_library(&self, library_id: &str) -> Result<(), BackendError> {
        let library_id = validate_id("libraryId", library_id)?;
        let mut state = write_state(&self.state)?;
        state
            .libraries
            .entry(library_id)
            .or_insert_with(|| LibraryState {
                users: HashSet::new(),
                boards: BTreeMap::new(),
                groups: BTreeMap::new(),
                tickets: BTreeMap::new(),
                comments: BTreeMap::new(),
                generation: 1,
                config: TaskManagerConfigDto::default(),
            });
        Ok(())
    }

    pub fn add_user(&self, library_id: &str, library_user_id: &str) -> Result<(), BackendError> {
        let library_id = validate_id("libraryId", library_id)?;
        let user_id = validate_id("libraryUserId", library_user_id)?;
        let mut state = write_state(&self.state)?;
        let library = state
            .libraries
            .get_mut(&library_id)
            .ok_or_else(|| not_found("La biblioteca no existe."))?;
        library.users.insert(user_id);
        Ok(())
    }

    pub fn seed_board(&self, board: TaskBoardDto) -> Result<(), BackendError> {
        board.validate()?;
        let mut state = write_state(&self.state)?;
        let library = library_mut(&mut state, &board.library_id)?;
        if library.boards.len() >= MAX_TASK_BOARDS && !library.boards.contains_key(&board.board_id)
        {
            return Err(invalid("La biblioteca supera el límite de tableros."));
        }
        library.boards.insert(board.board_id.clone(), board);
        Ok(())
    }

    pub fn seed_group(&self, group: TaskGroupDto) -> Result<(), BackendError> {
        group.validate()?;
        let mut state = write_state(&self.state)?;
        let library = library_mut(&mut state, &group.library_id)?;
        ensure_board_exists(library, &group.board_id)?;
        if library.groups.len() >= MAX_TASK_GROUPS && !library.groups.contains_key(&group.group_id)
        {
            return Err(invalid("La biblioteca supera el límite de grupos."));
        }
        library.groups.insert(group.group_id.clone(), group);
        Ok(())
    }

    pub fn seed_ticket(&self, ticket: TaskTicketDto) -> Result<(), BackendError> {
        validate_ticket(&ticket)?;
        let mut state = write_state(&self.state)?;
        let library = library_mut(&mut state, &ticket.summary.library_id)?;
        validate_ticket_relationships(library, &ticket.summary)?;
        if library.tickets.len() >= MAX_TASK_TICKETS
            && !library.tickets.contains_key(&ticket.summary.ticket_id)
        {
            return Err(invalid("La biblioteca supera el límite de tickets."));
        }
        library
            .tickets
            .insert(ticket.summary.ticket_id.clone(), ticket);
        Ok(())
    }

    pub fn seed_comment(&self, comment: TaskCommentDto) -> Result<(), BackendError> {
        validate_comment(&comment)?;
        let mut state = write_state(&self.state)?;
        let library = library_mut(&mut state, &comment.library_id)?;
        ensure_ticket_exists(library, &comment.ticket_id)?;
        library.comments.insert(comment.comment_id.clone(), comment);
        Ok(())
    }

    fn read_library<'a>(
        &self,
        state: &'a CoreState,
        context: &TaskManagerContextDto,
    ) -> Result<&'a LibraryState, BackendError> {
        context.validate()?;
        let library = state
            .libraries
            .get(&context.library_id)
            .ok_or_else(|| not_found("La biblioteca no existe."))?;
        if !library.users.contains(&context.library_user_id) {
            return Err(BackendError::new(
                BackendErrorCode::Unauthorized,
                "El usuario no está autorizado para esta biblioteca.",
                false,
            ));
        }
        if let Some(board_id) = &context.active_board_id {
            ensure_board_access(context, library, board_id)?;
        }
        Ok(library)
    }
}

impl TaskManagerReadPort for InMemoryTaskManager {
    fn list_boards(
        &self,
        request: &TaskManagerListRequest,
    ) -> Result<BoundedPage<TaskBoardDto>, BackendError> {
        let state = read_state(&self.state)?;
        let library = self.read_library(&state, &request.context)?;
        let mut boards = library
            .boards
            .values()
            .filter(|board| request.context.allows_board(&board.board_id))
            .cloned()
            .collect::<Vec<_>>();
        boards.sort_by(|left, right| {
            left.name
                .cmp(&right.name)
                .then_with(|| left.board_id.cmp(&right.board_id))
        });
        Ok(task_page(boards, request.offset, request.limit))
    }

    fn list_groups(
        &self,
        request: &TaskManagerListRequest,
    ) -> Result<BoundedPage<TaskGroupDto>, BackendError> {
        let state = read_state(&self.state)?;
        let library = self.read_library(&state, &request.context)?;
        if let Some(board_id) = &request.board_id {
            ensure_board_access(&request.context, library, board_id)?;
        }
        let mut groups = library
            .groups
            .values()
            .filter(|group| request.context.allows_board(&group.board_id))
            .filter(|group| {
                request
                    .board_id
                    .as_ref()
                    .is_none_or(|id| id == &group.board_id)
            })
            .cloned()
            .collect::<Vec<_>>();
        groups.sort_by(|left, right| {
            left.name
                .cmp(&right.name)
                .then_with(|| left.group_id.cmp(&right.group_id))
        });
        Ok(task_page(groups, request.offset, request.limit))
    }

    fn list_tickets(
        &self,
        request: &TaskTicketListRequest,
    ) -> Result<BoundedPage<TaskTicketSummaryDto>, BackendError> {
        let state = read_state(&self.state)?;
        let library = self.read_library(&state, &request.context)?;
        if let Some(board_id) = &request.board_id {
            ensure_board_access(&request.context, library, board_id)?;
        }
        if let Some(group_id) = &request.group_id {
            ensure_group_access(
                &request.context,
                library,
                group_id,
                request.board_id.as_deref(),
            )?;
        }
        let query = request.query.trim().to_lowercase();
        let mut tickets = library
            .tickets
            .values()
            .filter(|ticket| request.context.allows_board(&ticket.summary.board_id))
            .filter(|ticket| {
                request
                    .board_id
                    .as_ref()
                    .is_none_or(|id| id == &ticket.summary.board_id)
            })
            .filter(|ticket| {
                request
                    .group_id
                    .as_ref()
                    .is_none_or(|id| Some(id) == ticket.summary.group_id.as_ref())
            })
            .filter(|ticket| {
                request.states.is_empty() || request.states.contains(&ticket.summary.state)
            })
            .filter(|ticket| {
                request.priorities.is_empty()
                    || request.priorities.contains(&ticket.summary.priority)
            })
            .filter(|ticket| request.include_archived || !ticket.summary.state.is_archived())
            .filter(|ticket| {
                query.is_empty()
                    || ticket.summary.title.to_lowercase().contains(&query)
                    || ticket.content.to_lowercase().contains(&query)
            })
            .map(|ticket| ticket.summary.clone())
            .collect::<Vec<_>>();
        tickets.sort_by(|left, right| {
            left.summary_order_key()
                .cmp(&right.summary_order_key())
                .then_with(|| left.ticket_id.cmp(&right.ticket_id))
        });
        Ok(task_page(tickets, request.offset, request.limit))
    }

    fn read_ticket(
        &self,
        request: &TaskTicketReadRequest,
    ) -> Result<TaskTicketReadDto, BackendError> {
        validate_id("ticketId", &request.ticket_id)?;
        let state = read_state(&self.state)?;
        let library = self.read_library(&state, &request.context)?;
        let ticket = library
            .tickets
            .get(&request.ticket_id)
            .ok_or_else(|| not_found("El ticket no existe."))?;
        ensure_board_access(&request.context, library, &ticket.summary.board_id)?;
        if !request.include_archived && ticket.summary.state.is_archived() {
            return Err(not_found(
                "El ticket no está disponible en el alcance activo.",
            ));
        }
        let mut subtasks = library
            .tickets
            .values()
            .filter(|candidate| {
                candidate.summary.parent_ticket_id.as_ref() == Some(&request.ticket_id)
            })
            .map(|candidate| candidate.summary.clone())
            .collect::<Vec<_>>();
        subtasks.sort_by(|left, right| {
            left.title
                .cmp(&right.title)
                .then_with(|| left.ticket_id.cmp(&right.ticket_id))
        });
        let mut comments = library
            .comments
            .values()
            .filter(|comment| comment.ticket_id == request.ticket_id)
            .cloned()
            .collect::<Vec<_>>();
        comments.sort_by(|left, right| {
            left.created_at_unix_ms
                .cmp(&right.created_at_unix_ms)
                .then_with(|| left.comment_id.cmp(&right.comment_id))
        });
        Ok(TaskTicketReadDto {
            ticket: ticket.clone(),
            subtasks: task_page(subtasks, request.subtask_offset, request.subtask_limit),
            comments: task_page(comments, request.comment_offset, request.comment_limit),
        })
    }

    fn search_context(
        &self,
        request: &TaskContextSearchRequest,
    ) -> Result<BoundedPage<TaskContextHitDto>, BackendError> {
        validate_text("query", &request.query, MAX_TASK_NAME_CHARS)?;
        let state = read_state(&self.state)?;
        let library = self.read_library(&state, &request.context)?;
        if let Some(board_id) = &request.board_id {
            ensure_board_access(&request.context, library, board_id)?;
        }
        let allowed_ids = request.ticket_ids.iter().collect::<HashSet<_>>();
        let query_terms = request
            .query
            .split_whitespace()
            .map(str::to_lowercase)
            .collect::<Vec<_>>();
        let mut hits = library
            .tickets
            .values()
            .filter(|ticket| request.context.allows_board(&ticket.summary.board_id))
            .filter(|ticket| {
                request
                    .board_id
                    .as_ref()
                    .is_none_or(|id| id == &ticket.summary.board_id)
            })
            .filter(|ticket| {
                allowed_ids.is_empty() || allowed_ids.contains(&ticket.summary.ticket_id)
            })
            .filter(|ticket| request.include_archived || !ticket.summary.state.is_archived())
            .filter_map(|ticket| {
                let haystack =
                    format!("{} {}", ticket.summary.title, ticket.content).to_lowercase();
                let score = query_terms
                    .iter()
                    .filter(|term| haystack.contains(term.as_str()))
                    .count() as u32;
                (score > 0).then(|| TaskContextHitDto {
                    library_id: ticket.summary.library_id.clone(),
                    ticket_id: ticket.summary.ticket_id.clone(),
                    board_id: ticket.summary.board_id.clone(),
                    title: ticket.summary.title.clone(),
                    excerpt: bounded_preview(&ticket.content, 400),
                    score,
                })
            })
            .collect::<Vec<_>>();
        hits.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.ticket_id.cmp(&right.ticket_id))
        });
        Ok(task_page(hits, 0, request.limit))
    }

    fn get_options(
        &self,
        context: &TaskManagerContextDto,
        board_id: Option<&str>,
    ) -> Result<TaskManagerOptionsDto, BackendError> {
        let state = read_state(&self.state)?;
        let library = self.read_library(&state, context)?;
        let selected_board_id = board_id.or(context.active_board_id.as_deref());
        if let Some(board_id) = selected_board_id {
            ensure_board_access(context, library, board_id)?;
        }
        let boards = library
            .boards
            .values()
            .filter(|board| context.allows_board(&board.board_id))
            .cloned()
            .collect::<Vec<_>>();
        let groups = library
            .groups
            .values()
            .filter(|group| context.allows_board(&group.board_id))
            .filter(|group| selected_board_id.is_none_or(|id| id == group.board_id))
            .cloned()
            .collect::<Vec<_>>();
        let board = selected_board_id.and_then(|id| library.boards.get(id).cloned());
        Ok(TaskManagerOptionsDto {
            library_id: context.library_id.clone(),
            board,
            boards: task_page(boards, 0, MAX_TASK_RESULTS),
            groups: task_page(groups, 0, MAX_TASK_RESULTS),
            states: vec![
                TaskState::Pending,
                TaskState::Cancelled,
                TaskState::InProgress,
                TaskState::Completed,
                TaskState::Blocked,
            ],
            priorities: vec![
                TaskPriority::Low,
                TaskPriority::Medium,
                TaskPriority::High,
                TaskPriority::Urgent,
            ],
        })
    }

    fn board_summary(
        &self,
        context: &TaskManagerContextDto,
        board_id: &str,
    ) -> Result<TaskBoardSummaryDto, BackendError> {
        let state = read_state(&self.state)?;
        let library = self.read_library(&state, context)?;
        ensure_board_access(context, library, board_id)?;
        ensure_board_exists(library, board_id)?;
        let tickets = library
            .tickets
            .values()
            .filter(|ticket| ticket.summary.board_id == board_id);
        let mut summary = TaskBoardSummaryDto {
            library_id: context.library_id.clone(),
            board_id: board_id.to_string(),
            total_tickets: 0,
            by_state: BTreeMap::new(),
            by_priority: BTreeMap::new(),
            by_group: BTreeMap::new(),
        };
        for ticket in tickets {
            summary.total_tickets += 1;
            *summary.by_state.entry(ticket.summary.state).or_default() += 1;
            *summary
                .by_priority
                .entry(ticket.summary.priority)
                .or_default() += 1;
            *summary
                .by_group
                .entry(ticket.summary.group_id.clone().unwrap_or_default())
                .or_default() += 1;
        }
        Ok(summary)
    }
}

impl TaskManagerMutationPort for InMemoryTaskManager {
    fn preview_mutation(
        &self,
        request: &TaskMutationRequestDto,
    ) -> Result<TaskMutationPreviewDto, BackendError> {
        request.validate()?;
        let fingerprint = mutation_fingerprint(request)?;
        let key = PreviewKey {
            library_id: request.context.library_id.clone(),
            library_user_id: request.context.library_user_id.clone(),
            operation_id: request.operation_id.clone(),
        };
        let state = read_state(&self.state)?;
        if let Some(existing) = state.previews.get(&key) {
            if existing.preview.fingerprint == fingerprint
                && existing.preview.idempotency_key == request.idempotency_key
                && existing.context == request.context
            {
                return Ok(existing.preview.clone());
            }
            return Err(conflict("El operationId ya corresponde a otro preview."));
        }
        let library = self.read_library(&state, &request.context)?;
        let base_revisions = validate_mutation(library, &request.context, &request.mutation)?;
        let (ticket_ids, board_ids) = affected_ids(&request.mutation);
        let preview = TaskMutationPreviewDto {
            library_id: request.context.library_id.clone(),
            library_user_id: request.context.library_user_id.clone(),
            operation_id: request.operation_id.clone(),
            idempotency_key: request.idempotency_key.clone(),
            summary: mutation_summary(&request.mutation),
            mutation: request.mutation.clone(),
            base_revisions,
            affected_ticket_ids: ticket_ids,
            affected_board_ids: board_ids,
            fingerprint,
            allowed_actions: vec![
                MutationPreviewAction::ApplyAll,
                MutationPreviewAction::Reject,
                MutationPreviewAction::Cancel,
            ],
        };
        drop(state);
        let mut state = write_state(&self.state)?;
        state.previews.insert(
            key,
            StoredPreview {
                preview: preview.clone(),
                context: request.context.clone(),
            },
        );
        Ok(preview)
    }

    fn apply_mutation(
        &self,
        request: &TaskMutationApplyRequestDto,
    ) -> Result<TaskMutationReceiptDto, BackendError> {
        request.context.validate()?;
        validate_id("operationId", &request.operation_id)?;
        validate_id("idempotencyKey", &request.idempotency_key)?;
        let idempotency_key = IdempotencyKey {
            library_id: request.context.library_id.clone(),
            library_user_id: request.context.library_user_id.clone(),
            idempotency_key: request.idempotency_key.clone(),
        };
        let mut state = write_state(&self.state)?;
        if let Some(receipt) = state.applied.get(&idempotency_key) {
            if receipt.operation_id != request.operation_id {
                return Err(conflict(
                    "La clave de idempotencia ya fue usada por otra operación.",
                ));
            }
            let mut replay = receipt.clone();
            replay.replayed = true;
            return Ok(replay);
        }
        if !request.confirmed {
            return Err(BackendError::new(
                BackendErrorCode::Cancelled,
                "La mutación requiere confirmación explícita.",
                true,
            ));
        }
        let preview_key = PreviewKey {
            library_id: request.context.library_id.clone(),
            library_user_id: request.context.library_user_id.clone(),
            operation_id: request.operation_id.clone(),
        };
        let stored = state
            .previews
            .get(&preview_key)
            .cloned()
            .ok_or_else(|| not_found("El preview de la mutación ya no está disponible."))?;
        if stored.preview.idempotency_key != request.idempotency_key
            || stored.context != request.context
        {
            return Err(conflict(
                "El preview no pertenece a este usuario u operación.",
            ));
        }
        let library = state
            .libraries
            .get(&request.context.library_id)
            .ok_or_else(|| not_found("La biblioteca no existe."))?;
        ensure_user(library, &request.context.library_user_id)?;
        ensure_base_revisions(library, &stored.preview.base_revisions)?;
        let mut next_library = library.clone();
        let (affected_ids, entity_keys) = apply_mutation_to_library(
            &mut next_library,
            &request.context,
            &stored.preview.mutation,
        )?;
        next_library.generation = next_library.generation.saturating_add(1);
        let revisions = entity_keys
            .iter()
            .filter_map(|key| current_entity_revision(&next_library, key).ok())
            .collect::<Vec<_>>();
        let receipt = TaskMutationReceiptDto {
            library_id: request.context.library_id.clone(),
            library_user_id: request.context.library_user_id.clone(),
            operation_id: request.operation_id.clone(),
            idempotency_key: request.idempotency_key.clone(),
            changed: true,
            affected_ids,
            revisions,
            replayed: false,
        };
        state
            .libraries
            .insert(request.context.library_id.clone(), next_library);
        state.previews.remove(&preview_key);
        state.applied.insert(idempotency_key, receipt.clone());
        Ok(receipt)
    }
}

fn validate_mutation(
    library: &LibraryState,
    context: &TaskManagerContextDto,
    mutation: &TaskMutationDto,
) -> Result<Vec<TaskEntityRevisionDto>, BackendError> {
    let mut revisions = Vec::new();
    match mutation {
        TaskMutationDto::CreateBoard {
            board_id,
            name,
            color,
            context: board_context,
            activity_hours_per_day,
        } => {
            validate_activity_hours(*activity_hours_per_day)?;
            validate_id("boardId", board_id)?;
            validate_name("boardName", name, MAX_TASK_NAME_CHARS)?;
            validate_color(color)?;
            if let Some(board_context) = board_context {
                validate_context(board_context)?;
            }
            if !context.allows_board(board_id) {
                return Err(forbidden("El tablero no pertenece al alcance autorizado."));
            }
            if library.boards.contains_key(board_id) {
                return Err(conflict("El tablero ya existe."));
            }
        }
        TaskMutationDto::UpdateBoard {
            board_id,
            name,
            color,
            context: board_context,
            activity_hours_per_day,
        } => {
            validate_activity_hours(*activity_hours_per_day)?;
            let board = accessible_board(library, context, board_id)?;
            if let Some(name) = name {
                validate_name("boardName", name, MAX_TASK_NAME_CHARS)?;
            }
            if let Some(color) = color {
                validate_color(color)?;
            }
            if let Some(board_context) = board_context {
                validate_context(board_context)?;
            }
            revisions.push(entity_revision("board", &board.board_id, board.revision));
        }
        TaskMutationDto::DeleteBoard { board_id } => {
            let board = accessible_board(library, context, board_id)?;
            if library
                .tickets
                .values()
                .any(|ticket| ticket.summary.board_id == *board_id)
            {
                return Err(conflict("No se puede eliminar un tablero con tickets."));
            }
            if library
                .groups
                .values()
                .any(|group| group.board_id == *board_id)
            {
                return Err(conflict("No se puede eliminar un tablero con grupos."));
            }
            revisions.push(entity_revision("board", &board.board_id, board.revision));
        }
        TaskMutationDto::CreateGroup {
            board_id,
            group_id,
            name,
            color,
        } => {
            let board = accessible_board(library, context, board_id)?;
            validate_id("groupId", group_id)?;
            validate_name("groupName", name, MAX_TASK_NAME_CHARS)?;
            validate_color(color)?;
            if library.groups.contains_key(group_id) {
                return Err(conflict("El grupo ya existe."));
            }
            revisions.push(entity_revision("board", board_id, board.revision));
        }
        TaskMutationDto::DeleteGroup { board_id, group_id } => {
            let board = accessible_board(library, context, board_id)?;
            let group = library
                .groups
                .get(group_id)
                .ok_or_else(|| not_found("El grupo no existe."))?;
            if group.board_id != *board_id {
                return Err(forbidden("El grupo no pertenece al tablero."));
            }
            if library
                .tickets
                .values()
                .any(|ticket| ticket.summary.group_id.as_ref() == Some(group_id))
            {
                return Err(conflict(
                    "No se puede eliminar un grupo con tickets asignados.",
                ));
            }
            revisions.push(entity_revision("board", board_id, board.revision));
            revisions.push(entity_revision("group", group_id, group.revision));
        }
        TaskMutationDto::UpdateGroup {
            board_id,
            group_id,
            name,
            color,
        } => {
            let board = accessible_board(library, context, board_id)?;
            let group = library
                .groups
                .get(group_id)
                .ok_or_else(|| not_found("El grupo no existe."))?;
            if group.board_id != *board_id {
                return Err(forbidden("El grupo no pertenece al tablero."));
            }
            validate_name("groupName", name, MAX_TASK_NAME_CHARS)?;
            validate_color(color)?;
            if library
                .groups
                .values()
                .any(|candidate| candidate.board_id == *board_id && candidate.group_id != *group_id && candidate.name == *name)
            {
                return Err(conflict("Ya existe un grupo con ese nombre en el tablero."));
            }
            revisions.push(entity_revision("board", &board.board_id, board.revision));
            revisions.push(entity_revision("group", group_id, group.revision));
        }
        TaskMutationDto::ReorderGroups { board_id, group_ids } => {
            let board = accessible_board(library, context, board_id)?;
            if group_ids.is_empty() || group_ids.len() > MAX_TASK_GROUPS {
                return Err(invalid("El orden de grupos no es válido."));
            }
            let mut seen = HashSet::new();
            for group_id in group_ids {
                if !seen.insert(group_id) {
                    return Err(invalid("El orden de grupos contiene duplicados."));
                }
                let group = library
                    .groups
                    .get(group_id)
                    .ok_or_else(|| not_found("El grupo no existe."))?;
                if group.board_id != *board_id {
                    return Err(forbidden("El grupo no pertenece al tablero."));
                }
                revisions.push(entity_revision("group", group_id, group.revision));
            }
            revisions.push(entity_revision("board", &board.board_id, board.revision));
        }
        TaskMutationDto::CreateTicket {
            board_id,
            ticket_id,
            group_id,
            title,
            content,
            parent_ticket_id,
            tags,
            initial_fields,
            ..
        } => {
            let board = accessible_board(library, context, board_id)?;
            validate_id("ticketId", ticket_id)?;
            if let Some(fields) = initial_fields {
                fields.validate()?;
                if fields.parent_ticket_id.is_some() || fields.group_id.is_some() {
                    return Err(invalid(
                        "El padre y el grupo de un ticket nuevo van en sus campos propios.",
                    ));
                }
            }
            validate_title("title", title, MAX_TASK_TITLE_CHARS)?;
            validate_text("content", content, MAX_TASK_TEXT_CHARS)?;
            validate_tags(tags)?;
            validate_group_for_board(library, group_id.as_deref(), board_id)?;
            if library.tickets.contains_key(ticket_id) {
                return Err(conflict("El ticket ya existe."));
            }
            revisions.push(entity_revision("board", board_id, board.revision));
            if let Some(parent_id) = parent_ticket_id {
                let parent = root_parent_for_board(library, parent_id, board_id)?;
                revisions.push(entity_revision(
                    "ticket",
                    parent_id,
                    parent.summary.revision,
                ));
            }
        }
        TaskMutationDto::ReplaceTicketContent { ticket_id, content } => {
            validate_text("content", content, MAX_TASK_TEXT_CHARS)?;
            let ticket = accessible_ticket(library, context, ticket_id)?;
            revisions.push(entity_revision(
                "ticket",
                ticket_id,
                ticket.summary.revision,
            ));
        }
        TaskMutationDto::AddComment {
            ticket_id,
            comment_id,
            body,
            ..
        } => {
            validate_id("commentId", comment_id)?;
            validate_text("comment", body, MAX_TASK_TEXT_CHARS)?;
            if library.comments.contains_key(comment_id) {
                return Err(conflict("El comentario ya existe."));
            }
            let ticket = accessible_ticket(library, context, ticket_id)?;
            revisions.push(entity_revision(
                "ticket",
                ticket_id,
                ticket.summary.revision,
            ));
        }
        TaskMutationDto::AddSubtask {
            parent_ticket_id,
            ticket_id,
            title,
            content,
            ..
        } => {
            validate_id("ticketId", ticket_id)?;
            validate_title("title", title, MAX_TASK_TITLE_CHARS)?;
            validate_text("content", content, MAX_TASK_TEXT_CHARS)?;
            if library.tickets.contains_key(ticket_id) {
                return Err(conflict("El ticket ya existe."));
            }
            let parent = accessible_ticket(library, context, parent_ticket_id)?;
            let parent =
                root_parent_for_board(library, parent_ticket_id, &parent.summary.board_id)?;
            revisions.push(entity_revision(
                "ticket",
                parent_ticket_id,
                parent.summary.revision,
            ));
            if let Some(group_id) = &parent.summary.group_id {
                let group = library
                    .groups
                    .get(group_id)
                    .ok_or_else(|| not_found("El grupo del padre no existe."))?;
                revisions.push(entity_revision("group", group_id, group.revision));
            }
        }
        TaskMutationDto::MoveTicket {
            ticket_id,
            group_id,
        } => {
            let ticket = accessible_ticket(library, context, ticket_id)?;
            validate_group_for_board(library, group_id.as_deref(), &ticket.summary.board_id)?;
            revisions.push(entity_revision(
                "ticket",
                ticket_id,
                ticket.summary.revision,
            ));
        }
        TaskMutationDto::ChangeState { ticket_id, .. }
        | TaskMutationDto::ChangePriority { ticket_id, .. } => {
            let ticket = accessible_ticket(library, context, ticket_id)?;
            revisions.push(entity_revision(
                "ticket",
                ticket_id,
                ticket.summary.revision,
            ));
        }
        TaskMutationDto::UpdateTicket { ticket_id, fields } => {
            fields.validate()?;
            if fields.is_empty() {
                return Err(invalid("La actualización no contiene campos."));
            }
            let ticket = accessible_ticket(library, context, ticket_id)?;
            validate_group_for_board(
                library,
                fields.group_id.as_deref(),
                &ticket.summary.board_id,
            )?;
            if let Some(Some(parent_id)) = &fields.parent_ticket_id {
                let parent = accessible_ticket(library, context, parent_id)?;
                if parent.summary.board_id != ticket.summary.board_id || parent_id == ticket_id {
                    return Err(invalid("La tarea padre no pertenece al mismo tablero."));
                }
            }
            revisions.push(entity_revision(
                "ticket",
                ticket_id,
                ticket.summary.revision,
            ));
        }
        TaskMutationDto::BulkUpdate { ticket_ids, fields } => {
            fields.validate()?;
            if fields.is_empty()
                || ticket_ids.is_empty()
                || ticket_ids.len() > MAX_TASK_BULK_TICKETS
            {
                return Err(invalid(
                    "La actualización masiva debe incluir entre 1 y 50 tickets y campos.",
                ));
            }
            let mut seen = HashSet::new();
            for ticket_id in ticket_ids {
                if !seen.insert(ticket_id) {
                    return Err(invalid(
                        "La actualización masiva contiene tickets duplicados.",
                    ));
                }
                let ticket = accessible_ticket(library, context, ticket_id)?;
                validate_group_for_board(
                    library,
                    fields.group_id.as_deref(),
                    &ticket.summary.board_id,
                )?;
                if let Some(Some(parent_id)) = &fields.parent_ticket_id {
                    let parent = accessible_ticket(library, context, parent_id)?;
                    if parent.summary.board_id != ticket.summary.board_id || parent_id == ticket_id {
                        return Err(invalid("La tarea padre no pertenece al mismo tablero."));
                    }
                }
                revisions.push(entity_revision(
                    "ticket",
                    ticket_id,
                    ticket.summary.revision,
                ));
            }
        }
        TaskMutationDto::DuplicateTicket {
            ticket_id,
            new_ticket_id,
            title,
        } => {
            let ticket = accessible_ticket(library, context, ticket_id)?;
            validate_id("newTicketId", new_ticket_id)?;
            if library.tickets.contains_key(new_ticket_id) {
                return Err(conflict("El ticket duplicado ya existe."));
            }
            if let Some(title) = title {
                validate_title("title", title, MAX_TASK_TITLE_CHARS)?;
            }
            revisions.push(entity_revision(
                "ticket",
                ticket_id,
                ticket.summary.revision,
            ));
            let board = library
                .boards
                .get(&ticket.summary.board_id)
                .ok_or_else(|| not_found("El tablero no existe."))?;
            revisions.push(entity_revision("board", &board.board_id, board.revision));
        }
        TaskMutationDto::ArchiveTicket { ticket_id }
        | TaskMutationDto::RestoreTicket { ticket_id } => {
            let ticket = accessible_ticket(library, context, ticket_id)?;
            revisions.push(entity_revision(
                "ticket",
                ticket_id,
                ticket.summary.revision,
            ));
        }
        TaskMutationDto::DeleteTicket { ticket_id } => {
            let ticket = accessible_ticket(library, context, ticket_id)?;
            if library.tickets.values().any(|candidate| candidate.summary.parent_ticket_id.as_deref() == Some(ticket_id)) {
                return Err(conflict("No se puede eliminar un ticket con subtareas."));
            }
            revisions.push(entity_revision("ticket", ticket_id, ticket.summary.revision));
        }
    }
    revisions.sort_by(|left, right| {
        left.entity_type
            .cmp(&right.entity_type)
            .then_with(|| left.entity_id.cmp(&right.entity_id))
    });
    Ok(revisions)
}

fn apply_mutation_to_library(
    library: &mut LibraryState,
    context: &TaskManagerContextDto,
    mutation: &TaskMutationDto,
) -> Result<(Vec<String>, Vec<EntityKey>), BackendError> {
    let mut affected_ids = Vec::new();
    let mut entity_keys = Vec::new();
    match mutation {
        TaskMutationDto::CreateBoard {
            board_id,
            name,
            color,
            context: board_context,
            activity_hours_per_day,
        } => {
            if let Some(hours) = activity_hours_per_day {
                library
                    .config
                    .activity_hours_per_day
                    .insert(board_id.clone(), *hours);
            }
            library.boards.insert(
                board_id.clone(),
                TaskBoardDto {
                    library_id: context.library_id.clone(),
                    board_id: board_id.clone(),
                    name: name.clone(),
                    color: color.clone(),
                    context: board_context.clone(),
                    revision: 1,
                },
            );
            affected_ids.push(board_id.clone());
            entity_keys.push(EntityKey::new("board", board_id));
        }
        TaskMutationDto::UpdateBoard {
            board_id,
            name,
            color,
            context: board_context,
            activity_hours_per_day,
        } => {
            if let Some(hours) = activity_hours_per_day {
                library
                    .config
                    .activity_hours_per_day
                    .insert(board_id.clone(), *hours);
            }
            let board = library
                .boards
                .get_mut(board_id)
                .ok_or_else(|| not_found("El tablero no existe."))?;
            if let Some(name) = name {
                board.name = name.clone();
            }
            if let Some(color) = color {
                board.color = color.clone();
            }
            if board_context.is_some() {
                board.context = board_context.clone();
            }
            board.revision = board.revision.saturating_add(1);
            affected_ids.push(board_id.clone());
            entity_keys.push(EntityKey::new("board", board_id));
        }
        TaskMutationDto::DeleteBoard { board_id } => {
            library.boards.remove(board_id);
            affected_ids.push(board_id.clone());
        }
        TaskMutationDto::CreateGroup {
            board_id,
            group_id,
            name,
            color,
        } => {
            library.groups.insert(
                group_id.clone(),
                TaskGroupDto {
                    library_id: context.library_id.clone(),
                    group_id: group_id.clone(),
                    board_id: board_id.clone(),
                    name: name.clone(),
                    color: color.clone(),
                    revision: 1,
                    order: library.groups.values().filter(|group| group.board_id == *board_id).count() as u32,
                },
            );
            affected_ids.push(group_id.clone());
            entity_keys.push(EntityKey::new("group", group_id));
        }
        TaskMutationDto::DeleteGroup { group_id, .. } => {
            library.groups.remove(group_id);
            affected_ids.push(group_id.clone());
        }
        TaskMutationDto::UpdateGroup {
            group_id,
            name,
            color,
            ..
        } => {
            let group = library
                .groups
                .get_mut(group_id)
                .ok_or_else(|| not_found("El grupo no existe."))?;
            group.name = name.clone();
            group.color = color.clone();
            group.revision = group.revision.saturating_add(1);
            affected_ids.push(group_id.clone());
            entity_keys.push(EntityKey::new("group", group_id));
        }
        TaskMutationDto::ReorderGroups { group_ids, .. } => {
            for (order, group_id) in group_ids.iter().enumerate() {
                if let Some(group) = library.groups.get_mut(group_id) {
                    group.order = order as u32;
                    group.revision = group.revision.saturating_add(1);
                }
                affected_ids.push(group_id.clone());
                entity_keys.push(EntityKey::new("group", group_id));
            }
        }
        TaskMutationDto::CreateTicket {
            board_id,
            ticket_id,
            group_id,
            title,
            content,
            state,
            priority,
            parent_ticket_id,
            tags,
            initial_fields,
        } => {
            let mut ticket = TaskTicketDto {
                summary: TaskTicketSummaryDto {
                    library_id: context.library_id.clone(),
                    ticket_id: ticket_id.clone(),
                    board_id: board_id.clone(),
                    group_id: group_id.clone(),
                    title: title.clone(),
                    state: *state,
                    priority: *priority,
                    parent_ticket_id: parent_ticket_id.clone(),
                    detail_preview: bounded_preview(content, 180),
                    revision: 1,
                    logical_path: String::new(),
                },
                content: content.clone(),
                tags: tags.clone(),
                dependencies: Vec::new(),
                checklist: Vec::new(),
                start_date: String::new(),
                end_date: String::new(),
                dynamic_end_date: default_dynamic_end_date(),
                dedicated_hours: 0.0,
                estimated_hours: 0.0,
                deviation_hours: 0.0,
                order: default_task_order(),
                context: None,
                related_documents: Vec::new(),
                related_tasks: Vec::new(),
            };
            if let Some(fields) = initial_fields {
                apply_fields(&mut ticket, fields);
                ticket.summary.revision = 1;
            }
            library.tickets.insert(ticket_id.clone(), ticket);
            affected_ids.push(ticket_id.clone());
            entity_keys.push(EntityKey::new("ticket", ticket_id));
        }
        TaskMutationDto::ReplaceTicketContent { ticket_id, content } => {
            let ticket = library
                .tickets
                .get_mut(ticket_id)
                .ok_or_else(|| not_found("El ticket no existe."))?;
            ticket.content = content.clone();
            ticket.summary.detail_preview = bounded_preview(content, 180);
            ticket.summary.revision = ticket.summary.revision.saturating_add(1);
            affected_ids.push(ticket_id.clone());
            entity_keys.push(EntityKey::new("ticket", ticket_id));
        }
        TaskMutationDto::AddComment {
            ticket_id,
            comment_id,
            body,
            created_at_unix_ms,
        } => {
            let ticket = library
                .tickets
                .get_mut(ticket_id)
                .ok_or_else(|| not_found("El ticket no existe."))?;
            library.comments.insert(
                comment_id.clone(),
                TaskCommentDto {
                    library_id: context.library_id.clone(),
                    comment_id: comment_id.clone(),
                    ticket_id: ticket_id.clone(),
                    author_user_id: context.library_user_id.clone(),
                    body: body.clone(),
                    created_at_unix_ms: *created_at_unix_ms,
                    revision: 1,
                    logical_path: String::new(),
                },
            );
            ticket.summary.revision = ticket.summary.revision.saturating_add(1);
            affected_ids.push(comment_id.clone());
            entity_keys.push(EntityKey::new("ticket", ticket_id));
        }
        TaskMutationDto::AddSubtask {
            parent_ticket_id,
            ticket_id,
            title,
            content,
            priority,
        } => {
            let parent = library
                .tickets
                .get(parent_ticket_id)
                .ok_or_else(|| not_found("El ticket padre no existe."))?
                .clone();
            let ticket = TaskTicketDto {
                summary: TaskTicketSummaryDto {
                    library_id: context.library_id.clone(),
                    ticket_id: ticket_id.clone(),
                    board_id: parent.summary.board_id.clone(),
                    group_id: parent.summary.group_id.clone(),
                    title: title.clone(),
                    state: TaskState::Pending,
                    priority: *priority,
                    parent_ticket_id: Some(parent_ticket_id.clone()),
                    detail_preview: bounded_preview(content, 180),
                    revision: 1,
                    logical_path: String::new(),
                },
                content: content.clone(),
                tags: vec!["sub-task".to_string()],
                dependencies: Vec::new(),
                checklist: Vec::new(),
                start_date: String::new(),
                end_date: String::new(),
                dynamic_end_date: default_dynamic_end_date(),
                dedicated_hours: 0.0,
                estimated_hours: 0.0,
                deviation_hours: 0.0,
                order: default_task_order(),
                context: None,
                related_documents: Vec::new(),
                related_tasks: Vec::new(),
            };
            library.tickets.insert(ticket_id.clone(), ticket);
            affected_ids.push(ticket_id.clone());
            entity_keys.push(EntityKey::new("ticket", ticket_id));
        }
        TaskMutationDto::MoveTicket {
            ticket_id,
            group_id,
        } => update_ticket(
            library,
            ticket_id,
            |ticket| ticket.summary.group_id = group_id.clone(),
            &mut affected_ids,
            &mut entity_keys,
        )?,
        TaskMutationDto::ChangeState { ticket_id, state } => update_ticket(
            library,
            ticket_id,
            |ticket| ticket.summary.state = *state,
            &mut affected_ids,
            &mut entity_keys,
        )?,
        TaskMutationDto::ChangePriority {
            ticket_id,
            priority,
        } => update_ticket(
            library,
            ticket_id,
            |ticket| ticket.summary.priority = *priority,
            &mut affected_ids,
            &mut entity_keys,
        )?,
        TaskMutationDto::UpdateTicket { ticket_id, fields } => update_ticket(
            library,
            ticket_id,
            |ticket| apply_fields(ticket, fields),
            &mut affected_ids,
            &mut entity_keys,
        )?,
        TaskMutationDto::BulkUpdate { ticket_ids, fields } => {
            for ticket_id in ticket_ids {
                update_ticket(
                    library,
                    ticket_id,
                    |ticket| apply_fields(ticket, fields),
                    &mut affected_ids,
                    &mut entity_keys,
                )?;
            }
        }
        TaskMutationDto::DuplicateTicket {
            ticket_id,
            new_ticket_id,
            title,
        } => {
            let source = library
                .tickets
                .get(ticket_id)
                .ok_or_else(|| not_found("El ticket no existe."))?
                .clone();
            let mut copy = source.clone();
            copy.summary.ticket_id = new_ticket_id.clone();
            copy.summary.title = title
                .clone()
                .unwrap_or_else(|| format!("Copia de {}", source.summary.title));
            copy.summary.parent_ticket_id = source.summary.parent_ticket_id.clone();
            copy.summary.revision = 1;
            copy.summary.detail_preview = bounded_preview(&copy.content, 180);
            library.tickets.insert(new_ticket_id.clone(), copy);
            affected_ids.push(new_ticket_id.clone());
            entity_keys.push(EntityKey::new("ticket", new_ticket_id));
        }
        TaskMutationDto::ArchiveTicket { ticket_id } => update_ticket(
            library,
            ticket_id,
            |ticket| ticket.summary.state = TaskState::Completed,
            &mut affected_ids,
            &mut entity_keys,
        )?,
        TaskMutationDto::RestoreTicket { ticket_id } => update_ticket(
            library,
            ticket_id,
            |ticket| ticket.summary.state = TaskState::Pending,
            &mut affected_ids,
            &mut entity_keys,
        )?,
        TaskMutationDto::DeleteTicket { ticket_id } => {
            let ticket = library
                .tickets
                .remove(ticket_id)
                .ok_or_else(|| not_found("El ticket no existe."))?;
            let comment_ids = library
                .comments
                .values()
                .filter(|comment| comment.ticket_id == *ticket_id)
                .map(|comment| comment.comment_id.clone())
                .collect::<Vec<_>>();
            for comment_id in comment_ids {
                library.comments.remove(&comment_id);
            }
            affected_ids.push(ticket.summary.ticket_id);
        }
    }
    for key in entity_keys.iter().filter(|key| key.entity_type == "ticket") {
        let comments = library
            .comments
            .values()
            .filter(|comment| comment.ticket_id == key.entity_id)
            .collect::<Vec<_>>();
        let Some(ticket) = library.tickets.get(&key.entity_id) else {
            continue;
        };
        let preview = ticket_detail_preview(&ticket.content, comments);
        if let Some(ticket) = library.tickets.get_mut(&key.entity_id) {
            ticket.summary.detail_preview = preview;
        }
    }
    Ok((affected_ids, entity_keys))
}

/// Card preview of a ticket: its detail followed by its comments in the
/// order they were written, as they read in the ticket document.
pub fn ticket_detail_preview<'a>(
    content: &str,
    comments: impl IntoIterator<Item = &'a TaskCommentDto>,
) -> String {
    let mut comments = comments.into_iter().collect::<Vec<_>>();
    comments.sort_by(|left, right| {
        left.created_at_unix_ms
            .cmp(&right.created_at_unix_ms)
            .then_with(|| left.comment_id.cmp(&right.comment_id))
    });
    let text = std::iter::once(content)
        .chain(comments.iter().map(|comment| comment.body.as_str()))
        .collect::<Vec<_>>()
        .join(" ");
    bounded_preview(&text, 180)
}

fn update_ticket<F>(
    library: &mut LibraryState,
    ticket_id: &str,
    update: F,
    affected_ids: &mut Vec<String>,
    entity_keys: &mut Vec<EntityKey>,
) -> Result<(), BackendError>
where
    F: FnOnce(&mut TaskTicketDto),
{
    let ticket = library
        .tickets
        .get_mut(ticket_id)
        .ok_or_else(|| not_found("El ticket no existe."))?;
    update(ticket);
    ticket.summary.revision = ticket.summary.revision.saturating_add(1);
    affected_ids.push(ticket_id.to_string());
    entity_keys.push(EntityKey::new("ticket", ticket_id));
    Ok(())
}

fn apply_fields(ticket: &mut TaskTicketDto, fields: &TaskUpdateFieldsDto) {
    if let Some(title) = &fields.title {
        ticket.summary.title = title.clone();
    }
    if let Some(content) = &fields.content {
        ticket.content = content.clone();
        ticket.summary.detail_preview = bounded_preview(content, 180);
    }
    if let Some(state) = fields.state {
        ticket.summary.state = state;
    }
    if let Some(priority) = fields.priority {
        ticket.summary.priority = priority;
    }
    if fields.group_id.is_some() {
        ticket.summary.group_id = fields.group_id.clone();
    }
    if let Some(tags) = &fields.tags {
        ticket.tags = tags.clone();
    }
    if let Some(dependencies) = &fields.dependencies {
        ticket.dependencies = dependencies.clone();
    }
    if let Some(checklist) = &fields.checklist {
        ticket.checklist = checklist.clone();
    }
    if let Some(start_date) = &fields.start_date {
        ticket.start_date = start_date.clone();
    }
    if let Some(end_date) = &fields.end_date {
        ticket.end_date = end_date.clone();
    }
    if let Some(dynamic_end_date) = fields.dynamic_end_date {
        ticket.dynamic_end_date = dynamic_end_date;
    }
    if let Some(dedicated_hours) = fields.dedicated_hours {
        ticket.dedicated_hours = dedicated_hours;
    }
    if let Some(estimated_hours) = fields.estimated_hours {
        ticket.estimated_hours = estimated_hours;
    }
    if let Some(deviation_hours) = fields.deviation_hours {
        ticket.deviation_hours = deviation_hours;
    }
    if let Some(order) = fields.order {
        ticket.order = order;
    }
    if let Some(context) = &fields.context {
        ticket.context = Some(context.clone());
    }
    if let Some(parent_ticket_id) = &fields.parent_ticket_id {
        ticket.summary.parent_ticket_id = parent_ticket_id.clone();
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct EntityKey {
    entity_type: String,
    entity_id: String,
}
impl EntityKey {
    fn new(entity_type: &str, entity_id: &str) -> Self {
        Self {
            entity_type: entity_type.to_string(),
            entity_id: entity_id.to_string(),
        }
    }
}

fn current_entity_revision(
    library: &LibraryState,
    key: &EntityKey,
) -> Result<TaskEntityRevisionDto, BackendError> {
    let revision = match key.entity_type.as_str() {
        "board" => library
            .boards
            .get(&key.entity_id)
            .map(|value| value.revision),
        "group" => library
            .groups
            .get(&key.entity_id)
            .map(|value| value.revision),
        "ticket" => library
            .tickets
            .get(&key.entity_id)
            .map(|value| value.summary.revision),
        _ => None,
    }
    .ok_or_else(|| not_found("El recurso de la operación ya no existe."))?;
    Ok(entity_revision(&key.entity_type, &key.entity_id, revision))
}

fn ensure_base_revisions(
    library: &LibraryState,
    revisions: &[TaskEntityRevisionDto],
) -> Result<(), BackendError> {
    for expected in revisions {
        let current = current_entity_revision(
            library,
            &EntityKey::new(&expected.entity_type, &expected.entity_id),
        )?;
        if current.revision != expected.revision {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "El ticket o tablero cambió desde el preview.",
                true,
            ));
        }
    }
    Ok(())
}

fn validate_mutation_shape(mutation: &TaskMutationDto) -> Result<(), BackendError> {
    match mutation {
        TaskMutationDto::CreateBoard {
            board_id,
            name,
            color,
            context,
            activity_hours_per_day,
        } => {
            validate_activity_hours(*activity_hours_per_day)?;
            validate_id("boardId", board_id)?;
            validate_name("boardName", name, MAX_TASK_NAME_CHARS)?;
            validate_color(color)?;
            if let Some(context) = context {
                validate_context(context)?;
            }
        }
        TaskMutationDto::UpdateBoard {
            board_id,
            name,
            color,
            context,
            activity_hours_per_day,
        } => {
            validate_activity_hours(*activity_hours_per_day)?;
            validate_id("boardId", board_id)?;
            if let Some(name) = name {
                validate_name("boardName", name, MAX_TASK_NAME_CHARS)?;
            }
            if let Some(color) = color {
                validate_color(color)?;
            }
            if let Some(context) = context {
                validate_context(context)?;
            }
        }
        TaskMutationDto::DeleteBoard { board_id } => {
            validate_id("boardId", board_id)?;
        }
        TaskMutationDto::CreateGroup {
            board_id,
            group_id,
            name,
            color,
        } => {
            validate_id("boardId", board_id)?;
            validate_id("groupId", group_id)?;
            validate_name("groupName", name, MAX_TASK_NAME_CHARS)?;
            validate_color(color)?;
        }
        TaskMutationDto::DeleteGroup { board_id, group_id } => {
            validate_id("boardId", board_id)?;
            validate_id("groupId", group_id)?;
        }
        TaskMutationDto::UpdateGroup {
            board_id,
            group_id,
            name,
            color,
        } => {
            validate_id("boardId", board_id)?;
            validate_id("groupId", group_id)?;
            validate_name("groupName", name, MAX_TASK_NAME_CHARS)?;
            validate_color(color)?;
        }
        TaskMutationDto::ReorderGroups { board_id, group_ids } => {
            validate_id("boardId", board_id)?;
            if group_ids.is_empty() || group_ids.len() > MAX_TASK_GROUPS {
                return Err(invalid("El orden de grupos no es válido."));
            }
            for group_id in group_ids {
                validate_id("groupId", group_id)?;
            }
        }
        TaskMutationDto::CreateTicket {
            board_id,
            ticket_id,
            group_id,
            title,
            content,
            parent_ticket_id,
            tags,
            ..
        } => {
            validate_id("boardId", board_id)?;
            validate_id("ticketId", ticket_id)?;
            if let Some(group_id) = group_id {
                validate_id("groupId", group_id)?;
            }
            if let Some(parent_id) = parent_ticket_id {
                validate_id("parentTicketId", parent_id)?;
            }
            validate_title("title", title, MAX_TASK_TITLE_CHARS)?;
            validate_text("content", content, MAX_TASK_TEXT_CHARS)?;
            validate_tags(tags)?;
        }
        TaskMutationDto::ReplaceTicketContent { ticket_id, content } => {
            validate_id("ticketId", ticket_id)?;
            validate_text("content", content, MAX_TASK_TEXT_CHARS)?;
        }
        TaskMutationDto::AddComment {
            ticket_id,
            comment_id,
            body,
            ..
        } => {
            validate_id("ticketId", ticket_id)?;
            validate_id("commentId", comment_id)?;
            validate_text("comment", body, MAX_TASK_TEXT_CHARS)?;
        }
        TaskMutationDto::AddSubtask {
            parent_ticket_id,
            ticket_id,
            title,
            content,
            ..
        } => {
            validate_id("parentTicketId", parent_ticket_id)?;
            validate_id("ticketId", ticket_id)?;
            validate_title("title", title, MAX_TASK_TITLE_CHARS)?;
            validate_text("content", content, MAX_TASK_TEXT_CHARS)?;
        }
        TaskMutationDto::MoveTicket {
            ticket_id,
            group_id,
        } => {
            validate_id("ticketId", ticket_id)?;
            if let Some(group_id) = group_id {
                validate_id("groupId", group_id)?;
            }
        }
        TaskMutationDto::ChangeState { ticket_id, .. }
        | TaskMutationDto::ChangePriority { ticket_id, .. }
        | TaskMutationDto::ArchiveTicket { ticket_id }
        | TaskMutationDto::RestoreTicket { ticket_id }
        | TaskMutationDto::DeleteTicket { ticket_id } => {
            validate_id("ticketId", ticket_id)?;
        }
        TaskMutationDto::UpdateTicket { ticket_id, fields } => {
            validate_id("ticketId", ticket_id)?;
            fields.validate()?;
        }
        TaskMutationDto::BulkUpdate { ticket_ids, fields } => {
            for id in ticket_ids {
                validate_id("ticketId", id)?;
            }
            fields.validate()?;
        }
        TaskMutationDto::DuplicateTicket {
            ticket_id,
            new_ticket_id,
            title,
        } => {
            validate_id("ticketId", ticket_id)?;
            validate_id("newTicketId", new_ticket_id)?;
            if let Some(title) = title {
                validate_title("title", title, MAX_TASK_TITLE_CHARS)?;
            }
        }
    }
    Ok(())
}

fn validate_ticket_relationships(
    library: &LibraryState,
    summary: &TaskTicketSummaryDto,
) -> Result<(), BackendError> {
    validate_group_for_board(library, summary.group_id.as_deref(), &summary.board_id)?;
    if let Some(parent_id) = &summary.parent_ticket_id {
        root_parent_for_board(library, parent_id, &summary.board_id)?;
    }
    Ok(())
}
fn root_parent_for_board<'a>(
    library: &'a LibraryState,
    ticket_id: &str,
    board_id: &str,
) -> Result<&'a TaskTicketDto, BackendError> {
    let parent = library
        .tickets
        .get(ticket_id)
        .ok_or_else(|| not_found("El ticket padre no existe."))?;
    if parent.summary.board_id != board_id || parent.summary.parent_ticket_id.is_some() {
        return Err(invalid(
            "El padre debe ser un ticket principal del mismo tablero.",
        ));
    }
    Ok(parent)
}
fn accessible_board<'a>(
    library: &'a LibraryState,
    context: &TaskManagerContextDto,
    board_id: &str,
) -> Result<&'a TaskBoardDto, BackendError> {
    ensure_board_access(context, library, board_id)?;
    library
        .boards
        .get(board_id)
        .ok_or_else(|| not_found("El tablero no existe."))
}
fn accessible_ticket<'a>(
    library: &'a LibraryState,
    context: &TaskManagerContextDto,
    ticket_id: &str,
) -> Result<&'a TaskTicketDto, BackendError> {
    let ticket = library
        .tickets
        .get(ticket_id)
        .ok_or_else(|| not_found("El ticket no existe."))?;
    ensure_board_access(context, library, &ticket.summary.board_id)?;
    Ok(ticket)
}
fn ensure_board_access(
    context: &TaskManagerContextDto,
    library: &LibraryState,
    board_id: &str,
) -> Result<(), BackendError> {
    if !context.allows_board(board_id) {
        return Err(forbidden("El tablero no pertenece al alcance autorizado."));
    }
    ensure_board_exists(library, board_id)
}
fn ensure_board_exists(library: &LibraryState, board_id: &str) -> Result<(), BackendError> {
    if library.boards.contains_key(board_id) {
        Ok(())
    } else {
        Err(not_found("El tablero no existe."))
    }
}
fn ensure_group_access(
    context: &TaskManagerContextDto,
    library: &LibraryState,
    group_id: &str,
    board_id: Option<&str>,
) -> Result<(), BackendError> {
    let group = library
        .groups
        .get(group_id)
        .ok_or_else(|| not_found("El grupo no existe."))?;
    ensure_board_access(context, library, &group.board_id)?;
    if board_id.is_some_and(|id| id != group.board_id) {
        return Err(forbidden("El grupo no pertenece al tablero solicitado."));
    }
    Ok(())
}
fn ensure_group_for_board(
    library: &LibraryState,
    group_id: &str,
    board_id: &str,
) -> Result<(), BackendError> {
    let group = library
        .groups
        .get(group_id)
        .ok_or_else(|| not_found("El grupo no existe."))?;
    if group.board_id != board_id {
        return Err(invalid("El grupo no pertenece al tablero."));
    }
    Ok(())
}
fn validate_group_for_board(
    library: &LibraryState,
    group_id: Option<&str>,
    board_id: &str,
) -> Result<(), BackendError> {
    if let Some(group_id) = group_id {
        ensure_group_for_board(library, group_id, board_id)?;
    }
    Ok(())
}
fn ensure_ticket_exists(library: &LibraryState, ticket_id: &str) -> Result<(), BackendError> {
    if library.tickets.contains_key(ticket_id) {
        Ok(())
    } else {
        Err(not_found("El ticket no existe."))
    }
}
fn ensure_user(library: &LibraryState, user_id: &str) -> Result<(), BackendError> {
    if library.users.contains(user_id) {
        Ok(())
    } else {
        Err(BackendError::new(
            BackendErrorCode::Unauthorized,
            "El usuario no está autorizado para esta biblioteca.",
            false,
        ))
    }
}

fn validate_ticket(ticket: &TaskTicketDto) -> Result<(), BackendError> {
    ticket.summary.validate()?;
    validate_text("content", &ticket.content, MAX_TASK_TEXT_CHARS)?;
    validate_tags(&ticket.tags)?;
    validate_tags(&ticket.dependencies)?;
    validate_tags(&ticket.checklist)?;
    validate_text("startDate", &ticket.start_date, MAX_TASK_DATE_CHARS)?;
    validate_text("endDate", &ticket.end_date, MAX_TASK_DATE_CHARS)?;
    validate_hours("dedicatedHours", ticket.dedicated_hours)?;
    validate_hours("estimatedHours", ticket.estimated_hours)?;
    validate_hours("deviationHours", ticket.deviation_hours)?;
    if !ticket.order.is_finite() || !(0.0..=MAX_TASK_ORDER).contains(&ticket.order) {
        return Err(invalid("order no es válido."));
    }
    if let Some(context) = &ticket.context {
        validate_context(context)?;
    }
    validate_references("relatedDocuments", &ticket.related_documents)?;
    validate_references("relatedTasks", &ticket.related_tasks)
}
impl TaskTicketSummaryDto {
    fn validate(&self) -> Result<(), BackendError> {
        validate_id("libraryId", &self.library_id)?;
        validate_id("ticketId", &self.ticket_id)?;
        validate_id("boardId", &self.board_id)?;
        if let Some(group_id) = &self.group_id {
            validate_id("groupId", group_id)?;
        }
        if let Some(parent_id) = &self.parent_ticket_id {
            validate_id("parentTicketId", parent_id)?;
        }
        validate_title("title", &self.title, MAX_TASK_TITLE_CHARS)?;
        validate_text("detailPreview", &self.detail_preview, 400)?;
        if !self.logical_path.is_empty() {
            validate_logical_path("ticketPath", &self.logical_path)?;
        }
        Ok(())
    }
}
fn validate_comment(comment: &TaskCommentDto) -> Result<(), BackendError> {
    validate_id("libraryId", &comment.library_id)?;
    validate_id("commentId", &comment.comment_id)?;
    validate_id("ticketId", &comment.ticket_id)?;
    validate_id("authorUserId", &comment.author_user_id)?;
    validate_text("comment", &comment.body, MAX_TASK_TEXT_CHARS)?;
    if !comment.logical_path.is_empty() {
        validate_logical_path("commentPath", &comment.logical_path)?;
    }
    Ok(())
}
fn validate_tags(values: &[String]) -> Result<(), BackendError> {
    if values.len() > MAX_TASK_TAGS {
        return Err(invalid("La colección de tags supera el límite permitido."));
    }
    for value in values {
        validate_text("tag", value, MAX_TASK_NAME_CHARS)?;
    }
    Ok(())
}
fn validate_references(field: &str, values: &[String]) -> Result<(), BackendError> {
    if values.len() > MAX_TASK_RELATED_REFERENCES {
        return Err(invalid(format!("{field} supera el límite permitido.")));
    }
    for value in values {
        validate_text(field, value, MAX_TASK_REFERENCE_CHARS)?;
    }
    Ok(())
}
fn validate_hours(field: &str, value: f64) -> Result<(), BackendError> {
    if !value.is_finite() || !(0.0..=MAX_TASK_HOURS).contains(&value) {
        return Err(invalid(format!("{field} no es válido.")));
    }
    Ok(())
}
fn mutation_fingerprint(request: &TaskMutationRequestDto) -> Result<String, BackendError> {
    serde_json::to_string(&request.mutation).map_err(|_| {
        BackendError::new(
            BackendErrorCode::Internal,
            "No se pudo preparar el fingerprint de la operación.",
            false,
        )
    })
}
fn mutation_summary(mutation: &TaskMutationDto) -> String {
    match mutation {
        TaskMutationDto::CreateBoard { .. } => "Crear tablero".to_string(),
        TaskMutationDto::UpdateBoard { .. } => "Actualizar tablero".to_string(),
        TaskMutationDto::DeleteBoard { .. } => "Eliminar tablero".to_string(),
        TaskMutationDto::CreateGroup { .. } => "Crear grupo".to_string(),
        TaskMutationDto::DeleteGroup { .. } => "Eliminar grupo".to_string(),
        TaskMutationDto::UpdateGroup { .. } => "Actualizar grupo".to_string(),
        TaskMutationDto::ReorderGroups { .. } => "Reordenar grupos".to_string(),
        TaskMutationDto::CreateTicket { .. } => "Crear ticket".to_string(),
        TaskMutationDto::ReplaceTicketContent { .. } => {
            "Reemplazar contenido del ticket".to_string()
        }
        TaskMutationDto::AddComment { .. } => "Agregar comentario".to_string(),
        TaskMutationDto::AddSubtask { .. } => "Crear subtarea".to_string(),
        TaskMutationDto::MoveTicket { .. } => "Mover ticket".to_string(),
        TaskMutationDto::ChangeState { .. } => "Cambiar estado".to_string(),
        TaskMutationDto::ChangePriority { .. } => "Cambiar prioridad".to_string(),
        TaskMutationDto::UpdateTicket { .. } => "Actualizar ticket".to_string(),
        TaskMutationDto::BulkUpdate { .. } => "Actualizar tickets".to_string(),
        TaskMutationDto::DuplicateTicket { .. } => "Duplicar ticket".to_string(),
        TaskMutationDto::ArchiveTicket { .. } => "Archivar ticket".to_string(),
        TaskMutationDto::RestoreTicket { .. } => "Restaurar ticket".to_string(),
        TaskMutationDto::DeleteTicket { .. } => "Eliminar ticket".to_string(),
    }
}
fn affected_ids(mutation: &TaskMutationDto) -> (Vec<String>, Vec<String>) {
    let tickets = match mutation {
        TaskMutationDto::CreateTicket { ticket_id, .. }
        | TaskMutationDto::AddSubtask { ticket_id, .. }
        | TaskMutationDto::ReplaceTicketContent { ticket_id, .. }
        | TaskMutationDto::AddComment { ticket_id, .. }
        | TaskMutationDto::MoveTicket { ticket_id, .. }
        | TaskMutationDto::ChangeState { ticket_id, .. }
        | TaskMutationDto::ChangePriority { ticket_id, .. }
        | TaskMutationDto::UpdateTicket { ticket_id, .. }
        | TaskMutationDto::ArchiveTicket { ticket_id }
        | TaskMutationDto::RestoreTicket { ticket_id }
        | TaskMutationDto::DeleteTicket { ticket_id } => vec![ticket_id.clone()],
        TaskMutationDto::BulkUpdate { ticket_ids, .. } => ticket_ids.clone(),
        TaskMutationDto::DuplicateTicket {
            ticket_id,
            new_ticket_id,
            ..
        } => vec![ticket_id.clone(), new_ticket_id.clone()],
        _ => Vec::new(),
    };
    let boards = match mutation {
        TaskMutationDto::CreateBoard { board_id, .. }
        | TaskMutationDto::UpdateBoard { board_id, .. }
        | TaskMutationDto::DeleteBoard { board_id }
        | TaskMutationDto::CreateGroup { board_id, .. }
        | TaskMutationDto::DeleteGroup { board_id, .. }
        | TaskMutationDto::UpdateGroup { board_id, .. }
        | TaskMutationDto::ReorderGroups { board_id, .. }
        | TaskMutationDto::CreateTicket { board_id, .. } => vec![board_id.clone()],
        TaskMutationDto::AddSubtask { .. }
        | TaskMutationDto::ReplaceTicketContent { .. }
        | TaskMutationDto::AddComment { .. }
        | TaskMutationDto::MoveTicket { .. }
        | TaskMutationDto::ChangeState { .. }
        | TaskMutationDto::ChangePriority { .. }
        | TaskMutationDto::UpdateTicket { .. }
        | TaskMutationDto::BulkUpdate { .. }
        | TaskMutationDto::DuplicateTicket { .. }
        | TaskMutationDto::ArchiveTicket { .. }
        | TaskMutationDto::RestoreTicket { .. } => Vec::new(),
        TaskMutationDto::DeleteTicket { .. } => Vec::new(),
    };
    (tickets, boards)
}
fn entity_revision(entity_type: &str, entity_id: &str, revision: u64) -> TaskEntityRevisionDto {
    TaskEntityRevisionDto {
        entity_type: entity_type.to_string(),
        entity_id: entity_id.to_string(),
        revision,
    }
}
fn task_page<T>(items: Vec<T>, offset: usize, requested_limit: usize) -> BoundedPage<T> {
    let total = items.len();
    let limit = requested_limit.clamp(1, MAX_TASK_RESULTS);
    let items = items
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    BoundedPage {
        items,
        total,
        offset,
        limit,
        has_more: offset.saturating_add(limit).min(total) < total,
    }
}
fn bounded_preview(value: &str, max_chars: usize) -> String {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars = value.chars().collect::<Vec<_>>();
    if chars.len() <= max_chars {
        value
    } else {
        format!(
            "{}…",
            chars
                .into_iter()
                .take(max_chars.saturating_sub(1))
                .collect::<String>()
        )
    }
}
fn default_task_limit() -> usize {
    MAX_TASK_RESULTS
}
fn default_dynamic_end_date() -> bool {
    true
}
fn default_task_order() -> f64 {
    999_999.0
}

fn library_snapshot(library_id: &str, library: &LibraryState) -> TaskManagerLibrarySnapshotDto {
    let mut users = library.users.iter().cloned().collect::<Vec<_>>();
    users.sort();
    // Groups are keyed by id; consumers list them in the order people set.
    let mut groups = library.groups.values().cloned().collect::<Vec<_>>();
    groups.sort_by_key(|group| group.order);
    TaskManagerLibrarySnapshotDto {
        library_id: library_id.to_string(),
        users,
        boards: library.boards.values().cloned().collect(),
        groups,
        tickets: library.tickets.values().cloned().collect(),
        comments: library.comments.values().cloned().collect(),
        generation: library.generation,
        config: library.config.clone(),
    }
}

fn snapshot_to_libraries(
    snapshot: &TaskManagerSnapshotDto,
) -> Result<BTreeMap<String, LibraryState>, BackendError> {
    snapshot.validate()?;
    snapshot
        .libraries
        .iter()
        .map(|library| {
            Ok((
                library.library_id.clone(),
                library_state_from_snapshot(library)?,
            ))
        })
        .collect()
}

fn validate_library_snapshot(snapshot: &TaskManagerLibrarySnapshotDto) -> Result<(), BackendError> {
    library_state_from_snapshot(snapshot).map(|_| ())
}

fn library_state_from_snapshot(
    snapshot: &TaskManagerLibrarySnapshotDto,
) -> Result<LibraryState, BackendError> {
    validate_id("libraryId", &snapshot.library_id)?;
    for (board_id, hours) in &snapshot.config.activity_hours_per_day {
        validate_id("boardId", board_id)?;
        if !hours.is_finite() || !(0.0..=24.0).contains(hours) {
            return Err(invalid("activityHoursPerDay no es válido."));
        }
    }
    if snapshot.users.len() > MAX_TASK_USERS {
        return Err(invalid("La biblioteca supera el límite de usuarios."));
    }
    if snapshot.boards.len() > MAX_TASK_BOARDS {
        return Err(invalid("La biblioteca supera el límite de tableros."));
    }
    if snapshot.groups.len() > MAX_TASK_GROUPS {
        return Err(invalid("La biblioteca supera el límite de grupos."));
    }
    if snapshot.tickets.len() > MAX_TASK_TICKETS {
        return Err(invalid("La biblioteca supera el límite de tickets."));
    }
    if snapshot.comments.len() > MAX_TASK_COMMENTS {
        return Err(invalid("La biblioteca supera el límite de comentarios."));
    }

    let mut users = HashSet::new();
    for user_id in &snapshot.users {
        let user_id = validate_id("libraryUserId", user_id)?;
        if !users.insert(user_id) {
            return Err(invalid("El snapshot contiene usuarios duplicados."));
        }
    }

    let mut boards = BTreeMap::new();
    for board in &snapshot.boards {
        board.validate()?;
        if board.library_id != snapshot.library_id {
            return Err(invalid("El tablero pertenece a otra biblioteca."));
        }
        if boards
            .insert(board.board_id.clone(), board.clone())
            .is_some()
        {
            return Err(invalid("El snapshot contiene tableros duplicados."));
        }
    }

    let mut groups = BTreeMap::new();
    for group in &snapshot.groups {
        group.validate()?;
        if group.library_id != snapshot.library_id {
            return Err(invalid("El grupo pertenece a otra biblioteca."));
        }
        if !boards.contains_key(&group.board_id) {
            return Err(not_found("El tablero del grupo no existe."));
        }
        if groups
            .insert(group.group_id.clone(), group.clone())
            .is_some()
        {
            return Err(invalid("El snapshot contiene grupos duplicados."));
        }
    }

    let mut tickets = BTreeMap::new();
    for ticket in &snapshot.tickets {
        validate_ticket(ticket)?;
        if ticket.summary.library_id != snapshot.library_id {
            return Err(invalid("El ticket pertenece a otra biblioteca."));
        }
        if tickets
            .insert(ticket.summary.ticket_id.clone(), ticket.clone())
            .is_some()
        {
            return Err(invalid("El snapshot contiene tickets duplicados."));
        }
    }

    let state = LibraryState {
        users,
        boards,
        groups,
        tickets,
        comments: BTreeMap::new(),
        generation: snapshot.generation,
        config: snapshot.config.clone(),
    };
    for ticket in state.tickets.values() {
        if !state.boards.contains_key(&ticket.summary.board_id) {
            return Err(not_found("El tablero del ticket no existe."));
        }
        validate_ticket_relationships(&state, &ticket.summary)?;
    }

    let mut comments = BTreeMap::new();
    for comment in &snapshot.comments {
        validate_comment(comment)?;
        if comment.library_id != snapshot.library_id {
            return Err(invalid("El comentario pertenece a otra biblioteca."));
        }
        ensure_ticket_exists(&state, &comment.ticket_id)?;
        ensure_user(&state, &comment.author_user_id)?;
        if comments
            .insert(comment.comment_id.clone(), comment.clone())
            .is_some()
        {
            return Err(invalid("El snapshot contiene comentarios duplicados."));
        }
    }

    Ok(LibraryState { comments, ..state })
}

fn library_mut<'a>(
    state: &'a mut CoreState,
    library_id: &str,
) -> Result<&'a mut LibraryState, BackendError> {
    state
        .libraries
        .get_mut(library_id)
        .ok_or_else(|| not_found("La biblioteca no existe."))
}
fn read_state<'a>(
    state: &'a Arc<RwLock<CoreState>>,
) -> Result<std::sync::RwLockReadGuard<'a, CoreState>, BackendError> {
    state.read().map_err(|_| {
        BackendError::new(
            BackendErrorCode::Internal,
            "No se pudo leer el estado del Task Manager.",
            true,
        )
    })
}
fn write_state<'a>(
    state: &'a Arc<RwLock<CoreState>>,
) -> Result<std::sync::RwLockWriteGuard<'a, CoreState>, BackendError> {
    state.write().map_err(|_| {
        BackendError::new(
            BackendErrorCode::Internal,
            "No se pudo actualizar el estado del Task Manager.",
            true,
        )
    })
}
fn validate_id(field: &str, value: &str) -> Result<String, BackendError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > 128
        || value
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\'))
    {
        return Err(invalid(format!("{field} no es válido.")));
    }
    Ok(value.to_string())
}
fn validate_logical_path(field: &str, value: &str) -> Result<(), BackendError> {
    if value.trim().is_empty()
        || value.starts_with('/')
        || value.contains('\\')
        || value
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        || value.chars().any(char::is_control)
    {
        return Err(invalid(format!("{field} no es válida.")));
    }
    Ok(())
}
fn validate_text(field: &str, value: &str, max: usize) -> Result<(), BackendError> {
    if value.chars().count() > max
        || value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(invalid(format!("{field} supera el límite permitido.")));
    }
    Ok(())
}
fn validate_name(field: &str, value: &str, max: usize) -> Result<(), BackendError> {
    if value.trim().is_empty() {
        return Err(invalid(format!("{field} es obligatorio.")));
    }
    validate_text(field, value, max)?;
    if value.chars().any(char::is_control) {
        return Err(invalid(format!("{field} contiene caracteres inválidos.")));
    }
    if value.contains('/') || value.contains('\\') {
        return Err(invalid(format!("{field} contiene un separador inválido.")));
    }
    Ok(())
}
fn validate_title(field: &str, value: &str, max: usize) -> Result<(), BackendError> {
    if value.trim().is_empty() {
        return Err(invalid(format!("{field} es obligatorio.")));
    }
    if value.chars().count() > max {
        return Err(invalid(format!("{field} supera el límite permitido.")));
    }
    if value.chars().any(char::is_control) {
        return Err(invalid(format!("{field} contiene caracteres inválidos.")));
    }
    Ok(())
}
fn validate_activity_hours(value: Option<f64>) -> Result<(), BackendError> {
    match value {
        Some(hours) if !hours.is_finite() || !(0.0..=24.0).contains(&hours) => {
            Err(invalid("activityHoursPerDay no es válido."))
        }
        _ => Ok(()),
    }
}
fn validate_color(value: &str) -> Result<(), BackendError> {
    if value.len() != 7
        || !value.starts_with('#')
        || !value[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(invalid("El color debe tener formato hexadecimal #RRGGBB."));
    }
    Ok(())
}
fn validate_context(value: &str) -> Result<(), BackendError> {
    if value.len() > 120
        || !value.starts_with('#')
        || value[1..].is_empty()
        || value.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(invalid("El contexto no es válido."));
    }
    Ok(())
}
fn invalid(message: impl Into<String>) -> BackendError {
    BackendError::invalid_input(message)
}
fn not_found(message: impl Into<String>) -> BackendError {
    BackendError::new(BackendErrorCode::NotFound, message, false)
}
fn conflict(message: impl Into<String>) -> BackendError {
    BackendError::new(BackendErrorCode::Conflict, message, true)
}
fn forbidden(message: impl Into<String>) -> BackendError {
    BackendError::new(BackendErrorCode::Forbidden, message, false)
}

pub fn task_manager_read_tool_contracts() -> Vec<ToolDefinition> {
    [
        (
            "search_task_tickets",
            "Busca tickets por metadata y devuelve resultados acotados.",
        ),
        (
            "search_task_context",
            "Busca contexto de tickets autorizados sin inventar evidencia.",
        ),
        (
            "read_task_tickets",
            "Lee tickets identificados, subtareas y comentarios acotados.",
        ),
        (
            "read_all_task_tickets",
            "Enumera tickets autorizados con límites explícitos.",
        ),
        (
            "get_task_manager_options",
            "Devuelve tableros, grupos, estados y prioridades válidos.",
        ),
        (
            "get_task_board_summary",
            "Resume tickets de un tablero por estado, prioridad y grupo.",
        ),
    ]
    .into_iter()
    .map(|(name, description)| ToolDefinition {
        name: name.to_string(),
        description: description.to_string(),
        input_schema: serde_json::json!({"type": "object"}),
        scopes: vec![BackendScope::TaskManager],
        read_only: true,
        requires_confirmation: false,
    })
    .collect()
}

pub fn task_manager_mutation_tool_contracts() -> Vec<ToolDefinition> {
    [
        (
            "create_task_ticket",
            "Prepara la creación de un ticket y requiere confirmación.",
        ),
        (
            "replace_task_content",
            "Prepara el reemplazo de contenido con revisión.",
        ),
        (
            "add_task_comment",
            "Prepara un comentario asociado al usuario autorizado.",
        ),
        (
            "add_task_subtask",
            "Prepara una subtarea validando su padre principal.",
        ),
        (
            "move_task_group",
            "Prepara el movimiento a un grupo del mismo tablero.",
        ),
        ("change_task_state", "Prepara un cambio de estado."),
        ("change_task_priority", "Prepara un cambio de prioridad."),
        (
            "update_task_fields",
            "Prepara una actualización explícita y acotada.",
        ),
        (
            "bulk_update_tasks",
            "Prepara una actualización masiva acotada.",
        ),
        ("duplicate_task", "Prepara la duplicación de un ticket."),
        ("archive_task", "Prepara el archivado de un ticket."),
        ("restore_task", "Prepara la restauración de un ticket."),
        ("create_task_group", "Prepara la creación de un grupo."),
        (
            "delete_task_group",
            "Prepara la eliminación de un grupo vacío.",
        ),
    ]
    .into_iter()
    .map(|(name, description)| ToolDefinition {
        name: name.to_string(),
        description: description.to_string(),
        input_schema: serde_json::json!({"type": "object"}),
        scopes: vec![BackendScope::TaskManager],
        read_only: false,
        requires_confirmation: true,
    })
    .collect()
}

impl TaskTicketSummaryDto {
    fn summary_order_key(&self) -> (&str, &str) {
        (&self.title, self.group_id.as_deref().unwrap_or(""))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn detail_preview_includes_comments_in_written_order() {
        let comment = |id: &str, at: i64, body: &str| TaskCommentDto {
            library_id: "library".into(),
            comment_id: id.into(),
            ticket_id: "ticket".into(),
            author_user_id: "user-owner".into(),
            body: body.into(),
            created_at_unix_ms: at,
            revision: 1,
            logical_path: String::new(),
        };
        let comments = [comment("b", 2, "segundo"), comment("a", 1, "primero")];
        assert_eq!(ticket_detail_preview("", &comments), "primero segundo");
        assert_eq!(ticket_detail_preview("Detalle", &comments[..1]), "Detalle segundo");
    }

    #[derive(Default)]
    struct TestSnapshotStore {
        snapshot: Mutex<Option<TaskManagerLibrarySnapshotDto>>,
        fail_save: Mutex<bool>,
    }

    impl TaskManagerSnapshotStore for TestSnapshotStore {
        fn load(
            &self,
            library_id: &str,
        ) -> Result<Option<TaskManagerLibrarySnapshotDto>, BackendError> {
            Ok(self
                .snapshot
                .lock()
                .unwrap()
                .clone()
                .filter(|snapshot| snapshot.library_id == library_id))
        }

        fn commit(&self, request: &TaskManagerStoreCommit) -> Result<(), BackendError> {
            if *self.fail_save.lock().unwrap() {
                return Err(BackendError::new(
                    BackendErrorCode::Storage,
                    "fallo de prueba",
                    true,
                ));
            }
            *self.snapshot.lock().unwrap() = Some(request.snapshot.clone());
            Ok(())
        }
    }

    fn setup() -> (InMemoryTaskManager, TaskManagerContextDto) {
        let manager = InMemoryTaskManager::new();
        manager.add_library("library-a").unwrap();
        manager.add_user("library-a", "user-a").unwrap();
        manager
            .seed_board(TaskBoardDto {
                library_id: "library-a".into(),
                board_id: "board-a".into(),
                name: "Trabajo".into(),
                color: "#123456".into(),
                context: Some("#Personal".into()),
                revision: 1,
            })
            .unwrap();
        manager
            .seed_group(TaskGroupDto {
                library_id: "library-a".into(),
                group_id: "group-a".into(),
                board_id: "board-a".into(),
                name: "Backlog".into(),
                color: "#654321".into(),
                revision: 1,
                order: 0,
            })
            .unwrap();
        let context = TaskManagerContextDto::new("library-a", "user-a").unwrap();
        (manager, context)
    }

    fn ticket(id: &str, title: &str, parent: Option<&str>) -> TaskTicketDto {
        TaskTicketDto {
            summary: TaskTicketSummaryDto {
                library_id: "library-a".into(),
                ticket_id: id.into(),
                board_id: "board-a".into(),
                group_id: Some("group-a".into()),
                title: title.into(),
                state: TaskState::Pending,
                priority: TaskPriority::Medium,
                parent_ticket_id: parent.map(str::to_string),
                detail_preview: title.into(),
                revision: 1,
                logical_path: format!("task-mannager/default/{id}.md"),
            },
            content: format!("Contenido de {title}"),
            tags: vec!["task".into()],
            dependencies: vec![],
            checklist: vec![],
            start_date: String::new(),
            end_date: String::new(),
            dynamic_end_date: default_dynamic_end_date(),
            dedicated_hours: 0.0,
            estimated_hours: 0.0,
            deviation_hours: 0.0,
            order: default_task_order(),
            context: None,
            related_documents: vec![],
            related_tasks: vec![],
        }
    }

    #[test]
    fn read_snapshot_is_scoped_and_serializes_routes_and_revisions() {
        let (manager, mut context) = setup();
        manager
            .seed_ticket(ticket("ticket-a", "Ticket", None))
            .unwrap();
        context.allowed_board_ids = vec!["board-a".into()];

        let snapshot = manager.read_snapshot(&context).unwrap();
        let response =
            TaskManagerSnapshotReadDto::from_snapshot(context.clone(), snapshot).unwrap();
        assert_eq!(response.version, TASK_MANAGER_SNAPSHOT_READ_VERSION);
        assert_eq!(response.context.library_user_id, "user-a");
        assert_eq!(response.routes.len(), 1);
        assert_eq!(
            response.routes[0].logical_path,
            "task-mannager/default/ticket-a.md"
        );
        assert_eq!(response.revisions.len(), 3);

        let serialized = serde_json::to_value(&response).unwrap();
        assert_eq!(serialized["version"], TASK_MANAGER_SNAPSHOT_READ_VERSION);
        assert_eq!(serialized["context"]["libraryId"], "library-a");
        assert_eq!(serialized["routes"][0]["entityType"], "ticket");
        assert_eq!(serialized["revisions"][2]["entityId"], "ticket-a");
    }

    #[test]
    fn read_snapshot_accepts_display_titles_with_path_separators() {
        let (manager, mut context) = setup();
        manager
            .seed_ticket(ticket(
                "ticket-separated-title",
                "API v2 / Windows\\Android",
                None,
            ))
            .unwrap();
        context.allowed_board_ids = vec!["board-a".into()];

        let snapshot = manager.read_snapshot(&context).unwrap();
        let response = TaskManagerSnapshotReadDto::from_snapshot(context, snapshot).unwrap();

        assert_eq!(
            response.snapshot.tickets[0].summary.title,
            "API v2 / Windows\\Android"
        );
    }

    #[test]
    fn mutation_request_uses_camel_case_fields_inside_tagged_variants() {
        let request: TaskMutationRequestDto = serde_json::from_value(serde_json::json!({
            "context": {
                "libraryId": "library-a",
                "libraryUserId": "user-a",
                "allowedBoardIds": ["board-a"]
            },
            "operationId": "operation-a",
            "idempotencyKey": "task-manager:operation-a",
            "mutation": {
                "kind": "move-ticket",
                "ticketId": "ticket-a",
                "groupId": "group-a"
            }
        }))
        .unwrap();

        assert!(matches!(
            &request.mutation,
            TaskMutationDto::MoveTicket {
                ticket_id,
                group_id: Some(group_id),
            } if ticket_id.as_str() == "ticket-a" && group_id.as_str() == "group-a"
        ));
        let encoded = serde_json::to_value(request).unwrap();
        assert_eq!(encoded["mutation"]["ticketId"], "ticket-a");
        assert_eq!(encoded["mutation"]["groupId"], "group-a");
        assert!(encoded["mutation"].get("ticket_id").is_none());
    }

    #[test]
    fn read_snapshot_rejects_an_unknown_response_version() {
        let (manager, context) = setup();
        let mut response = TaskManagerSnapshotReadDto::from_snapshot(
            context.clone(),
            manager.read_snapshot(&context).unwrap(),
        )
        .unwrap();
        response.version = TASK_MANAGER_SNAPSHOT_READ_VERSION.saturating_add(1);

        assert_eq!(
            response.validate().unwrap_err().code,
            BackendErrorCode::InvalidInput
        );
    }

    #[test]
    fn ticket_metadata_round_trips_and_legacy_payloads_use_compatible_defaults() {
        let mut ticket = ticket("ticket-metadata", "Metadata", None);
        ticket.start_date = "2026-09-01T08:00:00.000Z".into();
        ticket.end_date = "2026-09-02T16:30:00.000Z".into();
        ticket.dynamic_end_date = false;
        ticket.dedicated_hours = 1.25;
        ticket.estimated_hours = 4.5;
        ticket.deviation_hours = 0.75;
        ticket.order = 12.5;
        ticket.context = Some("#Trabajo".into());
        ticket.related_documents = vec!["notes/design.md".into()];
        ticket.related_tasks = vec!["ticket-other".into()];

        let encoded = serde_json::to_value(&ticket).unwrap();
        let decoded: TaskTicketDto = serde_json::from_value(encoded.clone()).unwrap();
        assert_eq!(decoded, ticket);
        assert_eq!(encoded["startDate"], "2026-09-01T08:00:00.000Z");
        assert_eq!(encoded["dedicatedHours"], 1.25);
        assert_eq!(encoded["relatedDocuments"][0], "notes/design.md");

        let mut legacy = encoded.as_object().unwrap().clone();
        for field in [
            "startDate",
            "endDate",
            "dynamicEndDate",
            "dedicatedHours",
            "estimatedHours",
            "deviationHours",
            "order",
            "context",
            "relatedDocuments",
            "relatedTasks",
        ] {
            legacy.remove(field);
        }
        let legacy: TaskTicketDto =
            serde_json::from_value(serde_json::Value::Object(legacy)).unwrap();
        assert_eq!(legacy.start_date, "");
        assert_eq!(legacy.dynamic_end_date, true);
        assert_eq!(legacy.order, default_task_order());
        assert!(legacy.related_documents.is_empty());
    }

    #[test]
    fn ticket_metadata_limits_reject_invalid_hours_and_references() {
        let (manager, _) = setup();
        let mut negative_hours = ticket("ticket-hours", "Hours", None);
        negative_hours.estimated_hours = -1.0;
        assert_eq!(
            manager.seed_ticket(negative_hours).unwrap_err().code,
            BackendErrorCode::InvalidInput
        );

        let mut too_many_references = ticket("ticket-refs", "References", None);
        too_many_references.related_tasks = (0..=MAX_TASK_RELATED_REFERENCES)
            .map(|index| format!("ticket-{index}"))
            .collect();
        assert_eq!(
            manager.seed_ticket(too_many_references).unwrap_err().code,
            BackendErrorCode::InvalidInput
        );
    }

    #[test]
    fn rejects_cross_library_and_unknown_user_access() {
        let (manager, mut context) = setup();
        context.library_id = "library-b".into();
        let result = manager.list_boards(&TaskManagerListRequest {
            context,
            board_id: None,
            offset: 0,
            limit: 10,
        });
        assert_eq!(result.unwrap_err().code, BackendErrorCode::NotFound);
        let mut unauthorized = TaskManagerContextDto::new("library-a", "user-b").unwrap();
        unauthorized.allowed_board_ids = vec!["board-a".into()];
        let result = manager.list_boards(&TaskManagerListRequest {
            context: unauthorized,
            board_id: None,
            offset: 0,
            limit: 10,
        });
        assert_eq!(result.unwrap_err().code, BackendErrorCode::Unauthorized);
    }

    #[test]
    fn parent_must_be_a_root_ticket_in_the_same_board() {
        let (manager, context) = setup();
        manager
            .seed_ticket(ticket("parent", "Parent", None))
            .unwrap();
        manager
            .seed_ticket(ticket("child", "Child", Some("parent")))
            .unwrap();
        let request = TaskMutationRequestDto {
            context: context.clone(),
            operation_id: "op-grandchild".into(),
            idempotency_key: "idem-grandchild".into(),
            mutation: TaskMutationDto::AddSubtask {
                parent_ticket_id: "child".into(),
                ticket_id: "grandchild".into(),
                title: "Grandchild".into(),
                content: "body".into(),
                priority: TaskPriority::Low,
            },
        };
        assert_eq!(
            manager.preview_mutation(&request).unwrap_err().code,
            BackendErrorCode::InvalidInput
        );
        let wrong_board = TaskTicketDto {
            summary: TaskTicketSummaryDto {
                board_id: "other-board".into(),
                ..ticket("other", "Other", None).summary
            },
            ..ticket("other", "Other", None)
        };
        assert_eq!(
            manager.seed_ticket(wrong_board).unwrap_err().code,
            BackendErrorCode::InvalidInput
        );
    }

    #[test]
    fn snapshot_lists_groups_in_their_saved_order() {
        let (manager, context) = setup();
        manager
            .seed_group(TaskGroupDto {
                library_id: "library-a".into(),
                group_id: "group-b".into(),
                board_id: "board-a".into(),
                name: "Sprint".into(),
                color: "#654321".into(),
                revision: 1,
                order: 1,
            })
            .unwrap();
        manager
            .preview_mutation(&TaskMutationRequestDto {
                context: context.clone(),
                operation_id: "op-reorder".into(),
                idempotency_key: "idem-reorder".into(),
                mutation: TaskMutationDto::ReorderGroups {
                    board_id: "board-a".into(),
                    group_ids: vec!["group-b".into(), "group-a".into()],
                },
            })
            .unwrap();
        manager
            .apply_mutation(&TaskMutationApplyRequestDto {
                context: context.clone(),
                operation_id: "op-reorder".into(),
                idempotency_key: "idem-reorder".into(),
                confirmed: true,
            })
            .unwrap();

        let snapshot = manager.read_snapshot(&context).unwrap();
        let group_ids = snapshot
            .groups
            .iter()
            .map(|group| group.group_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(group_ids, vec!["group-b", "group-a"]);
    }

    #[test]
    fn preview_apply_checks_revision_and_idempotency() {
        let (manager, context) = setup();
        manager
            .seed_ticket(ticket("ticket-1", "Original", None))
            .unwrap();
        let request = TaskMutationRequestDto {
            context: context.clone(),
            operation_id: "op-1".into(),
            idempotency_key: "idem-1".into(),
            mutation: TaskMutationDto::ChangeState {
                ticket_id: "ticket-1".into(),
                state: TaskState::InProgress,
            },
        };
        manager.preview_mutation(&request).unwrap();
        let other = TaskMutationRequestDto {
            context: context.clone(),
            operation_id: "op-2".into(),
            idempotency_key: "idem-2".into(),
            mutation: TaskMutationDto::ChangePriority {
                ticket_id: "ticket-1".into(),
                priority: TaskPriority::Urgent,
            },
        };
        manager.preview_mutation(&other).unwrap();
        manager
            .apply_mutation(&TaskMutationApplyRequestDto {
                context: context.clone(),
                operation_id: "op-2".into(),
                idempotency_key: "idem-2".into(),
                confirmed: true,
            })
            .unwrap();
        let stale = manager.apply_mutation(&TaskMutationApplyRequestDto {
            context: context.clone(),
            operation_id: "op-1".into(),
            idempotency_key: "idem-1".into(),
            confirmed: true,
        });
        assert_eq!(stale.unwrap_err().code, BackendErrorCode::Conflict);
        let fresh_request = TaskMutationRequestDto {
            context: context.clone(),
            operation_id: "op-3".into(),
            idempotency_key: "idem-3".into(),
            mutation: request.mutation.clone(),
        };
        let preview = manager.preview_mutation(&fresh_request).unwrap();
        assert_eq!(
            preview.allowed_actions,
            vec![
                MutationPreviewAction::ApplyAll,
                MutationPreviewAction::Reject,
                MutationPreviewAction::Cancel
            ]
        );
        manager
            .apply_mutation(&TaskMutationApplyRequestDto {
                context: context.clone(),
                operation_id: "op-3".into(),
                idempotency_key: "idem-3".into(),
                confirmed: true,
            })
            .unwrap();
        let replay = manager
            .apply_mutation(&TaskMutationApplyRequestDto {
                context,
                operation_id: "op-3".into(),
                idempotency_key: "idem-3".into(),
                confirmed: true,
            })
            .unwrap();
        assert!(replay.replayed);
    }

    #[test]
    fn comment_retry_is_idempotent_and_scoped_to_the_actor() {
        let (manager, context) = setup();
        manager
            .seed_ticket(ticket("ticket-1", "Ticket", None))
            .unwrap();
        let request = TaskMutationRequestDto {
            context: context.clone(),
            operation_id: "op-comment".into(),
            idempotency_key: "idem-comment".into(),
            mutation: TaskMutationDto::AddComment {
                ticket_id: "ticket-1".into(),
                comment_id: "comment-1".into(),
                body: "Nota".into(),
                created_at_unix_ms: 10,
            },
        };
        manager.preview_mutation(&request).unwrap();
        manager
            .apply_mutation(&TaskMutationApplyRequestDto {
                context: context.clone(),
                operation_id: "op-comment".into(),
                idempotency_key: "idem-comment".into(),
                confirmed: true,
            })
            .unwrap();
        let read = manager
            .read_ticket(&TaskTicketReadRequest {
                context,
                ticket_id: "ticket-1".into(),
                include_archived: false,
                subtask_offset: 0,
                subtask_limit: 10,
                comment_offset: 0,
                comment_limit: 10,
            })
            .unwrap();
        assert_eq!(read.comments.total, 1);
    }

    #[test]
    fn list_and_search_results_are_bounded() {
        let (manager, context) = setup();
        for index in 0..(MAX_TASK_RESULTS + 5) {
            manager
                .seed_ticket(ticket(
                    &format!("ticket-{index}"),
                    &format!("Task {index}"),
                    None,
                ))
                .unwrap();
        }
        let page = manager
            .list_tickets(&TaskTicketListRequest {
                context: context.clone(),
                board_id: None,
                group_id: None,
                states: vec![],
                priorities: vec![],
                query: String::new(),
                include_archived: true,
                offset: 0,
                limit: usize::MAX,
            })
            .unwrap();
        assert_eq!(page.items.len(), MAX_TASK_RESULTS);
        assert!(page.has_more);
        let hits = manager
            .search_context(&TaskContextSearchRequest {
                context,
                query: "Contenido".into(),
                board_id: None,
                ticket_ids: vec![],
                include_archived: true,
                limit: usize::MAX,
            })
            .unwrap();
        assert_eq!(hits.items.len(), MAX_TASK_RESULTS);
    }

    #[test]
    fn options_and_summary_are_authorized_by_board_scope() {
        let (manager, mut context) = setup();
        manager
            .seed_ticket(ticket("ticket-1", "Ticket", None))
            .unwrap();
        context.allowed_board_ids = vec!["board-a".into()];
        let options = manager.get_options(&context, Some("board-a")).unwrap();
        assert_eq!(options.groups.items.len(), 1);
        let summary = manager.board_summary(&context, "board-a").unwrap();
        assert_eq!(summary.total_tickets, 1);
        assert_eq!(
            manager
                .get_options(&context, Some("board-b"))
                .unwrap_err()
                .code,
            BackendErrorCode::Forbidden
        );
    }

    #[test]
    fn contracts_keep_reads_non_mutating_and_writes_confirmed() {
        let reads = task_manager_read_tool_contracts();
        let writes = task_manager_mutation_tool_contracts();
        assert!(reads
            .iter()
            .all(|tool| tool.read_only && !tool.requires_confirmation));
        assert!(writes
            .iter()
            .all(|tool| !tool.read_only && tool.requires_confirmation));
        let manager = setup().0;
        let context = TaskManagerContextDto::new("library-a", "user-a").unwrap();
        let request = TaskMutationRequestDto {
            context: context.clone(),
            operation_id: "op-no-confirm".into(),
            idempotency_key: "idem-no-confirm".into(),
            mutation: TaskMutationDto::CreateTicket {
                board_id: "board-a".into(),
                ticket_id: "ticket-new".into(),
                group_id: None,
                title: "New".into(),
                content: "Body".into(),
                state: TaskState::Pending,
                priority: TaskPriority::Low,
                parent_ticket_id: None,
                tags: vec![],
                initial_fields: None,
            },
        };
        manager.preview_mutation(&request).unwrap();
        assert_eq!(
            manager
                .apply_mutation(&TaskMutationApplyRequestDto {
                    context,
                    operation_id: "op-no-confirm".into(),
                    idempotency_key: "idem-no-confirm".into(),
                    confirmed: false
                })
                .unwrap_err()
                .code,
            BackendErrorCode::Cancelled
        );
    }

    #[test]
    fn snapshot_round_trip_is_deterministic_and_excludes_transient_state() {
        let (manager, context) = setup();
        manager
            .seed_ticket(ticket("ticket-1", "Ticket", None))
            .unwrap();
        manager
            .seed_comment(TaskCommentDto {
                library_id: "library-a".into(),
                comment_id: "comment-1".into(),
                ticket_id: "ticket-1".into(),
                author_user_id: "user-a".into(),
                body: "Comentario persistente".into(),
                created_at_unix_ms: 10,
                revision: 3,
                logical_path: "task-mannager/default/ticket-1.md".into(),
            })
            .unwrap();
        let request = TaskMutationRequestDto {
            context: context.clone(),
            operation_id: "op-preview-only".into(),
            idempotency_key: "idem-preview-only".into(),
            mutation: TaskMutationDto::ChangeState {
                ticket_id: "ticket-1".into(),
                state: TaskState::InProgress,
            },
        };
        manager.preview_mutation(&request).unwrap();

        let snapshot = manager.export_snapshot().unwrap();
        let bytes = manager.export_snapshot_bytes().unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("preview"));
        assert_eq!(bytes, snapshot.to_bytes().unwrap());
        assert_eq!(
            snapshot,
            TaskManagerSnapshotDto::from_bytes(&bytes).unwrap()
        );

        let restored = InMemoryTaskManager::new();
        restored.replace_serialized_snapshot(&bytes).unwrap();
        assert_eq!(restored.export_snapshot().unwrap(), snapshot);
        assert_eq!(
            restored
                .apply_mutation(&TaskMutationApplyRequestDto {
                    context,
                    operation_id: "op-preview-only".into(),
                    idempotency_key: "idem-preview-only".into(),
                    confirmed: true,
                })
                .unwrap_err()
                .code,
            BackendErrorCode::NotFound
        );
    }

    #[test]
    fn snapshot_rejects_malformed_and_oversized_bytes() {
        assert_eq!(
            TaskManagerSnapshotDto::from_bytes(b"not-json")
                .unwrap_err()
                .code,
            BackendErrorCode::InvalidInput
        );
        let unknown_field = br#"{"version":1,"libraries":[],"unexpected":true}"#;
        assert_eq!(
            TaskManagerSnapshotDto::from_bytes(unknown_field)
                .unwrap_err()
                .code,
            BackendErrorCode::InvalidInput
        );
        let oversized = vec![b' '; MAX_TASK_SNAPSHOT_BYTES + 1];
        assert_eq!(
            TaskManagerSnapshotDto::from_bytes(&oversized)
                .unwrap_err()
                .code,
            BackendErrorCode::InvalidInput
        );
    }

    #[test]
    fn snapshot_preserves_multiple_library_boundaries() {
        let (manager, _) = setup();
        manager.add_library("library-b").unwrap();
        manager.add_user("library-b", "user-b").unwrap();
        manager
            .seed_board(TaskBoardDto {
                library_id: "library-b".into(),
                board_id: "board-b".into(),
                name: "Personal".into(),
                color: "#abcdef".into(),
                context: None,
                revision: 7,
            })
            .unwrap();

        let snapshot = manager.export_snapshot().unwrap();
        let restored = InMemoryTaskManager::new();
        restored.import_snapshot(snapshot).unwrap();
        assert_eq!(
            restored
                .list_boards(&TaskManagerListRequest {
                    context: TaskManagerContextDto::new("library-a", "user-a").unwrap(),
                    board_id: None,
                    offset: 0,
                    limit: 10,
                })
                .unwrap()
                .items
                .len(),
            1
        );
        assert_eq!(
            restored
                .list_boards(&TaskManagerListRequest {
                    context: TaskManagerContextDto::new("library-b", "user-b").unwrap(),
                    board_id: None,
                    offset: 0,
                    limit: 10,
                })
                .unwrap()
                .items
                .len(),
            1
        );
        assert_eq!(
            restored
                .list_boards(&TaskManagerListRequest {
                    context: TaskManagerContextDto::new("library-a", "user-b").unwrap(),
                    board_id: None,
                    offset: 0,
                    limit: 10,
                })
                .unwrap_err()
                .code,
            BackendErrorCode::Unauthorized
        );
    }

    #[test]
    fn snapshot_replacement_is_atomic_and_preserves_revision_and_generation() {
        let (manager, context) = setup();
        manager
            .seed_ticket(ticket("ticket-1", "Ticket", None))
            .unwrap();
        let request = TaskMutationRequestDto {
            context: context.clone(),
            operation_id: "op-revision".into(),
            idempotency_key: "idem-revision".into(),
            mutation: TaskMutationDto::ChangeState {
                ticket_id: "ticket-1".into(),
                state: TaskState::Completed,
            },
        };
        manager.preview_mutation(&request).unwrap();
        manager
            .apply_mutation(&TaskMutationApplyRequestDto {
                context: context.clone(),
                operation_id: "op-revision".into(),
                idempotency_key: "idem-revision".into(),
                confirmed: true,
            })
            .unwrap();
        let snapshot = manager.export_snapshot().unwrap();
        assert_eq!(snapshot.libraries[0].generation, 2);
        assert_eq!(snapshot.libraries[0].tickets[0].summary.revision, 2);

        let mut invalid = snapshot.clone();
        invalid.libraries[0].tickets[0].summary.library_id = "library-b".into();
        let restored = InMemoryTaskManager::new();
        assert_eq!(
            restored.replace_snapshot(invalid).unwrap_err().code,
            BackendErrorCode::InvalidInput
        );
        assert!(restored.export_snapshot().unwrap().libraries.is_empty());

        restored.replace_snapshot(snapshot.clone()).unwrap();
        assert_eq!(restored.export_snapshot().unwrap(), snapshot);
        let read = restored
            .read_ticket(&TaskTicketReadRequest {
                context,
                ticket_id: "ticket-1".into(),
                include_archived: true,
                subtask_offset: 0,
                subtask_limit: 10,
                comment_offset: 0,
                comment_limit: 10,
            })
            .unwrap();
        assert_eq!(read.ticket.summary.revision, 2);
    }

    #[test]
    fn persistent_manager_loads_scoped_state_and_saves_confirmed_mutations() {
        let (source, context) = setup();
        source
            .seed_ticket(ticket("ticket-1", "Ticket", None))
            .unwrap();
        let snapshot = source
            .export_snapshot()
            .unwrap()
            .libraries
            .into_iter()
            .next();
        let store = Arc::new(TestSnapshotStore {
            snapshot: Mutex::new(snapshot),
            fail_save: Mutex::new(false),
        });
        let manager = PersistentTaskManager::open("library-a", store.clone()).unwrap();
        let request = TaskMutationRequestDto {
            context: context.clone(),
            operation_id: "op-persistent".into(),
            idempotency_key: "idem-persistent".into(),
            mutation: TaskMutationDto::ChangeState {
                ticket_id: "ticket-1".into(),
                state: TaskState::Completed,
            },
        };
        manager.preview_mutation(&request).unwrap();
        manager
            .apply_mutation(&TaskMutationApplyRequestDto {
                context,
                operation_id: "op-persistent".into(),
                idempotency_key: "idem-persistent".into(),
                confirmed: true,
            })
            .unwrap();

        let persisted = store.snapshot.lock().unwrap().clone().unwrap();
        assert_eq!(persisted.library_id, "library-a");
        assert_eq!(persisted.tickets[0].summary.state, TaskState::Completed);
    }

    #[test]
    fn persistent_manager_rolls_back_when_durable_save_fails() {
        let (source, context) = setup();
        source
            .seed_ticket(ticket("ticket-1", "Ticket", None))
            .unwrap();
        let store = Arc::new(TestSnapshotStore {
            snapshot: Mutex::new(
                source
                    .export_snapshot()
                    .unwrap()
                    .libraries
                    .into_iter()
                    .next(),
            ),
            fail_save: Mutex::new(true),
        });
        let manager = PersistentTaskManager::open("library-a", store).unwrap();
        let request = TaskMutationRequestDto {
            context: context.clone(),
            operation_id: "op-rollback".into(),
            idempotency_key: "idem-rollback".into(),
            mutation: TaskMutationDto::ChangeState {
                ticket_id: "ticket-1".into(),
                state: TaskState::Completed,
            },
        };
        manager.preview_mutation(&request).unwrap();
        assert_eq!(
            manager
                .apply_mutation(&TaskMutationApplyRequestDto {
                    context: context.clone(),
                    operation_id: "op-rollback".into(),
                    idempotency_key: "idem-rollback".into(),
                    confirmed: true,
                })
                .unwrap_err()
                .code,
            BackendErrorCode::Storage
        );
        let read = manager
            .read_ticket(&TaskTicketReadRequest {
                context,
                ticket_id: "ticket-1".into(),
                include_archived: true,
                subtask_offset: 0,
                subtask_limit: 10,
                comment_offset: 0,
                comment_limit: 10,
            })
            .unwrap();
        assert_eq!(read.ticket.summary.state, TaskState::Pending);
    }
}
