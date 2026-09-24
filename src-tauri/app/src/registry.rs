//! Registry of the application commands.
//!
//! Every command of the application is routed here. Each entry reads its
//! arguments from the JSON object (camelCase keys, as Tauri did), injects the
//! application, a service state or the calling window, and returns the
//! result as JSON. Commands without `async` run on the calling thread;
//! `async` ones return a future the host drives. The entries were generated
//! from the former Tauri handler list; new commands are added by hand with
//! the same shape.
//!
//! Clients reach the registry through one entry point, [`APP_INVOKE`], whose
//! body is `{ command, args }`.

#![allow(clippy::redundant_closure)]

use std::future::Future;
use std::pin::Pin;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::host::{AppHandle, Manager, Window};

/// JSON result of a command: the value or the error it returned.
pub type Reply = Result<Value, Value>;

/// Outcome of routing a command.
pub enum Dispatch {
    Ready(Reply),
    Pending(Pin<Box<dyn Future<Output = Reply> + Send>>),
}

/// Runs `command` with `args` on behalf of the client window
/// `window_label`. Returns `None` when the application has no such command.
pub fn dispatch(app: &AppHandle, window_label: &str, command: &str, args: &Value) -> Option<Dispatch> {
    let route = route(command)?;
    Some(route(app, window_label, command, args).unwrap_or_else(|error| Dispatch::Ready(Err(error))))
}

