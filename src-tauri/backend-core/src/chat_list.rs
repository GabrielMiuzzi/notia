//! The chat history list: each chat's day of last activity, the group it
//! falls in (pinned, today, yesterday, this week, earlier) and the agent that
//! answered it last. The interface only draws the list.

use serde::{Deserialize, Serialize};

use crate::chat_history::{ChatRole, StoredChatDocument};

const DAY_MS: i64 = 86_400_000;
/// A week counts the six days before today.
const WEEK_DAYS: i64 = 7;

/// The device's clock, so days are the person's local days.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatClock {
    /// Now, in milliseconds since the Unix epoch.
    pub now_ms: i64,
    /// Minutes to add to UTC to get local time (Buenos Aires: -180).
    pub utc_offset_minutes: i32,
}

impl ChatClock {
    fn local_ms(self, utc_ms: i64) -> i64 {
        utc_ms + i64::from(self.utc_offset_minutes) * 60_000
    }

    fn today(self) -> i64 {
        self.local_ms(self.now_ms).div_euclid(DAY_MS)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChatGroup {
    Pinned,
    Today,
    Yesterday,
    ThisWeek,
    Earlier,
}

/// Days since 1970-01-01 of a civil date (proleptic Gregorian).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Local time a chat file name carries (`Chat-YYYY-MM-DD-HH-MM-SS[-n].md`),
/// in milliseconds of the local calendar.
pub fn stamp_local_ms(file_name: &str) -> Option<i64> {
    let stem = file_name.strip_prefix("Chat-")?.strip_suffix(".md").unwrap_or(file_name);
    let parts = stem.split('-').take(6).map(str::parse::<i64>).collect::<Result<Vec<_>, _>>().ok()?;
    let [year, month, day, hour, minute, second] = parts.as_slice() else {
        return None;
    };
    let valid = (1..=12).contains(month) && (1..=31).contains(day) && *hour < 24 && *minute < 60 && *second < 60;
    valid.then(|| days_from_civil(*year, *month, *day) * DAY_MS + ((hour * 60 + minute) * 60 + second) * 1000)
}

/// When the chat was last active, in local milliseconds: its file's
/// modification time, or the time its name carries.
pub fn activity_local_ms(clock: ChatClock, modified_utc_ms: Option<i64>, file_name: &str) -> Option<i64> {
    modified_utc_ms.map(|modified| clock.local_ms(modified)).or_else(|| stamp_local_ms(file_name))
}

pub fn chat_group(clock: ChatClock, pinned: bool, activity_local_ms: Option<i64>) -> ChatGroup {
    if pinned {
        return ChatGroup::Pinned;
    }
    let Some(activity) = activity_local_ms else {
        return ChatGroup::Earlier;
    };
    match clock.today() - activity.div_euclid(DAY_MS) {
        days if days <= 0 => ChatGroup::Today,
        1 => ChatGroup::Yesterday,
        days if days < WEEK_DAYS => ChatGroup::ThisWeek,
        _ => ChatGroup::Earlier,
    }
}

/// Agent (prompt file) that wrote the chat's last answer; `None` for Notia.
pub fn last_agent(document: &StoredChatDocument) -> Option<String> {
    document
        .messages
        .iter()
        .rev()
        .find(|message| message.role == ChatRole::Assistant)
        .and_then(|message| message.agent.clone())
}

/// Order of the history: pinned first, then the most recently active.
pub fn history_order(left: (ChatGroup, Option<i64>), right: (ChatGroup, Option<i64>)) -> std::cmp::Ordering {
    let pinned = |group: ChatGroup| group != ChatGroup::Pinned;
    pinned(left.0).cmp(&pinned(right.0)).then_with(|| right.1.cmp(&left.1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat_history::StoredChatMessage;

    /// 2026-09-26 12:00 in Buenos Aires (UTC-3).
    const CLOCK: ChatClock = ChatClock { now_ms: 1_790_434_800_000, utc_offset_minutes: -180 };

    fn day_of(year: i64, month: i64, day: i64) -> i64 {
        days_from_civil(year, month, day) * DAY_MS + 10 * 3_600_000
    }

    #[test]
    fn reads_the_time_a_chat_name_carries() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(stamp_local_ms("Chat-2026-09-26-08-30-00.md"), Some(days_from_civil(2026, 9, 26) * DAY_MS + 30_600_000));
        assert!(stamp_local_ms("Chat-2026-09-26-08-30-00-2.md").is_some());
        assert_eq!(stamp_local_ms("Notas.md"), None);
        assert_eq!(stamp_local_ms("Chat-2026-13-01-00-00-00.md"), None);
    }

    #[test]
    fn groups_by_local_day_and_keeps_pinned_first() {
        assert_eq!(CLOCK.today(), days_from_civil(2026, 9, 26));
        assert_eq!(chat_group(CLOCK, false, Some(day_of(2026, 9, 26))), ChatGroup::Today);
        assert_eq!(chat_group(CLOCK, false, Some(day_of(2026, 9, 25))), ChatGroup::Yesterday);
        assert_eq!(chat_group(CLOCK, false, Some(day_of(2026, 9, 20))), ChatGroup::ThisWeek);
        assert_eq!(chat_group(CLOCK, false, Some(day_of(2026, 9, 19))), ChatGroup::Earlier);
        assert_eq!(chat_group(CLOCK, true, Some(day_of(2020, 1, 1))), ChatGroup::Pinned);
        assert_eq!(chat_group(CLOCK, false, None), ChatGroup::Earlier);
        // 01:00 UTC on the 26th is still the 25th in Buenos Aires.
        let late = activity_local_ms(CLOCK, Some(days_from_civil(2026, 9, 26) * DAY_MS + 3_600_000), "x.md");
        assert_eq!(chat_group(CLOCK, false, late), ChatGroup::Yesterday);
        let mut rows = [(ChatGroup::Today, Some(5)), (ChatGroup::Pinned, Some(1)), (ChatGroup::Today, Some(9))];
        rows.sort_by(|left, right| history_order(*left, *right));
        assert_eq!(rows, [(ChatGroup::Pinned, Some(1)), (ChatGroup::Today, Some(9)), (ChatGroup::Today, Some(5))]);
    }

    #[test]
    fn the_last_answer_names_the_agent() {
        let mut document = StoredChatDocument::new("x".into(), true, true, 10);
        assert_eq!(last_agent(&document), None);
        let message = |role, agent: Option<&str>| StoredChatMessage { role, content: "c".into(), attachments: Vec::new(), agent: agent.map(str::to_string) };
        document.messages = vec![message(ChatRole::Assistant, Some("tasks.md")), message(ChatRole::User, None)];
        assert_eq!(last_agent(&document).as_deref(), Some("tasks.md"));
        document.messages.push(message(ChatRole::Assistant, None));
        assert_eq!(last_agent(&document), None);
    }
}

#[cfg(test)]
mod pinned_tests {
    use crate::chat_history::{parse_chat_document, serialize_chat_document, StoredChatDocument};

    #[test]
    fn a_pinned_chat_keeps_its_pin_and_the_others_write_nothing() {
        let mut document = StoredChatDocument::new("Plan".into(), true, true, 10);
        let plain = serialize_chat_document(&document);
        assert!(!plain.contains("pinned"));
        assert!(!parse_chat_document(&plain, "x").pinned);
        document.pinned = true;
        let pinned = serialize_chat_document(&document);
        assert!(pinned.contains("pinned: true"));
        assert!(parse_chat_document(&pinned, "x").pinned);
    }
}
