use std::collections::HashSet;
use std::sync::OnceLock;

use super::context::{BackendRequestContext, BackendScope};
use super::error::{BackendError, BackendErrorCode};
use super::protocol::ToolDefinition;

const CONFIDENTIAL_CONTEXT: &str = "#Confidencial";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolPolicy {
    Public,
    LibraryRead,
    LibraryWrite,
    TaskRead,
    TaskWrite,
    FinanceRead,
    FinanceWrite,
    RoutineRead,
    RoutineWrite,
    Memory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolCatalogProjection {
    Full,
    ReadOnly,
    PublishedTaskManager,
}

/// Returns the catalog owned by the backend.
///
/// Requests received from a client may contain a projection (or, while the
/// migration is in progress, an old client-side catalog), but they must not be
/// able to change a tool's policy, mutability or confirmation requirements.
/// Keeping the source of truth here also gives headless transports the same
/// catalog as the Tauri transport.
pub fn canonical_tool_catalog() -> Vec<ToolDefinition> {
    let mut catalog = Vec::new();
    catalog.extend(super::library_tools::library_tool_contracts());
    catalog.extend(super::library_tools::library_mutation_tool_contracts());
    catalog.extend(super::task_manager_tools::task_manager_read_tool_contracts());
    catalog.extend(super::task_manager_tools::task_manager_mutation_tool_contracts());
    catalog.extend([
        public_tool(
            "search_web",
            "Busca fuentes públicas y devuelve enlaces verificables.",
            vec![BackendScope::Library, BackendScope::Finance],
        ),
        public_tool(
            "request_user_clarification",
            "Solicita un dato que falta antes de continuar.",
            vec![BackendScope::Library, BackendScope::Document, BackendScope::TaskManager, BackendScope::Finance],
        ),
        public_tool(
            "request_user_confirmation",
            "Prepara una decisión explícita del usuario.",
            vec![BackendScope::Library, BackendScope::Document, BackendScope::TaskManager, BackendScope::Finance],
        ),
        public_tool(
            "get_workspace_context",
            "Obtiene el contexto visual autorizado de la solicitud.",
            vec![BackendScope::Library, BackendScope::Document, BackendScope::Graph],
        ),
        memory_tool("add_agent_rule", "Guarda una regla operativa persistente."),
        memory_tool("add_agent_memory", "Guarda un hecho persistente del usuario."),
    ]);
    catalog.extend(alias_tools(
        [
            "read_active_markdown_document",
            "request_file_read_permission",
            "extract_document_facts",
        ],
        BackendScope::Document,
        true,
    ));
    catalog.extend(alias_tools(
        [
            "get_finance_dashboard",
            "get_finance_dollar_quotes",
            "get_finance_inflation_indices",
            "get_finance_historical_dollar_quotes",
            "list_finance_accounts",
            "list_finance_categories",
            "list_finance_movements",
            "search_finance_categories",
            "list_finance_credit_card_statements",
            "list_finance_salaries",
            "list_finance_purchases",
            "list_finance_price_history",
            "list_finance_services",
            "list_finance_service_occurrences",
            "list_finance_service_invoices",
            "list_finance_review_items",
            "list_finance_products",
            "list_finance_merchants",
            "get_finance_full_snapshot",
            "get_finance_record",
            "list_finance_records",
        ],
        BackendScope::Finance,
        true,
    ));
    catalog.extend(alias_tools(
        [
            "create_finance_transaction",
            "create_finance_savings_movement",
            "create_finance_savings_exchange",
            "create_finance_category",
            "create_finance_purchase",
            "create_finance_salary",
            "create_finance_credit_card_statement",
            "update_finance_transaction_status",
            "create_finance_service",
            "create_finance_service_occurrence",
            "create_finance_service_invoice",
            "save_finance_account",
            "save_finance_category",
            "save_finance_transaction",
            "save_finance_savings_reserve",
            "save_finance_savings_movement",
            "save_finance_savings_exchange",
            "save_finance_purchase",
            "save_finance_salary",
            "save_finance_credit_card_statement",
            "save_finance_installment_plan",
            "save_finance_service",
            "save_finance_service_occurrence",
            "save_finance_service_invoice",
            "link_finance_savings_account",
            "set_finance_service_active",
            "delete_finance_record",
            "reverse_finance_transaction",
            "clear_finance_data",
            "extract_finance_document",
            "link_finance_records",
            "unlink_finance_records",
            "resolve_finance_review_item",
            "rename_finance_product",
            "rename_finance_merchant",
            "merge_finance_products",
            "merge_finance_merchants",
        ],
        BackendScope::Finance,
        false,
    ));
    catalog.extend(alias_tools(
        [
            "list_finance_installment_plans",
            "list_finance_installments",
            "list_finance_artifacts",
        ],
        BackendScope::Finance,
        true,
    ));
    catalog.extend(routine_tools(
        &[
            "get_routine_dashboard",
            "get_routine_day",
            "list_routine_history",
            "get_routine_month_report",
        ],
        true,
    ));
    catalog.extend(routine_tools(
        &[
            "save_routine",
            "delete_routine",
            "save_routine_task",
            "set_routine_task_status",
            "delete_routine_task",
            "restore_routine_task",
            "reorder_routine_tasks",
            "set_routine_completions",
            "set_routine_goal",
        ],
        false,
    ));
    catalog.extend(alias_tools(
        ["undo_ai_operation"],
        BackendScope::Library,
        false,
    ));
    catalog.extend(document_mutation_alias_tools([
        "create_library_note",
        "replace_library_document",
        "delete_library_document",
    ]));
    catalog.extend(plan_tools());
    catalog.into_iter().map(with_canonical_schema).collect()
}

/// Model-facing description and JSON schema per tool, owned by the backend
/// (`defaults/tool_schemas.json`). Policy, scopes, mutability and
/// confirmation stay in this module; the resource only documents arguments.
fn tool_schemas() -> &'static serde_json::Map<String, serde_json::Value> {
    static SCHEMAS: OnceLock<serde_json::Map<String, serde_json::Value>> = OnceLock::new();
    SCHEMAS.get_or_init(|| {
        serde_json::from_str(include_str!("defaults/tool_schemas.json"))
            .expect("defaults/tool_schemas.json must be a JSON object")
    })
}

