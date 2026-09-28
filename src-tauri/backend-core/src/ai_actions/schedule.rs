//! When an action runs. A schedule is read in its zone: the wall times of
//! a recurrence are local, and each occurrence becomes a UTC instant (a
//! time skipped by a DST change moves forward, as `jiff` does by default).

use jiff::civil::Date;
use jiff::tz::TimeZone;
use jiff::Timestamp;

use super::{AiSchedule, Recurrence, RepeatUnit};

/// Days searched for the next occurrence: a rule every 52 weeks repeats
/// within a year and a week.
const MAX_SEARCH_DAYS: i32 = 400;
const DAY_MINUTES: u16 = 24 * 60;

/// `YYYY-MM-DD`.
pub fn parse_date(value: &str) -> Option<Date> {
    value.trim().parse::<Date>().ok()
}

/// `HH:MM` as minutes of the day.
pub fn parse_minute(value: &str) -> Option<u16> {
    let (hour, minute) = value.trim().split_once(':')?;
    if hour.len() != 2 || minute.len() != 2 {
        return None;
    }
    let (hour, minute) = (hour.parse::<u16>().ok()?, minute.parse::<u16>().ok()?);
    (hour < 24 && minute < 60).then_some(hour * 60 + minute)
}

pub fn format_minute(minute: u16) -> String {
    format!("{:02}:{:02}", minute / 60, minute % 60)
}

fn timestamp(ms: i64) -> Timestamp {
    Timestamp::from_millisecond(ms).unwrap_or(Timestamp::UNIX_EPOCH)
}

/// The instant of `date` at `minute` in `zone`.
pub fn local_instant(zone: &TimeZone, date: Date, minute: u16) -> Option<i64> {
    let time = date.at((minute / 60) as i8, (minute % 60) as i8, 0, 0);
    zone.to_ambiguous_zoned(time).compatible().ok().map(|zoned| zoned.timestamp().as_millisecond())
}

/// The local date of an instant.
pub fn local_date(zone: &TimeZone, ms: i64) -> Date {
    timestamp(ms).to_zoned(zone.clone()).date()
}

/// The local date and minute of the day of an instant.
pub fn local_date_minute(zone: &TimeZone, ms: i64) -> (Date, u16) {
    let zoned = timestamp(ms).to_zoned(zone.clone());
    (zoned.date(), zoned.hour() as u16 * 60 + zoned.minute() as u16)
}

/// Start and end (exclusive) of the local day of `date`.
pub fn day_bounds(zone: &TimeZone, date: Date) -> (i64, i64) {
    let start = zone
        .to_ambiguous_zoned(date.at(0, 0, 0, 0))
        .compatible()
        .map(|zoned| zoned.timestamp().as_millisecond())
        .unwrap_or_default();
    let end = date
        .tomorrow()
        .ok()
        .and_then(|next| zone.to_ambiguous_zoned(next.at(0, 0, 0, 0)).compatible().ok())
        .map(|zoned| zoned.timestamp().as_millisecond())
        .unwrap_or(start + i64::from(DAY_MINUTES) * 60_000);
    (start, end)
}

fn weekday(date: Date) -> u8 {
    date.weekday().to_monday_zero_offset() as u8
}

fn days_between(from: Date, to: Date) -> i32 {
    from.until(to).map(|span| span.get_days()).unwrap_or(-1)
}

/// Local minutes of the day a recurrence runs on `date` (none when the day
/// does not count).
fn rule_minutes(rule: &Recurrence, date: Date) -> Vec<u16> {
    if !rule.weekdays.contains(&weekday(date)) || rule.every == 0 {
        return Vec::new();
    }
    let from = rule.from.as_deref().and_then(parse_minute);
    match rule.unit {
        RepeatUnit::Minutes | RepeatUnit::Hours => {
            let step = if rule.unit == RepeatUnit::Hours { rule.every * 60 } else { rule.every };
            let end = rule.to.as_deref().and_then(parse_minute).unwrap_or(DAY_MINUTES - 1);
            let mut minutes = Vec::new();
            let mut minute = u32::from(from.unwrap_or(0));
            while minute <= u32::from(end) {
                minutes.push(minute as u16);
                minute += step;
            }
            minutes
        }
        RepeatUnit::Days | RepeatUnit::Weeks => {
            let (Some(from), Some(anchor)) = (from, parse_date(&rule.anchor_date)) else {
                return Vec::new();
            };
            let counts = if rule.unit == RepeatUnit::Days {
                let days = days_between(anchor, date);
                days >= 0 && days % rule.every as i32 == 0
            } else {
                let monday = |day: Date| day.checked_sub(jiff::Span::new().days(i64::from(weekday(day)))).unwrap_or(day);
                let days = days_between(monday(anchor), monday(date));
                days >= 0 && (days / 7) % rule.every as i32 == 0
            };
            if counts {
                vec![from]
            } else {
                Vec::new()
            }
        }
    }
}

/// The occurrences on the local `date` of the schedule's zone, in order.
pub fn occurrences_on(schedule: &AiSchedule, zone: &TimeZone, date: Date) -> Vec<i64> {
    match schedule {
        AiSchedule::Once { at_ms } => {
            if local_date(zone, *at_ms) == date {
                vec![*at_ms]
            } else {
                Vec::new()
            }
        }
        AiSchedule::Recurring { rule } => {
            let mut instants = rule_minutes(rule, date)
                .into_iter()
                .filter_map(|minute| local_instant(zone, date, minute))
                .collect::<Vec<_>>();
            // A DST change can map two wall times to one instant.
            instants.dedup();
            instants
        }
    }
}

/// The occurrences in `[from_ms, to_ms)`, in order.
pub fn occurrences_between(schedule: &AiSchedule, zone: &TimeZone, from_ms: i64, to_ms: i64) -> Vec<i64> {
    if to_ms <= from_ms {
        return Vec::new();
    }
    if let AiSchedule::Once { at_ms } = schedule {
        return if (from_ms..to_ms).contains(at_ms) { vec![*at_ms] } else { Vec::new() };
    }
    let mut date = local_date(zone, from_ms);
    let last = local_date(zone, to_ms);
    let mut instants = Vec::new();
    while date <= last {
        instants.extend(occurrences_on(schedule, zone, date).into_iter().filter(|instant| (from_ms..to_ms).contains(instant)));
        match date.tomorrow() {
            Ok(next) => date = next,
            Err(_) => break,
        }
    }
    instants
}

/// The first occurrence after `after_ms` (exclusive).
pub fn next_after(schedule: &AiSchedule, zone: &TimeZone, after_ms: i64) -> Option<i64> {
    upcoming(schedule, zone, after_ms, 1).into_iter().next()
}

/// The next `count` occurrences after `after_ms` (exclusive).
pub fn upcoming(schedule: &AiSchedule, zone: &TimeZone, after_ms: i64, count: usize) -> Vec<i64> {
    if let AiSchedule::Once { at_ms } = schedule {
        return if *at_ms > after_ms && count > 0 { vec![*at_ms] } else { Vec::new() };
    }
    let mut date = local_date(zone, after_ms);
    let mut found = Vec::new();
    for _ in 0..MAX_SEARCH_DAYS {
        for instant in occurrences_on(schedule, zone, date) {
            if instant > after_ms {
                found.push(instant);
                if found.len() == count {
                    return found;
                }
            }
        }
        match date.tomorrow() {
            Ok(next) => date = next,
            Err(_) => break,
        }
    }
    found
}
