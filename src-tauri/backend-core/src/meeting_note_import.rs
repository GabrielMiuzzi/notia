//! Meetings saved as notes before their archive existed: the note the
//! meeting wrote (`MeetingRecord::note_markdown`) is read back into a
//! finished record so «Reuniones anteriores» lists and reopens it. What the
//! note does not keep (live lines, pinned answers, the call's speech) stays
//! empty.

use super::*;

/// File names of the notes a meeting writes (`note_file_name`).
const NOTE_PREFIXES: [&str; 2] = ["Reunión ", "Transcripción de "];
const NOTES_HEADING: &str = "Notas IA";

/// Whether the note at `logical_path` may be a meeting note, by its name.
pub fn is_meeting_note_name(logical_path: &str) -> bool {
    let name = logical_path.rsplit('/').next().unwrap_or_default();
    name.to_lowercase().ends_with(".md") && NOTE_PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

/// A stable archive id for the note at `logical_path`.
pub fn imported_meeting_id(logical_path: &str) -> String {
    // FNV-1a: the same note always gets the same id.
    let hash = logical_path.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    });
    format!("nota-{hash:016x}")
}

/// The finished meeting a saved note describes; `None` when the note is not
/// one Meeting wrote or has no transcript. `start_ms` turns the note's
/// `dd/mm/yyyy hh:mm` into milliseconds in local time.
pub fn archive_from_note(
    markdown: &str,
    note: SavedMeetingNote,
    start_ms: impl Fn(&str) -> Option<u64>,
) -> Option<MeetingArchive> {
    let (front, body) = split_frontmatter(markdown);
    let created_ms = front.lines().find_map(|line| line.strip_prefix("createdAt:")).and_then(|value| value.trim().parse::<u64>().ok());
    let mut lines = body.lines().peekable();
    let heading = lines.by_ref().find(|line| !line.trim().is_empty())?.trim();
    let heading = heading.strip_prefix("# ")?;
    let mut meta = HashMap::new();
    while let Some(line) = lines.next_if(|line| !line.starts_with("## ")) {
        if let Some((key, value)) = line.trim().strip_prefix("- **").and_then(|rest| rest.split_once(":** ")) {
            meta.insert(key.to_string(), value.trim().to_string());
        }
    }
    let sections = sections(lines);

    let (date_label, source_file) = if let Some(label) = heading.strip_prefix("Reunión del ") {
        (label.trim().to_string(), None)
    } else {
        heading.strip_prefix("Transcripción de ")?;
        let file = meta.get("Archivo").and_then(|name| MeetingSourceFile::from_name(name).ok())?;
        (meta.get("Transcripta el").cloned()?, Some(file))
    };
    let unix_ms = start_ms(&date_label).or(created_ms)?;
    let file_stamp = file_stamp(&date_label)?;

    let turns = transcript_turns(sections.get("Transcripción")?);
    if turns.is_empty() {
        return None;
    }
    let duration_ms = meta
        .get("Duración")
        .and_then(|value| parse_clock(value))
        .unwrap_or_default()
        .max(turns.last().map_or(0, |turn| turn.1));

    let start = MeetingStart { date_label, file_stamp, unix_ms };
    let mut record = MeetingRecord::new(imported_meeting_id(&note.logical_path), start, MeetingSources { microphone: true, system: false }, false);
    record.status = MeetingStatus::Completed;
    record.source_file = source_file;
    record.duration_ms = duration_ms;

    let mut names = meta
        .get("Hablantes")
        .map(|names| names.split(", ").map(str::trim).filter(|name| !name.is_empty()).map(str::to_string).collect::<Vec<_>>())
        .unwrap_or_default();
    for (name, _, _) in &turns {
        if let Some(name) = name.as_ref().filter(|name| !names.contains(name)) {
            names.push(name.clone());
        }
    }
    record.speakers = names
        .iter()
        .enumerate()
        .map(|(index, name)| SpeakerName { id: format!("speaker-{}", index + 1), name: name.clone() })
        .collect();
    let speaker_id = |name: &Option<String>| {
        let name = name.as_ref()?;
        names.iter().position(|known| known == name).map(|index| format!("speaker-{}", index + 1))
    };
    record.segments = turns
        .iter()
        .enumerate()
        .map(|(index, (name, at_ms, text))| MeetingSegment {
            start_ms: *at_ms,
            end_ms: turns.get(index + 1).map_or(duration_ms, |next| next.1).max(*at_ms),
            speaker_id: speaker_id(name),
            text: text.clone(),
        })
        .collect();

    if let Some(summary) = sections.get("Resumen").map(|lines| lines.join("\n").trim().to_string()).filter(|text| !text.is_empty()) {
        record.insights.summary = Some(summary);
    }
    record.insights.key_points = sections.get("Puntos clave").map(|lines| bullets(lines)).unwrap_or_default();
    for item in sections.get("Tareas").map(|lines| checklist(lines)).unwrap_or_default() {
        let (title, detail) = item.split_once(" — ").map_or((item.as_str(), ""), |(title, detail)| (title, detail));
        let id = record.next_id("task");
        record.insights.tasks.push(MeetingTask { id, title: title.to_string(), detail: detail.to_string(), sent: false });
    }
    if let Some(lines) = sections.get(NOTES_HEADING) {
        record.ai_notes.notes = ai_notes(lines);
        for index in 0..record.ai_notes.notes.tasks.len() {
            record.ai_notes.notes.tasks[index].id = record.next_id("note-task");
        }
        record.ai_notes.enabled = !record.ai_notes.notes.is_empty();
    }
    record.notes = sections.get("Notas").map(|lines| lines.join("\n").trim().to_string()).unwrap_or_default();
    for line in sections.get("Momentos marcados").map(Vec::as_slice).unwrap_or_default() {
        let Some((minute, label)) = line.trim().strip_prefix("- `").and_then(|rest| rest.split_once("` ")) else { continue };
        let Some(at_ms) = parse_clock(minute) else { continue };
        let id = record.next_id("mark");
        record.marks.push(MeetingMark { id, at_ms, label: label.trim().to_string() });
    }
    record.saved_note = Some(note);
    Some(MeetingArchive::new(record, None))
}