fn with_canonical_schema(mut tool: ToolDefinition) -> ToolDefinition {
    if let Some(entry) = tool_schemas().get(&tool.name) {
        if let Some(description) = entry.get("description").and_then(serde_json::Value::as_str) {
            tool.description = description.to_string();
        }
        if let Some(parameters) = entry.get("parameters") {
            tool.input_schema = parameters.clone();
        }
    }
    tool
}

/// Plan tools open an approval interaction; they never mutate by themselves.
fn plan_tools() -> Vec<ToolDefinition> {
    [
        ("set_agent_execution_plan", vec![BackendScope::Library, BackendScope::Document]),
        ("create_agent_plan", vec![BackendScope::Library, BackendScope::Document]),
        ("update_agent_plan", vec![BackendScope::Library, BackendScope::Document]),
        ("set_task_execution_plan", vec![BackendScope::TaskManager]),
    ]
    .into_iter()
    .map(|(name, scopes)| ToolDefinition {
        name: name.to_string(),
        description: "Propone un plan de pasos para aprobación del usuario.".to_string(),
        input_schema: serde_json::json!({"type": "object"}),
        scopes,
        read_only: false,
        requires_confirmation: false,
    })
    .collect()
}

/// Projects the canonical backend catalog for a request. `requested_names` is
/// only a filter; it is never a source of tool metadata or authorization.
pub fn project_canonical_tool_catalog(
    context: &BackendRequestContext,
    principal: &AuthorizationPrincipal,
    requested_names: &[String],
    projection: ToolCatalogProjection,
) -> Result<Vec<ToolDefinition>, BackendError> {
    let requested = requested_names
        .iter()
        .map(|name| name.trim())
        .filter(|name| !name.is_empty())
        .collect::<HashSet<_>>();
    let canonical = canonical_tool_catalog();
    if requested_names.len() != requested.len() {
        return Err(BackendError::invalid_input(
            "La selección de tools contiene nombres vacíos o repetidos.",
        ));
    }
    if let Some(unknown) = requested
        .iter()
        .find(|name| !canonical.iter().any(|tool| tool.name == **name))
    {
        return Err(BackendError::invalid_input(format!(
            "La tool solicitada no pertenece al catálogo backend: {unknown}."
        )));
    }
    project_tool_catalog(
        context,
        principal,
        &canonical
            .into_iter()
            .filter(|tool| requested.is_empty() || requested.contains(tool.name.as_str()))
            .collect::<Vec<_>>(),
        projection,
    )
}

