//! Translation from agent tool calls to Task Manager DTOs.
//!
//! The tool schemas in `defaults/tool_schemas.json` are the model-facing
//! contract. This module is the single place that maps those arguments to the
//! persistent store DTOs, generating identifiers on the backend so the model
//! never chooses a ticket, comment or group id.

use serde_json::{json, Value};

use crate::error::{BackendError, BackendErrorCode};
use crate::task_manager_tools::{
    TaskColumnKind, TaskGroupDto, TaskManagerContextDto, TaskManagerReadPort, TaskMutationDto, TaskPriority, TaskState,
    TaskTicketDto, TaskTicketListRequest, TaskTicketReadRequest, TaskUpdateFieldsDto, MAX_TASK_RESULTS,
};

const STATE_NAMES: &str = "Pendiente, En progreso, Bloqueada, Finalizada o Cancelada";
const PRIORITY_NAMES: &str = "Baja, Media, Alta, Urgente o Atrasado";

/// The filters of `search_task_tickets` / `read_all_task_tickets` (with
/// its `context`). A priority given as a state («Atrasado» is a priority:
/// the tickets past their date) moves to `priorities`; any other wrong
/// value says which lists are valid.
pub fn ticket_list_request(payload: &Value) -> Result<TaskTicketListRequest, BackendError> {
    let mut payload = payload.clone();
    if let Some(object) = payload.as_object_mut() {
        let states = object.get("states").and_then(Value::as_array).cloned().unwrap_or_default();
        let (priorities, states): (Vec<Value>, Vec<Value>) =
            states.into_iter().partition(|value| serde_json::from_value::<TaskPriority>(value.clone()).is_ok());
        if !priorities.is_empty() {
            object.insert("states".to_string(), Value::Array(states));
            let mut merged = object.get("priorities").and_then(Value::as_array).cloned().unwrap_or_default();
            merged.extend(priorities.into_iter().filter(|value| !merged.contains(value)).collect::<Vec<_>>());
            object.insert("priorities".to_string(), Value::Array(merged));
        }
    }
    serde_json::from_value::<TaskTicketListRequest>(payload).map_err(|_| {
        BackendError::invalid_input(format!(
            "Los filtros de Task Manager no son válidos: states admite {STATE_NAMES}; priorities admite {PRIORITY_NAMES} (Atrasado son los tickets vencidos)."
        ))
    })
}

/// `replace_task_content` with `section`: the ticket's whole body with only
/// that section changed. `mode` `append` adds `content` at the end of the
/// section, `replace` swaps its text; a missing section is added at the end
/// as `## section`. Any other call comes back as it is.
pub fn expand_section_edit(name: &str, arguments: &Value, tickets: &[TaskTicketDto]) -> Result<Value, BackendError> {
    let Some(section) = optional(arguments, "section") else {
        return Ok(arguments.clone());
    };
    if name != "replace_task_content" {
        return Ok(arguments.clone());
    }
    let ticket_id = required(arguments, "ticketId")?;
    let ticket = tickets
        .iter()
        .find(|ticket| ticket.summary.ticket_id == ticket_id)
        .ok_or_else(|| BackendError::invalid_input("El ticket no existe o no está a tu alcance; buscalo con search_task_tickets."))?;
    let append = match optional(arguments, "mode").as_deref() {
        None | Some("append") => true,
        Some("replace") => false,
        Some(_) => return Err(BackendError::invalid_input("mode es append (agrega al final de la sección) o replace (reemplaza su texto).")),
    };
    let text = required(arguments, "content")?;
    let mut expanded = arguments.clone();
    if let Some(object) = expanded.as_object_mut() {
        object.remove("section");
        object.remove("mode");
        object.insert("content".to_string(), json!(section_edited(&ticket.content, &section, text.trim_end(), append)));
    }
    Ok(expanded)
}

