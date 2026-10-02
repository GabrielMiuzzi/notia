#![cfg(any(target_os = "windows", target_os = "android"))]

//! LocalAgreement-2 (Macháček, Dabre and Bojar, 2023; `whisper_streaming`).
//! The audio of the utterance in progress is decoded again and again from its
//! start; each decode is a hypothesis of the whole utterance. The words after
//! the committed ones that two consecutive hypotheses agree on are committed,
//! and the preview never rewrites them while the utterance lasts.

#[derive(Debug, Default)]
pub struct LocalAgreement {
    committed: Vec<String>,
    /// Words of the latest hypothesis after the committed ones.
    pending: Vec<String>,
}

impl LocalAgreement {
    /// Takes a new hypothesis of the whole utterance and commits the words
    /// that follow the committed ones in both it and the previous hypothesis.
    pub fn insert(&mut self, hypothesis: &str) {
        let words = split_words(hypothesis);
        let tail = &words[committed_end(&self.committed, &words)..];
        let agreed = self
            .pending
            .iter()
            .zip(tail)
            .take_while(|(previous, current)| same_word(previous, current))
            .count();
        self.committed.extend_from_slice(&tail[..agreed]);
        self.pending = tail[agreed..].to_vec();
    }

    /// Committed words followed by the unconfirmed rest of the last hypothesis.
    pub fn preview(&self) -> String {
        self.committed.iter().chain(&self.pending).map(String::as_str).collect::<Vec<_>>().join(" ")
    }

    /// The utterance ended: `last`, a decode of all of its audio, is its
    /// text. It sees the whole utterance and searches more widely, so it is
    /// more accurate than the words committed on partial audio, which only
    /// keep the preview steady. Those words survive only when the last decode
    /// lost the speech they cover (it has fewer words), followed by what the
    /// last decode heard after them.
    pub fn finish(self, last: &str) -> String {
        let words = split_words(last);
        if words.len() >= self.committed.len() {
            return words.join(" ");
        }
        let tail = &words[committed_end(&self.committed, &words)..];
        self.committed.iter().chain(tail).map(String::as_str).collect::<Vec<_>>().join(" ")
    }
}

fn split_words(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_string).collect()
}

