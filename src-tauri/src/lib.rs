use serde::Deserialize;

use filesystem::commands::{
    create_library_directory, create_library_entry, create_library_file, is_directory_path,
    library_entry_operation, path_exists, read_library_file, read_library_tree,
    read_library_tree_signature, read_markdown_files, search_library_files, write_binary_file,
    write_library_file,
};
use filesystem::watch::{start_library_tree_watch, stop_library_tree_watch, LibraryTreeWatchState};

mod backup;
mod database;
mod finance;
mod finance_records;

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
mod mobile_directory_picker;
mod mobile_speech_permission;
mod notia_timer;
mod task_manager_publication;
mod services {
    pub mod ai_service;
    pub mod bluetooth_service;
    pub mod finance_extraction;
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
        .plugin(tauri_plugin_dialog::init());

    let builder = builder.plugin(database::init());

    #[cfg(target_os = "windows")]
    let builder = windows_tray::configure(builder);

    builder
        .invoke_handler(tauri::generate_handler![
            read_library_tree,
            read_library_tree_signature,
            read_library_file,
            search_library_files,
            read_markdown_files,
            write_library_file,
            create_library_file,
            create_library_directory,
            path_exists,
            is_directory_path,
            write_binary_file,
            backup::create_windows_library_backup,
            create_library_entry,
            library_entry_operation,
            start_library_tree_watch,
            stop_library_tree_watch,
            database::initialize_library_database,
            finance::finance_get_dashboard,
            finance::finance_dev_list_tables,
            finance::finance_dev_query_table,
            finance::finance_dev_query_sql,
            finance::finance_dev_seed_demo_data,
            finance::finance_save_account,
            finance::finance_save_category,
            finance::finance_save_transaction,
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
            finance_records::finance_list_price_history,
            finance_records::finance_save_salary,
            finance_records::finance_list_salaries,
            finance_records::finance_save_credit_card_statement,
            finance_records::finance_list_credit_card_statements,
            finance_records::finance_save_installment_plan,
            finance_records::finance_save_investment,
            finance_records::finance_get_net_worth,
            finance_records::finance_list_net_worth_history,
            services::finance_extraction::extract_finance_document,
            commands::ai::check_desktop_ai_health,
            commands::ai::run_desktop_ai_chat,
            commands::ai::run_desktop_ai_tool_chat,
            commands::ai::run_desktop_ai_chat_streaming,
            commands::ai::list_desktop_ai_models,
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
            commands::qwen3_tts::prepare_qwen3_tts,
            commands::telegram::check_telegram_bot,
            commands::telegram::poll_telegram_updates,
            commands::telegram::send_telegram_message,
            commands::telegram::transcribe_telegram_audio,
            commands::telegram::download_telegram_photo,
            commands::telegram::extract_telegram_pdf,
            commands::telegram::answer_telegram_callback,
            mobile_ai_bridge::check_android_ai_health,
            mobile_ai_bridge::run_android_ai_chat,
            mobile_ai_bridge::run_android_ai_chat_streaming,
            mobile_ai_bridge::list_android_ai_models,
            mobile_directory_picker::pick_android_directory_tree,
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
            start_window_dragging,
            start_window_dragging_with_restore,
            task_manager_publication::publish_task_manager_boards,
            task_manager_publication::hash_task_manager_publication_password,
            task_manager_publication::get_task_manager_publication_url,
            task_manager_publication::list_pending_task_manager_publication_devices,
            task_manager_publication::approve_task_manager_publication_device,
            task_manager_publication::revoke_task_manager_publication_device,
            task_manager_publication::open_task_manager_publication,
            task_manager_publication::stop_task_manager_publication,
            task_manager_publication::notify_task_manager_publication_changed,
        ])
        .plugin(mobile_ai_bridge::init())
        .plugin(mobile_directory_picker::init())
        .plugin(mobile_speech_permission::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