fn route(command: &str) -> Option<Route> {
    let route: Route = match command {
        "backend_export_markdown_document" => backend_export_markdown_document,
        "backend_read_library_config" => backend_read_library_config,
        "backend_write_library_config" => backend_write_library_config,
        "backend_ensure_library_config" => backend_ensure_library_config,
        "backend_library_graph" => backend_library_graph,
        "library_link_targets" => library_link_targets,
        "library_link_suggestions" => library_link_suggestions,
        "backend_library_graph_search" => backend_library_graph_search,
        "backend_library_search" => backend_library_search,
        "calendar_argentina_holidays" => calendar_argentina_holidays,
        "backend_library_catalog" => backend_library_catalog,
        "backend_agent_history" => backend_agent_history,
        "backend_save_pending_clarification" => backend_save_pending_clarification,
        "backend_pending_clarification" => backend_pending_clarification,
        "backend_clear_pending_clarification" => backend_clear_pending_clarification,
        "backend_answer_pending_clarification" => backend_answer_pending_clarification,
        "backend_agent_history_diff" => backend_agent_history_diff,
        "backend_agent_prompts" => backend_agent_prompts,
        "backend_select_agent_prompt" => backend_select_agent_prompt,
        "backend_save_agent_memories" => backend_save_agent_memories,
        "backend_device_preferences" => backend_device_preferences,
        "backend_publish_task_manager" => backend_publish_task_manager,
        "backend_save_device_preferences" => backend_save_device_preferences,
        "backend_create_chat" => backend_create_chat,
        "backend_load_chat" => backend_load_chat,
        "backend_list_chats" => backend_list_chats,
        "backend_match_chat" => backend_match_chat,
        "backend_set_chat_context" => backend_set_chat_context,
        "backend_save_chat" => backend_save_chat,
        "backend_chat_image_previews" => backend_chat_image_previews,
        "backend_classify_chat_file" => backend_classify_chat_file,
        "backend_save_library_catalog" => backend_save_library_catalog,
        "backend_backup_status" => backend_backup_status,
        "backend_pick_backup_directory" => backend_pick_backup_directory,
        "backend_disable_backups" => backend_disable_backups,
        "backend_migrate_backup_directory" => backend_migrate_backup_directory,
        "backend_sync_page_link" => backend_sync_page_link,
        "coldpass_unlock" => coldpass_unlock,
        "coldpass_status" => coldpass_status,
        "coldpass_generate_password" => coldpass_generate_password,
        "coldpass_lock" => coldpass_lock,
        "coldpass_save_entry" => coldpass_save_entry,
        "coldpass_delete_entry" => coldpass_delete_entry,
        "coldpass_pick_csv_import" => coldpass_pick_csv_import,
        "coldpass_confirm_import" => coldpass_confirm_import,
        "stop_library_tree_watch" => stop_library_tree_watch,
        "list_library_roles" => list_library_roles,
        "create_library_role" => create_library_role,
        "list_library_users" => list_library_users,
        "create_library_user" => create_library_user,
        "update_library_user_password" => update_library_user_password,
        "delete_library_user" => delete_library_user,
        "update_library_user_name" => update_library_user_name,
        "update_library_user_role" => update_library_user_role,
        "update_library_user_contexts" => update_library_user_contexts,
        "resolve_library_telegram_user" => resolve_library_telegram_user,
        "find_library_user" => find_library_user,
        "link_library_user_telegram" => link_library_user_telegram,
        "unlink_library_user_telegram" => unlink_library_user_telegram,
        "finance_get_dashboard" => finance_get_dashboard,
        "routine_get_dashboard" => routine_get_dashboard,
        "routine_apply_mutation" => routine_apply_mutation,
        "agenda_get_view" => agenda_get_view,
        "agenda_apply_mutation" => agenda_apply_mutation,
        "finance_get_transaction" => finance_get_transaction,
        "finance_list_all_transactions" => finance_list_all_transactions,
        "finance_list_all_savings_movements" => finance_list_all_savings_movements,
        "finance_dev_list_tables" => finance_dev_list_tables,
        "finance_dev_query_table" => finance_dev_query_table,
        "finance_dev_query_sql" => finance_dev_query_sql,
        "finance_dev_seed_demo_data" => finance_dev_seed_demo_data,
        "finance_save_account" => finance_save_account,
        "finance_save_category" => finance_save_category,
        "finance_save_transaction" => finance_save_transaction,
        "finance_apply_ui_change" => finance_apply_ui_change,
        "finance_list_services" => finance_list_services,
        "finance_set_service_active" => finance_set_service_active,
        "finance_list_service_occurrences" => finance_list_service_occurrences,
        "finance_list_all_service_occurrences" => finance_list_all_service_occurrences,
        "finance_list_service_occurrence_versions" => finance_list_service_occurrence_versions,
        "finance_list_all_service_occurrence_versions" => finance_list_all_service_occurrence_versions,
        "finance_list_service_invoices" => finance_list_service_invoices,
        "finance_save_audit_run" => finance_save_audit_run,
        "finance_run_audit" => finance_run_audit,
        "finance_list_audit_runs" => finance_list_audit_runs,
        "finance_save_audit_proposal" => finance_save_audit_proposal,
        "finance_list_audit_proposals" => finance_list_audit_proposals,
        "finance_decide_audit_proposal" => finance_decide_audit_proposal,
        "finance_repair_relation" => finance_repair_relation,
        "finance_list_relation_repairs" => finance_list_relation_repairs,
        "finance_delete_transaction" => finance_delete_transaction,
        "finance_delete_account" => finance_delete_account,
        "finance_delete_category" => finance_delete_category,
        "finance_clear_all_data" => finance_clear_all_data,
        "finance_save_savings_reserve" => finance_save_savings_reserve,
        "finance_save_savings_movement" => finance_save_savings_movement,
        "finance_save_savings_exchange" => finance_save_savings_exchange,
        "finance_link_savings_account" => finance_link_savings_account,
        "finance_save_purchase" => finance_save_purchase,
        "finance_list_purchases" => finance_list_purchases,
        "finance_period_summary" => finance_period_summary,
        "finance_dashboard_insights" => finance_dashboard_insights,
        "finance_salary_analysis" => finance_salary_analysis,
        "finance_dollar_quotes" => finance_dollar_quotes,
        "finance_inflation_indices" => finance_inflation_indices,
        "finance_historical_dollar_quotes" => finance_historical_dollar_quotes,
        "finance_relation_audit" => finance_relation_audit,
        "finance_validate_purchase" => finance_validate_purchase,
        "finance_preview_card_services" => finance_preview_card_services,
        "finance_salary_draft" => finance_salary_draft,
        "finance_list_price_history" => finance_list_price_history,
        "finance_save_salary" => finance_save_salary,
        "finance_list_salaries" => finance_list_salaries,
        "finance_save_credit_card_statement" => finance_save_credit_card_statement,
        "finance_list_credit_card_statements" => finance_list_credit_card_statements,
        "finance_save_installment_plan" => finance_save_installment_plan,
        "finance_list_installment_plans" => finance_list_installment_plans,
        "finance_list_installments" => finance_list_installments,
        "finance_save_investment" => finance_save_investment,
        "finance_list_investments" => finance_list_investments,
        "finance_get_net_worth" => finance_get_net_worth,
        "finance_list_net_worth_history" => finance_list_net_worth_history,
        "extract_finance_document" => extract_finance_document,
        "list_finance_artifacts" => list_finance_artifacts,
        "get_speech_capabilities" => get_speech_capabilities,
        "prepare_speech_model" => prepare_speech_model,
        "get_speech_model_status" => get_speech_model_status,
        "probe_speech_audio_input" => probe_speech_audio_input,
        "probe_sherpa_runtime" => probe_sherpa_runtime,
        "start_speech_session" => start_speech_session,
        "pause_speech_session" => pause_speech_session,
        "resume_speech_session" => resume_speech_session,
        "consume_speech_turn" => consume_speech_turn,
        "speech_remote_audio" => speech_remote_audio,
        "speech_remote_audio_cancel" => speech_remote_audio_cancel,
        "stop_speech_session" => stop_speech_session,
        "cancel_speech_session" => cancel_speech_session,
        "skip_speech_diarization" => skip_speech_diarization,
        "start_audio_monitor" => start_audio_monitor,
        "stop_audio_monitor" => stop_audio_monitor,
        "meeting_snapshot" => meeting_snapshot,
        "meeting_discard" => meeting_discard,
        "meeting_add_mark" => meeting_add_mark,
        "meeting_remove_mark" => meeting_remove_mark,
        "meeting_set_notes" => meeting_set_notes,
        "meeting_set_live_answers" => meeting_set_live_answers,
        "meeting_regenerate_answer" => meeting_regenerate_answer,
        "meeting_pin_answer" => meeting_pin_answer,
        "meeting_rename_speaker" => meeting_rename_speaker,
        "meeting_merge_speakers" => meeting_merge_speakers,
        "meeting_generate_insights" => meeting_generate_insights,
        "meeting_save_note" => meeting_save_note,
        "meeting_export" => meeting_export,
        "meeting_task_boards" => meeting_task_boards,
        "meeting_send_tasks" => meeting_send_tasks,
        "get_qwen3_tts_status" => get_qwen3_tts_status,
        "reload_qwen3_tts" => reload_qwen3_tts,
        "synthesize_qwen3_tts_speech" => synthesize_qwen3_tts_speech,
        "qwen3_tts_speech_plan" => qwen3_tts_speech_plan,
        "prepare_qwen3_tts" => prepare_qwen3_tts,
        "check_telegram_bot" => check_telegram_bot,
        "revoke_library_binding" => revoke_library_binding,
        #[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
        "coldpass_bluetooth_status" => coldpass_bluetooth_status,
        #[cfg(any(target_os = "android", target_os = "ios", not(feature = "bluetooth")))]
        "coldpass_bluetooth_status" => coldpass_bluetooth_status,
        #[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
        "coldpass_bluetooth_connect" => coldpass_bluetooth_connect,
        #[cfg(any(target_os = "android", target_os = "ios", not(feature = "bluetooth")))]
        "coldpass_bluetooth_connect" => coldpass_bluetooth_connect,
        #[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
        "coldpass_bluetooth_submit_pin" => coldpass_bluetooth_submit_pin,
        #[cfg(any(target_os = "android", target_os = "ios", not(feature = "bluetooth")))]
        "coldpass_bluetooth_submit_pin" => coldpass_bluetooth_submit_pin,
        #[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
        "coldpass_bluetooth_authenticate" => coldpass_bluetooth_authenticate,
        #[cfg(any(target_os = "android", target_os = "ios", not(feature = "bluetooth")))]
        "coldpass_bluetooth_authenticate" => coldpass_bluetooth_authenticate,
        #[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
        "coldpass_bluetooth_send_message" => coldpass_bluetooth_send_message,
        #[cfg(any(target_os = "android", target_os = "ios", not(feature = "bluetooth")))]
        "coldpass_bluetooth_send_message" => coldpass_bluetooth_send_message,
        #[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
        "coldpass_bluetooth_disconnect" => coldpass_bluetooth_disconnect,
        #[cfg(any(target_os = "android", target_os = "ios", not(feature = "bluetooth")))]
        "coldpass_bluetooth_disconnect" => coldpass_bluetooth_disconnect,
        #[cfg(target_os = "windows")]
        "publish_task_manager_ai_stream_event" => publish_task_manager_ai_stream_event,
        #[cfg(not(target_os = "windows"))]
        "publish_task_manager_ai_stream_event" => publish_task_manager_ai_stream_event,
        "get_task_manager_publication_url" => get_task_manager_publication_url,
        "get_task_manager_publication_status" => get_task_manager_publication_status,
        "open_task_manager_publication" => open_task_manager_publication,
        "stop_task_manager_publication" => stop_task_manager_publication,
        "begin_task_manager_publication_batch" => begin_task_manager_publication_batch,
        "end_task_manager_publication_batch" => end_task_manager_publication_batch,
        "ai_chat_send" => ai_chat_send,
        "ai_chat_answer" => ai_chat_answer,
        "ai_chat_cancel" => ai_chat_cancel,
        "ai_check_health" => ai_check_health,
        "ai_list_models" => ai_list_models,
        "ai_resolve_model" => ai_resolve_model,
        "ai_recognize_inkmath" => ai_recognize_inkmath,
        "multichat_catalog" => multichat_catalog,
        "multichat_open" => multichat_open,
        "multichat_send" => multichat_send,
        "multichat_cancel" => multichat_cancel,
        "multichat_close" => multichat_close,
        "library_open" => library_open,
        "library_refresh" => library_refresh,
        "library_read_directory" => library_read_directory,
        "library_read_document" => library_read_document,
        "library_write_document" => library_write_document,
        "library_mutate_entry" => library_mutate_entry,
        "library_pick_directory" => library_pick_directory,
        "library_list_files" => library_list_files,
        "library_list_folders" => library_list_folders,
        "task_manager_board_view" => task_manager_board_view,
        "task_manager_board_execute" => task_manager_board_execute,
        "task_manager_pomodoro" => task_manager_pomodoro,
        "task_manager_delete_pomodoro" => task_manager_delete_pomodoro,
        "task_manager_read_ticket_source" => task_manager_read_ticket_source,
        "task_manager_write_ticket_source" => task_manager_write_ticket_source,
        _ => return None,
    };
    Some(route)
}