fn public_tool(name: &str, description: &str, scopes: Vec<BackendScope>) -> ToolDefinition {
    ToolDefinition {
        name: name.to_string(),
        description: description.to_string(),
        input_schema: serde_json::json!({"type": "object"}),
        scopes,
        read_only: true,
        requires_confirmation: false,
    }
}

fn memory_tool(name: &str, description: &str) -> ToolDefinition {
    ToolDefinition {
        name: name.to_string(),
        description: description.to_string(),
        input_schema: serde_json::json!({"type": "object"}),
        // Every app chat of the owner can save memories and rules; finance
        // stays out by design and graph chats are read-only.
        scopes: vec![BackendScope::Library, BackendScope::Document, BackendScope::TaskManager],
        read_only: false,
        requires_confirmation: false,
    }
}

fn alias_tools<const N: usize>(
    names: [&str; N],
    scope: BackendScope,
    read_only: bool,
) -> Vec<ToolDefinition> {
    names
        .into_iter()
        .map(|name| ToolDefinition {
            name: name.to_string(),
            description: "Tool versionada del catálogo backend.".to_string(),
            input_schema: serde_json::json!({"type": "object"}),
            scopes: vec![scope.clone()],
            read_only,
            requires_confirmation: !read_only,
        })
        .collect()
}

/// Rutina is reachable from the library chat and from Finanzas, because
/// Telegram routes a message to Finanzas by its wording ("pagué la cuenta").
fn routine_tools(names: &[&str], read_only: bool) -> Vec<ToolDefinition> {
    names
        .iter()
        .map(|name| ToolDefinition {
            name: name.to_string(),
            description: "Tool versionada del catálogo backend.".to_string(),
            input_schema: serde_json::json!({"type": "object"}),
            scopes: vec![BackendScope::Library, BackendScope::Finance],
            read_only,
            requires_confirmation: !read_only,
        })
        .collect()
}

