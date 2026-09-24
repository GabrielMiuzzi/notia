//! One Meeting recording and everything derived from it.
//!
//! The record keeps the live lines recognized while recording, the diarized
//! segments of the finished recording, the speaker names, the person's notes
//! and marks, the live answers and the AI insights. The views the interface
//! shows (turns, speaker statistics, filters), the note written to the
//! library, the text the AI receives and the prompts of the Meeting AI tasks
//! are derived here. Pure: the app crate owns the state, the audio and the
//! adapters.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::BackendError;

pub const MAX_SPEAKER_NAME_CHARS: usize = 60;
pub const MAX_NOTES_CHARS: usize = 20_000;
pub const MAX_MARKS: usize = 200;
pub const MAX_QUERY_CHARS: usize = 200;
pub const MAX_LIVE_ANSWERS: usize = 50;
const MAX_MARK_LABEL_WORDS: usize = 8;
const MAX_QUESTION_CHARS: usize = 300;
const MIN_QUESTION_WORDS: usize = 3;
const MAX_SUGGESTED_QUESTIONS: usize = 3;
const MAX_SUGGESTED_QUESTION_CHARS: usize = 60;
const RECENT_CONTEXT_CHARS: usize = 6_000;
const CORRECTION_BATCH_CHARS: usize = 6_000;
const MAX_SUMMARY_CHARS: usize = 4_000;
const MAX_KEY_POINTS: usize = 12;
const MAX_KEY_POINT_CHARS: usize = 300;
const MAX_TASKS: usize = 20;
const MAX_TASK_TITLE_CHARS: usize = 120;
const MAX_TASK_DETAIL_CHARS: usize = 500;

/// Line recognized while recording, before the speakers are separated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingLine {
    pub id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    /// The line asks a question (it can get a live answer).
    pub question: bool,
}

/// Segment of the finished recording, with its speaker when diarization
/// found one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeetingSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub speaker_id: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingMark {
    pub id: String,
    pub at_ms: u64,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MeetingAnswerStatus {
    Generating,
    Ready,
    Failed,
}

/// Answer the AI suggests for a question asked during the recording.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingAnswer {
    pub id: String,
    pub question: String,
    pub asked_at_ms: u64,
    pub text: String,
    pub status: MeetingAnswerStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Kept in the meeting note.
    pub pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingTask {
    pub id: String,
    pub title: String,
    pub detail: String,
    /// Already created in the Task Manager.
    pub sent: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingInsights {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub key_points: Vec<String>,
    pub tasks: Vec<MeetingTask>,
    /// The transcript went through the AI correction.
    pub corrected: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MeetingStatus {
    Live,
    Processing,
    Completed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSources {
    pub microphone: bool,
    pub system: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SpeakerName {
    id: String,
    name: String,
}

/// Note of the library the meeting was saved to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedMeetingNote {
    pub logical_path: String,
    /// The note as the explorer shows it.
    pub visible_path: String,
    pub revision: String,
}

/// Labels of the local moment the recording started, computed by the app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeetingStart {
    /// `24/09/2026 10:32`
    pub date_label: String,
    /// `2026-09-24 10.32`, safe inside a file name.
    pub file_stamp: String,
    pub unix_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeetingRecord {
    pub id: String,
    pub start: MeetingStart,
    pub status: MeetingStatus,
    pub sources: MeetingSources,
    pub lines: Vec<MeetingLine>,
    pub segments: Vec<MeetingSegment>,
    speakers: Vec<SpeakerName>,
    pub duration_ms: u64,
    pub notes: String,
    pub marks: Vec<MeetingMark>,
    pub answers: Vec<MeetingAnswer>,
    pub live_answers: bool,
    pub insights: MeetingInsights,
    pub saved_note: Option<SavedMeetingNote>,
    next_id: u64,
}

/// Turn of the finished transcript: consecutive segments of one speaker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingTurnDto {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_id: Option<String>,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSpeakerDto {
    pub id: String,
    pub name: String,
    pub initials: String,
    pub talk_ms: u64,
    /// Share of the talk time, in whole percents that add up to 100.
    pub share_percent: u32,
    /// Position of the speaker, for its color.
    pub color_index: u32,
}

/// Question asked in the meeting and the minute it was asked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingQuestionDto {
    pub question: String,
    pub at_ms: u64,
}

/// What the interface asked to see of the turns.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingFilter {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub speaker_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSnapshotDto {
    pub id: String,
    pub status: MeetingStatus,
    pub title: String,
    pub date_label: String,
    pub duration_ms: u64,
    pub sources: MeetingSources,
    pub lines: Vec<MeetingLine>,
    pub speakers: Vec<MeetingSpeakerDto>,
    /// Turns that match the filter.
    pub turns: Vec<MeetingTurnDto>,
    pub total_turns: usize,
    pub notes: String,
    pub marks: Vec<MeetingMark>,
    pub answers: Vec<MeetingAnswer>,
    pub live_answers: bool,
    pub insights: MeetingInsights,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_note_path: Option<String>,
    /// Questions asked in the meeting, to ask the AI about them.
    pub suggested_questions: Vec<MeetingQuestionDto>,
    /// Transcript with the minute of each turn, for the meeting chat.
    pub context_text: String,
}

/// What "Pasar por IA" should produce.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingInsightsRequest {
    #[serde(default)]
    pub summary: bool,
    #[serde(default)]
    pub key_points: bool,
    #[serde(default)]
    pub tasks: bool,
    #[serde(default)]
    pub correct: bool,
}

impl MeetingInsightsRequest {
    pub fn is_empty(&self) -> bool {
        !(self.summary || self.key_points || self.tasks || self.correct)
    }

    pub fn wants_insights(&self) -> bool {
        self.summary || self.key_points || self.tasks
    }
}

/// Insights parsed from the AI answer.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedInsights {
    pub summary: Option<String>,
    pub key_points: Option<Vec<String>>,
    pub tasks: Option<Vec<(String, String)>>,
}

