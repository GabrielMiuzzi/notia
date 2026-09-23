//! Translation from agent tool calls to Task Manager DTOs.
//!
//! The tool schemas in `defaults/tool_schemas.json` are the model-facing
//! contract. This module is the single place that maps those arguments to the
//! persistent store DTOs, generating identifiers on the backend so the model
//! never chooses a ticket, comment or group id.

use serde_json::Value;

use crate::error::BackendError;
use crate::task_manager_tools::{
    TaskMutationDto, TaskPriority, TaskState, TaskUpdateFieldsDto,
};

/// Maximum tickets read by one `read_task_tickets` call.
pub const MAX_TASK_TOOL_READ_TICKETS: usize = 20;

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

/// Maps a Task Manager mutation tool to the store DTO. `new_id` produces
/// backend-owned identifiers; `now_unix_ms` stamps new comments.
pub fn task_mutation_from_tool(
    name: &str,
    arguments: &Value,
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
        assert!(task_mutation_from_tool("change_task_state", &json!({"state": "Pendiente"}), &mut ids(), 0).is_err());
        assert!(task_mutation_from_tool("change_task_state", &json!({"ticketId": "t", "state": "Hecha"}), &mut ids(), 0).is_err());
        assert!(task_mutation_from_tool("update_task_fields", &json!({"ticketId": "t", "fields": {}}), &mut ids(), 0).is_err());
        assert!(task_mutation_from_tool("delete_board", &json!({}), &mut ids(), 0).is_err());
    }

    #[test]
    fn comments_are_stamped_by_the_backend() {
        let mutation = task_mutation_from_tool(
            "add_task_comment",
            &json!({"ticketId": "t-1", "comment": "Hecho"}),
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