fn document_mutation_alias_tools<const N: usize>(names: [&str; N]) -> Vec<ToolDefinition> {
    names
        .into_iter()
        .map(|name| ToolDefinition {
            name: name.to_string(),
            description: "Mutación documental versionada del catálogo backend.".to_string(),
            input_schema: serde_json::json!({"type": "object"}),
            scopes: vec![BackendScope::Library, BackendScope::Document, BackendScope::Graph],
            read_only: false,
            requires_confirmation: true,
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizationPrincipal {
    pub library_id: String,
    pub library_user_id: String,
    pub allowed_contexts: Vec<String>,
    pub all_contexts: bool,
}

impl AuthorizationPrincipal {
    pub fn validate(&self) -> Result<(), BackendError> {
        if self.library_id.trim().is_empty()
            || self.library_user_id.trim().is_empty()
            || self
                .allowed_contexts
                .iter()
                .any(|value| value.trim().is_empty())
        {
            return Err(BackendError::invalid_input(
                "El principal de autorización no es válido.",
            ));
        }
        Ok(())
    }

    fn can_access_confidential_context(&self) -> bool {
        self.all_contexts
            || self
                .allowed_contexts
                .iter()
                .any(|value| value.eq_ignore_ascii_case(CONFIDENTIAL_CONTEXT))
    }
}

pub fn tool_policy(tool_name: &str) -> ToolPolicy {
    match tool_name {
        "search_web"
        | "request_user_clarification"
        | "request_user_confirmation"
        | "get_workspace_context" => ToolPolicy::Public,
        "add_agent_rule" | "add_agent_memory" => ToolPolicy::Memory,
        "search_library_documents"
        | "search_library_context"
        | "search_library_exact"
        | "get_document_metadata"
        | "find_document_references"
        | "compare_documents"
        | "extract_document_facts"
        | "read_library_documents"
        | "read_active_markdown_document"
        | "request_file_read_permission" => ToolPolicy::LibraryRead,
        "read_all_task_tickets"
        | "search_task_tickets"
        | "search_task_context"
        | "read_task_tickets"
        | "get_task_manager_options"
        | "get_task_board_summary" => ToolPolicy::TaskRead,
        "set_agent_execution_plan"
        | "set_task_execution_plan"
        | "create_agent_plan"
        | "update_agent_plan" => ToolPolicy::TaskWrite,
        "get_routine_dashboard"
        | "get_routine_day"
        | "list_routine_history"
        | "get_routine_month_report" => ToolPolicy::RoutineRead,
        "save_routine"
        | "delete_routine"
        | "save_routine_task"
        | "set_routine_task_status"
        | "delete_routine_task"
        | "restore_routine_task"
        | "reorder_routine_tasks"
        | "set_routine_completions"
        | "set_routine_goal" => ToolPolicy::RoutineWrite,
        name if name.starts_with("list_finance_") || name.starts_with("get_finance_") => {
            ToolPolicy::FinanceRead
        }
        name if name.starts_with("create_finance_")
            || name.starts_with("save_finance_")
            || name.starts_with("update_finance_")
            || name.starts_with("set_finance_")
            || name.starts_with("delete_finance_")
            || name.starts_with("reverse_finance_")
            || name.starts_with("clear_finance_")
            || name.starts_with("link_finance_")
            || name.starts_with("unlink_finance_")
            || name.starts_with("resolve_finance_")
            || name.starts_with("rename_finance_")
            || name.starts_with("merge_finance_")
            || name == "extract_finance_document" =>
        {
            ToolPolicy::FinanceWrite
        }
        _ => ToolPolicy::LibraryWrite,
    }
}

fn is_task_scope(tool: &ToolDefinition) -> bool {
    tool.scopes.is_empty() || tool.scopes.contains(&BackendScope::TaskManager)
}

pub fn authorize_tool_call(
    context: &BackendRequestContext,
    principal: &AuthorizationPrincipal,
    tool: &ToolDefinition,
    projection: ToolCatalogProjection,
) -> Result<(), BackendError> {
    context.validate()?;
    principal.validate()?;
    if principal.library_id != context.library_id
        || principal.library_user_id != context.actor.library_user_id
    {
        return Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La herramienta no está autorizada para esta biblioteca o usuario.",
            false,
        ));
    }
    if !tool.scopes.is_empty() && !tool.scopes.contains(&context.scope) {
        return Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La herramienta no está autorizada para este scope.",
            false,
        ));
    }
    if matches!(projection, ToolCatalogProjection::ReadOnly) && !tool.read_only {
        return Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La herramienta de escritura no está disponible en modo de solo lectura.",
            false,
        ));
    }
    if matches!(projection, ToolCatalogProjection::PublishedTaskManager)
        && (!is_task_scope(tool) || tool.name == "search_web")
    {
        return Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La herramienta no está disponible en la publicación de Task Manager.",
            false,
        ));
    }

    match tool_policy(&tool.name) {
        ToolPolicy::Public | ToolPolicy::LibraryRead | ToolPolicy::LibraryWrite => Ok(()),
        ToolPolicy::Memory
            if context.actor.is_library_owner() && context.persistence_policy.allows_memory() =>
        {
            Ok(())
        }
        ToolPolicy::Memory => Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La herramienta no está autorizada para este usuario.",
            false,
        )),
        ToolPolicy::TaskRead | ToolPolicy::TaskWrite
            if matches!(
                context.scope,
                BackendScope::TaskManager | BackendScope::Library
            ) =>
        {
            Ok(())
        }
        ToolPolicy::TaskRead | ToolPolicy::TaskWrite => Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La herramienta no está autorizada para este scope.",
            false,
        )),
        // Routine data is always scoped to the acting library user, so any
        // authorized user may read and write their own routine.
        ToolPolicy::RoutineRead | ToolPolicy::RoutineWrite
            if matches!(context.scope, BackendScope::Library | BackendScope::Finance) =>
        {
            Ok(())
        }
        ToolPolicy::RoutineRead | ToolPolicy::RoutineWrite => Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La herramienta de Rutina no está autorizada para este scope.",
            false,
        )),
        ToolPolicy::FinanceRead | ToolPolicy::FinanceWrite
            if principal.can_access_confidential_context()
                && matches!(context.scope, BackendScope::Finance | BackendScope::Library) =>
        {
            Ok(())
        }
        ToolPolicy::FinanceRead | ToolPolicy::FinanceWrite => Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La herramienta financiera requiere autorización del contexto confidencial.",
            false,
        )),
    }
}