type Route = fn(&AppHandle, &str, &str, &Value) -> Result<Dispatch, Value>;

/// Every command of the registry.
pub const COMMAND_NAMES: &[&str] = &[
    "backend_export_markdown_document",
    "backend_read_library_config",
    "backend_write_library_config",
    "backend_ensure_library_config",
    "backend_library_graph",
    "library_link_targets",
    "library_link_suggestions",
    "backend_library_graph_search",
    "backend_library_search",
    "calendar_argentina_holidays",
    "backend_library_catalog",
    "backend_agent_history",
    "backend_save_pending_clarification",
    "backend_pending_clarification",
    "backend_clear_pending_clarification",
    "backend_answer_pending_clarification",
    "backend_agent_history_diff",
    "backend_agent_prompts",
    "backend_select_agent_prompt",
    "backend_save_agent_memories",
    "backend_device_preferences",
    "backend_publish_task_manager",
    "backend_save_device_preferences",
    "backend_create_chat",
    "backend_load_chat",
    "backend_list_chats",
    "backend_match_chat",
    "backend_set_chat_context",
    "backend_save_chat",
    "backend_chat_image_previews",
    "backend_classify_chat_file",
    "backend_save_library_catalog",
    "backend_backup_status",
    "backend_pick_backup_directory",
    "backend_disable_backups",
    "backend_migrate_backup_directory",
    "backend_sync_page_link",
    "coldpass_unlock",
    "coldpass_status",
    "coldpass_generate_password",
    "coldpass_lock",
    "coldpass_save_entry",
    "coldpass_delete_entry",
    "coldpass_pick_csv_import",
    "coldpass_confirm_import",
    "stop_library_tree_watch",
    "list_library_roles",
    "create_library_role",
    "list_library_users",
    "create_library_user",
    "update_library_user_password",
    "delete_library_user",
    "update_library_user_name",
    "update_library_user_role",
    "update_library_user_contexts",
    "resolve_library_telegram_user",
    "find_library_user",
    "link_library_user_telegram",
    "unlink_library_user_telegram",
    "finance_get_dashboard",
    "routine_get_dashboard",
    "routine_apply_mutation",
    "agenda_get_view",
    "agenda_apply_mutation",
    "finance_get_transaction",
    "finance_list_all_transactions",
    "finance_list_all_savings_movements",
    "finance_dev_list_tables",
    "finance_dev_query_table",
    "finance_dev_query_sql",
    "finance_dev_seed_demo_data",
    "finance_save_account",
    "finance_save_category",
    "finance_save_transaction",
    "finance_apply_ui_change",
    "finance_list_services",
    "finance_set_service_active",
    "finance_list_service_occurrences",
    "finance_list_all_service_occurrences",
    "finance_list_service_occurrence_versions",
    "finance_list_all_service_occurrence_versions",
    "finance_list_service_invoices",
    "finance_save_audit_run",
    "finance_run_audit",
    "finance_list_audit_runs",
    "finance_save_audit_proposal",
    "finance_list_audit_proposals",
    "finance_decide_audit_proposal",
    "finance_repair_relation",
    "finance_list_relation_repairs",
    "finance_delete_transaction",
    "finance_delete_account",
    "finance_delete_category",
    "finance_clear_all_data",
    "finance_save_savings_reserve",
    "finance_save_savings_movement",
    "finance_save_savings_exchange",
    "finance_link_savings_account",
    "finance_save_purchase",
    "finance_list_purchases",
    "finance_period_summary",
    "finance_dashboard_insights",
    "finance_salary_analysis",
    "finance_dollar_quotes",
    "finance_inflation_indices",
    "finance_historical_dollar_quotes",
    "finance_relation_audit",
    "finance_validate_purchase",
    "finance_preview_card_services",
    "finance_salary_draft",
    "finance_list_price_history",
    "finance_save_salary",
    "finance_list_salaries",
    "finance_save_credit_card_statement",
    "finance_list_credit_card_statements",
    "finance_save_installment_plan",
    "finance_list_installment_plans",
    "finance_list_installments",
    "finance_save_investment",
    "finance_list_investments",
    "finance_get_net_worth",
    "finance_list_net_worth_history",
    "extract_finance_document",
    "list_finance_artifacts",
    "get_speech_capabilities",
    "prepare_speech_model",
    "get_speech_model_status",
    "probe_speech_audio_input",
    "probe_sherpa_runtime",
    "start_speech_session",
    "pause_speech_session",
    "resume_speech_session",
    "consume_speech_turn",
    "speech_remote_audio",
    "speech_remote_audio_cancel",
    "stop_speech_session",
    "cancel_speech_session",
    "skip_speech_diarization",
    "start_audio_monitor",
    "stop_audio_monitor",
    "meeting_snapshot",
    "meeting_discard",
    "meeting_add_mark",
    "meeting_remove_mark",
    "meeting_set_notes",
    "meeting_set_live_answers",
    "meeting_regenerate_answer",
    "meeting_pin_answer",
    "meeting_rename_speaker",
    "meeting_merge_speakers",
    "meeting_generate_insights",
    "meeting_save_note",
    "meeting_export",
    "meeting_task_boards",
    "meeting_send_tasks",
    "get_qwen3_tts_status",
    "reload_qwen3_tts",
    "synthesize_qwen3_tts_speech",
    "qwen3_tts_speech_plan",
    "prepare_qwen3_tts",
    "check_telegram_bot",
    "revoke_library_binding",
    "coldpass_bluetooth_status",
    "coldpass_bluetooth_connect",
    "coldpass_bluetooth_submit_pin",
    "coldpass_bluetooth_authenticate",
    "coldpass_bluetooth_send_message",
    "coldpass_bluetooth_disconnect",
    "publish_task_manager_ai_stream_event",
    "get_task_manager_publication_url",
    "get_task_manager_publication_status",
    "open_task_manager_publication",
    "stop_task_manager_publication",
    "begin_task_manager_publication_batch",
    "end_task_manager_publication_batch",
    "ai_chat_send",
    "ai_chat_answer",
    "ai_chat_cancel",
    "ai_check_health",
    "ai_list_models",
    "ai_resolve_model",
    "ai_recognize_inkmath",
    "multichat_catalog",
    "multichat_open",
    "multichat_send",
    "multichat_cancel",
    "multichat_close",
    "library_open",
    "library_refresh",
    "library_read_directory",
    "library_read_document",
    "library_write_document",
    "library_mutate_entry",
    "library_pick_directory",
    "library_list_files",
    "library_list_folders",
    "task_manager_board_view",
    "task_manager_board_execute",
    "task_manager_pomodoro",
    "task_manager_delete_pomodoro",
    "task_manager_read_ticket_source",
    "task_manager_write_ticket_source",
];

