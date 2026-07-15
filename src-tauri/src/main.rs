// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "android")]
    {
        let max_level = if cfg!(debug_assertions) {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Info
        };
        android_logger::init_once(
            android_logger::Config::default()
                .with_tag("notia")
                .with_max_level(max_level),
        );
        log::info!("[notia] android logger initialized level={:?}", max_level);
    }

    #[cfg(not(target_os = "android"))]
    {
        let max_level = if cfg!(debug_assertions) {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Info
        };
        let _ = env_logger::builder().filter_level(max_level).try_init();
    }

    notia_lib::run()
}
