//! Translation from agent tool calls to Task Manager DTOs.
//!
//! The tool schemas in `defaults/tool_schemas.json` are the model-facing
//! contract. This module is the single place that maps those arguments to the
//! persistent store DTOs, generating identifiers on the backend so the model
//! never chooses a ticket, comment or group id.

use serde_json::Value;

use crate::error::BackendError;
use crate::task_manager_tools::{
    TaskGroupDto, TaskMutationDto, TaskPriority, TaskState, TaskUpdateFieldsDto,
};

/// Maximum tickets read by one `read_task_tickets` call.
pub const MAX_TASK_TOOL_READ_TICKETS: usize = 20;

/// Task Manager tools that change data; each one maps to one store mutation.
pub const TASK_MUTATION_TOOLS: [&str; 16] = [
    "create_task_ticket",
    "replace_task_content",
    "add_task_comment",
    "add_task_subtask",
    "move_task_group",
    "change_task_state",
    "change_task_priority",
    "update_task_fields",
    "bulk_update_tasks",
    "duplicate_task",
    "archive_task",
    "restore_task",
    "create_task_group",
    "update_task_group",
    "reorder_task_groups",
    "delete_task_group",
];

pub fn is_task_mutation_tool(name: &str) -> bool {
    TASK_MUTATION_TOOLS.contains(&name)
}

fn text(arguments: &Value, name: &str) -> String {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn required(arguments: &Value, name: &str) -> Result<String, BackendError> {
    let value = text(arguments, name);
    if value.is_empty() {
        return Err(BackendError::invalid_input(format!(
            "Falta {name}; consultalo con las herramientas de lectura antes de mutar."
        )));
    }
    Ok(value)
}

fn optional(arguments: &Value, name: &str) -> Option<String> {
    Some(text(arguments, name)).filter(|value| !value.is_empty())
}

fn string_list(arguments: &Value, name: &str) -> Vec<String> {
    arguments
        .get(name)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_enum<T: serde::de::DeserializeOwned>(
    arguments: &Value,
    name: &str,
) -> Result<Option<T>, BackendError> {
    match arguments.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|_| BackendError::invalid_input(format!("{name} no es un valor permitido."))),
    }
}

fn required_enum<T: serde::de::DeserializeOwned>(
    arguments: &Value,
    name: &str,
) -> Result<T, BackendError> {
    parse_enum(arguments, name)?
        .ok_or_else(|| BackendError::invalid_input(format!("Falta {name}.")))
}

fn fields(arguments: &Value) -> Result<TaskUpdateFieldsDto, BackendError> {
    let value = arguments
        .get("fields")
        .cloned()
        .ok_or_else(|| BackendError::invalid_input("Falta fields."))?;
    let fields = serde_json::from_value::<TaskUpdateFieldsDto>(value)
        .map_err(|_| BackendError::invalid_input("fields contiene campos o valores no válidos."))?;
    if fields.is_empty() {
        return Err(BackendError::invalid_input(
            "fields debe incluir al menos un campo a modificar.",
        ));
    }
    Ok(fields)
}

/// Group of the board named by the tool, among the library's current groups.
fn current_group<'a>(
    groups: &'a [TaskGroupDto],
    board_id: &str,
    group_id: &str,
) -> Result<&'a TaskGroupDto, BackendError> {
    groups
        .iter()
        .find(|group| group.board_id == board_id && group.group_id == group_id)
        .ok_or_else(|| {
            BackendError::invalid_input(
                "El grupo no existe en ese tablero; consultalo con get_task_manager_options.",
            )
        })
}