/// Commands that act on devices of the computer running Notia (microphone,
/// Bluetooth, native pickers). Only the interface running on that computer
/// may call them; remote clients of the headless server cannot.
pub const LOCAL_ONLY_COMMANDS: &[&str] = &[
    "probe_speech_audio_input",
    "start_speech_session",
    "pause_speech_session",
    "resume_speech_session",
    "consume_speech_turn",
    "stop_speech_session",
    "cancel_speech_session",
    "skip_speech_diarization",
    "start_audio_monitor",
    "stop_audio_monitor",
    "meeting_snapshot",
    "meeting_discard",
    "meeting_add_mark",
    "meeting_remove_mark",
    "meeting_set_notes",
    "meeting_set_live_answers",
    "meeting_regenerate_answer",
    "meeting_pin_answer",
    "meeting_rename_speaker",
    "meeting_merge_speakers",
    "meeting_generate_insights",
    "meeting_save_note",
    "meeting_export",
    "meeting_task_boards",
    "meeting_send_tasks",
    "coldpass_bluetooth_status",
    "coldpass_bluetooth_connect",
    "coldpass_bluetooth_submit_pin",
    "coldpass_bluetooth_authenticate",
    "coldpass_bluetooth_send_message",
    "coldpass_bluetooth_disconnect",
    "library_pick_directory",
    "backend_pick_backup_directory",
    "coldpass_pick_csv_import",
];

/// Whether a remote client (headless server) may call `command`.
pub fn is_remote_command(command: &str) -> bool {
    route(command).is_some() && !LOCAL_ONLY_COMMANDS.contains(&command)
}

/// A library user on a published Task Manager: every command runs as that
/// user and only over the published boards. The window and the headless
/// server act as the owner and use [`dispatch`] instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishedScope {
    pub library_id: String,
    pub library_user_id: String,
    pub board_ids: Vec<String>,
}

/// Commands a published page may call. The rest of the registry is not
/// reachable from a publication.
pub const PUBLISHED_COMMANDS: &[&str] = &[
    "task_manager_board_view",
    "task_manager_board_execute",
    "task_manager_read_ticket_source",
    "task_manager_write_ticket_source",
    "task_manager_pomodoro",
];

pub fn is_published_command(command: &str) -> bool {
    PUBLISHED_COMMANDS.contains(&command)
}

/// Runs a published command for `scope`. Returns the result and whether it
/// changed data, or `None` when publications cannot call `command`.
pub fn dispatch_published(
    app: &AppHandle,
    scope: &PublishedScope,
    command: &str,
    args: &Value,
) -> Option<Result<(Value, bool), crate::backend::BackendError>> {
    use crate::task_manager_commands as task_manager;

    if !is_published_command(command) {
        return None;
    }
    let state = app.state::<task_manager::TaskManagerBackendState>();
    let registry = app.state::<crate::library_registry::LibraryBindingRegistry>();
    Some(task_manager::task_manager_execute_for_publication(
        app,
        &state,
        &registry,
        &scope.library_id,
        &scope.library_user_id,
        scope.board_ids.clone(),
        command,
        args,
    ))
}

/// Single command a host exposes to its clients.
pub const APP_INVOKE: &str = "app_invoke";

/// Body of [`APP_INVOKE`]: a command of the registry and its arguments.
#[derive(Debug, Deserialize)]
struct AppInvoke {
    command: String,
    #[serde(default)]
    args: Value,
}

/// Runs the body of an [`APP_INVOKE`] call. A malformed body or an unknown
/// command is answered with an error instead of reaching any handler.
pub fn dispatch_app_invoke(app: &AppHandle, window_label: &str, body: &Value) -> Dispatch {
    let request = match AppInvoke::deserialize(body) {
        Ok(request) => request,
        Err(error) => return Dispatch::Ready(Err(Value::String(format!("invalid {APP_INVOKE} body: {error}")))),
    };
    let args = if request.args.is_null() { Value::Object(Default::default()) } else { request.args };
    dispatch(app, window_label, &request.command, &args).unwrap_or_else(|| {
        Dispatch::Ready(Err(Value::String(format!("command {} not found", request.command))))
    })
}

fn arg<T: DeserializeOwned>(command: &str, args: &Value, key: &str) -> Result<T, Value> {
    match args.get(key) {
        Some(value) => serde_json::from_value(value.clone()).map_err(|error| {
            Value::String(format!("invalid args `{key}` for command `{command}`: {error}"))
        }),
        None => serde_json::from_value(Value::Null)
            .map_err(|_| Value::String(format!("command {command} missing required key {key}"))),
    }
}

fn reply_value<T: Serialize>(value: T) -> Reply {
    serde_json::to_value(value).map_err(|error| Value::String(error.to_string()))
}

fn reply_result<T: Serialize, E: Serialize>(result: Result<T, E>) -> Reply {
    match result {
        Ok(value) => reply_value(value),
        Err(error) => Err(serde_json::to_value(error).unwrap_or_else(|error| Value::String(error.to_string()))),
    }
}

fn backend_export_markdown_document(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::filesystem::commands::backend_export_markdown_document(app.clone(), arg(command, args, "payload")?, app.state(), app.state()))))
}

fn backend_read_library_config(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::library_config::backend_read_library_config(arg(command, args, "payload")?, app.state(), app.state()))))
}

fn backend_write_library_config(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::library_config::backend_write_library_config(arg(command, args, "payload")?, app.state(), app.state()))))
}

fn backend_ensure_library_config(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::library_config::backend_ensure_library_config(arg(command, args, "payload")?, app.state(), app.state()))))
}

fn backend_library_graph(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::library_graph::backend_library_graph(arg0, arg1).await) })))
}

fn library_link_targets(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::library_graph::library_link_targets(arg0, arg1).await) })))
}

fn library_link_suggestions(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::library_graph::library_link_suggestions(arg0, arg1).await) })))
}

fn backend_library_graph_search(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::library_graph::backend_library_graph_search(arg0, arg1).await) })))
}

fn backend_library_search(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::library_graph::backend_library_search(arg0, arg1).await) })))
}

fn calendar_argentina_holidays(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = arg(command, args, "year")?;
    let arg1 = app.state();
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::services::calendar_holidays::calendar_argentina_holidays(arg0, arg1).await) })))
}

fn backend_library_catalog(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_catalog::backend_library_catalog(app.clone(), app.state()))))
}

fn backend_agent_history(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::agent_history::backend_agent_history(app.clone(), arg(command, args, "payload")?))))
}

fn backend_save_pending_clarification(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::agent_pending::backend_save_pending_clarification(app.clone(), arg(command, args, "payload")?))))
}

fn backend_pending_clarification(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::agent_pending::backend_pending_clarification(app.clone(), arg(command, args, "payload")?))))
}