/// Batch of segments sent to the AI correction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CorrectionBatch {
    pub prompt: String,
    pub ids: Vec<String>,
}

impl MeetingRecord {
    pub fn new(id: impl Into<String>, start: MeetingStart, sources: MeetingSources, live_answers: bool) -> Self {
        Self {
            id: id.into(),
            start,
            status: MeetingStatus::Live,
            sources,
            lines: Vec::new(),
            segments: Vec::new(),
            speakers: Vec::new(),
            duration_ms: 0,
            notes: String::new(),
            marks: Vec::new(),
            answers: Vec::new(),
            live_answers,
            insights: MeetingInsights::default(),
            saved_note: None,
            next_id: 0,
        }
    }

    fn next_id(&mut self, prefix: &str) -> String {
        self.next_id = self.next_id.saturating_add(1);
        format!("{prefix}-{}", self.next_id)
    }

    pub fn title(&self) -> String {
        format!("Reunión {}", self.start.file_stamp)
    }

    /// Adds a line the recognizer confirmed. `None` when the text is empty.
    pub fn push_line(&mut self, start_ms: u64, end_ms: u64, text: &str) -> Option<MeetingLine> {
        let text = text.trim();
        if text.is_empty() {
            return None;
        }
        let line = MeetingLine {
            id: self.next_id("line"),
            start_ms,
            end_ms: end_ms.max(start_ms),
            text: text.to_string(),
            question: !detect_questions(text).is_empty(),
        };
        self.duration_ms = self.duration_ms.max(line.end_ms);
        self.lines.push(line.clone());
        Some(line)
    }

    pub fn begin_processing(&mut self, duration_ms: u64) {
        self.status = MeetingStatus::Processing;
        self.duration_ms = self.duration_ms.max(duration_ms);
    }

    /// Stores the finished transcript. Without speakers (diarization skipped
    /// or failed) the live lines, which keep their minute, become the
    /// segments.
    pub fn complete(&mut self, segments: Vec<MeetingSegment>, duration_ms: u64) {
        let has_speakers = segments.iter().any(|segment| segment.speaker_id.is_some());
        self.segments = if has_speakers || self.lines.is_empty() {
            segments.into_iter().filter(|segment| !segment.text.trim().is_empty()).collect()
        } else {
            self.lines
                .iter()
                .map(|line| MeetingSegment {
                    start_ms: line.start_ms,
                    end_ms: line.end_ms,
                    speaker_id: None,
                    text: line.text.clone(),
                })
                .collect()
        };
        self.speakers.clear();
        for segment in &self.segments {
            let Some(id) = &segment.speaker_id else { continue };
            if !self.speakers.iter().any(|speaker| &speaker.id == id) {
                let name = format!("Hablante {}", self.speakers.len() + 1);
                self.speakers.push(SpeakerName { id: id.clone(), name });
            }
        }
        self.duration_ms = self
            .duration_ms
            .max(duration_ms)
            .max(self.segments.iter().map(|segment| segment.end_ms).max().unwrap_or(0));
        self.status = MeetingStatus::Completed;
    }

    /// Marks the moment `at_ms`, labelled with the words last recognized.
    pub fn add_mark(&mut self, at_ms: u64) -> Result<MeetingMark, BackendError> {
        if self.marks.len() >= MAX_MARKS {
            return Err(BackendError::invalid_input("La reunión alcanzó el máximo de momentos marcados."));
        }
        let label = self
            .lines
            .iter()
            .rev()
            .find(|line| line.start_ms <= at_ms)
            .map(|line| excerpt(&line.text, MAX_MARK_LABEL_WORDS))
            .unwrap_or_else(|| format!("Momento {}", self.marks.len() + 1));
        let mark = MeetingMark { id: self.next_id("mark"), at_ms, label };
        self.marks.push(mark.clone());
        Ok(mark)
    }

    pub fn remove_mark(&mut self, id: &str) -> Result<(), BackendError> {
        let before = self.marks.len();
        self.marks.retain(|mark| mark.id != id);
        if self.marks.len() == before {
            return Err(BackendError::invalid_input("El momento marcado no existe."));
        }
        Ok(())
    }

    pub fn set_notes(&mut self, notes: &str) -> Result<(), BackendError> {
        if notes.chars().count() > MAX_NOTES_CHARS {
            return Err(BackendError::invalid_input("Las notas de la reunión son demasiado largas."));
        }
        self.notes = notes.to_string();
        Ok(())
    }

