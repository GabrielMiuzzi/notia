use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const OPEN_MENU_ID: &str = "tray-open";
const EXIT_MENU_ID: &str = "tray-exit";

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        log::warn!("[notia:tray] main window not found");
        return;
    };

    if let Err(error) = window.show() {
        log::error!("[notia:tray] failed to show main window: {error}");
        return;
    }
    if let Err(error) = window.unminimize() {
        log::warn!("[notia:tray] failed to restore main window: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::warn!("[notia:tray] failed to focus main window: {error}");
    }
}

pub fn configure<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .setup(|app| {
            let open_item =
                MenuItem::with_id(app, OPEN_MENU_ID, "Abrir Notia", true, None::<&str>)?;
            let exit_item = MenuItem::with_id(app, EXIT_MENU_ID, "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &exit_item])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Notia")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    OPEN_MENU_ID => show_main_window(app),
                    EXIT_MENU_ID => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    log::error!("[notia:tray] failed to hide main window: {error}");
                }
            }
        })
}