fn backend_clear_pending_clarification(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready({ crate::agent_pending::backend_clear_pending_clarification(app.clone(), arg(command, args, "payload")?); Ok(Value::Null) }))
}

fn backend_answer_pending_clarification(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::agent_pending::backend_answer_pending_clarification(app.clone(), arg(command, args, "payload")?))))
}

fn backend_agent_history_diff(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::agent_history::backend_agent_history_diff(app.clone(), arg(command, args, "payload")?))))
}

fn backend_agent_prompts(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::agent_workspace::backend_agent_prompts(arg0, arg1).await) })))
}

fn backend_select_agent_prompt(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::agent_workspace::backend_select_agent_prompt(arg0, arg1).await) })))
}

fn backend_save_agent_memories(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::agent_workspace::backend_save_agent_memories(arg0, arg1).await) })))
}

fn backend_device_preferences(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::device_preferences::backend_device_preferences(app.clone()))))
}

fn backend_publish_task_manager(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::task_manager_publication_source::backend_publish_task_manager(arg0, arg1).await) })))
}

fn backend_save_device_preferences(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::device_preferences::backend_save_device_preferences(app.clone(), arg(command, args, "preferences")?))))
}

fn backend_create_chat(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::chat_history::backend_create_chat(arg0, arg1).await) })))
}

fn backend_load_chat(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::chat_history::backend_load_chat(arg0, arg1).await) })))
}

fn backend_list_chats(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::chat_history::backend_list_chats(arg0, arg1).await) })))
}

fn backend_match_chat(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::chat_history::backend_match_chat(arg0, arg1).await) })))
}

fn backend_set_chat_context(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::chat_history::backend_set_chat_context(arg0, arg1).await) })))
}

fn backend_save_chat(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::chat_history::backend_save_chat(arg0, arg1).await) })))
}

fn backend_chat_image_previews(_app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::chat_history::backend_chat_image_previews(arg0).await) })))
}

fn backend_classify_chat_file(_app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::chat_history::backend_classify_chat_file(arg(command, args, "payload")?))))
}

fn backend_save_library_catalog(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_catalog::backend_save_library_catalog(app.clone(), arg(command, args, "catalog")?, app.state()))))
}

fn backend_backup_status(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::backup::service::backend_backup_status(app.clone()))))
}

fn backend_pick_backup_directory(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::backup::service::backend_pick_backup_directory(arg0).await) })))
}

fn backend_disable_backups(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::backup::service::backend_disable_backups(app.clone()))))
}

fn backend_migrate_backup_directory(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::backup::service::backend_migrate_backup_directory(app.clone(), arg(command, args, "directoryPath")?))))
}

fn backend_sync_page_link(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::page_links::backend_sync_page_link(arg0, arg1).await) })))
}

fn coldpass_unlock(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::coldpass::coldpass_unlock(arg0, arg1).await) })))
}

fn coldpass_status(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::coldpass::coldpass_status(arg0, arg1).await) })))
}

fn coldpass_generate_password(_app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::coldpass::coldpass_generate_password(arg(command, args, "payload")?))))
}

fn coldpass_lock(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::coldpass::coldpass_lock(arg(command, args, "payload")?, app.state()))))
}

fn coldpass_save_entry(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::coldpass::coldpass_save_entry(arg0, arg1).await) })))
}

fn coldpass_delete_entry(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::coldpass::coldpass_delete_entry(arg0, arg1).await) })))
}

fn coldpass_pick_csv_import(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::coldpass::coldpass_pick_csv_import(arg0, arg1).await) })))
}

fn coldpass_confirm_import(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::coldpass::coldpass_confirm_import(arg0, arg1).await) })))
}

fn stop_library_tree_watch(app: &AppHandle, window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::filesystem::watch::stop_library_tree_watch(Window::new(app.clone(), window_label), app.state()))))
}

fn list_library_roles(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::list_library_roles(app.clone(), arg(command, args, "payload")?))))
}

fn create_library_role(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::create_library_role(app.clone(), arg(command, args, "payload")?))))
}

fn list_library_users(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::list_library_users(app.clone(), arg(command, args, "payload")?))))
}

fn create_library_user(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::create_library_user(app.clone(), arg(command, args, "payload")?))))
}

fn update_library_user_password(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::update_library_user_password(app.clone(), app.state(), arg(command, args, "payload")?))))
}

fn delete_library_user(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::delete_library_user(app.clone(), app.state(), arg(command, args, "payload")?))))
}

fn update_library_user_name(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::update_library_user_name(app.clone(), arg(command, args, "payload")?))))
}

fn update_library_user_role(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::update_library_user_role(app.clone(), arg(command, args, "payload")?))))
}

fn update_library_user_contexts(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::update_library_user_contexts(app.clone(), app.state(), arg(command, args, "payload")?))))
}

fn resolve_library_telegram_user(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::resolve_library_telegram_user(app.clone(), arg(command, args, "payload")?))))
}

fn find_library_user(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::find_library_user(app.clone(), arg(command, args, "payload")?))))
}

fn link_library_user_telegram(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::link_library_user_telegram(app.clone(), arg(command, args, "payload")?))))
}

fn unlink_library_user_telegram(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_users::unlink_library_user_telegram(app.clone(), arg(command, args, "payload")?))))
}

fn finance_get_dashboard(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_get_dashboard(app.clone(), arg(command, args, "context")?, arg(command, args, "month")?))))
}

fn routine_get_dashboard(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::routine::routine_get_dashboard(app.clone(), arg(command, args, "context")?))))
}

fn routine_apply_mutation(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::routine::routine_apply_mutation(app.clone(), arg(command, args, "payload")?))))
}

fn agenda_get_view(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::agenda::agenda_get_view(app.clone(), arg(command, args, "context")?, arg(command, args, "request")?))))
}

fn agenda_apply_mutation(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::agenda::agenda_apply_mutation(app.clone(), arg(command, args, "payload")?))))
}

fn finance_get_transaction(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_get_transaction(app.clone(), arg(command, args, "payload")?))))
}

fn finance_list_all_transactions(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_list_all_transactions(app.clone(), arg(command, args, "context")?))))
}

fn finance_list_all_savings_movements(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_list_all_savings_movements(app.clone(), arg(command, args, "context")?))))
}

fn finance_dev_list_tables(_app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::finance::finance_dev_list_tables())))
}

fn finance_dev_query_table(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_dev_query_table(app.clone(), arg(command, args, "payload")?))))
}

fn finance_dev_query_sql(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_dev_query_sql(app.clone(), arg(command, args, "payload")?))))
}

fn finance_dev_seed_demo_data(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_dev_seed_demo_data(app.clone(), arg(command, args, "context")?))))
}

fn finance_save_account(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_save_account(app.clone(), arg(command, args, "payload")?))))
}

fn finance_save_category(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_save_category(app.clone(), arg(command, args, "payload")?))))
}

fn finance_save_transaction(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_save_transaction(app.clone(), arg(command, args, "payload")?))))
}

