use serde::Deserialize;

use filesystem::commands::{
    backend_export_markdown_document, backend_library_entry_operation, backend_read_library_document,
    backend_write_library_document, create_library_directory, create_library_entry,
    create_library_file, is_directory_path, library_entry_operation, path_exists,
    read_library_file, read_library_tree, read_library_tree_signature, read_markdown_files,
    search_library_files, write_library_file,
};
use filesystem::watch::{start_library_tree_watch, stop_library_tree_watch, LibraryTreeWatchState};
use library_registry::{
    pick_library_directory, register_library_binding, revoke_library_binding,
    LibraryBindingRegistry,
};

pub mod backend;
pub mod backend_ollama;
mod backend_runtime;
pub mod backend_tauri;
mod backup;
mod database;
mod finance;
mod finance_agent_inputs;
mod finance_reconciliation;
mod finance_records;
mod finance_views;
mod routine;
mod routine_dashboard;
mod routine_tools;
mod coldpass;
mod agent_history;
mod agent_knowledge;
mod agent_pending;
mod agent_workspace;
mod chat_history;
mod device_preferences;
mod telegram_worker;
mod library_documents;
mod library_catalog;
mod library_config;
mod page_links;
mod library_graph;
mod library_inventory;
mod library_document_adapter;
mod library_registry;
mod library_users;
mod user_auth;

