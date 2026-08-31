// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "android")]
    {
        let filter = android_logger::FilterBuilder::new()
            .filter_level(log::LevelFilter::Error)
            .filter_module("notia_telegram_ai", log::LevelFilter::Info)
            .build();
        android_logger::init_once(
            android_logger::Config::default()
                .with_tag("notia")
                .with_max_level(log::LevelFilter::Info)
                .with_filter(filter),
        );
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = env_logger::builder()
            .filter_level(log::LevelFilter::Error)
            .filter_module("notia_telegram_ai", log::LevelFilter::Info)
            .try_init();
    }

    notia_lib::run()
}
