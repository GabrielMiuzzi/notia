//! The texts of the dashboard and the form, in Spanish (es-AR): when an
//! action runs, the summary of the form and the relative times.

use jiff::civil::Date;
use jiff::tz::TimeZone;

use super::schedule::{local_date_minute, parse_minute};
use super::{AiActionKind, AiSchedule, Recurrence, RepeatUnit};

const WEEKDAY_SHORT: [&str; 7] = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const WEEKDAY_LONG: [&str; 7] = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const WEEKDAY_PLURAL: [&str; 7] = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"];
const MONTH_SHORT: [&str; 12] = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTH_LONG: [&str; 12] = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const WORKDAYS: [u8; 5] = [0, 1, 2, 3, 4];
const WEEKEND: [u8; 2] = [5, 6];

fn weekday_index(date: Date) -> usize {
    date.weekday().to_monday_zero_offset() as usize
}

fn month_index(date: Date) -> usize {
    (date.month() - 1) as usize
}

fn capitalized(value: &str) -> String {
    let mut characters = value.chars();
    characters.next().map(|first| first.to_uppercase().chain(characters).collect()).unwrap_or_default()
}

/// `HH:MM` of an instant in `zone`.
pub fn time_label(zone: &TimeZone, ms: i64) -> String {
    let (_, minute) = local_date_minute(zone, ms);
    super::schedule::format_minute(minute)
}

/// «Lunes 28 de septiembre».
pub fn long_date(date: Date) -> String {
    format!("{} {} de {}", capitalized(WEEKDAY_LONG[weekday_index(date)]), date.day(), MONTH_LONG[month_index(date)])
}

/// «lun 28 sep».
pub fn short_date(date: Date) -> String {
    format!("{} {} {}", WEEKDAY_SHORT[weekday_index(date)].to_lowercase(), date.day(), MONTH_SHORT[month_index(date)])
}

/// «Hoy», «Mañana» or «Jue 1 oct» (with the year when it is another one).
fn day_label(date: Date, today: Date) -> String {
    if date == today {
        return "Hoy".to_string();
    }
    if today.tomorrow().ok() == Some(date) {
        return "Mañana".to_string();
    }
    let mut label = format!("{} {} {}", WEEKDAY_SHORT[weekday_index(date)], date.day(), MONTH_SHORT[month_index(date)]);
    if date.year() != today.year() {
        label.push_str(&format!(" {}", date.year()));
    }
    label
}

/// «Hoy · 17:00», «Mañana · 10:00», «Jue 1 oct · 09:00».
pub fn moment_label(zone: &TimeZone, ms: i64, today: Date) -> String {
    let (date, minute) = local_date_minute(zone, ms);
    format!("{} · {}", day_label(date, today), super::schedule::format_minute(minute))
}

/// «hoy 15:00», «mañana 08:00», «dom 4 oct 20:00».
pub fn next_label(zone: &TimeZone, ms: i64, today: Date) -> String {
    let (date, minute) = local_date_minute(zone, ms);
    let day = day_label(date, today);
    let day = if date == today || today.tomorrow().ok() == Some(date) { day.to_lowercase() } else { lowercase_first(&day) };
    format!("{day} {}", super::schedule::format_minute(minute))
}

fn lowercase_first(value: &str) -> String {
    let mut characters = value.chars();
    characters.next().map(|first| first.to_lowercase().chain(characters).collect()).unwrap_or_default()
}

/// «Todos los días», «Lun a Vie», «Sáb y Dom», «Lun a Mié» or «Lun, Mié, Vie».
pub fn days_short(weekdays: &[u8]) -> String {
    match weekdays {
        days if days.len() == 7 => "Todos los días".to_string(),
        days if days == WEEKEND => "Sáb y Dom".to_string(),
        days if days.len() >= 3 && days.windows(2).all(|pair| pair[1] == pair[0] + 1) => {
            format!("{} a {}", WEEKDAY_SHORT[days[0] as usize], WEEKDAY_SHORT[days[days.len() - 1] as usize])
        }
        days => days.iter().map(|day| WEEKDAY_SHORT[*day as usize]).collect::<Vec<_>>().join(", "),
    }
}

