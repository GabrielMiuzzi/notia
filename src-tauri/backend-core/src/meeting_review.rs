//! The AI review of a finished meeting, run on its own once the speakers are
//! separated: first the transcript is cleaned up (misheard words fixed,
//! filler words, repetitions and false starts removed, each turn put in
//! order), then the speakers the conversation names get their names (someone
//! called on who answers next, a self-introduction). Each step keeps the
//! segments and who said them; a step that fails leaves the meeting as it was.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::meeting::json_object;

/// Characters of transcript in one cleanup request.
pub const CLEANUP_BATCH_CHARS: usize = 6_000;
/// Characters of transcript the naming request reads: introductions and the
/// first turns come at the start.
pub const NAMING_TRANSCRIPT_CHARS: usize = 40_000;

pub const REVIEW_SYSTEM_PROMPT: &str = "Sos el editor de transcripciones de reuniones de Notia. \
Respondés solo con un objeto JSON válido, sin bloque de código ni texto adicional.";

/// The step of the review running now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MeetingReviewStage {
    Cleanup,
    Names,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingReviewState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<MeetingReviewStage>,
    /// The transcript was cleaned up.
    pub cleaned: bool,
    /// Speakers the review named.
    pub named: usize,
    /// Why the last step failed, for the person.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn cleanup_prompt(body: &str) -> String {
    format!(
        "Esta es la transcripción automática de una reunión, intervención por intervención, con el hablante entre corchetes. \
Para cada intervención:\n\
- Corregí las palabras que el reconocimiento oyó mal, por el contexto de la conversación (nombres, términos, frases sin sentido).\n\
- Quitá muletillas y rellenos (eh, eeeh, mmm, este, o sea, bueno usado como relleno), palabras repetidas y arranques en falso.\n\
- Ordená lo dicho para que se lea como un párrafo coherente, con puntuación correcta.\n\
No cambies el sentido ni la persona que habla, no agregues información, no resumas, no unas ni dividas intervenciones y conservá cada id. \
Si una intervención es solo muletillas, devolvé su texto vacío.\n\
Devolvé {{\"segments\": [{{\"id\": \"S1\", \"text\": \"...\"}}]}} con todas las intervenciones.\n\n{}",
        body.trim_end()
    )
}

/// `speakers` are the ids still without a name, with the label they show.
pub fn naming_prompt(transcript: &str, speakers: &[(String, String)]) -> String {
    let list = speakers.iter().map(|(id, label)| format!("- {id}: {label}")).collect::<Vec<_>>().join("\n");
    format!(
        "Esta es la transcripción de una reunión con los hablantes separados automáticamente. \
Deducí el nombre de cada hablante sin nombre solo cuando la conversación lo muestre con claridad: \
alguien se presenta («soy Laura»), alguien le da la palabra a una persona por su nombre y ese hablante habla a continuación, \
o le responden llamándolo por su nombre. Ante la duda, no lo nombres. Usá el nombre como se dice en la reunión, \
sin cargos ni apellidos inventados, y no le des el mismo nombre a dos hablantes.\n\
Hablantes sin nombre:\n{list}\n\n\
Devolvé {{\"speakers\": [{{\"id\": \"speaker-1\", \"name\": \"Laura\"}}]}} solo con los que puedas nombrar (vacío si ninguno).\n\n\
Transcripción:\n{}",
        transcript.trim_end()
    )
}

/// The names of the answer, by speaker id; ids outside `known` are dropped.
pub fn parse_speaker_names(answer: &str, known: &[String]) -> Vec<(String, String)> {
    let Some(object) = json_object(answer) else { return Vec::new() };
    let Some(speakers) = object.get("speakers").and_then(Value::as_array) else { return Vec::new() };
    let mut names: Vec<(String, String)> = Vec::new();
    for speaker in speakers {
        let (Some(id), Some(name)) = (
            speaker.get("id").and_then(Value::as_str).map(str::trim),
            speaker.get("name").and_then(Value::as_str).map(str::trim),
        ) else {
            continue;
        };
        let taken = names.iter().any(|(known_id, known_name)| known_id == id || known_name.eq_ignore_ascii_case(name));
        if known.iter().any(|known_id| known_id == id) && !name.is_empty() && !taken {
            names.push((id.to_string(), name.to_string()));
        }
    }
    names
}

/// Whether a speaker still has the name Notia gave it ("Hablante 3").
pub fn is_default_speaker_name(name: &str) -> bool {
    name.strip_prefix("Hablante ").is_some_and(|number| !number.is_empty() && number.chars().all(|c| c.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speaker_names_keep_known_ids_and_one_name_each() {
        let known = vec!["speaker-1".to_string(), "speaker-2".to_string(), "speaker-3".to_string()];
        let answer = r#"```json
{"speakers": [
  {"id": "speaker-1", "name": " Laura "},
  {"id": "speaker-9", "name": "Pedro"},
  {"id": "speaker-2", "name": "laura"},
  {"id": "speaker-3", "name": ""},
  {"id": "speaker-1", "name": "Ana"}
]}
```"#;
        assert_eq!(parse_speaker_names(answer, &known), vec![("speaker-1".to_string(), "Laura".to_string())]);
        assert!(parse_speaker_names("no sé", &known).is_empty());
    }

    #[test]
    fn default_names_are_told_apart_from_given_ones() {
        assert!(is_default_speaker_name("Hablante 1"));
        assert!(is_default_speaker_name("Hablante 12"));
        assert!(!is_default_speaker_name("Hablante"));
        assert!(!is_default_speaker_name("Hablante uno"));
        assert!(!is_default_speaker_name("Laura"));
    }

    #[test]
    fn the_prompts_carry_the_transcript_and_the_speakers() {
        let prompt = naming_prompt("[00:01] Hablante 1: Hola, soy Laura.", &[("speaker-1".into(), "Hablante 1".into())]);
        assert!(prompt.contains("- speaker-1: Hablante 1"));
        assert!(prompt.ends_with("[00:01] Hablante 1: Hola, soy Laura."));
        assert!(cleanup_prompt("S1 [Hablante 1]: eh hola\n").ends_with("S1 [Hablante 1]: eh hola"));
    }
}
