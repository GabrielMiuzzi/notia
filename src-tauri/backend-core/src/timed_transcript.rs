//! The final pass of a recording: words with their time, from the timed
//! tokens of the whisper.cpp bridge, and the live line each one belongs to.

/// A word and when it was said (ms of the recording).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimedWord {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

/// The words of the bridge's timed tokens: one line per token,
/// `start\tend\ttext`, in hundredths of a second from the start of the
/// decoded audio, which begins at `offset_ms`. A token that begins with a
/// space starts a word; the bytes of a word are joined before reading them
/// as text, because whisper.cpp may split one accented letter between two
/// tokens. A word starts at its first letter: Whisper times a leading «—»,
/// «¡» or «¿» at the end of the previous phrase. It ends at the latest where
/// the next one starts.
pub fn words_from_timed_tokens(raw: &[u8], offset_ms: u64) -> Vec<TimedWord> {
    let mut words = Vec::new();
    // Start, end, bytes and whether a letter has been timed yet.
    let mut current: Option<(u64, u64, Vec<u8>, bool)> = None;
    let finish = |word: Option<(u64, u64, Vec<u8>, bool)>, words: &mut Vec<TimedWord>| {
        if let Some((start_ms, end_ms, bytes, _)) = word {
            let text = String::from_utf8_lossy(&bytes).trim().to_string();
            if !text.is_empty() {
                words.push(TimedWord { start_ms, end_ms: end_ms.max(start_ms), text });
            }
        }
    };
    for line in raw.split(|&byte| byte == b'\n') {
        let mut fields = line.splitn(3, |&byte| byte == b'\t');
        let (Some(start), Some(end), Some(text)) = (fields.next(), fields.next(), fields.next()) else {
            continue;
        };
        let centiseconds = |field: &[u8]| std::str::from_utf8(field).ok().and_then(|value| value.trim().parse::<i64>().ok()).unwrap_or(0).max(0) as u64;
        let start_ms = offset_ms + centiseconds(start) * 10;
        let end_ms = offset_ms + centiseconds(end) * 10;
        let starts_word = text.first() == Some(&b' ');
        let lettered = has_letter(text);
        match current.as_mut() {
            Some((word_start, word_end, bytes, timed)) if !starts_word => {
                if lettered && !*timed {
                    *word_start = start_ms;
                    *timed = true;
                }
                *word_end = (*word_end).max(end_ms);
                bytes.extend_from_slice(text);
            }
            _ => {
                finish(current.take(), &mut words);
                current = Some((start_ms, end_ms, text.to_vec(), lettered));
            }
        }
    }
    finish(current.take(), &mut words);
    let starts = words.iter().skip(1).map(|word| word.start_ms).collect::<Vec<_>>();
    for (word, next_start) in words.iter_mut().zip(starts) {
        if next_start > word.start_ms {
            word.end_ms = word.end_ms.min(next_start);
        }
    }
    words
}

/// Whether a token holds a letter or a digit: ASCII, or the lead byte of an
/// accented Latin letter (`á`, `ñ`...), which punctuation such as `¿` or `—`
/// never uses.
fn has_letter(token: &[u8]) -> bool {
    token.iter().any(|byte| byte.is_ascii_alphanumeric() || *byte == 0xC3)
}

/// The words of each span (ms of the recording, in order): a word belongs to
/// the span that holds its start, else to the nearest one. Spans are the live
/// lines, cut where the voice detector heard a pause.
pub fn words_by_span(words: &[TimedWord], spans: &[(u64, u64)]) -> Vec<Vec<TimedWord>> {
    let mut grouped = vec![Vec::new(); spans.len()];
    for word in words {
        let distance = |&(start, end): &(u64, u64)| {
            if word.start_ms < start {
                start - word.start_ms
            } else {
                word.start_ms.saturating_sub(end)
            }
        };
        if let Some((index, _)) = spans.iter().enumerate().min_by_key(|(_, span)| distance(span)) {
            grouped[index].push(word.clone());
        }
    }
    grouped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_become_words_even_when_an_accent_is_split() {
        // "¿Qué tal?" with the "é" (C3 A9) split across two tokens.
        let mut raw = b"0\t50\t \xC2\xBFQu\n20\t30\t\xC3\n30\t40\t\xA9\n40\t80\t tal\n80\t90\t?\n".to_vec();
        raw.extend_from_slice(b"garbage line\n");
        let words = words_from_timed_tokens(&raw, 1_000);
        assert_eq!(
            words,
            vec![
                TimedWord { start_ms: 1_000, end_ms: 1_400, text: "¿Qué".into() },
                TimedWord { start_ms: 1_400, end_ms: 1_900, text: "tal?".into() },
            ]
        );
        // "¿Qué" ended at 50 by its first token, after "tal?" started at 40.
        assert!(words_from_timed_tokens(b"", 0).is_empty());
        // "—¡Ser": the dash and "¡" are timed before the pause, the word after it.
        let dashed = words_from_timed_tokens(b"0\t40\t loro.\n50\t80\t \xE2\x80\x94\xC2\xA1\n180\t220\tSer\n", 0);
        assert_eq!(dashed[1], TimedWord { start_ms: 1_800, end_ms: 2_200, text: "—¡Ser".into() });
    }

    #[test]
    fn each_word_goes_to_the_line_that_holds_its_start() {
        let word = |start: u64, end: u64, text: &str| TimedWord { start_ms: start, end_ms: end, text: text.into() };
        let words = [
            word(100, 400, "Sí,"),
            word(400, 900, "claro."),
            // In the pause between the lines: nearer the second one.
            word(1_300, 1_500, "¿Y"),
            word(1_600, 1_900, "vos?"),
            word(4_000, 4_300, "Listo."),
        ];
        let lines = word_texts(words_by_span(&words, &[(0, 1_000), (1_400, 2_000)]));
        assert_eq!(lines, vec![vec!["Sí,", "claro."], vec!["¿Y", "vos?", "Listo."]]);
        assert!(words_by_span(&words, &[]).is_empty());
    }

    fn word_texts(groups: Vec<Vec<TimedWord>>) -> Vec<Vec<String>> {
        groups.into_iter().map(|group| group.into_iter().map(|word| word.text).collect()).collect()
    }
}