fn finance_apply_ui_change(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_ui::finance_apply_ui_change(app.clone(), arg(command, args, "payload")?))))
}

fn finance_list_services(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_list_services(app.clone(), arg(command, args, "context")?))))
}

fn finance_set_service_active(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_set_service_active(app.clone(), arg(command, args, "payload")?))))
}

fn finance_list_service_occurrences(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_list_service_occurrences(app.clone(), arg(command, args, "context")?, arg(command, args, "period")?))))
}

fn finance_list_all_service_occurrences(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_list_all_service_occurrences(app.clone(), arg(command, args, "context")?))))
}

fn finance_list_service_occurrence_versions(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_list_service_occurrence_versions(app.clone(), arg(command, args, "context")?, arg(command, args, "occurrenceId")?))))
}

fn finance_list_all_service_occurrence_versions(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_list_all_service_occurrence_versions(app.clone(), arg(command, args, "context")?))))
}

fn finance_list_service_invoices(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_list_service_invoices(app.clone(), arg(command, args, "context")?, arg(command, args, "period")?))))
}

fn finance_save_audit_run(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_save_audit_run(app.clone(), arg(command, args, "payload")?))))
}

fn finance_run_audit(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_run_audit(app.clone(), arg(command, args, "payload")?))))
}

fn finance_list_audit_runs(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_list_audit_runs(app.clone(), arg(command, args, "context")?, arg(command, args, "period")?, arg(command, args, "status")?))))
}

fn finance_save_audit_proposal(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_save_audit_proposal(app.clone(), arg(command, args, "payload")?))))
}

fn finance_list_audit_proposals(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_list_audit_proposals(app.clone(), arg(command, args, "context")?, arg(command, args, "period")?, arg(command, args, "status")?))))
}

fn finance_decide_audit_proposal(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_decide_audit_proposal(app.clone(), arg(command, args, "payload")?))))
}

fn finance_repair_relation(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_repair_relation(app.clone(), arg(command, args, "payload")?))))
}

fn finance_list_relation_repairs(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_list_relation_repairs(app.clone(), arg(command, args, "context")?, arg(command, args, "relationType")?, arg(command, args, "relationId")?))))
}

fn finance_delete_transaction(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_delete_transaction(app.clone(), arg(command, args, "payload")?))))
}

fn finance_delete_account(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_delete_account(app.clone(), arg(command, args, "payload")?))))
}

fn finance_delete_category(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_delete_category(app.clone(), arg(command, args, "payload")?))))
}

fn finance_clear_all_data(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_clear_all_data(app.clone(), arg(command, args, "context")?))))
}

fn finance_save_savings_reserve(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_save_savings_reserve(app.clone(), arg(command, args, "payload")?))))
}

fn finance_save_savings_movement(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_save_savings_movement(app.clone(), arg(command, args, "payload")?))))
}

fn finance_save_savings_exchange(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_save_savings_exchange(app.clone(), arg(command, args, "payload")?))))
}

fn finance_link_savings_account(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance::finance_link_savings_account(app.clone(), arg(command, args, "payload")?))))
}

fn finance_save_purchase(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_save_purchase(app.clone(), arg(command, args, "payload")?))))
}

fn finance_list_purchases(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_list_purchases(app.clone(), arg(command, args, "payload")?))))
}

fn finance_period_summary(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_views::finance_period_summary(app.clone(), arg(command, args, "payload")?))))
}

fn finance_dashboard_insights(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_views::finance_dashboard_insights(app.clone(), arg(command, args, "payload")?))))
}

fn finance_salary_analysis(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::finance_views::finance_salary_analysis(arg0, arg1).await) })))
}

fn finance_dollar_quotes(_app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {

    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::services::finance_external::finance_dollar_quotes().await) })))
}

fn finance_inflation_indices(_app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {

    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::services::finance_external::finance_inflation_indices().await) })))
}

fn finance_historical_dollar_quotes(_app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = arg(command, args, "from")?;
    let arg1 = arg(command, args, "to")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::services::finance_external::finance_historical_dollar_quotes(arg0, arg1).await) })))
}

fn finance_relation_audit(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_views::finance_relation_audit(app.clone(), arg(command, args, "payload")?))))
}

fn finance_validate_purchase(_app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_views::finance_validate_purchase(arg(command, args, "purchase")?))))
}

fn finance_preview_card_services(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_views::finance_preview_card_services(app.clone(), arg(command, args, "payload")?))))
}

fn finance_salary_draft(_app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::finance_views::finance_salary_draft(arg(command, args, "rawResult")?))))
}

fn finance_list_price_history(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_list_price_history(app.clone(), arg(command, args, "payload")?))))
}

fn finance_save_salary(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_save_salary(app.clone(), arg(command, args, "payload")?))))
}

fn finance_list_salaries(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_list_salaries(app.clone(), arg(command, args, "payload")?))))
}

fn finance_save_credit_card_statement(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_save_credit_card_statement(app.clone(), arg(command, args, "payload")?))))
}

fn finance_list_credit_card_statements(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_list_credit_card_statements(app.clone(), arg(command, args, "payload")?))))
}

fn finance_save_installment_plan(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_save_installment_plan(app.clone(), arg(command, args, "payload")?))))
}

fn finance_list_installment_plans(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_list_installment_plans(app.clone(), arg(command, args, "context")?))))
}

fn finance_list_installments(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_list_installments(app.clone(), arg(command, args, "payload")?))))
}

fn finance_save_investment(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_save_investment(app.clone(), arg(command, args, "payload")?))))
}

fn finance_list_investments(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_list_investments(app.clone(), arg(command, args, "payload")?))))
}

fn finance_get_net_worth(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_get_net_worth(app.clone(), arg(command, args, "context")?, arg(command, args, "asOf")?))))
}

fn finance_list_net_worth_history(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::finance_records::finance_list_net_worth_history(app.clone(), arg(command, args, "context")?))))
}

fn extract_finance_document(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::services::finance_extraction::extract_finance_document(arg0, arg1).await) })))
}

fn list_finance_artifacts(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::services::finance_extraction::list_finance_artifacts(app.clone(), arg(command, args, "context")?))))
}

fn get_speech_capabilities(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::commands::speech::get_speech_capabilities(app.clone(), app.state()))))
}

fn prepare_speech_model(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = arg(command, args, "payload")?;
    let arg1 = app.clone();
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::speech::prepare_speech_model(arg0, arg1).await) })))
}

fn get_speech_model_status(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::commands::speech::get_speech_model_status(app.clone()))))
}

fn probe_speech_audio_input(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::commands::speech::probe_speech_audio_input(app.state()))))
}

fn probe_sherpa_runtime(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::commands::speech::probe_sherpa_runtime(app.clone()))))
}

fn start_speech_session(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = arg(command, args, "payload")?;
    let arg1 = app.clone();
    let arg2 = app.state();
    let arg3 = app.state();
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::speech::start_speech_session(arg0, arg1, arg2, arg3).await) })))
}

fn pause_speech_session(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::commands::speech::pause_speech_session(arg(command, args, "payload")?, app.clone(), app.state()))))
}

