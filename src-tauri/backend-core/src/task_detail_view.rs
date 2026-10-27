//! The detail of one ticket as the phone screen «Detalle de tarea» shows
//! it: its description and its comments, each with its author, the color
//! the board gives that person and when it was written («hace 5 min»,
//! «ayer»). The board view carries everything else of the ticket.

use std::collections::HashMap;

use serde::Serialize;

use crate::task_board_actions::{board_members, initials};
use crate::task_manager_tools::{TaskCommentDto, TaskManagerLibrarySnapshotDto};
use crate::{BackendError, BackendErrorCode};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetailDto {
    /// The ticket's text without its properties and comments.
    pub description: String,
    pub comments: Vec<TaskDetailCommentDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetailCommentDto {
    pub comment_id: String,
    pub author: String,
    pub initials: String,
    /// The author's color on the board; none for people outside it.
    pub color: Option<String>,
    /// «ahora», «hace 5 min», «hoy 14:30», «ayer 09:10», «12 oct».
    pub when: String,
    pub text: String,
}

const MONTHS: [&str; 12] = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

fn fold(value: &str) -> String {
    value.trim().to_lowercase()
}

/// When a comment was written, read from `now` (both local times).
pub fn when_label(written: jiff::civil::DateTime, now: jiff::civil::DateTime) -> String {
    let minutes = (now.duration_since(written).as_secs() / 60).max(0);
    let time = format!("{:02}:{:02}", written.hour(), written.minute());
    if minutes < 1 {
        return "ahora".to_string();
    }
    if minutes < 60 {
        return format!("hace {minutes} min");
    }
    if written.date() == now.date() {
        return format!("hoy {time}");
    }
    if now.date().yesterday().ok() == Some(written.date()) {
        return format!("ayer {time}");
    }
    let month = MONTHS[(written.month() - 1) as usize];
    if written.year() == now.year() {
        format!("{} {month}", written.day())
    } else {
        format!("{} {month} {}", written.day(), written.year())
    }
}

/// The detail of the ticket at `logical_path`. `user_names` names the
/// library users by id; `local_time` turns a comment's instant into this
/// device's local time.
pub fn project_task_detail(
    snapshot: &TaskManagerLibrarySnapshotDto,
    logical_path: &str,
    user_names: &HashMap<String, String>,
    owner_name: Option<&str>,
    now: jiff::civil::DateTime,
    local_time: impl Fn(i64) -> jiff::civil::DateTime,
) -> Result<TaskDetailDto, BackendError> {
    let ticket = snapshot
        .tickets
        .iter()
        .find(|ticket| ticket.summary.logical_path == logical_path)
        .ok_or_else(|| BackendError::new(BackendErrorCode::NotFound, "La tarea no existe o no está disponible.", false))?;
    let members = board_members(snapshot, &ticket.summary.board_id, owner_name);
    let color_of = |name: &str| members.iter().find(|member| fold(&member.name) == fold(name)).map(|member| member.color.clone());
    let mut comments = snapshot
        .comments
        .iter()
        .filter(|comment| comment.ticket_id == ticket.summary.ticket_id)
        .collect::<Vec<&TaskCommentDto>>();
    comments.sort_by(|left, right| left.written_order(right));
    Ok(TaskDetailDto {
        description: ticket.content.trim().to_string(),
        comments: comments
            .into_iter()
            .map(|comment| {
                let author = user_names
                    .get(&comment.author_user_id)
                    .cloned()
                    .unwrap_or_else(|| comment.author_user_id.clone());
                TaskDetailCommentDto {
                    comment_id: comment.comment_id.clone(),
                    initials: initials(&author),
                    color: color_of(&author),
                    when: when_label(local_time(comment.created_at_unix_ms), now),
                    text: comment.body.trim().to_string(),
                    author,
                }
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use jiff::civil::date;

    #[test]
    fn a_comment_says_when_it_was_written() {
        let now = date(2026, 10, 18).at(15, 30, 0, 0);
        assert_eq!(when_label(date(2026, 10, 18).at(15, 30, 0, 0), now), "ahora");
        assert_eq!(when_label(date(2026, 10, 18).at(15, 25, 0, 0), now), "hace 5 min");
        assert_eq!(when_label(date(2026, 10, 18).at(9, 5, 0, 0), now), "hoy 09:05");
        assert_eq!(when_label(date(2026, 10, 17).at(22, 0, 0, 0), now), "ayer 22:00");
        assert_eq!(when_label(date(2026, 10, 2).at(8, 0, 0, 0), now), "2 oct");
        assert_eq!(when_label(date(2025, 12, 31).at(8, 0, 0, 0), now), "31 dic 2025");
        // A clock a little ahead never says «hace -2 min».
        assert_eq!(when_label(date(2026, 10, 18).at(15, 32, 0, 0), now), "ahora");
    }
}