/// Maps a Task Manager mutation tool to the store DTO. `groups` are the
/// library's current groups, which fill what a group update leaves out;
/// `new_id` produces backend-owned identifiers; `now_unix_ms` stamps new
/// comments.
pub fn task_mutation_from_tool(
    name: &str,
    arguments: &Value,
    groups: &[TaskGroupDto],
    new_id: &mut dyn FnMut() -> String,
    now_unix_ms: i64,
) -> Result<TaskMutationDto, BackendError> {
    let mutation = match name {
        "create_task_ticket" => TaskMutationDto::CreateTicket {
            board_id: required(arguments, "boardId")?,
            ticket_id: new_id(),
            group_id: optional(arguments, "groupId"),
            title: required(arguments, "title")?,
            content: text(arguments, "content"),
            state: parse_enum(arguments, "state")?.unwrap_or(TaskState::Pending),
            priority: parse_enum(arguments, "priority")?.unwrap_or(TaskPriority::Medium),
            parent_ticket_id: None,
            tags: string_list(arguments, "tags"),
            initial_fields: None,
        },
        "replace_task_content" => TaskMutationDto::ReplaceTicketContent {
            ticket_id: required(arguments, "ticketId")?,
            content: required(arguments, "content")?,
        },
        "add_task_comment" => TaskMutationDto::AddComment {
            ticket_id: required(arguments, "ticketId")?,
            comment_id: new_id(),
            body: required(arguments, "comment")?,
            created_at_unix_ms: now_unix_ms,
        },
        "add_task_subtask" => TaskMutationDto::AddSubtask {
            parent_ticket_id: required(arguments, "ticketId")?,
            ticket_id: new_id(),
            title: required(arguments, "title")?,
            content: text(arguments, "content"),
            priority: parse_enum(arguments, "priority")?.unwrap_or(TaskPriority::Medium),
        },
        "move_task_group" => TaskMutationDto::MoveTicket {
            ticket_id: required(arguments, "ticketId")?,
            group_id: optional(arguments, "groupId"),
        },
        "change_task_state" => TaskMutationDto::ChangeState {
            ticket_id: required(arguments, "ticketId")?,
            state: required_enum(arguments, "state")?,
        },
        "change_task_priority" => TaskMutationDto::ChangePriority {
            ticket_id: required(arguments, "ticketId")?,
            priority: required_enum(arguments, "priority")?,
        },
        "update_task_fields" => TaskMutationDto::UpdateTicket {
            ticket_id: required(arguments, "ticketId")?,
            fields: fields(arguments)?,
        },
        "bulk_update_tasks" => {
            let ticket_ids = string_list(arguments, "ticketIds");
            if ticket_ids.is_empty() {
                return Err(BackendError::invalid_input("Falta ticketIds."));
            }
            TaskMutationDto::BulkUpdate {
                ticket_ids,
                fields: fields(arguments)?,
            }
        }
        "duplicate_task" => TaskMutationDto::DuplicateTicket {
            ticket_id: required(arguments, "ticketId")?,
            new_ticket_id: new_id(),
            title: optional(arguments, "title"),
        },
        "archive_task" => TaskMutationDto::ArchiveTicket {
            ticket_id: required(arguments, "ticketId")?,
        },
        "restore_task" => TaskMutationDto::RestoreTicket {
            ticket_id: required(arguments, "ticketId")?,
        },
        "create_task_group" => TaskMutationDto::CreateGroup {
            board_id: required(arguments, "boardId")?,
            group_id: new_id(),
            name: required(arguments, "name")?,
            color: required(arguments, "color")?,
        },
        "update_task_group" => {
            let board_id = required(arguments, "boardId")?;
            let group_id = required(arguments, "groupId")?;
            let name = optional(arguments, "name");
            let color = optional(arguments, "color");
            if name.is_none() && color.is_none() {
                return Err(BackendError::invalid_input(
                    "update_task_group necesita name, color o ambos.",
                ));
            }
            let current = current_group(groups, &board_id, &group_id)?;
            TaskMutationDto::UpdateGroup {
                name: name.unwrap_or_else(|| current.name.clone()),
                color: color.unwrap_or_else(|| current.color.clone()),
                board_id,
                group_id,
            }
        }
        "reorder_task_groups" => {
            let group_ids = string_list(arguments, "groupIds");
            if group_ids.is_empty() {
                return Err(BackendError::invalid_input("Falta groupIds."));
            }
            TaskMutationDto::ReorderGroups {
                board_id: required(arguments, "boardId")?,
                group_ids,
            }
        }
        "delete_task_group" => TaskMutationDto::DeleteGroup {
            board_id: required(arguments, "boardId")?,
            group_id: required(arguments, "groupId")?,
        },
        _ => {
            return Err(BackendError::invalid_input(
                "La herramienta no corresponde a una mutación de Task Manager.",
            ))
        }
    };
    Ok(mutation)
}