fn resume_speech_session(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::commands::speech::resume_speech_session(arg(command, args, "payload")?, app.clone(), app.state()))))
}

fn consume_speech_turn(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::commands::speech::consume_speech_turn(arg(command, args, "payload")?, app.clone(), app.state()))))
}

fn speech_remote_audio(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = app.state();
    let arg2 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::remote_speech::speech_remote_audio(arg0, arg1, arg2).await) })))
}

fn speech_remote_audio_cancel(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::commands::remote_speech::speech_remote_audio_cancel(app.state(), arg(command, args, "payload")?))))
}

fn stop_speech_session(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = arg(command, args, "payload")?;
    let arg1 = app.clone();
    let arg2 = app.state();
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::speech::stop_speech_session(arg0, arg1, arg2).await) })))
}

fn skip_speech_diarization(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::commands::speech::skip_speech_diarization(arg(command, args, "payload")?, app.state()))))
}

fn start_audio_monitor(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::commands::speech::start_audio_monitor(arg(command, args, "payload")?, app.clone(), app.state(), app.state()))))
}

fn stop_audio_monitor(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::commands::speech::stop_audio_monitor(arg(command, args, "payload")?, app.state()))))
}

fn meeting_snapshot(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::meeting::meeting_snapshot(app.clone(), arg(command, args, "payload")?))))
}

fn meeting_discard(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::meeting::meeting_discard(app.clone(), arg(command, args, "payload")?))))
}

fn meeting_add_mark(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::meeting::meeting_add_mark(app.clone(), arg(command, args, "payload")?))))
}

fn meeting_remove_mark(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::meeting::meeting_remove_mark(app.clone(), arg(command, args, "payload")?))))
}

fn meeting_set_notes(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::meeting::meeting_set_notes(app.clone(), arg(command, args, "payload")?))))
}

fn meeting_set_live_answers(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::meeting::meeting_set_live_answers(app.clone(), arg(command, args, "payload")?))))
}

fn meeting_regenerate_answer(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::meeting::meeting_regenerate_answer(app.clone(), arg(command, args, "payload")?))))
}

fn meeting_pin_answer(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::meeting::meeting_pin_answer(app.clone(), arg(command, args, "payload")?))))
}

fn meeting_rename_speaker(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::meeting::meeting_rename_speaker(app.clone(), arg(command, args, "payload")?))))
}

fn meeting_merge_speakers(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::meeting::meeting_merge_speakers(app.clone(), arg(command, args, "payload")?))))
}

fn meeting_generate_insights(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::meeting::meeting_generate_insights(arg0, arg1).await) })))
}

fn meeting_save_note(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::meeting::meeting_save_note(arg0, arg1).await) })))
}

fn meeting_export(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::meeting::meeting_export(arg0, arg1).await) })))
}

fn meeting_task_boards(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::meeting::meeting_task_boards(arg0, arg1).await) })))
}

fn meeting_send_tasks(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::meeting::meeting_send_tasks(arg0, arg1).await) })))
}

fn cancel_speech_session(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::commands::speech::cancel_speech_session(arg(command, args, "payload")?, app.clone(), app.state()))))
}

fn get_qwen3_tts_status(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::commands::qwen3_tts::get_qwen3_tts_status(app.state()))))
}

fn reload_qwen3_tts(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::commands::qwen3_tts::reload_qwen3_tts(app.state()))))
}

fn synthesize_qwen3_tts_speech(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "input")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::qwen3_tts::synthesize_qwen3_tts_speech(arg0, arg1).await) })))
}

fn qwen3_tts_speech_plan(_app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::commands::qwen3_tts::qwen3_tts_speech_plan(arg(command, args, "markdown")?))))
}

fn prepare_qwen3_tts(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "input")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::qwen3_tts::prepare_qwen3_tts(arg0, arg1).await) })))
}

fn check_telegram_bot(_app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::telegram::check_telegram_bot(arg0).await) })))
}

fn revoke_library_binding(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::library_registry::revoke_library_binding(app.clone(), arg(command, args, "libraryId")?, app.state(), app.state(), app.state()))))
}

#[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
fn coldpass_bluetooth_status(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.state();
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::bluetooth::coldpass_bluetooth_status(arg0).await) })))
}

#[cfg(any(target_os = "android", target_os = "ios", not(feature = "bluetooth")))]
fn coldpass_bluetooth_status(_app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {

    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::bluetooth::coldpass_bluetooth_status().await) })))
}

#[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
fn coldpass_bluetooth_connect(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.state();
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::bluetooth::coldpass_bluetooth_connect(arg0).await) })))
}

#[cfg(any(target_os = "android", target_os = "ios", not(feature = "bluetooth")))]
fn coldpass_bluetooth_connect(_app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {

    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::bluetooth::coldpass_bluetooth_connect().await) })))
}

#[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
fn coldpass_bluetooth_submit_pin(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = arg(command, args, "payload")?;
    let arg1 = app.state();
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::bluetooth::coldpass_bluetooth_submit_pin(arg0, arg1).await) })))
}

#[cfg(any(target_os = "android", target_os = "ios", not(feature = "bluetooth")))]
fn coldpass_bluetooth_submit_pin(_app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {

    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::bluetooth::coldpass_bluetooth_submit_pin().await) })))
}

#[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
fn coldpass_bluetooth_authenticate(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = arg(command, args, "payload")?;
    let arg1 = app.state();
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::bluetooth::coldpass_bluetooth_authenticate(arg0, arg1).await) })))
}

#[cfg(any(target_os = "android", target_os = "ios", not(feature = "bluetooth")))]
fn coldpass_bluetooth_authenticate(_app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {

    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::bluetooth::coldpass_bluetooth_authenticate().await) })))
}

#[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
fn coldpass_bluetooth_send_message(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = arg(command, args, "payload")?;
    let arg1 = app.state();
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::bluetooth::coldpass_bluetooth_send_message(arg0, arg1).await) })))
}

#[cfg(any(target_os = "android", target_os = "ios", not(feature = "bluetooth")))]
fn coldpass_bluetooth_send_message(_app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {

    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::bluetooth::coldpass_bluetooth_send_message().await) })))
}

#[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
fn coldpass_bluetooth_disconnect(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.state();
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::bluetooth::coldpass_bluetooth_disconnect(arg0).await) })))
}

#[cfg(any(target_os = "android", target_os = "ios", not(feature = "bluetooth")))]
fn coldpass_bluetooth_disconnect(_app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {

    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::commands::bluetooth::coldpass_bluetooth_disconnect().await) })))
}

#[cfg(target_os = "windows")]
fn publish_task_manager_ai_stream_event(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::task_manager_publication::publish_task_manager_ai_stream_event(app.state(), arg(command, args, "requestId")?, arg(command, args, "event")?))))
}

#[cfg(not(target_os = "windows"))]
fn publish_task_manager_ai_stream_event(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::task_manager_publication::publish_task_manager_ai_stream_event(app.state(), arg(command, args, "requestId")?, arg(command, args, "event")?))))
}

fn get_task_manager_publication_url(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::task_manager_publication::get_task_manager_publication_url(app.state()))))
}

