//! Búsqueda por palabras para las herramientas del asistente: cada palabra
//! de la consulta se busca por separado en todo el texto de un elemento,
//! sin acentos, sin conectores («de», «con»…) y sin plurales, así
//! «mancuernas glúteo» encuentra una ficha con mancuernas que trabaja los
//! glúteos y «yogur granola» una receta que lleva los dos.

/// Words that do not narrow a search.
const STOPWORDS: [&str; 19] = ["de", "del", "con", "y", "e", "o", "u", "al", "a", "la", "el", "los", "las", "en", "un", "una", "para", "por", "que"];

/// Text folded for comparisons: lower case, without accents.
pub fn fold(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| match character {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            other => other,
        })
        .collect()
}

/// The words of a query that are searched, folded and in singular.
pub fn query_terms(query: &str) -> Vec<String> {
    let mut terms = Vec::<String>::new();
    for word in fold(query).split(|character: char| !character.is_alphanumeric()) {
        if word.is_empty() || STOPWORDS.contains(&word) {
            continue;
        }
        // «glúteos» finds «glúteo» and «mancuernas» finds «mancuerna».
        let term = if word.chars().count() > 3 { word.strip_suffix('s').unwrap_or(word) } else { word };
        if !terms.iter().any(|existing| existing == term) {
            terms.push(term.to_string());
        }
    }
    terms
}

/// How many terms appear in a folded text.
pub fn hits(terms: &[String], folded: &str) -> usize {
    terms.iter().filter(|term| folded.contains(term.as_str())).count()
}

/// What a search found.
pub struct Ranked<'a, T> {
    pub items: Vec<&'a T>,
    /// No item had every word: these have some, the most first.
    pub partial: bool,
}

/// The items whose text (`text` returns it folded) has every term, in their
/// order. When none has them all, the ones with some, the most first.
pub fn rank<'a, T>(items: impl IntoIterator<Item = &'a T>, terms: &[String], text: impl Fn(&T) -> String) -> Ranked<'a, T> {
    let scored = items.into_iter().map(|item| (hits(terms, &text(item)), item)).collect::<Vec<_>>();
    if terms.is_empty() {
        return Ranked { items: scored.into_iter().map(|(_, item)| item).collect(), partial: false };
    }
    let complete = scored.iter().filter(|(count, _)| *count == terms.len()).map(|(_, item)| *item).collect::<Vec<_>>();
    if !complete.is_empty() || terms.len() == 1 {
        return Ranked { items: complete, partial: false };
    }
    let mut some = scored.into_iter().filter(|(count, _)| *count > 0).collect::<Vec<_>>();
    some.sort_by(|a, b| b.0.cmp(&a.0));
    Ranked { partial: !some.is_empty(), items: some.into_iter().map(|(_, item)| item).collect() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_query_drops_connectors_accents_and_plurals() {
        assert_eq!(query_terms("Máquina de glúteos"), ["maquina", "gluteo"]);
        assert_eq!(query_terms("mancuernas, glúteo y glúteos"), ["mancuerna", "gluteo"]);
        assert_eq!(query_terms("  de la  "), Vec::<String>::new());
        // Short words keep their s.
        assert_eq!(query_terms("tres"), ["tre"]);
        assert_eq!(query_terms("gas"), ["gas"]);
    }

    #[test]
    fn every_word_is_searched_apart_and_some_words_are_the_fallback() {
        let items = ["Patada de glúteo en polea", "Patada de glúteo", "Remo con mancuernas", "Sentadilla"];
        let text = |item: &&str| fold(item);
        let found = rank(items.iter(), &query_terms("patada glúteo"), text);
        assert_eq!(found.items, [&items[0], &items[1]]);
        assert!(!found.partial);
        // No item has both words: the ones with one, best first.
        let found = rank(items.iter(), &query_terms("máquina de glúteos"), text);
        assert_eq!(found.items, [&items[0], &items[1]]);
        assert!(found.partial);
        let found = rank(items.iter(), &query_terms("polea remo"), text);
        assert_eq!(found.items, [&items[0], &items[2]]);
        // One word that nothing has finds nothing.
        let found = rank(items.iter(), &query_terms("barra"), text);
        assert!(found.items.is_empty() && !found.partial);
        assert_eq!(rank(items.iter(), &[], text).items.len(), 4);
    }
}