fn split_frontmatter(markdown: &str) -> (&str, &str) {
    let text = markdown.trim_start_matches('\u{feff}');
    let Some(rest) = text.strip_prefix("---\n").or_else(|| text.strip_prefix("---\r\n")) else { return ("", text) };
    match rest.find("\n---") {
        Some(end) => {
            let after = &rest[end + 4..];
            (&rest[..end], after.split_once('\n').map_or("", |(_, body)| body))
        }
        None => ("", text),
    }
}

/// The `## ` sections of the note, by title, with their lines.
fn sections<'a>(lines: impl Iterator<Item = &'a str>) -> HashMap<String, Vec<String>> {
    let mut sections = HashMap::<String, Vec<String>>::new();
    let mut current: Option<String> = None;
    for line in lines {
        let line = line.trim_end_matches('\r');
        if let Some(title) = line.strip_prefix("## ") {
            let title = title.trim().to_string();
            sections.entry(title.clone()).or_default();
            current = Some(title);
        } else if let Some(title) = &current {
            sections.entry(title.clone()).or_default().push(line.to_string());
        }
    }
    sections
}

/// `**Name** · `mm:ss`` (or `` `mm:ss` text``) turns: speaker, minute, text.
fn transcript_turns(lines: &[String]) -> Vec<(Option<String>, u64, String)> {
    let mut turns: Vec<(Option<String>, u64, String)> = Vec::new();
    let mut open = false;
    for line in lines.iter().map(|line| line.trim()) {
        if line.is_empty() {
            open = false;
            continue;
        }
        if let Some((name, minute)) = line.strip_prefix("**").and_then(|rest| rest.split_once("** · `")) {
            if let Some(at_ms) = minute.strip_suffix('`').and_then(parse_clock) {
                turns.push((Some(name.to_string()), at_ms, String::new()));
                open = true;
                continue;
            }
        }
        if !open {
            if let Some((minute, text)) = line.strip_prefix('`').and_then(|rest| rest.split_once("` ")) {
                if let Some(at_ms) = parse_clock(minute) {
                    turns.push((None, at_ms, text.trim().to_string()));
                    open = true;
                    continue;
                }
            }
        }
        if let Some(turn) = turns.last_mut().filter(|_| open) {
            if !turn.2.is_empty() {
                turn.2.push(' ');
            }
            turn.2.push_str(line);
        }
    }
    turns.retain(|turn| !turn.2.is_empty());
    turns
}