fn get_task_manager_publication_status(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::task_manager_publication::get_task_manager_publication_status(app.state()))))
}

fn open_task_manager_publication(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::task_manager_publication::open_task_manager_publication(app.state()))))
}

fn stop_task_manager_publication(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::task_manager_publication::stop_task_manager_publication(app.state()))))
}

fn begin_task_manager_publication_batch(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.state();
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::task_manager_publication::begin_task_manager_publication_batch(arg0).await) })))
}

fn end_task_manager_publication_batch(app: &AppHandle, _window_label: &str, _command: &str, _args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::task_manager_publication::end_task_manager_publication_batch(app.state()))))
}

fn ai_chat_send(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::ai_chat::ai_chat_send(arg0, arg1).await) })))
}

fn ai_chat_answer(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::ai_chat::ai_chat_answer(app.state(), arg(command, args, "payload")?))))
}

fn ai_chat_cancel(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::ai_chat::ai_chat_cancel(arg0, arg1).await) })))
}

fn ai_check_health(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::ai_tasks::ai_check_health(arg0, arg1).await) })))
}

fn ai_list_models(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::ai_tasks::ai_list_models(arg0, arg1).await) })))
}

fn ai_resolve_model(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::ai_tasks::ai_resolve_model(arg0, arg1).await) })))
}

fn ai_recognize_inkmath(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::ai_tasks::ai_recognize_inkmath(arg0, arg1).await) })))
}

fn multichat_catalog(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::multichat::multichat_catalog(arg0, arg1).await) })))
}

fn multichat_open(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::multichat::multichat_open(arg0, arg1).await) })))
}

fn multichat_send(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::multichat::multichat_send(arg0, arg1).await) })))
}

fn multichat_cancel(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready({ crate::multichat::multichat_cancel(app.clone(), arg(command, args, "payload")?); Ok(Value::Null) }))
}

fn multichat_close(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready({ crate::multichat::multichat_close(app.clone(), arg(command, args, "payload")?); Ok(Value::Null) }))
}

fn library_open(app: &AppHandle, window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = Window::new(app.clone(), window_label);
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::library_session::library_open(arg0, arg1).await) })))
}

fn library_refresh(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::library_session::library_refresh(arg0, arg1).await) })))
}

fn library_read_directory(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::library_session::library_read_directory(arg0, arg1).await) })))
}

fn library_read_document(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::library_session::library_read_document(app.clone(), arg(command, args, "payload")?))))
}

fn library_write_document(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::library_session::library_write_document(app.clone(), arg(command, args, "payload")?))))
}

fn library_mutate_entry(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_value(crate::library_session::library_mutate_entry(app.clone(), arg(command, args, "payload")?))))
}

fn library_pick_directory(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::library_session::library_pick_directory(arg0, arg1).await) })))
}

fn library_list_files(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::library_session::library_list_files(arg0, arg1).await) })))
}

fn library_list_folders(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::library_session::library_list_folders(arg0, arg1).await) })))
}

fn task_manager_board_view(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::task_manager_commands::task_manager_board_view(app.clone(), arg(command, args, "payload")?, app.state(), app.state()))))
}

fn task_manager_board_execute(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::task_manager_commands::task_manager_board_execute(arg0, arg1).await) })))
}

fn task_manager_pomodoro(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    let arg0 = app.clone();
    let arg1 = arg(command, args, "payload")?;
    Ok(Dispatch::Pending(Box::pin(async move { reply_result(crate::task_manager_commands::task_manager_pomodoro(arg0, arg1).await) })))
}

fn task_manager_delete_pomodoro(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::task_manager_commands::task_manager_delete_pomodoro(app.clone(), arg(command, args, "payload")?, app.state(), app.state()))))
}

fn task_manager_read_ticket_source(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::task_manager_commands::task_manager_read_ticket_source(app.clone(), arg(command, args, "payload")?, app.state(), app.state()))))
}

fn task_manager_write_ticket_source(app: &AppHandle, _window_label: &str, command: &str, args: &Value) -> Result<Dispatch, Value> {
    Ok(Dispatch::Ready(reply_result(crate::task_manager_commands::task_manager_write_ticket_source(app.clone(), arg(command, args, "payload")?, app.state(), app.state()))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::{AppPaths, HostPorts};

    fn ready_error(dispatch: Dispatch) -> Value {
        match dispatch {
            Dispatch::Ready(Err(error)) => error,
            _ => panic!("expected an immediate error"),
        }
    }

    #[test]
    fn every_listed_command_has_a_route() {
        for command in COMMAND_NAMES {
            assert!(route(command).is_some(), "{command}");
        }
        for command in LOCAL_ONLY_COMMANDS {
            assert!(COMMAND_NAMES.contains(command), "{command}");
            assert!(!is_remote_command(command), "{command}");
        }
        assert!(is_remote_command("task_manager_board_view"));
        assert!(!is_remote_command("window_control"));
    }

    #[test]
    fn publications_reach_only_their_commands_with_the_published_user() {
        let app = crate::create_app(AppPaths::default(), HostPorts::default());
        let scope = PublishedScope {
            library_id: "library-1".into(),
            library_user_id: "user-1".into(),
            board_ids: vec!["board-1".into()],
        };
        for command in PUBLISHED_COMMANDS {
            assert!(COMMAND_NAMES.contains(command), "{command}");
        }
        assert!(!is_published_command("task_manager_apply_mutation"));
        assert!(dispatch_published(&app, &scope, "backend_library_catalog", &serde_json::json!({})).is_none());
        assert!(dispatch_published(&app, &scope, "write_library_file", &serde_json::json!({})).is_none());
        // An unregistered library is refused by the use case, not by the host.
        assert!(dispatch_published(&app, &scope, "task_manager_board_view", &serde_json::json!({}))
            .expect("published command")
            .is_err());
    }

    #[test]
    fn app_invoke_rejects_unknown_commands_and_malformed_bodies() {
        let app = crate::create_app(AppPaths::default(), HostPorts::default());
        let unknown = dispatch_app_invoke(&app, "main", &serde_json::json!({ "command": "nope" }));
        assert_eq!(ready_error(unknown), Value::String("command nope not found".into()));
        let malformed = dispatch_app_invoke(&app, "main", &serde_json::json!({ "args": {} }));
        assert!(ready_error(malformed).as_str().unwrap().starts_with("invalid app_invoke body"));
    }

    #[test]
    fn app_invoke_reports_missing_arguments_like_tauri() {
        let app = crate::create_app(AppPaths::default(), HostPorts::default());
        let body = serde_json::json!({ "command": "calendar_argentina_holidays" });
        assert_eq!(
            ready_error(dispatch_app_invoke(&app, "main", &body)),
            Value::String("command calendar_argentina_holidays missing required key year".into())
        );
        let invalid = serde_json::json!({ "command": "calendar_argentina_holidays", "args": { "year": "x" } });
        assert!(ready_error(dispatch_app_invoke(&app, "main", &invalid))
            .as_str()
            .unwrap()
            .starts_with("invalid args `year` for command `calendar_argentina_holidays`"));
    }
}