/// Ticket ids requested by `read_task_tickets`, accepting the legacy single
/// `ticketId`. The list is deduplicated and bounded.
pub fn ticket_ids_to_read(arguments: &Value) -> Result<Vec<String>, BackendError> {
    let mut ids = string_list(arguments, "ticketIds");
    if let Some(single) = optional(arguments, "ticketId") {
        ids.push(single);
    }
    let mut unique = Vec::new();
    for id in ids {
        if !unique.contains(&id) {
            unique.push(id);
        }
    }
    if unique.is_empty() {
        return Err(BackendError::invalid_input("Falta ticketIds."));
    }
    if unique.len() > MAX_TASK_TOOL_READ_TICKETS {
        return Err(BackendError::invalid_input(format!(
            "read_task_tickets admite hasta {MAX_TASK_TOOL_READ_TICKETS} tickets por llamada."
        )));
    }
    Ok(unique)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ids() -> impl FnMut() -> String {
        let mut next = 0;
        move || {
            next += 1;
            format!("id-{next}")
        }
    }

    #[test]
    fn creates_a_ticket_with_backend_ids_and_defaults() {
        let mutation = task_mutation_from_tool(
            "create_task_ticket",
            &json!({"boardId": "board-1", "title": "Nueva", "priority": "Alta"}),
            &[],
            &mut ids(),
            0,
        )
        .expect("mutation");
        assert_eq!(
            mutation,
            TaskMutationDto::CreateTicket {
                board_id: "board-1".into(),
                ticket_id: "id-1".into(),
                group_id: None,
                title: "Nueva".into(),
                content: String::new(),
                state: TaskState::Pending,
                priority: TaskPriority::High,
                parent_ticket_id: None,
                tags: Vec::new(),
                initial_fields: None,
            }
        );
    }

    #[test]
    fn rejects_missing_ids_and_unknown_enum_values() {
        assert!(task_mutation_from_tool("change_task_state", &json!({"state": "Pendiente"}), &[], &mut ids(), 0).is_err());
        assert!(task_mutation_from_tool("change_task_state", &json!({"ticketId": "t", "state": "Hecha"}), &[], &mut ids(), 0).is_err());
        assert!(task_mutation_from_tool("update_task_fields", &json!({"ticketId": "t", "fields": {}}), &[], &mut ids(), 0).is_err());
        assert!(task_mutation_from_tool("delete_board", &json!({}), &[], &mut ids(), 0).is_err());
    }

    #[test]
    fn comments_are_stamped_by_the_backend() {
        let mutation = task_mutation_from_tool(
            "add_task_comment",
            &json!({"ticketId": "t-1", "comment": "Hecho"}),
            &[],
            &mut ids(),
            42,
        )
        .expect("comment");
        assert_eq!(
            mutation,
            TaskMutationDto::AddComment {
                ticket_id: "t-1".into(),
                comment_id: "id-1".into(),
                body: "Hecho".into(),
                created_at_unix_ms: 42,
            }
        );
    }

    fn group(id: &str, name: &str, color: &str) -> TaskGroupDto {
        TaskGroupDto {
            library_id: "library-1".into(),
            group_id: id.into(),
            board_id: "board-1".into(),
            name: name.into(),
            color: color.into(),
            revision: 1,
            order: 0,
        }
    }

    #[test]
    fn a_group_update_keeps_the_fields_it_does_not_change() {
        let groups = [group("g-1", "Backlog Q", "#10b981")];
        let renamed = task_mutation_from_tool(
            "update_task_group",
            &json!({"boardId": "board-1", "groupId": "g-1", "name": "Backlog Q actual"}),
            &groups,
            &mut ids(),
            0,
        )
        .expect("rename");
        assert_eq!(
            renamed,
            TaskMutationDto::UpdateGroup {
                board_id: "board-1".into(),
                group_id: "g-1".into(),
                name: "Backlog Q actual".into(),
                color: "#10b981".into(),
            }
        );
        let recolored = task_mutation_from_tool(
            "update_task_group",
            &json!({"boardId": "board-1", "groupId": "g-1", "color": "#4FD1C5"}),
            &groups,
            &mut ids(),
            0,
        )
        .expect("recolor");
        assert!(matches!(recolored, TaskMutationDto::UpdateGroup { ref name, ref color, .. } if name == "Backlog Q" && color == "#4FD1C5"));
    }

    #[test]
    fn a_group_update_needs_a_change_and_a_known_group() {
        let groups = [group("g-1", "Backlog Q", "#10b981")];
        let update = |arguments: Value| task_mutation_from_tool("update_task_group", &arguments, &groups, &mut ids(), 0);
        assert!(update(json!({"boardId": "board-1", "groupId": "g-1"})).is_err());
        assert!(update(json!({"boardId": "board-1", "groupId": "g-2", "name": "Otro"})).is_err());
        assert!(update(json!({"boardId": "board-2", "groupId": "g-1", "name": "Otro"})).is_err());
    }

    #[test]
    fn a_reorder_passes_the_requested_group_order() {
        let mutation = task_mutation_from_tool(
            "reorder_task_groups",
            &json!({"boardId": "board-1", "groupIds": ["g-2", " g-1 ", ""]}),
            &[],
            &mut ids(),
            0,
        )
        .expect("reorder");
        assert_eq!(
            mutation,
            TaskMutationDto::ReorderGroups {
                board_id: "board-1".into(),
                group_ids: vec!["g-2".into(), "g-1".into()],
            }
        );
        assert!(task_mutation_from_tool("reorder_task_groups", &json!({"boardId": "board-1", "groupIds": []}), &[], &mut ids(), 0).is_err());
    }

    #[test]
    fn every_mutation_tool_has_a_mapping_and_a_contract() {
        let contracts = crate::task_manager_tools::task_manager_mutation_tool_contracts();
        assert_eq!(contracts.len(), TASK_MUTATION_TOOLS.len());
        for name in TASK_MUTATION_TOOLS {
            assert!(contracts.iter().any(|tool| tool.name == name), "{name} sin contrato");
            let unsupported = task_mutation_from_tool(name, &json!({}), &[], &mut ids(), 0)
                .err()
                .is_some_and(|error| error.message.contains("no corresponde"));
            assert!(!unsupported, "{name} sin mapeo");
        }
    }

    #[test]
    fn reading_tickets_is_deduplicated_and_bounded() {
        assert_eq!(
            ticket_ids_to_read(&json!({"ticketIds": ["a", "b", "a"], "ticketId": "c"})).expect("ids"),
            vec!["a", "b", "c"]
        );
        let many = (0..=MAX_TASK_TOOL_READ_TICKETS).map(|i| i.to_string()).collect::<Vec<_>>();
        assert!(ticket_ids_to_read(&json!({ "ticketIds": many })).is_err());
        assert!(ticket_ids_to_read(&json!({})).is_err());
    }
}
