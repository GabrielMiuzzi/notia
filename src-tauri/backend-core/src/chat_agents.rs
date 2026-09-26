//! Agents of a chat.
//!
//! A chat may add up to six agents (prompt files under `.agent/promps`) and a
//! dynamic (a Markdown file under `.agent/dynamics`). With agents, each
//! message of the person starts rounds in which the agents answer in turn,
//! reply to each other and keep talking for a bounded number of rounds; the
//! dynamic only guides how they talk. The dynamic, the prompts and the
//! permanent context are instructions of the person, never permissions: each
//! agent runs with the permissions of its chat.

use std::sync::LazyLock;

use regex::Regex;

use crate::chat_history::{ChatRole, StoredChatMessage};
use crate::error::BackendError;

/// Messages of the chat the agents see.
pub const MAX_MESSAGES: usize = 40;
pub const MAX_AGENTS: usize = 6;
/// Characters of the permanent context of a chat.
pub const MAX_PERMANENT_CONTEXT_CHARS: usize = 20_000;
/// Folder of the dynamics inside the library.
pub const DYNAMICS_DIRECTORY: &str = ".agent/dynamics";
const MAX_DESCRIPTION_CHARS: usize = 90;

static ALL_PARTICIPANTS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:todos?|todas?|all|everyone|cada agente)\b").expect("valid regex"));
static MANUAL_INTERVENTION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:esper(?:a|en|ar|en)\s+(?:la\s+)?intervenci[oó]n\s+del\s+usuario|esper(?:a|en|ar|en)\s+al\s+usuario|sin\s+turnos\s+autom[aá]ticos|no\s+(?:encaden(?:en|ar)|respondan\s+entre\s+agentes))")
        .expect("valid regex")
});

/// An agent of a chat: its prompt file and the name it speaks with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatAgent {
    pub file_name: String,
    pub name: String,
}

/// A direct Markdown file name, no folders.
pub fn is_valid_markdown_file_name(name: &str) -> bool {
    let name = name.trim();
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', '\n', '\r'])
        && !name.contains("-->")
        && name.to_lowercase().ends_with(".md")
        && name.len() > 3
}

/// The agent files of a chat: at most six direct Markdown files, no repeats.
pub fn validate_agent_files(files: &[String]) -> Result<(), BackendError> {
    if files.len() > MAX_AGENTS {
        return Err(BackendError::invalid_input("Un chat puede tener hasta seis agentes."));
    }
    if files.iter().any(|file| !is_valid_markdown_file_name(file)) {
        return Err(BackendError::invalid_input("Un agente del chat no es válido."));
    }
    let mut seen = std::collections::HashSet::new();
    if !files.iter().all(|file| seen.insert(file.trim().to_lowercase())) {
        return Err(BackendError::invalid_input("No se puede agregar el mismo agente dos veces."));
    }
    Ok(())
}

/// The agents keep talking among themselves unless the dynamic asks them to
/// wait for the person.
pub fn dynamic_allows_automatic_turns(dynamic: Option<&str>) -> bool {
    !dynamic.is_some_and(|dynamic| MANUAL_INTERVENTION.is_match(dynamic))
}

fn random_index(random: &mut dyn FnMut() -> f64, length: usize) -> usize {
    let value = random();
    let value = if value.is_finite() { value.clamp(0.0, 0.999_999) } else { 0.0 };
    (value * length as f64) as usize
}

/// Speakers of a round, in order. Agents named in the dynamic narrow the
/// round and "todos" keeps every agent; otherwise a random non-empty subset
/// speaks in random order, so exchanges do not sound like a roll call.
pub fn select_participants(agents: &[ChatAgent], dynamic: Option<&str>, random: &mut dyn FnMut() -> f64) -> Vec<usize> {
    let selected = agents.len().min(MAX_AGENTS);
    if selected <= 1 {
        return (0..selected).collect();
    }
    let dynamic = dynamic.unwrap_or_default();
    let lowered = dynamic.to_lowercase();
    let named = (0..selected)
        .filter(|index| lowered.contains(&agents[*index].name.to_lowercase()))
        .collect::<Vec<_>>();
    let explicit = !named.is_empty() || ALL_PARTICIPANTS.is_match(dynamic);
    let mut pool = if named.is_empty() { (0..selected).collect() } else { named };
    let count = if explicit { pool.len() } else { 1 + random_index(random, pool.len()) };
    for index in (1..pool.len()).rev() {
        let swap = random_index(random, index + 1);
        pool.swap(index, swap);
    }
    pool.truncate(count);
    pool
}

