use serde::Deserialize;

use filesystem::commands::{
    create_library_directory, create_library_entry, create_library_file, is_directory_path,
    library_entry_operation, path_exists, read_library_file, read_library_tree,
    read_library_tree_signature, read_markdown_files, search_library_files, write_binary_file,
    write_library_file,
};
use filesystem::watch::{start_library_tree_watch, stop_library_tree_watch, LibraryTreeWatchState};

mod commands {
    pub mod ai;
    pub mod bluetooth;
    pub mod telegram;
}
mod dto {
    pub mod bluetooth;
}
mod filesystem;
mod mobile_ai_bridge;
mod mobile_directory_picker;
mod notia_timer;
mod services {
    pub mod ai_service;
    pub mod bluetooth_service;
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
    log::log!(
        log_level,
        "[notia:js:{}] {} {}",
        payload.module,
        payload.message,
        data_suffix
    );
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
        .manage(LibraryTreeWatchState::default())
        .plugin(tauri_plugin_dialog::init());

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
            create_library_entry,
            library_entry_operation,
            start_library_tree_watch,
            stop_library_tree_watch,
            commands::ai::check_desktop_ai_health,
            commands::ai::run_desktop_ai_chat,
            commands::ai::run_desktop_ai_tool_chat,
            commands::ai::run_desktop_ai_chat_streaming,
            commands::ai::list_desktop_ai_models,
            commands::telegram::check_telegram_bot,
            commands::telegram::poll_telegram_updates,
            commands::telegram::send_telegram_message,
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
        ])
        .plugin(mobile_ai_bridge::init())
        .plugin(mobile_directory_picker::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