fn bullets(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .filter_map(|line| line.trim().strip_prefix("- "))
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn checklist(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .filter_map(|line| {
            let line = line.trim();
            line.strip_prefix("- [ ] ").or_else(|| line.strip_prefix("- [x] "))
        })
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

/// The «## Notas IA» section (`meeting_ai::notes_markdown`) read back.
fn ai_notes(lines: &[String]) -> meeting_ai::MeetingAiNotes {
    let mut notes = meeting_ai::MeetingAiNotes::default();
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    for line in lines {
        if let Some(title) = line.trim().strip_prefix("### ") {
            groups.push((title.trim().to_string(), Vec::new()));
        } else if let Some((_, group)) = groups.last_mut() {
            group.push(line.clone());
        } else if let Some(objective) = line.trim().strip_prefix("**Objetivo:** ") {
            notes.objective = objective.trim().to_string();
        }
    }
    for (title, group) in groups {
        match title.as_str() {
            "Decisiones" => notes.decisions = bullets(&group),
            "Preguntas abiertas" => notes.open_questions = bullets(&group),
            "Tareas de seguimiento" => {
                notes.tasks = checklist(&group).into_iter().map(note_task).collect();
            }
            _ => {
                let (title, at_ms) = title
                    .strip_suffix("`)")
                    .and_then(|rest| rest.rsplit_once(" (`"))
                    .and_then(|(title, minute)| Some((title.to_string(), parse_clock(minute)?)))
                    .unwrap_or((title.clone(), 0));
                notes.topics.push(meeting_ai::MeetingNoteTopic { title, at_ms, items: bullets(&group) });
            }
        }
    }
    notes
}

/// `text (owner, due)`, as `notes_markdown` writes a task.
fn note_task(item: String) -> meeting_ai::MeetingNoteTask {
    let parsed = item.strip_suffix(')').and_then(|rest| rest.rsplit_once(" (")).map(|(text, detail)| {
        let mut parts = detail.splitn(2, ", ");
        (text.to_string(), parts.next().unwrap_or_default().to_string(), parts.next().unwrap_or_default().to_string())
    });
    let (text, owner, due) = parsed.unwrap_or((item, String::new(), String::new()));
    meeting_ai::MeetingNoteTask { id: String::new(), text, owner, due, sent: false }
}

/// `06/10/2026 09:03` → `2026-10-06 09.03`.
fn file_stamp(date_label: &str) -> Option<String> {
    let (date, time) = date_label.trim().split_once(' ')?;
    let mut parts = date.split('/');
    let (day, month, year) = (parts.next()?, parts.next()?, parts.next()?);
    let valid = [day, month, year].iter().all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));
    valid.then(|| format!("{year}-{month}-{day} {}", time.replace(':', ".")))
}