/// Lowercase letters and digits of a word: "¿Cómo" and "cómo," compare equal.
fn normalized(word: &str) -> String {
    word.chars().filter(|character| character.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn same_word(left: &str, right: &str) -> bool {
    normalized(left) == normalized(right)
}

/// Index of `words` right after the words that correspond to `committed`.
/// A new decode of the same audio may spell the committed part slightly
/// differently, so its prefix is aligned by word edit distance. Between equal
/// distances, the end whose last word matches the last committed word wins,
/// then the prefix whose letters are as many as the committed ones (both
/// cover the same audio), then the longer one.
fn committed_end(committed: &[String], words: &[String]) -> usize {
    if committed.is_empty() {
        return 0;
    }
    let committed = committed.iter().map(|word| normalized(word)).collect::<Vec<_>>();
    let words = words.iter().map(|word| normalized(word)).collect::<Vec<_>>();
    // distance[j]: edit distance between all of `committed` and `words[..j]`.
    let mut previous = (0..=words.len()).collect::<Vec<_>>();
    for (row, committed_word) in committed.iter().enumerate() {
        let mut current = vec![row + 1; words.len() + 1];
        for (column, word) in words.iter().enumerate() {
            let substitution = previous[column] + usize::from(committed_word != word);
            current[column + 1] = substitution.min(previous[column + 1] + 1).min(current[column] + 1);
        }
        previous = current;
    }
    let last = committed.last().expect("committed is not empty");
    let committed_letters = committed.iter().map(|word| word.chars().count()).sum::<usize>();
    let prefix_letters = std::iter::once(0)
        .chain(words.iter().scan(0, |total, word| {
            *total += word.chars().count();
            Some(*total)
        }))
        .collect::<Vec<_>>();
    (0..=words.len())
        .min_by_key(|&end| {
            let ends_on_last = end > 0 && words[end - 1] == *last;
            (
                previous[end],
                !ends_on_last,
                prefix_letters[end].abs_diff(committed_letters),
                std::cmp::Reverse(end),
            )
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{committed_end, LocalAgreement};

    fn words(text: &str) -> Vec<String> {
        text.split_whitespace().map(str::to_string).collect()
    }

    #[test]
    fn commits_only_what_two_consecutive_hypotheses_agree_on() {
        let mut agreement = LocalAgreement::default();
        agreement.insert("Hola, cómo");
        // Nothing is confirmed by a single decode.
        assert_eq!(agreement.preview(), "Hola, cómo");
        agreement.insert("Hola, ¿cómo estás");
        assert_eq!(agreement.committed, words("Hola, ¿cómo"));
        assert_eq!(agreement.preview(), "Hola, ¿cómo estás");
        agreement.insert("Hola, ¿cómo están todos?");
        // "estás" changed: it stays pending.
        assert_eq!(agreement.committed, words("Hola, ¿cómo"));
        agreement.insert("Hola, ¿cómo están todos? Bien");
        assert_eq!(agreement.committed, words("Hola, ¿cómo están todos?"));
        assert_eq!(agreement.preview(), "Hola, ¿cómo están todos? Bien");
    }

    #[test]
    fn committed_words_survive_a_hypothesis_that_rewrites_them() {
        let mut agreement = LocalAgreement::default();
        agreement.insert("vamos a ver el informe");
        agreement.insert("vamos a ver el informe de ventas");
        assert_eq!(agreement.preview(), "vamos a ver el informe de ventas");
        // A later decode writes "haber" for "a ver": the committed text stays.
        agreement.insert("vamos haber el informe de ventas del mes");
        agreement.insert("vamos haber el informe de ventas del mes pasado");
        assert_eq!(agreement.preview(), "vamos a ver el informe de ventas del mes pasado");
    }

    #[test]
    fn the_last_decode_is_the_text_unless_it_lost_committed_speech() {
        let mut agreement = LocalAgreement::default();
        agreement.insert("El jueves revisamos");
        agreement.insert("El jueves revisamos el");
        assert_eq!(agreement.finish("El jueves revisamos el presupuesto."), "El jueves revisamos el presupuesto.");

        // The whole utterance corrects a word committed on partial audio.
        let mut agreement = LocalAgreement::default();
        agreement.insert("vamos haber");
        agreement.insert("vamos haber el");
        assert_eq!(agreement.finish("Vamos a ver el informe."), "Vamos a ver el informe.");

        // Without hypotheses the last decode is the whole text.
        assert_eq!(LocalAgreement::default().finish("Hola."), "Hola.");

        // A last decode that lost speech keeps the committed words.
        let mut agreement = LocalAgreement::default();
        agreement.insert("Buen día a todos los presentes");
        agreement.insert("Buen día a todos los presentes hoy");
        assert_eq!(agreement.finish(""), "Buen día a todos los presentes");
        let mut agreement = LocalAgreement::default();
        agreement.insert("Buen día a todos los presentes");
        agreement.insert("Buen día a todos los presentes hoy");
        assert_eq!(agreement.finish("Buen día a todos los"), "Buen día a todos los presentes");
    }

    #[test]
    fn aligns_the_committed_words_inside_a_new_decode() {
        let committed = words("vamos a ver");
        assert_eq!(committed_end(&committed, &words("vamos a ver el informe")), 3);
        // A word inserted inside the committed part.
        assert_eq!(committed_end(&committed, &words("vamos eh a ver el informe")), 4);
        // Two words merged into one.
        assert_eq!(committed_end(&committed, &words("vamos haber el informe")), 2);
        // A decode shorter than the committed part.
        assert_eq!(committed_end(&committed, &words("vamos")), 1);
        assert_eq!(committed_end(&[], &words("hola")), 0);
    }
}