    pub fn rename_speaker(&mut self, id: &str, name: &str) -> Result<(), BackendError> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > MAX_SPEAKER_NAME_CHARS || name.contains(['\n', '\r']) {
            return Err(BackendError::invalid_input(format!(
                "El nombre del hablante debe tener entre 1 y {MAX_SPEAKER_NAME_CHARS} caracteres en una línea."
            )));
        }
        let speaker = self
            .speakers
            .iter_mut()
            .find(|speaker| speaker.id == id)
            .ok_or_else(|| BackendError::invalid_input("El hablante no existe en esta reunión."))?;
        speaker.name = name.to_string();
        Ok(())
    }

    /// Gives every turn of `source` to `target`, which keeps its name.
    pub fn merge_speakers(&mut self, source: &str, target: &str) -> Result<(), BackendError> {
        if source == target {
            return Err(BackendError::invalid_input("Elegí dos hablantes distintos para unir."));
        }
        let known = |id: &str| self.speakers.iter().any(|speaker| speaker.id == id);
        if !known(source) || !known(target) {
            return Err(BackendError::invalid_input("El hablante no existe en esta reunión."));
        }
        for segment in &mut self.segments {
            if segment.speaker_id.as_deref() == Some(source) {
                segment.speaker_id = Some(target.to_string());
            }
        }
        self.speakers.retain(|speaker| speaker.id != source);
        Ok(())
    }

    /// Starts a live answer. Returns `None` when the question was already
    /// answered.
    pub fn begin_answer(&mut self, question: &str, asked_at_ms: u64) -> Option<String> {
        if self.answers.iter().any(|answer| answer.question == question) {
            return None;
        }
        let id = self.next_id("answer");
        self.answers.push(MeetingAnswer {
            id: id.clone(),
            question: question.to_string(),
            asked_at_ms,
            text: String::new(),
            status: MeetingAnswerStatus::Generating,
            error: None,
            pinned: false,
        });
        let overflow = self.answers.len().saturating_sub(MAX_LIVE_ANSWERS);
        if overflow > 0 {
            // The oldest unpinned answers go first.
            let removable = self
                .answers
                .iter()
                .filter(|answer| !answer.pinned && answer.id != id)
                .map(|answer| answer.id.clone())
                .take(overflow)
                .collect::<Vec<_>>();
            self.answers.retain(|answer| !removable.contains(&answer.id));
        }
        Some(id)
    }

    /// Clears an answer to generate it again.
    pub fn restart_answer(&mut self, id: &str) -> Result<(String, String), BackendError> {
        let answer = self.answer_mut(id)?;
        if answer.status == MeetingAnswerStatus::Generating {
            return Err(BackendError::invalid_input("La respuesta todavía se está generando."));
        }
        let previous = answer.text.clone();
        answer.text.clear();
        answer.status = MeetingAnswerStatus::Generating;
        answer.error = None;
        Ok((answer.question.clone(), previous))
    }

    pub fn set_answer_text(&mut self, id: &str, text: &str) {
        if let Ok(answer) = self.answer_mut(id) {
            answer.text = text.to_string();
        }
    }

    pub fn finish_answer(&mut self, id: &str, result: Result<String, String>) {
        if let Ok(answer) = self.answer_mut(id) {
            match result {
                Ok(text) => {
                    answer.text = text.trim().to_string();
                    answer.status = MeetingAnswerStatus::Ready;
                }
                Err(error) => {
                    answer.status = MeetingAnswerStatus::Failed;
                    answer.error = Some(error);
                }
            }
        }
    }

    pub fn pin_answer(&mut self, id: &str, pinned: bool) -> Result<(), BackendError> {
        self.answer_mut(id)?.pinned = pinned;
        Ok(())
    }

    fn answer_mut(&mut self, id: &str) -> Result<&mut MeetingAnswer, BackendError> {
        self.answers
            .iter_mut()
            .find(|answer| answer.id == id)
            .ok_or_else(|| BackendError::invalid_input("La respuesta no existe en esta reunión."))
    }

    pub fn apply_insights(&mut self, parsed: ParsedInsights) {
        if let Some(summary) = parsed.summary {
            self.insights.summary = Some(summary);
        }
        if let Some(points) = parsed.key_points {
            self.insights.key_points = points;
        }
        if let Some(tasks) = parsed.tasks {
            let tasks = tasks
                .into_iter()
                .map(|(title, detail)| MeetingTask { id: self.next_id("task"), title, detail, sent: false })
                .collect();
            self.insights.tasks = tasks;
        }
    }

    /// Replaces the text of the corrected segments. A correction much
    /// shorter or longer than the original is discarded as a rewrite.
    pub fn apply_corrections(&mut self, corrections: &HashMap<String, String>) {
        for (index, segment) in self.segments.iter_mut().enumerate() {
            let Some(corrected) = corrections.get(&correction_id(index)) else { continue };
            let corrected = corrected.trim();
            let original = segment.text.chars().count().max(1);
            let length = corrected.chars().count();
            if !corrected.is_empty() && length * 2 >= original && length * 5 <= original * 8 {
                segment.text = corrected.to_string();
            }
        }
        self.insights.corrected = true;
    }

    pub fn mark_tasks_sent(&mut self, ids: &[String]) {
        for task in &mut self.insights.tasks {
            if ids.contains(&task.id) {
                task.sent = true;
            }
        }
    }

    pub fn pending_tasks(&self, ids: &[String]) -> Vec<MeetingTask> {
        self.insights
            .tasks
            .iter()
            .filter(|task| ids.contains(&task.id) && !task.sent)
            .cloned()
            .collect()
    }

    fn speaker_name(&self, id: Option<&str>) -> Option<&str> {
        let id = id?;
        self.speakers.iter().find(|speaker| speaker.id == id).map(|speaker| speaker.name.as_str())
    }

    /// Consecutive segments of one speaker, joined.
    pub fn turns(&self) -> Vec<MeetingTurnDto> {
        let mut turns: Vec<MeetingTurnDto> = Vec::new();
        for (index, segment) in self.segments.iter().enumerate() {
            match turns.last_mut() {
                Some(turn) if turn.speaker_id.is_some() && turn.speaker_id == segment.speaker_id => {
                    turn.end_ms = turn.end_ms.max(segment.end_ms);
                    turn.text.push(' ');
                    turn.text.push_str(segment.text.trim());
                }
                _ => turns.push(MeetingTurnDto {
                    id: format!("turn-{}", index + 1),
                    speaker_id: segment.speaker_id.clone(),
                    start_ms: segment.start_ms,
                    end_ms: segment.end_ms,
                    text: segment.text.trim().to_string(),
                }),
            }
        }
        turns
    }

    pub fn speaker_stats(&self) -> Vec<MeetingSpeakerDto> {
        let talk = self
            .speakers
            .iter()
            .map(|speaker| {
                self.segments
                    .iter()
                    .filter(|segment| segment.speaker_id.as_deref() == Some(speaker.id.as_str()))
                    .map(|segment| segment.end_ms.saturating_sub(segment.start_ms))
                    .sum::<u64>()
            })
            .collect::<Vec<_>>();
        let shares = whole_percents(&talk);
        self.speakers
            .iter()
            .enumerate()
            .map(|(index, speaker)| MeetingSpeakerDto {
                id: speaker.id.clone(),
                name: speaker.name.clone(),
                initials: initials(&speaker.name),
                talk_ms: talk[index],
                share_percent: shares[index],
                color_index: index as u32,
            })
            .collect()
    }

    pub fn snapshot(&self, filter: &MeetingFilter) -> MeetingSnapshotDto {
        let turns = self.turns();
        let total_turns = turns.len();
        let query = filter.query.trim().chars().take(MAX_QUERY_CHARS).collect::<String>().to_lowercase();
        let visible = turns
            .into_iter()
            .filter(|turn| filter.speaker_id.is_none() || turn.speaker_id == filter.speaker_id)
            .filter(|turn| query.is_empty() || turn.text.to_lowercase().contains(&query))
            .collect();
        MeetingSnapshotDto {
            id: self.id.clone(),
            status: self.status,
            title: self.title(),
            date_label: self.start.date_label.clone(),
            duration_ms: self.duration_ms,
            sources: self.sources,
            lines: self.lines.clone(),
            speakers: self.speaker_stats(),
            turns: visible,
            total_turns,
            notes: self.notes.clone(),
            marks: self.marks.clone(),
            answers: self.answers.clone(),
            live_answers: self.live_answers,
            insights: self.insights.clone(),
            saved_note_path: self.saved_note.as_ref().map(|note| note.visible_path.clone()),
            suggested_questions: self.suggested_questions(),
            context_text: self.context_text(),
        }
    }

    /// The first short questions of the meeting, each with the minute where
    /// the segment (or live line) that asks it starts.
    fn suggested_questions(&self) -> Vec<MeetingQuestionDto> {
        let mut questions = Vec::<MeetingQuestionDto>::new();
        let texts = if self.segments.is_empty() {
            self.lines.iter().map(|line| (line.start_ms, line.text.as_str())).collect::<Vec<_>>()
        } else {
            self.segments.iter().map(|segment| (segment.start_ms, segment.text.as_str())).collect()
        };
        let asked = texts
            .into_iter()
            .flat_map(|(at_ms, text)| detect_questions(text).into_iter().map(move |question| (at_ms, question)));
        for (at_ms, question) in asked {
            if question.chars().count() > MAX_SUGGESTED_QUESTION_CHARS
                || questions.iter().any(|known| known.question == question)
            {
                continue;
            }
            questions.push(MeetingQuestionDto { question, at_ms });
            if questions.len() == MAX_SUGGESTED_QUESTIONS {
                break;
            }
        }
        questions
    }

    /// Transcript with the minute of each turn and the person's notes.
    pub fn context_text(&self) -> String {
        let mut lines = if self.segments.is_empty() {
            self.lines
                .iter()
                .map(|line| format!("[{}] {}", format_clock(line.start_ms), line.text))
                .collect::<Vec<_>>()
        } else {
            self.turns()
                .iter()
                .map(|turn| match self.speaker_name(turn.speaker_id.as_deref()) {
                    Some(name) => format!("[{}] {name}: {}", format_clock(turn.start_ms), turn.text),
                    None => format!("[{}] {}", format_clock(turn.start_ms), turn.text),
                })
                .collect()
        };
        if !self.notes.trim().is_empty() {
            lines.push(String::new());
            lines.push("Notas de la persona durante la reunión:".to_string());
            lines.push(self.notes.trim().to_string());
        }
        lines.join("\n")
    }

    /// The last lines recognized, for a live answer.
    pub fn recent_context(&self) -> String {
        let mut picked = Vec::new();
        let mut size = 0;
        for line in self.lines.iter().rev() {
            size += line.text.len();
            if size > RECENT_CONTEXT_CHARS && !picked.is_empty() {
                break;
            }
            picked.push(format!("[{}] {}", format_clock(line.start_ms), line.text));
        }
        picked.reverse();
        picked.join("\n")
    }

    /// Batches of segments for the AI correction, each small enough for one
    /// answer.
    pub fn correction_batches(&self) -> Vec<CorrectionBatch> {
        let mut batches = Vec::new();
        let mut ids = Vec::new();
        let mut body = String::new();
        for (index, segment) in self.segments.iter().enumerate() {
            let line = format!("{}: {}\n", correction_id(index), segment.text.trim());
            if !ids.is_empty() && body.len() + line.len() > CORRECTION_BATCH_CHARS {
                batches.push(CorrectionBatch { prompt: correction_prompt(&body), ids: std::mem::take(&mut ids) });
                body.clear();
            }
            ids.push(correction_id(index));
            body.push_str(&line);
        }
        if !ids.is_empty() {
            batches.push(CorrectionBatch { prompt: correction_prompt(&body), ids });
        }
        batches
    }

    /// File name of the meeting note.
    pub fn note_file_name(&self) -> String {
        format!("{}.md", safe_file_stem(&self.title()))
    }

    /// Markdown body of the meeting note (without frontmatter).
    pub fn note_markdown(&self) -> String {
        let mut out = format!("# Reunión del {}\n\n", self.start.date_label);
        out.push_str(&format!("- **Duración:** {}\n", format_clock(self.duration_ms)));
        let speakers = self.speakers.iter().map(|speaker| speaker.name.as_str()).collect::<Vec<_>>();
        if !speakers.is_empty() {
            out.push_str(&format!("- **Hablantes:** {}\n", speakers.join(", ")));
        }
        out.push('\n');
        if let Some(summary) = &self.insights.summary {
            out.push_str(&format!("## Resumen\n\n{}\n\n", summary.trim()));
        }
        if !self.insights.key_points.is_empty() {
            out.push_str("## Puntos clave\n\n");
            for point in &self.insights.key_points {
                out.push_str(&format!("- {}\n", single_line(point)));
            }
            out.push('\n');
        }
        if !self.insights.tasks.is_empty() {
            out.push_str("## Tareas\n\n");
            for task in &self.insights.tasks {
                let detail = if task.detail.trim().is_empty() {
                    String::new()
                } else {
                    format!(" — {}", single_line(&task.detail))
                };
                out.push_str(&format!("- [ ] {}{detail}\n", single_line(&task.title)));
            }
            out.push('\n');
        }
        if !self.notes.trim().is_empty() {
            out.push_str(&format!("## Notas\n\n{}\n\n", self.notes.trim()));
        }
        if !self.marks.is_empty() {
            out.push_str("## Momentos marcados\n\n");
            for mark in &self.marks {
                out.push_str(&format!("- `{}` {}\n", format_clock(mark.at_ms), single_line(&mark.label)));
            }
            out.push('\n');
        }
        let pinned = self.answers.iter().filter(|answer| answer.pinned && !answer.text.trim().is_empty());
        let mut wrote_answers = false;
        for answer in pinned {
            if !wrote_answers {
                out.push_str("## Respuestas fijadas\n\n");
                wrote_answers = true;
            }
            out.push_str(&format!(
                "### {} (`{}`)\n\n{}\n\n",
                single_line(&answer.question),
                format_clock(answer.asked_at_ms),
                answer.text.trim()
            ));
        }
        out.push_str("## Transcripción\n\n");
        let turns = self.turns();
        if turns.is_empty() {
            for line in &self.lines {
                out.push_str(&format!("`{}` {}\n\n", format_clock(line.start_ms), line.text));
            }
        }
        for turn in turns {
            match self.speaker_name(turn.speaker_id.as_deref()) {
                Some(name) => out.push_str(&format!("**{name}** · `{}`\n{}\n\n", format_clock(turn.start_ms), turn.text)),
                None => out.push_str(&format!("`{}` {}\n\n", format_clock(turn.start_ms), turn.text)),
            }
        }
        format!("{}\n", out.trim_end())
    }
}

