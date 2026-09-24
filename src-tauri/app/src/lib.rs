//! Notia application layer: use cases, service state, platform adapters and
//! the command registry. It does not depend on Tauri; a host (the Tauri
//! window, later the headless server) builds the application with
//! [`create_app`], runs [`startup_hooks`] and routes commands through
//! [`registry::dispatch`].

pub mod host;
pub mod registry;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod server;

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
mod finance_ui;
mod finance_views;
mod routine;
mod routine_dashboard;
mod routine_tools;
mod coldpass;
mod agent_history;
mod agent_knowledge;
mod agent_pending;
mod agent_workspace;
mod ai_chat;
mod ai_tasks;
mod chat_history;
mod device_preferences;
mod telegram_worker;
mod library_documents;
mod library_catalog;
mod library_config;
mod page_links;
mod library_graph;
mod library_inventory;
mod library_session;
mod multichat;
mod library_document_adapter;
mod library_registry;
mod library_users;
mod user_auth;

mod commands {
    pub mod bluetooth;
    pub mod qwen3_tts;
    pub mod remote_speech;
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
    #[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
    pub mod coldpass_secure_link;
    pub mod finance_extraction;
    pub mod finance_external;
    pub mod qwen3_tts_service;
    pub mod sherpa_diarization;
    pub mod sherpa_offline;
    pub mod sherpa_runtime;
    pub mod spanish_transcript;
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

use host::plugin::TauriPlugin;
use host::{AppContext, AppPaths, HostPorts, Manager};

/// Builds the application with the state of every service registered.
pub fn create_app(paths: AppPaths, ports: HostPorts) -> AppContext {
    let app = AppContext::new(paths, ports);
    app.manage(state::bluetooth_state::ColdPassBluetoothState::default());
    app.manage(services::speech_service::SpeechRuntimeState::default());
    app.manage(services::qwen3_tts_service::Qwen3TtsRuntimeState::default());
    app.manage(filesystem::watch::LibraryTreeWatchState::default());
    app.manage(task_manager_publication::TaskManagerPublicationState::default());
    app.manage(task_manager_commands::TaskManagerBackendState::default());
    app.manage(backend_runtime::BackendRuntimeState::default());
    app.manage(library_registry::LibraryBindingRegistry::default());
    app.manage(library_session::LibrarySessionState::default());
    app.manage(ai_chat::AiChatState::default());
    app.manage(ai_tasks::AiTasksState::default());
    app.manage(multichat::MultichatState::default());
    app.manage(coldpass::ColdPassState::default());
    app.manage(library_catalog::LibraryCatalogState::default());
    app.manage(agent_workspace::AgentWorkspaceState::default());
    app.manage(agent_history::AgentHistoryState::default());
    app.manage(chat_history::ChatHistoryState::default());
    app.manage(device_preferences::DevicePreferencesState::default());
    app.manage(telegram_worker::TelegramWorkerState::default());
    app.manage(library_graph::LibraryGraphState::default());
    app.manage(services::calendar_holidays::CalendarHolidaysState::default());
    app.manage(backup::service::BackupState::default());
    app.manage(commands::remote_speech::RemoteSpeechState::default());
    app
}

/// Startup hooks, in the order they must run. Each hook keeps the name of
/// its native plugin so the host registers the Kotlin side under it.
pub fn startup_hooks() -> Vec<TauriPlugin> {
    vec![
        library_registry::init(),
        backup::service::init(),
        telegram_worker::init(),
        task_manager_publication_source::init(),
        database::init(),
        mobile_ai_bridge::init(),
        mobile_continuity::init(),
        mobile_directory_picker::init(),
        mobile_speech_permission::init(),
        services::speech_service::init_preload(),
    ]
}