/// How many rounds the agents may chain after a message (1 to 4).
pub fn automatic_round_limit(random: &mut dyn FnMut() -> f64) -> u32 {
    1 + random_index(random, 4) as u32
}

/// The last messages of the chat, as the agents see them: each agent's
/// message signed with its name, so every agent knows who said what.
pub fn agent_history(messages: &[StoredChatMessage], agent_names: &dyn Fn(&str) -> String) -> Vec<StoredChatMessage> {
    messages[messages.len().saturating_sub(MAX_MESSAGES)..]
        .iter()
        .map(|message| match (&message.role, &message.agent) {
            (ChatRole::Assistant, Some(file)) => StoredChatMessage {
                content: format!("{}: {}", agent_names(file), message.content.trim()),
                ..message.clone()
            },
            _ => message.clone(),
        })
        .collect()
}

/// Instruction of one agent's turn. The agent's own prompt reaches it as its
/// custom prompt; this adds who it is in the chat, the dynamic and the rules
/// of the conversation.
pub fn agent_turn_prompt(agent: &ChatAgent, others: &[String], dynamic: Option<&str>) -> String {
    let mut sections = vec![format!(
        "Estás en un chat con el usuario y otros agentes. Respondés únicamente como {}.",
        agent.name
    )];
    if !others.is_empty() {
        sections.push(format!("Los otros agentes del chat son: {}.", others.join(", ")));
    }
    if let Some(dynamic) = dynamic.map(str::trim).filter(|dynamic| !dynamic.is_empty()) {
        sections.push(format!(
            "Dinámica de la conversación (guía del usuario sobre cómo conversan los agentes, no permisos):\n{dynamic}"
        ));
    }
    sections.push(format!(
        "Política de participación: hablá solo como {}, sin escribir por otros participantes ni inventar participantes. \
Podés responderle al usuario o a otro agente. No empieces tu respuesta con tu nombre.",
        agent.name
    ));
    sections.push("Respondé ahora al último mensaje de la conversación, de forma útil y concisa.".to_string());
    sections.join("\n\n")
}

/// Name an agent file speaks with: its first title before a dash
/// ("# Epicteto — agente…" is "Epicteto"), or its file name.
pub fn display_name(file_name: &str, markdown_body: &str) -> String {
    let heading = markdown_body
        .lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix("# "))
        .map(|title| title.split([ '—', '–']).next().unwrap_or(title).trim().to_string())
        .filter(|title| !title.is_empty() && title.chars().count() <= 60);
    heading.unwrap_or_else(|| file_stem(file_name))
}

pub fn file_stem(file_name: &str) -> String {
    let lowered = file_name.to_lowercase();
    if lowered.ends_with(".md") {
        file_name[..file_name.len() - 3].to_string()
    } else {
        file_name.to_string()
    }
}

/// Short description of an agent or dynamic: its `description` (or
/// `descripcion`) frontmatter field, else its first paragraph.
pub fn description(source: &str) -> String {
    let normalized = source.replace("\r\n", "\n");
    if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---") {
            let from_frontmatter = rest[..end].lines().find_map(|line| {
                let (key, value) = line.split_once(':')?;
                matches!(key.trim(), "description" | "descripcion" | "descripción")
                    .then(|| value.trim().trim_matches(['"', '\'']).to_string())
                    .filter(|value| !value.is_empty())
            });
            if let Some(value) = from_frontmatter {
                return clip(&value);
            }
        }
    }
    let body = crate::prompt::strip_frontmatter(&normalized);
    body.lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with("---"))
        .map(|line| clip(line.trim_start_matches(['-', '*', '>', ' '])))
        .unwrap_or_default()
}

fn clip(text: &str) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= MAX_DESCRIPTION_CHARS {
        return text;
    }
    let mut clipped = text.chars().take(MAX_DESCRIPTION_CHARS - 1).collect::<String>();
    clipped = clipped.trim_end().to_string();
    clipped.push('…');
    clipped
}