/// `mm:ss` or `h:mm:ss` in milliseconds.
fn parse_clock(value: &str) -> Option<u64> {
    let parts = value.trim().split(':').map(|part| part.trim().parse::<u64>().ok()).collect::<Option<Vec<_>>>()?;
    let seconds = match parts.as_slice() {
        [minutes, seconds] if *seconds < 60 => minutes * 60 + seconds,
        [hours, minutes, seconds] if *minutes < 60 && *seconds < 60 => hours * 3_600 + minutes * 60 + seconds,
        _ => return None,
    };
    Some(seconds * 1_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(path: &str) -> SavedMeetingNote {
        SavedMeetingNote { logical_path: path.into(), visible_path: path.into(), revision: "r1".into() }
    }

    #[test]
    fn a_note_meeting_wrote_comes_back_as_its_meeting() {
        let mut original = MeetingRecord::new(
            "m1",
            MeetingStart { date_label: "06/10/2026 09:03".into(), file_stamp: "2026-10-06 09.03".into(), unix_ms: 5 },
            MeetingSources { microphone: true, system: false },
            false,
        );
        original.push_line(0, 4_000, "Hola a todos.");
        original.complete(
            vec![
                MeetingSegment { start_ms: 8_000, end_ms: 20_000, speaker_id: Some("speaker-2".into()), text: "Arrancamos con la migración.".into() },
                MeetingSegment { start_ms: 20_000, end_ms: 30_000, speaker_id: Some("speaker-1".into()), text: "¿Cuándo empieza?".into() },
                MeetingSegment { start_ms: 30_000, end_ms: 50_000, speaker_id: Some("speaker-2".into()), text: "El lunes.".into() },
            ],
            1_280_000,
        );
        original.rename_speaker("speaker-1", "Martín").unwrap();
        original.add_mark(20_000, Some("Fecha de inicio")).unwrap();
        original.insights.summary = Some("Se planificó la migración.".into());
        original.insights.key_points = vec!["Dos días por proyecto.".into()];
        original.finish_notes_pass(
            Ok("{\"objective\": \"Explicar la migración\", \"decisions\": [\"Migrar en dos días\"], \
\"topics\": [{\"title\": \"Motivos\", \"minute\": \"01:50\", \"items\": [\"Clúster grande\"]}], \
\"tasks\": [{\"text\": \"Validar en QA\", \"owner\": \"Martín\", \"due\": \"viernes\"}]}".into()),
            None,
        );
        let note = format!("---\ncreatedAt: 1791288218715\ncontexto: \"#Personal\"\n---\n{}", original.note_markdown());

        let archive = archive_from_note(&note, saved("Meetings/Reunión 2026-10-06 09.03.md"), |label| (label == "06/10/2026 09:03").then_some(42)).expect("meeting");
        let record = archive.record;
        assert_eq!(record.title(), "Reunión 2026-10-06 09.03");
        assert_eq!(record.start.unix_ms, 42);
        assert_eq!(record.status, MeetingStatus::Completed);
        assert_eq!(record.duration_ms, 1_280_000);
        assert_eq!(record.id, imported_meeting_id("Meetings/Reunión 2026-10-06 09.03.md"));
        assert!(archive_path(&record.id).is_ok());
        let names = record.speaker_stats().into_iter().map(|speaker| speaker.name).collect::<Vec<_>>();
        assert_eq!(names, vec!["Hablante 1", "Martín"]);
        let turns = record.turns();
        assert_eq!(turns.len(), 3);
        assert_eq!((turns[1].start_ms, turns[1].end_ms, turns[1].text.as_str()), (20_000, 30_000, "¿Cuándo empieza?"));
        assert_eq!(record.speaker_name(turns[1].speaker_id.as_deref()), Some("Martín"));
        assert_eq!(record.insights.summary.as_deref(), Some("Se planificó la migración."));
        assert_eq!(record.insights.key_points, vec!["Dos días por proyecto.".to_string()]);
        let notes = &record.ai_notes.notes;
        assert!(record.ai_notes.enabled);
        assert_eq!(notes.objective, "Explicar la migración");
        assert_eq!(notes.decisions, vec!["Migrar en dos días".to_string()]);
        assert_eq!((notes.topics[0].title.as_str(), notes.topics[0].at_ms), ("Motivos", 110_000));
        assert_eq!((notes.tasks[0].text.as_str(), notes.tasks[0].owner.as_str(), notes.tasks[0].due.as_str()), ("Validar en QA", "Martín", "viernes"));
        assert!(!notes.tasks[0].id.is_empty());
        assert_eq!(record.marks.len(), 1);
        assert_eq!(record.marks[0].at_ms, 20_000);
        assert_eq!(record.saved_note.as_ref().map(|note| note.revision.as_str()), Some("r1"));
        // The rebuilt meeting writes the same transcript again.
        assert!(record.note_markdown().contains("**Martín** · `00:20`\n¿Cuándo empieza?"));
    }

    /// Reads the meeting notes of a real folder (`NOTIA_MEETING_NOTES_DIR`)
    /// without changing them and prints what each one rebuilds.
    #[test]
    #[ignore]
    fn rebuilds_the_meeting_notes_of_a_folder() {
        let folder = std::env::var("NOTIA_MEETING_NOTES_DIR").expect("NOTIA_MEETING_NOTES_DIR");
        let mut count = 0;
        for entry in std::fs::read_dir(folder).expect("folder").flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_meeting_note_name(&name) {
                continue;
            }
            let text = std::fs::read_to_string(entry.path()).expect("note");
            let archive = archive_from_note(&text, saved(&name), |_| Some(1)).unwrap_or_else(|| panic!("{name} did not rebuild"));
            let record = &archive.record;
            println!(
                "{name}: {} · {} turnos · {} hablantes · {} temas · {} tareas",
                format_clock(record.duration_ms),
                record.turns().len(),
                record.speaker_count(),
                record.ai_notes.notes.topics.len(),
                record.pending_task_count()
            );
            count += 1;
        }
        assert!(count > 0);
    }

    #[test]
    fn other_notes_are_not_meetings() {
        assert!(is_meeting_note_name("Meetings/Reunión 2026-10-02 10.05.md"));
        assert!(is_meeting_note_name("Transcripción de clase (2).md"));
        assert!(!is_meeting_note_name("Ideas/Reuniones.md"));
        assert!(archive_from_note("# Ideas\n\n- una", saved("Reunión x.md"), |_| Some(1)).is_none());
        assert!(archive_from_note("# Reunión del 02/10/2026 10:05\n\n- **Duración:** 01:00\n\n## Transcripción\n\n", saved("Reunión x.md"), |_| Some(1)).is_none());
    }
}