/// «todos los días», «de lunes a viernes», «los fines de semana» or «los
/// lunes, miércoles y viernes», as the summary says it.
pub fn days_phrase(weekdays: &[u8]) -> String {
    match weekdays {
        [] => "ningún día".to_string(),
        days if days.len() == 7 => "todos los días".to_string(),
        days if days == WORKDAYS => "de lunes a viernes".to_string(),
        days if days == WEEKEND => "los fines de semana".to_string(),
        days => {
            let names = days.iter().map(|day| WEEKDAY_PLURAL[*day as usize]).collect::<Vec<_>>();
            let (last, rest) = names.split_last().expect("not empty");
            if rest.is_empty() {
                format!("los {last}")
            } else {
                format!("los {} y {last}", rest.join(", "))
            }
        }
    }
}

/// «09», or «09:30» when it is not on the hour.
fn hour_label(minute: u16) -> String {
    if minute % 60 == 0 {
        format!("{:02}", minute / 60)
    } else {
        super::schedule::format_minute(minute)
    }
}

fn window_label(rule: &Recurrence) -> Option<String> {
    let from = rule.from.as_deref().and_then(parse_minute);
    let to = rule.to.as_deref().and_then(parse_minute);
    match (from, to) {
        (Some(from), Some(to)) => Some(format!("{} a {} h", hour_label(from), hour_label(to))),
        (Some(from), None) => Some(format!("desde {} h", hour_label(from))),
        (None, Some(to)) => Some(format!("hasta {} h", hour_label(to))),
        (None, None) => None,
    }
}

/// «Todos los días · 08:00», «Cada 3 h · 09 a 21 h», «Lun a Vie · 16:00»,
/// «Semanal · Dom 20:00».
pub fn recurrence_label(rule: &Recurrence) -> String {
    let all_days = rule.weekdays.len() == 7;
    let time = rule.from.clone().unwrap_or_default();
    match rule.unit {
        RepeatUnit::Minutes | RepeatUnit::Hours => {
            let mut parts = vec![match (rule.unit, rule.every) {
                (RepeatUnit::Hours, 1) => "Cada hora".to_string(),
                (RepeatUnit::Hours, every) => format!("Cada {every} h"),
                (_, every) => format!("Cada {every} min"),
            }];
            parts.extend(window_label(rule));
            if !all_days {
                parts.push(days_short(&rule.weekdays));
            }
            parts.join(" · ")
        }
        RepeatUnit::Days if rule.every == 1 => format!("{} · {time}", days_short(&rule.weekdays)),
        RepeatUnit::Days if all_days => format!("Cada {} días · {time}", rule.every),
        RepeatUnit::Days => format!("Cada {} días · {} · {time}", rule.every, days_short(&rule.weekdays)),
        RepeatUnit::Weeks => {
            let prefix = if rule.every == 1 { "Semanal".to_string() } else { format!("Cada {} semanas", rule.every) };
            format!("{prefix} · {} {time}", days_short(&rule.weekdays))
        }
    }
}

/// When an action runs, as its card says it.
pub fn schedule_label(schedule: &AiSchedule, zone: &TimeZone, today: Date) -> String {
    match schedule {
        AiSchedule::Once { at_ms } => moment_label(zone, *at_ms, today),
        AiSchedule::Recurring { rule } => recurrence_label(rule),
    }
}

/// The summary under the form (Telegram is the only channel).
pub fn form_summary(kind: AiActionKind, weekdays: &[u8]) -> String {
    match kind {
        AiActionKind::Reminder => {
            "La IA te va a enviar un recordatorio generado con este prompt en la fecha y hora elegidas, por Telegram.".to_string()
        }
        AiActionKind::OneShot => {
            "La IA va a ejecutar este prompt una sola vez en la fecha y hora elegidas, y te avisa el resultado por Telegram.".to_string()
        }
        AiActionKind::Recurring => format!(
            "La IA va a repetir este prompt en el intervalo elegido, {}, y te responde por Telegram.",
            days_phrase(weekdays)
        ),
    }
}

/// «en 48 min», «en 2 h», «en 1 h 5 min»; «ahora» when it is due.
pub fn in_label(minutes: i64) -> String {
    match minutes {
        minutes if minutes <= 0 => "ahora".to_string(),
        minutes if minutes < 60 => format!("en {minutes} min"),
        minutes if minutes % 60 == 0 => format!("en {} h", minutes / 60),
        minutes => format!("en {} h {} min", minutes / 60, minutes % 60),
    }
}

/// Minutes from `now_ms` to `at_ms`, rounded up so «en 1 min» shows until
/// the minute arrives.
pub fn minutes_until(now_ms: i64, at_ms: i64) -> i64 {
    (at_ms - now_ms + 59_999).div_euclid(60_000)
}