/// What a section edit does, in the words of its confirmation.
pub fn section_edit_summary(name: &str, arguments: &Value, tickets: &[TaskTicketDto]) -> Option<String> {
    let section = optional(arguments, "section").filter(|_| name == "replace_task_content")?;
    let ticket_id = optional(arguments, "ticketId").unwrap_or_default();
    let title = tickets.iter().find(|ticket| ticket.summary.ticket_id == ticket_id).map_or(ticket_id, |ticket| ticket.summary.title.clone());
    let verb = if optional(arguments, "mode").as_deref() == Some("replace") { "Reemplazar el texto de" } else { "Agregar a" };
    Some(format!("{verb} la sección «{}» del ticket «{title}»:
{}", section.trim().trim_start_matches('#').trim(), optional(arguments, "content").unwrap_or_default()))
}

/// The level and folded title of a Markdown heading line.
fn heading(line: &str) -> Option<(usize, String)> {
    let trimmed = line.trim_start();
    let level = trimmed.chars().take_while(|character| *character == '#').count();
    let title = trimmed.get(level..)?;
    if !(1..=6).contains(&level) || !title.starts_with(' ') {
        return None;
    }
    Some((level, crate::text_search::fold(title.trim().trim_end_matches(':').trim())))
}

fn section_edited(content: &str, section: &str, text: &str, append: bool) -> String {
    let wanted = crate::text_search::fold(section.trim().trim_start_matches('#').trim().trim_end_matches(':').trim());
    let lines = content.lines().collect::<Vec<_>>();
    let Some((start, level)) = lines.iter().enumerate().find_map(|(index, line)| heading(line).filter(|(_, title)| *title == wanted).map(|(level, _)| (index, level))) else {
        let body = content.trim_end();
        let title = section.trim().trim_start_matches('#').trim();
        return if body.is_empty() { format!("## {title}

{text}
") } else { format!("{body}

## {title}

{text}
") };
    };
    let end = lines[start + 1..].iter().position(|line| heading(line).is_some_and(|(other, _)| other <= level)).map_or(lines.len(), |offset| start + 1 + offset);
    let kept = lines[start + 1..end].iter().rev().skip_while(|line| line.trim().is_empty()).collect::<Vec<_>>();
    let mut body = if append { kept.into_iter().rev().map(|line| line.to_string()).collect::<Vec<_>>() } else { Vec::new() };
    while body.first().is_some_and(|line| line.trim().is_empty()) {
        body.remove(0);
    }
    body.extend(text.lines().map(str::to_string));
    let mut result = lines[..=start].iter().map(|line| line.to_string()).collect::<Vec<_>>();
    result.push(String::new());
    result.extend(body);
    if end < lines.len() {
        result.push(String::new());
        result.extend(lines[end..].iter().map(|line| line.to_string()));
    }
    format!("{}
", result.join("
").trim_end())
}

/// Maximum tickets read by one `read_task_tickets` call.
pub const MAX_TASK_TOOL_READ_TICKETS: usize = 20;

/// Task Manager tools that change data; each one maps to one store mutation.
/// The tools that follow the board's own rules (state, moves, time, people,
/// projects…) are in `task_board_tool_input`.
pub const TASK_MUTATION_TOOLS: [&str; 13] = [
    "create_task_ticket",
    "replace_task_content",
    "add_task_comment",
    "update_task_comment",
    "delete_task_comment",
    "add_task_subtask",
    "change_task_priority",
    "update_task_fields",
    "bulk_update_tasks",
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
        "update_task_comment" => TaskMutationDto::UpdateComment {
            ticket_id: required(arguments, "ticketId")?,
            comment_id: required(arguments, "commentId")?,
            body: required(arguments, "comment")?,
        },
        "delete_task_comment" => TaskMutationDto::DeleteComment {
            ticket_id: required(arguments, "ticketId")?,
            comment_id: required(arguments, "commentId")?,
        },
        "add_task_subtask" => TaskMutationDto::AddSubtask {
            parent_ticket_id: required(arguments, "ticketId")?,
            ticket_id: new_id(),
            title: required(arguments, "title")?,
            content: text(arguments, "content"),
            priority: parse_enum(arguments, "priority")?.unwrap_or(TaskPriority::Medium),
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
        "create_task_group" => TaskMutationDto::CreateGroup {
            board_id: required(arguments, "boardId")?,
            group_id: new_id(),
            name: required(arguments, "name")?,
            color: required(arguments, "color")?,
            column_kind: parse_enum::<TaskColumnKind>(arguments, "kind")?,
        },
        "update_task_group" => {
            let board_id = required(arguments, "boardId")?;
            let group_id = required(arguments, "groupId")?;
            let name = optional(arguments, "name");
            let color = optional(arguments, "color");
            let column_kind = parse_enum::<TaskColumnKind>(arguments, "kind")?;
            if name.is_none() && color.is_none() && column_kind.is_none() {
                return Err(BackendError::invalid_input(
                    "update_task_group necesita name, color o kind.",
                ));
            }
            let current = current_group(groups, &board_id, &group_id)?;
            TaskMutationDto::UpdateGroup {
                name: name.unwrap_or_else(|| current.name.clone()),
                color: color.unwrap_or_else(|| current.color.clone()),
                board_id,
                group_id,
                column_kind,
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

/// The tickets of a `read_task_tickets` call. A ticket asked by id is read
/// even when finished or cancelled, since its id came from a listing that
/// includes them; one that cannot be read goes in `notRead` with its reason
/// instead of failing the others.
pub fn read_tickets_by_id(port: &dyn TaskManagerReadPort, context: &TaskManagerContextDto, arguments: &Value) -> Result<Value, BackendError> {
    let include_archived = arguments.get("includeArchived").and_then(Value::as_bool).unwrap_or(true);
    let mut tickets = Vec::new();
    let mut not_read = Vec::new();
    for ticket_id in ticket_ids_to_read(arguments)? {
        let request = TaskTicketReadRequest {
            context: context.clone(),
            ticket_id: ticket_id.clone(),
            include_archived,
            subtask_offset: 0,
            subtask_limit: MAX_TASK_RESULTS,
            comment_offset: 0,
            comment_limit: MAX_TASK_RESULTS,
        };
        match port.read_ticket(&request) {
            Ok(ticket) => tickets.push(ticket),
            Err(error) if matches!(error.code, BackendErrorCode::NotFound | BackendErrorCode::Forbidden | BackendErrorCode::InvalidInput) => {
                not_read.push(json!({ "ticketId": ticket_id, "error": error.message }))
            }
            Err(error) => return Err(error),
        }
    }
    Ok(json!({ "tickets": tickets, "notRead": not_read }))
}

#[cfg(test)]
mod tests {

    #[test]
    fn a_section_of_the_body_is_appended_or_replaced_alone() {
        let body = "Contexto del ticket.

## Pendientes

- [ ] Llamar a André

## Notas

Nada más.
";
        assert_eq!(
            section_edited(body, "pendientes:", "- [ ] Probar el SN 0449530", true),
            "Contexto del ticket.

## Pendientes

- [ ] Llamar a André
- [ ] Probar el SN 0449530

## Notas

Nada más.
"
        );
        assert_eq!(
            section_edited(body, "## Pendientes", "- [x] Listo", false),
            "Contexto del ticket.

## Pendientes

- [x] Listo

## Notas

Nada más.
"
        );
        assert_eq!(section_edited("Texto.", "Pendientes", "- [ ] Uno", true), "Texto.

## Pendientes

- [ ] Uno
");
        // A deeper heading belongs to the section.
        assert_eq!(
            section_edited("## Pendientes
- a
### Detalle
- b
## Fin", "Pendientes", "- c", true),
            "## Pendientes

- a
### Detalle
- b
- c

## Fin
"
        );
    }

    #[test]
    fn a_priority_given_as_a_state_is_searched_as_a_priority() {
        let context = json!({ "libraryId": "library", "libraryUserId": "owner" });
        let request = ticket_list_request(&json!({ "context": context, "states": ["Atrasado", "En progreso"], "priorities": ["Urgente"] })).expect("request");
        assert_eq!(request.states, [TaskState::InProgress]);
        assert_eq!(request.priorities, [TaskPriority::Urgent, TaskPriority::Overdue]);
        let wrong = ticket_list_request(&json!({ "context": context, "states": ["Vencido"] })).expect_err("unknown");
        assert!(wrong.message.contains("Atrasado son los tickets vencidos"), "{}", wrong.message);
    }
    use super::*;

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

    #[test]
    fn comment_edits_and_deletions_name_an_existing_comment() {
        let edit = task_mutation_from_tool(
            "update_task_comment",
            &json!({"ticketId": "t-1", "commentId": "c-1", "comment": " Texto corregido "}),
            &[],
            &mut ids(),
            0,
        )
        .expect("edit");
        assert_eq!(
            edit,
            TaskMutationDto::UpdateComment {
                ticket_id: "t-1".into(),
                comment_id: "c-1".into(),
                body: "Texto corregido".into(),
            }
        );
        let deletion = task_mutation_from_tool("delete_task_comment", &json!({"ticketId": "t-1", "commentId": "c-1"}), &[], &mut ids(), 0)
            .expect("delete");
        assert_eq!(deletion, TaskMutationDto::DeleteComment { ticket_id: "t-1".into(), comment_id: "c-1".into() });
        assert!(task_mutation_from_tool("update_task_comment", &json!({"ticketId": "t-1", "comment": "x"}), &[], &mut ids(), 0).is_err());
        assert!(task_mutation_from_tool("update_task_comment", &json!({"ticketId": "t-1", "commentId": "c-1"}), &[], &mut ids(), 0).is_err());
        assert!(task_mutation_from_tool("delete_task_comment", &json!({"commentId": "c-1"}), &[], &mut ids(), 0).is_err());
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
            kind: None,
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
                column_kind: None,
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
        assert_eq!(contracts.len(), TASK_MUTATION_TOOLS.len() + crate::task_board_tool_input::TASK_BOARD_ACTION_TOOLS.len());
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