pub fn project_tool_catalog(
    context: &BackendRequestContext,
    principal: &AuthorizationPrincipal,
    tools: &[ToolDefinition],
    projection: ToolCatalogProjection,
) -> Result<Vec<ToolDefinition>, BackendError> {
    let mut names = HashSet::new();
    let mut projected = Vec::new();
    for tool in tools {
        if !names.insert(tool.name.clone()) {
            return Err(BackendError::invalid_input(
                "El catálogo contiene nombres de tools duplicados.",
            ));
        }
        if authorize_tool_call(context, principal, tool, projection).is_ok() {
            projected.push(tool.clone());
        }
    }
    Ok(projected)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_schema_documents_a_catalog_tool_with_an_object_schema() {
        let catalog = canonical_tool_catalog();
        for (name, entry) in tool_schemas() {
            assert!(
                catalog.iter().any(|tool| &tool.name == name),
                "schema without tool: {name}"
            );
            let parameters = &entry["parameters"];
            assert_eq!(parameters["type"], "object", "{name}");
            assert!(parameters["properties"].is_object(), "{name}");
            assert!(!entry["description"].as_str().unwrap_or_default().is_empty(), "{name}");
        }
    }

    #[test]
    fn schemas_replace_generic_catalog_metadata() {
        let catalog = canonical_tool_catalog();
        let tool = catalog
            .iter()
            .find(|tool| tool.name == "create_finance_transaction")
            .expect("tool");
        assert!(tool.input_schema["properties"]["amount"].is_object());
        assert!(tool.requires_confirmation);
        assert!(catalog.iter().any(|tool| tool.name == "set_task_execution_plan"));
    }

    fn context(scope: BackendScope) -> BackendRequestContext {
        BackendRequestContext {
            request_id: "request-1".into(),
            library_id: "library-1".into(),
            actor: super::super::BackendActor {
                library_user_id: "user-owner".into(),
                external_identity: None,
            },
            channel: super::super::BackendChannel::App,
            scope,
            persistence_policy: super::super::PersistencePolicy::Persistent,
        }
    }

    fn principal() -> AuthorizationPrincipal {
        AuthorizationPrincipal {
            library_id: "library-1".into(),
            library_user_id: "user-owner".into(),
            allowed_contexts: vec![CONFIDENTIAL_CONTEXT.into()],
            all_contexts: false,
        }
    }

    fn tool(name: &str, scope: BackendScope, read_only: bool) -> ToolDefinition {
        ToolDefinition {
            name: name.into(),
            description: "test".into(),
            input_schema: serde_json::json!({"type": "object"}),
            scopes: vec![scope],
            read_only,
            requires_confirmation: !read_only,
        }
    }

    #[test]
    fn filters_finance_tools_without_confidential_access() {
        let mut principal = principal();
        principal.allowed_contexts.clear();
        let tools = project_tool_catalog(
            &context(BackendScope::Finance),
            &principal,
            &[tool("get_finance_dashboard", BackendScope::Finance, true)],
            ToolCatalogProjection::Full,
        )
        .expect("catalog projects");
        assert!(tools.is_empty());
    }

    #[test]
    fn published_projection_keeps_only_task_scope() {
        let tools = project_tool_catalog(
            &context(BackendScope::TaskManager),
            &principal(),
            &[
                tool("read_task_tickets", BackendScope::TaskManager, true),
                tool("search_web", BackendScope::Library, true),
            ],
            ToolCatalogProjection::PublishedTaskManager,
        )
        .expect("catalog projects");
        assert_eq!(
            tools
                .iter()
                .map(|tool| tool.name.as_str())
                .collect::<Vec<_>>(),
            ["read_task_tickets"]
        );
    }

    #[test]
    fn routine_tools_are_library_scoped_and_confirm_writes() {
        let catalog = canonical_tool_catalog();
        let write = catalog
            .iter()
            .find(|tool| tool.name == "set_routine_completions")
            .expect("tool");
        assert!(write.requires_confirmation && !write.read_only);
        assert_eq!(tool_policy("get_routine_day"), ToolPolicy::RoutineRead);
        assert!(write.scopes.contains(&BackendScope::Finance));
        assert!(authorize_tool_call(
            &context(BackendScope::TaskManager),
            &principal(),
            &tool("get_routine_day", BackendScope::TaskManager, true),
            ToolCatalogProjection::Full,
        )
        .is_err());
        let mut principal = principal();
        principal.allowed_contexts.clear();
        let tools = project_tool_catalog(
            &context(BackendScope::Library),
            &principal,
            &[tool("get_routine_day", BackendScope::Library, true)],
            ToolCatalogProjection::Full,
        )
        .expect("catalog projects");
        assert_eq!(tools.len(), 1);
    }

    #[test]
    fn memory_tools_need_the_owner_and_a_memory_policy() {
        let memory = tool("add_agent_memory", BackendScope::Library, false);
        assert!(authorize_tool_call(&context(BackendScope::Library), &principal(), &memory, ToolCatalogProjection::Full).is_ok());
        let note_chat_memory = canonical_tool_catalog().into_iter().find(|tool| tool.name == "add_agent_memory").expect("tool");
        assert!(authorize_tool_call(&context(BackendScope::Document), &principal(), &note_chat_memory, ToolCatalogProjection::Full).is_ok());
        assert!(authorize_tool_call(&context(BackendScope::Finance), &principal(), &note_chat_memory, ToolCatalogProjection::Full).is_err());
        let mut without_memory = context(BackendScope::Library);
        without_memory.persistence_policy = super::super::PersistencePolicy::EphemeralNoMemory;
        assert!(authorize_tool_call(&without_memory, &principal(), &memory, ToolCatalogProjection::Full).is_err());
    }

    #[test]
    fn rejects_duplicate_tool_names() {
        let result = project_tool_catalog(
            &context(BackendScope::Library),
            &principal(),
            &[
                tool("read_task_tickets", BackendScope::Library, true),
                tool("read_task_tickets", BackendScope::Library, true),
            ],
            ToolCatalogProjection::Full,
        );
        assert_eq!(
            result.expect_err("duplicates are invalid").code,
            BackendErrorCode::InvalidInput
        );
    }
}