fn correction_id(index: usize) -> String {
    format!("S{}", index + 1)
}

/// Whole percents of each value that add up to 100 (largest remainder).
fn whole_percents(values: &[u64]) -> Vec<u32> {
    let total = values.iter().sum::<u64>();
    if total == 0 {
        return vec![0; values.len()];
    }
    let mut shares = values
        .iter()
        .map(|value| (value * 100 / total) as u32)
        .collect::<Vec<_>>();
    let mut remainders = values
        .iter()
        .enumerate()
        .map(|(index, value)| (value * 100 % total, index))
        .collect::<Vec<_>>();
    remainders.sort_by(|left, right| right.0.cmp(&left.0).then(left.1.cmp(&right.1)));
    let missing = 100 - shares.iter().sum::<u32>();
    for (_, index) in remainders.into_iter().take(missing as usize) {
        shares[index] += 1;
    }
    shares
}

/// `Hablante 1` → `H1`, `Ana Pérez` → `AP`, `Ana` → `A`.
fn initials(name: &str) -> String {
    let words = name.split_whitespace().collect::<Vec<_>>();
    let first = |word: &str| word.chars().next().map(|character| character.to_uppercase().collect::<String>());
    match words.as_slice() {
        [] => "?".to_string(),
        [only] => first(only).unwrap_or_default(),
        [head, second, ..] => {
            let second = if second.chars().all(|character| character.is_ascii_digit()) {
                second.to_string()
            } else {
                first(second).unwrap_or_default()
            };
            format!("{}{second}", first(head).unwrap_or_default())
        }
    }
}

