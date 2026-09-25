//! Spanish text repairs shared by every ASR engine. Models often omit the
//! opening question mark and close a chunk with a period that the next chunk
//! continues in lowercase. Parakeet also picks the language of each chunk by
//! itself and sometimes writes Spanish speech in English.

pub fn normalize_spanish_transcript(text: &str) -> String {
    normalize_spanish_chunk_punctuation(&normalize_spanish_questions(text))
}

fn normalize_spanish_questions(text: &str) -> String {
    const QUESTION_STARTERS: &[&str] = &[
        "acaso", "adonde", "adónde", "como", "cómo", "cual", "cuál", "cuando", "cuándo", "cuanto",
        "cuánto", "donde", "dónde", "es", "esta", "está", "estan", "están", "hay", "puede",
        "pueden", "podria", "podría", "podrian", "podrían", "por", "que", "qué", "quien", "quién",
        "quiere", "quieren", "tiene", "tienen",
    ];

    let mut normalized = text.to_string();
    let mut search_from = 0;
    while let Some(relative_end) = normalized[search_from..].find('?') {
        let question_end = search_from + relative_end;
        let clause_start = normalized[..question_end]
            .char_indices()
            .rev()
            .find(|(_, character)| matches!(character, '.' | '!' | '?' | '\n'))
            .map_or(0, |(index, character)| index + character.len_utf8());
        let leading_whitespace = normalized[clause_start..question_end]
            .find(|character: char| !character.is_whitespace())
            .map_or(question_end, |offset| clause_start + offset);
        if normalized[leading_whitespace..question_end].contains('¿') {
            search_from = question_end + 1;
            continue;
        }

        let mut insertion = None;
        for (offset, word) in word_spans(&normalized[leading_whitespace..question_end]) {
            let index = leading_whitespace + offset;
            let starts_uppercase = word.chars().next().is_some_and(char::is_uppercase);
            let lowercase_word = word.to_lowercase();
            let is_question_starter = QUESTION_STARTERS
                .iter()
                .any(|starter| lowercase_word == *starter);
            if index > leading_whitespace && starts_uppercase && is_question_starter {
                insertion = Some(index);
            }
        }

        if let Some(index) = insertion {
            let whitespace_start = normalized[..index]
                .char_indices()
                .rev()
                .take_while(|(_, character)| character.is_whitespace())
                .last()
                .map_or(index, |(position, _)| position);
            normalized.replace_range(whitespace_start..index, ". ¿");
            search_from = question_end + 4;
        } else {
            normalized.insert(leading_whitespace, '¿');
            search_from = question_end + 3;
        }
    }
    normalized
}

fn normalize_spanish_chunk_punctuation(text: &str) -> String {
    const COMMA_CONNECTORS: &[&str] = &["aunque", "pero", "porque", "pues", "sino"];
    let mut normalized = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(relative_period) = text[cursor..].find('.') {
        let period = cursor + relative_period;
        normalized.push_str(&text[cursor..period]);
        let after_period = period + 1;
        let Some(relative_next) =
            text[after_period..].find(|character: char| !character.is_whitespace())
        else {
            normalized.push('.');
            cursor = after_period;
            break;
        };
        let next = after_period + relative_next;
        let next_character = text[next..].chars().next();
        if !next_character.is_some_and(char::is_lowercase) {
            normalized.push('.');
            cursor = after_period;
            continue;
        }
        let next_word = word_spans(&text[next..])
            .first()
            .map(|(_, word)| word.to_lowercase())
            .unwrap_or_default();
        if COMMA_CONNECTORS.contains(&next_word.as_str()) {
            normalized.push(',');
        }
        cursor = after_period;
    }
    normalized.push_str(&text[cursor..]);
    normalized
}

// Short words that only one of the two languages uses. Words both use or that
// Spanish speakers borrow ("no", "a", "ok", "okay") are left out.
const ENGLISH_MARKERS: &[&str] = &[
    "the", "and", "of", "to", "is", "are", "was", "were", "be", "been", "it", "you", "we", "they",
    "i", "this", "that", "what", "with", "have", "has", "had", "will", "would", "can", "could",
    "should", "not", "just", "for", "on", "in", "at", "my", "your", "our", "their", "there",
    "but", "if", "about", "know", "think", "going", "so", "do", "does", "did", "how", "why",
    "when", "where", "which", "who", "from", "an", "all", "get", "need", "want", "really",
];
const SPANISH_MARKERS: &[&str] = &[
    "de", "la", "que", "el", "en", "y", "los", "las", "del", "se", "por", "con", "para", "una",
    "un", "es", "lo", "como", "más", "pero", "su", "sus", "le", "les", "ya", "este", "esta",
    "esto", "eso", "esa", "ese", "porque", "cuando", "muy", "sin", "sobre", "también", "hasta",
    "hay", "donde", "desde", "todo", "nos", "entonces", "bueno", "vamos", "qué", "sí", "yo",
    "él", "ella", "tenemos", "tiene", "está", "están", "son", "fue", "hacer", "puede", "así",
    "mi", "tu", "al", "o",
];
const MIN_ENGLISH_MARKERS: usize = 3;