mod commands {
    pub mod ai;
    pub mod bluetooth;
    pub mod qwen3_tts;
    pub mod speech;
    pub mod telegram;
}
mod dto {
    pub mod bluetooth;
    pub mod speech;
}
mod filesystem;
mod mobile_ai_bridge;
mod mobile_continuity;
mod mobile_directory_picker;
mod mobile_speech_permission;
mod notia_timer;
mod task_manager_commands;
mod task_manager_fs;
mod task_manager_publication;
mod task_manager_publication_source;
mod task_manager_store;
mod services {
    pub mod calendar_holidays;
    pub mod ai_service;
    pub mod bluetooth_service;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub mod coldpass_secure_link;
    pub mod finance_extraction;
    pub mod finance_external;
    pub mod qwen3_asr_service;
    pub mod qwen3_tts_service;
    pub mod sherpa_diarization;
    pub mod sherpa_runtime;
    pub mod speech_audio;
    pub mod speech_model_repository;
    pub mod speech_service;
    pub mod speech_worker;
    pub mod telegram_audio;
    pub mod telegram_service;
}
mod state {
    pub mod bluetooth_state;
}
#[cfg(target_os = "windows")]
mod windows_tray;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowControlPayload {
    action: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotiaLogPayload {
    level: String,
    module: String,
    message: String,
    #[serde(default)]
    data: Option<String>,
}

#[tauri::command]
fn notia_log(payload: NotiaLogPayload) {
    let log_level = match payload.level.as_str() {
        "error" => log::Level::Error,
        "warn" => log::Level::Warn,
        "info" => log::Level::Info,
        "perf" => log::Level::Info,
        _ => log::Level::Debug,
    };
    let data_suffix = payload.data.unwrap_or_default();
    if payload.module == "telegram-ai" {
        log::log!(
            target: "notia_telegram_ai",
            log_level,
            "[notia:js:telegram-ai] {} {}",
            payload.message,
            data_suffix
        );
    } else {
        log::log!(
            log_level,
            "[notia:js:{}] {} {}",
            payload.module,
            payload.message,
            data_suffix
        );
    }
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn window_control(window: tauri::Window, payload: WindowControlPayload) {
    match payload.action.as_str() {
        "minimize" => {
            let _ = window.minimize();
        }
        "maximize" => {
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            } else {
                let _ = window.maximize();
            }
        }
        "fullscreen" => {
            let is_fullscreen = window.is_fullscreen().unwrap_or(false);
            let _ = window.set_fullscreen(!is_fullscreen);
        }
        "close" => {
            let _ = window.close();
        }
        _ => {}
    }
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
fn window_control(_window: tauri::Window, payload: WindowControlPayload) {
    let _ = payload.action;
}

#[tauri::command]
fn exit_application(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn start_window_dragging(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
fn start_window_dragging(_window: tauri::Window) {}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn start_window_dragging_with_restore(window: tauri::Window) {
    if window.is_fullscreen().unwrap_or(false) {
        let _ = window.set_fullscreen(false);
    }
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    }
    let _ = window.start_dragging();
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
fn start_window_dragging_with_restore(_window: tauri::Window) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(state::bluetooth_state::ColdPassBluetoothState::default())
        .manage(services::speech_service::SpeechRuntimeState::default())
        .manage(services::qwen3_tts_service::Qwen3TtsRuntimeState::default())
        .manage(LibraryTreeWatchState::default())
        .manage(task_manager_publication::TaskManagerPublicationState::default())
        .manage(task_manager_commands::TaskManagerBackendState::default())
        .manage(backend_runtime::BackendRuntimeState::default())
        .manage(LibraryBindingRegistry::default())
        .manage(coldpass::ColdPassState::default())
        .manage(library_catalog::LibraryCatalogState::default())
        .manage(agent_workspace::AgentWorkspaceState::default())
        .manage(agent_history::AgentHistoryState::default())
        .manage(chat_history::ChatHistoryState::default())
        .manage(device_preferences::DevicePreferencesState::default())
        .manage(telegram_worker::TelegramWorkerState::default())
        .manage(library_graph::LibraryGraphState::default())
        .manage(services::calendar_holidays::CalendarHolidaysState::default())
        .plugin(library_registry::init())
        .plugin(backup::service::init())
        .plugin(telegram_worker::init())
        .plugin(task_manager_publication_source::init())
        .manage(backup::service::BackupState::default())
        .plugin(tauri_plugin_dialog::init());

    let builder = builder.plugin(database::init());

    #[cfg(target_os = "windows")]
    let builder = windows_tray::configure(builder);

    builder
        .invoke_handler(tauri::generate_handler![
            read_library_tree,
            read_library_tree_signature,
            read_library_file,
            backend_read_library_document,
            backend_write_library_document,
            backend_export_markdown_document,
            backend_library_entry_operation,
            library_config::backend_read_library_config,
            library_config::backend_write_library_config,
            library_config::backend_ensure_library_config,
            library_inventory::backend_reindex_library,
            library_graph::backend_library_graph,
            library_graph::backend_rebuild_link_cache,
            library_graph::backend_library_graph_search,
            library_graph::backend_library_search,
            services::calendar_holidays::calendar_argentina_holidays,
            library_catalog::backend_library_catalog,
            agent_history::backend_agent_history,
            agent_knowledge::backend_title_chat,
            agent_knowledge::backend_learn_from_turn,
            agent_pending::backend_save_pending_clarification,
            agent_pending::backend_pending_clarification,
            agent_pending::backend_clear_pending_clarification,
            agent_pending::backend_answer_pending_clarification,
            agent_history::backend_agent_history_diff,
            agent_workspace::backend_agent_prompts,
            agent_workspace::backend_agent_prompt,
            agent_workspace::backend_select_agent_prompt,
            agent_workspace::backend_agent_memories,
            agent_workspace::backend_save_agent_memories,
            agent_workspace::backend_agent_rules,
            agent_workspace::backend_save_agent_rules,
            agent_workspace::backend_append_agent_rule,
            device_preferences::backend_device_preferences,
            task_manager_publication_source::backend_publish_task_manager,
            device_preferences::backend_save_device_preferences,
            chat_history::backend_ensure_chat_structure,
            chat_history::backend_create_chat,
            chat_history::backend_load_chat,
            chat_history::backend_save_chat,
            chat_history::backend_append_chat,
            chat_history::backend_chat_image_previews,
            chat_history::backend_classify_chat_file,
            library_catalog::backend_save_library_catalog,
            backup::service::backend_backup_status,
            backup::service::backend_pick_backup_directory,
            backup::service::backend_disable_backups,
            backup::service::backend_migrate_backup_directory,
            page_links::backend_sync_page_link,
            coldpass::coldpass_unlock,
            coldpass::coldpass_lock,
            coldpass::coldpass_save_entry,
            coldpass::coldpass_delete_entry,
            coldpass::coldpass_pick_csv_import,
            coldpass::coldpass_confirm_import,
            search_library_files,
            read_markdown_files,
            write_library_file,
            create_library_file,
            create_library_directory,
            path_exists,
            is_directory_path,
            create_library_entry,
            library_entry_operation,
            start_library_tree_watch,
            stop_library_tree_watch,
            database::initialize_library_database,
            database::query_library_inventory,
            library_users::list_library_roles,
            library_users::create_library_role,
            library_users::list_library_users,
            library_users::create_library_user,
            library_users::update_library_user_password,
            library_users::delete_library_user,
            library_users::update_library_user_name,
            library_users::update_library_user_role,
            library_users::update_library_user_contexts,
            library_users::resolve_library_telegram_user,
            library_users::find_library_user,
            library_users::link_library_user_telegram,
            library_users::unlink_library_user_telegram,
            finance::finance_get_dashboard,
            routine::routine_get_dashboard,
            routine::routine_apply_mutation,
            finance::finance_get_transaction,
            finance::finance_list_all_transactions,
            finance::finance_list_all_savings_movements,
            finance::finance_list_accounts,
            finance::finance_list_categories,
            finance::finance_dev_list_tables,
            finance::finance_dev_query_table,
            finance::finance_dev_query_sql,
            finance::finance_dev_seed_demo_data,
            finance::finance_save_account,
            finance::finance_save_category,
            finance::finance_save_transaction,
            finance::finance_list_services,
            finance::finance_save_service,
            finance::finance_set_service_active,
            finance::finance_list_service_occurrences,
            finance::finance_list_all_service_occurrences,
            finance::finance_save_service_occurrence,
            finance::finance_list_service_occurrence_versions,
            finance::finance_list_all_service_occurrence_versions,
            finance::finance_save_service_invoice,
            finance::finance_list_service_invoices,
            finance::finance_save_audit_run,
            finance::finance_run_audit,
            finance::finance_list_audit_runs,
            finance::finance_save_audit_proposal,
            finance::finance_list_audit_proposals,
            finance::finance_decide_audit_proposal,
            finance::finance_repair_relation,
            finance::finance_list_relation_repairs,
            finance::finance_delete_transaction,
            finance::finance_delete_account,
            finance::finance_delete_category,
            finance::finance_clear_all_data,
            finance::finance_save_savings_reserve,
            finance::finance_save_savings_movement,
            finance::finance_save_savings_exchange,
            finance::finance_link_savings_account,
            finance_records::finance_save_purchase,
            finance_records::finance_list_purchases,
            finance_views::finance_period_summary,
            services::finance_external::finance_dollar_quotes,
            services::finance_external::finance_inflation_indices,
            services::finance_external::finance_historical_dollar_quotes,
            finance_views::finance_relation_audit,
            finance_views::finance_validate_purchase,
            finance_views::finance_preview_card_services,
            finance_views::finance_salary_draft,
            finance_records::finance_list_price_history,
            finance_records::finance_save_salary,
            finance_records::finance_list_salaries,
            finance_records::finance_save_credit_card_statement,
            finance_records::finance_list_credit_card_statements,
            finance_records::finance_save_installment_plan,
            finance_records::finance_list_installment_plans,
            finance_records::finance_list_installments,
            finance_records::finance_save_investment,
            finance_records::finance_list_investments,
            finance_records::finance_get_net_worth,
            finance_records::finance_list_net_worth_history,
            services::finance_extraction::extract_finance_document,
            services::finance_extraction::list_finance_artifacts,
            backend_tauri::validate_backend_request,
            backend_runtime::configure_backend_provider,
            backend_runtime::replay_backend_events,
            backend_runtime::run_backend_request,
            commands::ai::check_desktop_ai_health,
            commands::ai::run_desktop_ai_chat,
            commands::ai::run_desktop_ai_chat_streaming,
            commands::ai::list_desktop_ai_models,
            commands::ai::inspect_desktop_ai_model,
            commands::speech::get_speech_capabilities,
            commands::speech::prepare_speech_model,
            commands::speech::get_speech_model_status,
            commands::speech::probe_speech_audio_input,
            commands::speech::probe_sherpa_runtime,
            commands::speech::start_speech_session,
            commands::speech::pause_speech_session,
            commands::speech::resume_speech_session,
            commands::speech::consume_speech_turn,
            commands::speech::stop_speech_session,
            commands::speech::cancel_speech_session,
            commands::qwen3_tts::get_qwen3_tts_status,
            commands::qwen3_tts::reload_qwen3_tts,
            commands::qwen3_tts::synthesize_qwen3_tts_speech,
            commands::qwen3_tts::qwen3_tts_speech_plan,
            commands::qwen3_tts::prepare_qwen3_tts,
            commands::telegram::check_telegram_bot,
            mobile_ai_bridge::check_android_ai_health,
            mobile_ai_bridge::run_android_ai_chat,
            mobile_ai_bridge::run_android_ai_chat_streaming,
            mobile_ai_bridge::cancel_android_ai_chat_streaming,
            mobile_ai_bridge::list_android_ai_models,
            mobile_directory_picker::pick_android_directory_tree,
            pick_library_directory,
            register_library_binding,
            revoke_library_binding,
            mobile_directory_picker::read_android_library_tree,
            mobile_directory_picker::read_android_directory,
            mobile_directory_picker::read_android_flat_file_list,
            commands::bluetooth::coldpass_bluetooth_status,
            commands::bluetooth::coldpass_bluetooth_connect,
            commands::bluetooth::coldpass_bluetooth_submit_pin,
            commands::bluetooth::coldpass_bluetooth_authenticate,
            commands::bluetooth::coldpass_bluetooth_send_message,
            commands::bluetooth::coldpass_bluetooth_disconnect,
            notia_log,
            window_control,
            exit_application,
            start_window_dragging,
            start_window_dragging_with_restore,
            task_manager_publication::publish_task_manager_boards,
            task_manager_publication::publish_task_manager_ai_stream_event,
            task_manager_publication::get_task_manager_publication_url,
            task_manager_publication::get_task_manager_publication_status,
            task_manager_publication::set_task_manager_publication_recovery,
            task_manager_publication::open_task_manager_publication,
            task_manager_publication::stop_task_manager_publication,
            task_manager_publication::begin_task_manager_publication_batch,
            task_manager_publication::end_task_manager_publication_batch,
            task_manager_publication::notify_task_manager_publication_changed,
            task_manager_commands::task_manager_list_boards,
            task_manager_commands::task_manager_snapshot,
            task_manager_commands::task_manager_list_groups,
            task_manager_commands::task_manager_list_tickets,
            task_manager_commands::task_manager_read_ticket,
            task_manager_commands::task_manager_search_context,
            task_manager_commands::task_manager_get_options,
            task_manager_commands::task_manager_board_summary,
            task_manager_commands::task_manager_preview_mutation,
            task_manager_commands::task_manager_apply_mutation,
            task_manager_commands::task_manager_pomodoro_entries,
            task_manager_commands::task_manager_append_pomodoro,
            task_manager_commands::task_manager_delete_pomodoro,
            task_manager_commands::task_manager_read_ticket_source,
            task_manager_commands::task_manager_write_ticket_source,
        ])
        .plugin(mobile_ai_bridge::init())
        .plugin(mobile_continuity::init())
        .plugin(mobile_directory_picker::init())
        .plugin(mobile_speech_permission::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
