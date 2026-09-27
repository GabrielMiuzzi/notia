//! The device's local date and time, as the agent reads it: in the system
//! prompt, in the mail guidance and in the date of each of its thoughts.

use chrono::{Datelike, Local};

/// The device's offset (`-03:00`) and its local date and time in words
/// (`2026-09-27 14:05, sábado (UTC-03:00)`).
pub(crate) fn local_now() -> (String, String) {
    let now = Local::now();
    let weekday = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][now.weekday().num_days_from_monday() as usize];
    let offset = now.format("%:z").to_string();
    (offset.clone(), format!("{}, {weekday} (UTC{offset})", now.format("%Y-%m-%d %H:%M")))
}

/// Local date and time that dates a thought (`2026-09-27 14:05`).
pub(crate) fn thought_stamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M").to_string()
}