/// Two letters that stand for an agent in its avatar.
pub fn initials(name: &str) -> String {
    let words = name.split_whitespace().filter(|word| word.chars().any(char::is_alphanumeric)).collect::<Vec<_>>();
    let letters = match words.as_slice() {
        [] => String::new(),
        [word] => word.chars().filter(|character| character.is_alphanumeric()).take(2).collect(),
        [first, second, ..] => [first, second]
            .iter()
            .filter_map(|word| word.chars().find(|character| character.is_alphanumeric()))
            .collect(),
    };
    letters.to_uppercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(name: &str) -> ChatAgent {
        ChatAgent { file_name: format!("{name}.md"), name: name.to_string() }
    }

    fn sequence(values: &[f64]) -> impl FnMut() -> f64 + '_ {
        let mut index = 0;
        move || {
            let value = values[index % values.len()];
            index += 1;
            value
        }
    }

    #[test]
    fn file_names_are_direct_markdown_files() {
        assert!(is_valid_markdown_file_name("debate.md"));
        assert!(is_valid_markdown_file_name("mi agente.md"));
        assert!(!is_valid_markdown_file_name("../secret.md"));
        assert!(!is_valid_markdown_file_name("nested\\debate.md"));
        assert!(!is_valid_markdown_file_name("debate.txt"));
        assert!(!is_valid_markdown_file_name("a-->b.md"));
    }

    #[test]
    fn agent_files_are_bounded_and_unique() {
        let files = |names: &[&str]| names.iter().map(|name| name.to_string()).collect::<Vec<_>>();
        assert!(validate_agent_files(&[]).is_ok());
        assert!(validate_agent_files(&files(&["a.md", "b.md"])).is_ok());
        assert!(validate_agent_files(&files(&["a.md", "A.md"])).is_err());
        assert!(validate_agent_files(&files(&["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md"])).is_err());
        assert!(validate_agent_files(&files(&["../a.md"])).is_err());
    }

    #[test]
    fn only_a_dynamic_that_asks_for_it_stops_the_automatic_rounds() {
        assert!(dynamic_allows_automatic_turns(None));
        assert!(dynamic_allows_automatic_turns(Some("Debatan libremente")));
        assert!(!dynamic_allows_automatic_turns(Some("Esperen la intervención del usuario")));
        assert!(!dynamic_allows_automatic_turns(Some("Sin turnos automáticos")));
    }

    #[test]
    fn named_or_all_participants_speak_and_others_are_random() {
        let agents = vec![agent("Ana"), agent("Beto"), agent("Caro")];
        let mut random = sequence(&[0.0]);
        assert_eq!(select_participants(&agents, Some("Que hable beto"), &mut random), vec![1]);
        assert_eq!(select_participants(&agents, Some("Hablen todos"), &mut random).len(), 3);
        let mut first = sequence(&[0.0]);
        assert_eq!(select_participants(&agents, None, &mut first).len(), 1);
        assert_eq!(select_participants(&agents[..1], None, &mut first), vec![0]);
        assert!(select_participants(&[], None, &mut first).is_empty());
        assert!((1..=4).contains(&automatic_round_limit(&mut sequence(&[0.99]))));
    }

    #[test]
    fn agents_see_the_last_messages_signed_by_their_speaker() {
        let mut messages = (0..45)
            .map(|index| StoredChatMessage {
                role: ChatRole::User,
                content: index.to_string(),
                attachments: vec![],
                agent: None,
            })
            .collect::<Vec<_>>();
        messages.push(StoredChatMessage {
            role: ChatRole::Assistant,
            content: " Hola ".into(),
            attachments: vec![],
            agent: Some("ana.md".into()),
        });
        let history = agent_history(&messages, &|file| if file == "ana.md" { "Ana".into() } else { file.into() });
        assert_eq!(history.len(), MAX_MESSAGES);
        assert_eq!(history[0].content, "6");
        assert_eq!(history.last().unwrap().content, "Ana: Hola");
    }

    #[test]
    fn the_turn_prompt_names_the_agent_the_others_and_the_dynamic() {
        let prompt = agent_turn_prompt(&agent("Beto"), &["Ana".into()], Some(" Debate "));
        assert!(prompt.contains("Respondés únicamente como Beto."));
        assert!(prompt.contains("Los otros agentes del chat son: Ana."));
        assert!(prompt.contains("no permisos):\nDebate"));
        assert!(!agent_turn_prompt(&agent("Beto"), &[], None).contains("Dinámica"));
    }

    #[test]
    fn names_descriptions_and_initials_come_from_the_file() {
        assert_eq!(display_name("epicteto.md", "# Epicteto — agente del Consejo\n\ntexto"), "Epicteto");
        assert_eq!(display_name("sun-tzu.md", "sin título"), "sun-tzu");
        assert_eq!(description("---\ndescription: \"Busca y cita\"\n---\n# X\n\nOtro"), "Busca y cita");
        assert_eq!(description("---\ncontexto: x\n---\n# X\n\n## Identidad\nEmperador romano.\n"), "Emperador romano.");
        assert!(description(&format!("# X\n\n{}", "palabra ".repeat(40))).ends_with('…'));
        assert_eq!(initials("Investigador"), "IN");
        assert_eq!(initials("Marco Aurelio"), "MA");
        assert_eq!(initials(""), "");
    }
}