/// Whether a chunk transcribed while the configured language is Spanish came
/// out mostly in English: at least three English words and more than twice
/// as many as Spanish ones. A Spanish sentence with some English terms or an
/// English quote inside it is still Spanish.
pub fn looks_english(text: &str) -> bool {
    let (mut english, mut spanish) = (0, 0);
    for (_, word) in word_spans(text) {
        let word = word.to_lowercase();
        english += usize::from(ENGLISH_MARKERS.contains(&word.as_str()));
        spanish += usize::from(SPANISH_MARKERS.contains(&word.as_str()));
    }
    english >= MIN_ENGLISH_MARKERS && english > spanish * 2
}

pub fn word_count(text: &str) -> usize {
    word_spans(text).len()
}

fn word_spans(text: &str) -> Vec<(usize, &str)> {
    let mut spans = Vec::new();
    let mut word_start = None;
    for (index, character) in text.char_indices() {
        if character.is_alphanumeric() {
            word_start.get_or_insert(index);
        } else if let Some(start) = word_start.take() {
            spans.push((start, &text[start..index]));
        }
    }
    if let Some(start) = word_start {
        spans.push((start, &text[start..]));
    }
    spans
}

#[cfg(test)]
mod tests {
    use super::{
        looks_english, normalize_spanish_chunk_punctuation, normalize_spanish_questions,
        normalize_spanish_transcript,
    };

    #[test]
    fn tells_a_chunk_written_in_english_from_spanish_with_english_terms() {
        assert!(looks_english(
            "Today we are going to review the deploy of the backend and see the tickets."
        ));
        assert!(looks_english("Thanks. That sounds good to me. I will send the report tomorrow."));
        assert!(!looks_english(
            "Hoy vamos a revisar el deploy del backend y después vemos los tickets del sprint."
        ));
        assert!(!looks_english(
            "El cliente nos dijo, textualmente, we really need this by Friday, así que hay que reorganizar el trabajo."
        ));
        assert!(!looks_english(
            "Le pregunté al proveedor y me respondió the new version will be ready next week, but we still need to test the integration. Entonces yo creo que tenemos que esperar antes de avanzar con la migración."
        ));
        // Too few words to tell.
        assert!(!looks_english("Okay, so"));
        assert!(!looks_english("Data Pipeline."));
    }

    #[test]
    fn adds_the_opening_mark_to_spanish_questions() {
        assert_eq!(
            normalize_spanish_questions("Tiene usted un sistema de ahorro de agua?"),
            "¿Tiene usted un sistema de ahorro de agua?"
        );
    }

    #[test]
    fn separates_a_capitalized_question_detected_inside_a_transcript() {
        assert_eq!(
            normalize_spanish_questions(
                "Lo utilizo para regar las plantas y no consumir agua Tiene usted un sistema de ahorro de agua? Sí."
            ),
            "Lo utilizo para regar las plantas y no consumir agua. ¿Tiene usted un sistema de ahorro de agua? Sí."
        );
    }

    #[test]
    fn preserves_questions_that_are_already_well_formed() {
        assert_eq!(
            normalize_spanish_questions("¿Cómo está? Bien."),
            "¿Cómo está? Bien."
        );
    }

    #[test]
    fn removes_false_periods_before_lowercase_chunk_continuations() {
        assert_eq!(
            normalize_spanish_chunk_punctuation(
                "preguntas sobre el ahorro. y contaminación del agua."
            ),
            "preguntas sobre el ahorro y contaminación del agua."
        );
        assert_eq!(
            normalize_spanish_chunk_punctuation(
                "Hay muchos factores. pero sobre todo está el ser humano."
            ),
            "Hay muchos factores, pero sobre todo está el ser humano."
        );
    }

    #[test]
    fn combines_both_repairs() {
        assert_eq!(
            normalize_spanish_transcript("Hay agua. pero no alcanza. Tiene usted un tanque?"),
            "Hay agua, pero no alcanza. ¿Tiene usted un tanque?"
        );
    }
}