/// `mm:ss`, or `h:mm:ss` past the first hour.
pub fn format_clock(ms: u64) -> String {
    let seconds = ms / 1_000;
    let (hours, minutes, seconds) = (seconds / 3_600, seconds / 60 % 60, seconds % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

fn excerpt(text: &str, words: usize) -> String {
    let all = text.split_whitespace().collect::<Vec<_>>();
    let mut label = all.iter().take(words).copied().collect::<Vec<_>>().join(" ");
    if all.len() > words {
        label.push('…');
    }
    label
}

fn single_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Keeps letters, digits, spaces and `-._()` so the name is valid on every
/// platform and inside SAF.
fn safe_file_stem(title: &str) -> String {
    let stem = title
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, ' ' | '-' | '.' | '_' | '(' | ')') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let stem = stem.trim_matches(|character: char| character == '.' || character.is_whitespace());
    if stem.is_empty() { "Reunión".to_string() } else { stem.to_string() }
}

/// `Reunión 2026-09-24 10.32 (2).md` for the second note of the same minute.
pub fn numbered_file_name(file_name: &str, number: usize) -> String {
    match file_name.strip_suffix(".md") {
        Some(stem) if number > 1 => format!("{stem} ({number}).md"),
        _ => file_name.to_string(),
    }
}

/// Questions of a text: sentences that end in `?` with at least three
/// words, from their opening `¿` when there is one.
pub fn detect_questions(text: &str) -> Vec<String> {
    let mut questions = Vec::new();
    let mut sentence_start = 0;
    for (index, character) in text.char_indices() {
        if !matches!(character, '.' | '!' | '?') {
            continue;
        }
        let end = index + character.len_utf8();
        let sentence = &text[sentence_start..end];
        sentence_start = end;
        if character != '?' {
            continue;
        }
        let question = match sentence.rfind('¿') {
            Some(opening) => &sentence[opening..],
            None => sentence,
        };
        let question = question.trim().trim_start_matches([',', ';', ':']).trim();
        if question.split_whitespace().count() < MIN_QUESTION_WORDS || question.chars().count() > MAX_QUESTION_CHARS {
            continue;
        }
        questions.push(capitalize_question(question));
    }
    questions
}

fn capitalize_question(question: &str) -> String {
    let (prefix, rest) = match question.strip_prefix('¿') {
        Some(rest) => ("¿", rest),
        None => ("", question),
    };
    let mut characters = rest.chars();
    match characters.next() {
        Some(first) => format!("{prefix}{}{}", first.to_uppercase(), characters.as_str()),
        None => question.to_string(),
    }
}

pub const LIVE_ANSWER_SYSTEM_PROMPT: &str = "Sos el asistente en vivo de Notia durante una reunión. \
Cuando alguien hace una pregunta, sugerís una respuesta breve que la persona usuaria pueda decir en voz alta. \
Respondé en el idioma de la pregunta, en dos a cuatro oraciones, sin introducción, sin comillas y sin markdown. \
Usá solo el contexto de la transcripción; si falta un dato personal, proponé cómo encarar la respuesta en lugar de inventarlo.";

pub fn live_answer_prompt(recent_context: &str, question: &str) -> String {
    format!("TRANSCRIPCIÓN RECIENTE:\n{}\n\nPREGUNTA DETECTADA:\n{}", recent_context.trim(), question.trim())
}

pub fn shorter_answer_prompt(recent_context: &str, question: &str, previous: &str) -> String {
    format!(
        "{}\n\nRESPUESTA ANTERIOR:\n{}\n\nReescribí la respuesta en una o dos oraciones, más directa.",
        live_answer_prompt(recent_context, question),
        previous.trim()
    )
}

pub const INSIGHTS_SYSTEM_PROMPT: &str = "Sos el asistente de reuniones de Notia. \
Analizás transcripciones y respondés solo con un objeto JSON válido, sin bloque de código ni texto adicional. \
No inventes información: todo debe surgir de la transcripción. Escribí en el idioma de la transcripción.";

pub fn insights_prompt(context: &str, request: MeetingInsightsRequest) -> Result<String, BackendError> {
    if context.trim().is_empty() {
        return Err(BackendError::invalid_input("No hay una transcripción para pasar por IA."));
    }
    let mut keys = Vec::new();
    if request.summary {
        keys.push("- \"summary\": resumen de la reunión en tres a seis oraciones.");
    }
    if request.key_points {
        keys.push("- \"keyPoints\": lista de tres a ocho puntos clave, cada uno una frase breve.");
    }
    if request.tasks {
        keys.push(
            "- \"tasks\": lista de tareas accionables acordadas, cada una {\"title\": \"...\", \"detail\": \"...\"}; \
el detalle incluye responsable y plazo si se mencionaron. Lista vacía si no hay tareas.",
        );
    }
    if keys.is_empty() {
        return Err(BackendError::invalid_input("Elegí qué generar con IA."));
    }
    Ok(format!(
        "Devolvé un objeto JSON con estas claves:\n{}\n\nTRANSCRIPCIÓN (cada intervención con su minuto):\n{}",
        keys.join("\n"),
        context.trim()
    ))
}

pub const CORRECTION_SYSTEM_PROMPT: &str = "Sos el corrector de transcripciones de Notia. \
Respondés solo con un objeto JSON válido, sin bloque de código ni texto adicional.";

fn correction_prompt(body: &str) -> String {
    format!(
        "Corregí la puntuación, la ortografía, la concordancia y las frases evidentemente cortadas de cada intervención. \
No cambies el sentido, no resumas, no unas ni dividas intervenciones y conservá cada id.\n\
Devolvé {{\"segments\": [{{\"id\": \"S1\", \"text\": \"...\"}}]}} con todas las intervenciones.\n\n{}",
        body.trim_end()
    )
}

/// The JSON object of an AI answer, tolerating a code fence or text around it.
fn json_object(answer: &str) -> Option<Value> {
    let start = answer.find('{')?;
    let end = answer.rfind('}')?;
    (start < end).then(|| serde_json::from_str(&answer[start..=end]).ok()).flatten()
}

fn clipped(text: &str, max_chars: usize) -> String {
    text.trim().chars().take(max_chars).collect::<String>().trim().to_string()
}

pub fn parse_insights(answer: &str, request: MeetingInsightsRequest) -> Result<ParsedInsights, BackendError> {
    let object = json_object(answer)
        .filter(Value::is_object)
        .ok_or_else(|| BackendError::invalid_input("La IA no devolvió un resultado válido. Probá de nuevo."))?;
    let summary = request
        .summary
        .then(|| object.get("summary").and_then(Value::as_str).map(|text| clipped(text, MAX_SUMMARY_CHARS)))
        .flatten()
        .filter(|summary| !summary.is_empty());
    let key_points = request.key_points.then(|| {
        object
            .get("keyPoints")
            .and_then(Value::as_array)
            .map(|points| {
                points
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|point| clipped(point, MAX_KEY_POINT_CHARS))
                    .filter(|point| !point.is_empty())
                    .take(MAX_KEY_POINTS)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    });
    let tasks = request.tasks.then(|| {
        object
            .get("tasks")
            .and_then(Value::as_array)
            .map(|tasks| {
                tasks
                    .iter()
                    .filter_map(|task| match task {
                        Value::String(title) => Some((clipped(title, MAX_TASK_TITLE_CHARS), String::new())),
                        Value::Object(_) => Some((
                            clipped(task.get("title").and_then(Value::as_str).unwrap_or_default(), MAX_TASK_TITLE_CHARS),
                            clipped(task.get("detail").and_then(Value::as_str).unwrap_or_default(), MAX_TASK_DETAIL_CHARS),
                        )),
                        _ => None,
                    })
                    .filter(|(title, _)| !title.is_empty())
                    .take(MAX_TASKS)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    });
    if request.summary && summary.is_none() && key_points.as_ref().is_none_or(Vec::is_empty) && tasks.as_ref().is_none_or(Vec::is_empty) {
        return Err(BackendError::invalid_input("La IA no devolvió un resumen. Probá de nuevo."));
    }
    Ok(ParsedInsights { summary, key_points, tasks })
}

/// Corrected text of each segment id of the batch.
pub fn parse_corrections(answer: &str, batch: &CorrectionBatch) -> HashMap<String, String> {
    let Some(object) = json_object(answer) else { return HashMap::new() };
    object
        .get("segments")
        .and_then(Value::as_array)
        .map(|segments| {
            segments
                .iter()
                .filter_map(|segment| {
                    let id = segment.get("id").and_then(Value::as_str)?.trim();
                    let text = segment.get("text").and_then(Value::as_str)?;
                    batch.ids.iter().any(|known| known == id).then(|| (id.to_string(), text.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> MeetingRecord {
        MeetingRecord::new(
            "meeting-1",
            MeetingStart { date_label: "24/09/2026 10:32".into(), file_stamp: "2026-09-24 10.32".into(), unix_ms: 1 },
            MeetingSources { microphone: true, system: true },
            false,
        )
    }

    fn segment(start_ms: u64, end_ms: u64, speaker: &str, text: &str) -> MeetingSegment {
        MeetingSegment { start_ms, end_ms, speaker_id: Some(speaker.into()), text: text.into() }
    }

    fn completed() -> MeetingRecord {
        let mut record = record();
        record.push_line(0, 4_000, "Hola, ¿cómo te fue en el viaje?");
        record.complete(
            vec![
                segment(0, 6_000, "speaker-2", "Hola, ¿cómo te fue en el viaje?"),
                segment(6_000, 8_000, "speaker-1", "Bien, tranquilo."),
                segment(8_000, 10_000, "speaker-1", "Llegué bien."),
                segment(10_000, 12_000, "speaker-2", "Empecemos."),
            ],
            12_000,
        );
        record
    }

    #[test]
    fn questions_are_detected_from_their_opening_mark() {
        assert_eq!(
            detect_questions("Ok. Y una pregunta, ¿por qué renunciaste a tu trabajo? Bien."),
            vec!["¿Por qué renunciaste a tu trabajo?".to_string()]
        );
        assert!(detect_questions("¿Sí?").is_empty());
        assert!(detect_questions("Sin preguntas acá.").is_empty());
        assert_eq!(detect_questions("What did you like most?"), vec!["What did you like most?".to_string()]);
    }

    #[test]
    fn live_lines_flag_questions_and_marks_take_the_last_words() {
        let mut record = record();
        let line = record.push_line(1_000, 3_000, "¿Qué te gustaba más de tu trabajo?").unwrap();
        assert!(line.question);
        assert!(record.push_line(3_000, 3_000, "   ").is_none());
        record.push_line(5_000, 9_000, "Me relacionaba con obra, proyectos y contabilidad todos los días");
        let mark = record.add_mark(10_000).unwrap();
        assert_eq!(mark.label, "Me relacionaba con obra, proyectos y contabilidad todos…");
        assert_eq!(record.add_mark(500).unwrap().label, "Momento 2");
        record.remove_mark(&mark.id).unwrap();
        assert_eq!(record.marks.len(), 1);
        assert!(record.remove_mark(&mark.id).is_err());
    }

    #[test]
    fn speakers_are_named_by_appearance_and_turns_join_consecutive_segments() {
        let record = completed();
        let turns = record.turns();
        assert_eq!(turns.len(), 3);
        assert_eq!(turns[1].text, "Bien, tranquilo. Llegué bien.");
        assert_eq!((turns[1].start_ms, turns[1].end_ms), (6_000, 10_000));
        let speakers = record.speaker_stats();
        assert_eq!(speakers[0].id, "speaker-2");
        assert_eq!(speakers[0].name, "Hablante 1");
        assert_eq!(speakers[0].initials, "H1");
        assert_eq!(speakers[0].talk_ms, 8_000);
        assert_eq!(speakers.iter().map(|speaker| speaker.share_percent).sum::<u32>(), 100);
        assert_eq!((speakers[0].share_percent, speakers[1].share_percent), (67, 33));
    }

    #[test]
    fn renaming_and_merging_speakers_update_every_view() {
        let mut record = completed();
        assert!(record.rename_speaker("speaker-1", "  ").is_err());
        assert!(record.rename_speaker("speaker-9", "Ana").is_err());
        record.rename_speaker("speaker-1", "Ana Pérez").unwrap();
        assert_eq!(record.speaker_stats()[1].initials, "AP");
        assert!(record.context_text().contains("[00:06] Ana Pérez: Bien, tranquilo. Llegué bien."));
        assert!(record.merge_speakers("speaker-1", "speaker-1").is_err());
        record.merge_speakers("speaker-1", "speaker-2").unwrap();
        assert_eq!(record.turns().len(), 1);
        let speakers = record.speaker_stats();
        assert_eq!(speakers.len(), 1);
        assert_eq!(speakers[0].share_percent, 100);
    }

    #[test]
    fn the_snapshot_filters_turns_by_speaker_and_text() {
        let record = completed();
        let by_speaker = record.snapshot(&MeetingFilter { query: String::new(), speaker_id: Some("speaker-1".into()) });
        assert_eq!(by_speaker.turns.len(), 1);
        assert_eq!(by_speaker.total_turns, 3);
        let by_text = record.snapshot(&MeetingFilter { query: "EMPECEMOS".into(), speaker_id: None });
        assert_eq!(by_text.turns.len(), 1);
        assert_eq!(
            by_text.suggested_questions,
            vec![MeetingQuestionDto { question: "¿Cómo te fue en el viaje?".into(), at_ms: 0 }]
        );
    }

    #[test]
    fn suggested_questions_keep_the_minute_they_were_asked() {
        let mut record = record();
        record.push_line(0, 3_000, "Buenas, empecemos.");
        record.push_line(160_000, 164_000, "Ok. Y una pregunta, ¿por qué renunciaste a tu trabajo?");
        let live = record.snapshot(&MeetingFilter::default()).suggested_questions;
        assert_eq!(live, vec![MeetingQuestionDto { question: "¿Por qué renunciaste a tu trabajo?".into(), at_ms: 160_000 }]);
        record.complete(vec![segment(158_500, 165_000, "speaker-1", "Y una pregunta, ¿por qué renunciaste a tu trabajo?")], 165_000);
        assert_eq!(record.snapshot(&MeetingFilter::default()).suggested_questions[0].at_ms, 158_500);
    }

    #[test]
    fn without_speakers_the_live_lines_become_the_transcript() {
        let mut record = record();
        record.push_line(0, 2_000, "Primera frase.");
        record.push_line(62_000, 64_000, "Segunda frase.");
        record.complete(vec![MeetingSegment { start_ms: 0, end_ms: 64_000, speaker_id: None, text: "todo".into() }], 64_000);
        let turns = record.turns();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[1].start_ms, 62_000);
        assert!(record.speaker_stats().is_empty());
        assert!(record.note_markdown().contains("`01:02` Segunda frase."));
    }

    #[test]
    fn the_note_lists_insights_notes_marks_pinned_answers_and_turns() {
        let mut record = completed();
        record.set_notes("Revisar el contrato").unwrap();
        record.add_mark(6_500).unwrap();
        let answer = record.begin_answer("¿Cómo te fue en el viaje?", 1_000).unwrap();
        record.finish_answer(&answer, Ok("Muy bien, gracias.".into()));
        record.pin_answer(&answer, true).unwrap();
        record.apply_insights(ParsedInsights {
            summary: Some("Charla inicial.".into()),
            key_points: Some(vec!["Viaje tranquilo".into()]),
            tasks: Some(vec![("Enviar agenda".into(), "Ana, el lunes".into())]),
        });
        let note = record.note_markdown();
        assert!(note.starts_with("# Reunión del 24/09/2026 10:32\n"));
        assert!(note.contains("- **Hablantes:** Hablante 1, Hablante 2"));
        assert!(note.contains("## Resumen\n\nCharla inicial."));
        assert!(note.contains("- [ ] Enviar agenda — Ana, el lunes"));
        assert!(note.contains("## Notas\n\nRevisar el contrato"));
        assert!(note.contains("- `00:06` Hola, ¿cómo te fue en el viaje?"));
        assert!(note.contains("### ¿Cómo te fue en el viaje? (`00:01`)\n\nMuy bien, gracias."));
        assert!(note.contains("**Hablante 2** · `00:06`\nBien, tranquilo. Llegué bien."));
        assert_eq!(record.note_file_name(), "Reunión 2026-09-24 10.32.md");
        assert_eq!(numbered_file_name("Reunión 2026-09-24 10.32.md", 2), "Reunión 2026-09-24 10.32 (2).md");
    }

    #[test]
    fn live_answers_are_not_repeated_and_can_be_restarted() {
        let mut record = record();
        let id = record.begin_answer("¿Qué te gustaba?", 0).unwrap();
        assert!(record.begin_answer("¿Qué te gustaba?", 10).is_none());
        assert!(record.restart_answer(&id).is_err());
        record.finish_answer(&id, Ok(" Coordinar equipos. ".into()));
        assert_eq!(record.answers[0].text, "Coordinar equipos.");
        let (question, previous) = record.restart_answer(&id).unwrap();
        assert_eq!((question.as_str(), previous.as_str()), ("¿Qué te gustaba?", "Coordinar equipos."));
        record.finish_answer(&id, Err("sin conexión".into()));
        assert_eq!(record.answers[0].status, MeetingAnswerStatus::Failed);
    }

    #[test]
    fn insights_are_parsed_from_fenced_json_and_bounded() {
        let request = MeetingInsightsRequest { summary: true, key_points: true, tasks: true, correct: false };
        let answer = "```json\n{\"summary\": \" Resumen. \", \"keyPoints\": [\"Uno\", \"\", 3], \"tasks\": [{\"title\": \"Llamar\", \"detail\": \"Ana\"}, \"Enviar mail\", {\"title\": \"\"}]}\n```";
        let parsed = parse_insights(answer, request).unwrap();
        assert_eq!(parsed.summary.as_deref(), Some("Resumen."));
        assert_eq!(parsed.key_points, Some(vec!["Uno".to_string()]));
        assert_eq!(parsed.tasks, Some(vec![("Llamar".into(), "Ana".into()), ("Enviar mail".into(), String::new())]));
        assert!(parse_insights("no es json", request).is_err());
        let only_tasks = MeetingInsightsRequest { tasks: true, ..Default::default() };
        assert_eq!(parse_insights("{\"summary\": \"x\"}", only_tasks).unwrap().summary, None);
        assert!(insights_prompt("", request).is_err());
        assert!(insights_prompt("[00:00] Hola", MeetingInsightsRequest::default()).is_err());
        assert!(insights_prompt("[00:00] Hola", request).unwrap().contains("\"keyPoints\""));
    }

    #[test]
    fn corrections_replace_only_known_segments_of_a_similar_length() {
        let mut record = completed();
        let batches = record.correction_batches();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].ids, vec!["S1", "S2", "S3", "S4"]);
        assert!(batches[0].prompt.contains("S2: Bien, tranquilo."));
        let corrections = parse_corrections(
            "{\"segments\": [{\"id\": \"S2\", \"text\": \"Bien, tranquila.\"}, {\"id\": \"S3\", \"text\": \"x\"}, {\"id\": \"S9\", \"text\": \"otro\"}]}",
            &batches[0],
        );
        assert_eq!(corrections.len(), 2);
        record.apply_corrections(&corrections);
        assert_eq!(record.segments[1].text, "Bien, tranquila.");
        assert_eq!(record.segments[2].text, "Llegué bien.");
        assert!(record.insights.corrected);
    }

    #[test]
    fn clock_percents_and_file_names_are_formatted() {
        assert_eq!(format_clock(65_000), "01:05");
        assert_eq!(format_clock(3_725_000), "1:02:05");
        assert_eq!(whole_percents(&[1, 1, 1]), vec![34, 33, 33]);
        assert_eq!(whole_percents(&[0, 0]), vec![0, 0]);
        assert_eq!(safe_file_stem("Reunión: 10/2"), "Reunión- 10-2");
        assert_eq!(initials("Ana"), "A");
    }
}
