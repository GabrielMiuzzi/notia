//! Who speaks each piece of a recording. The diarization model cuts the
//! audio where the speaker changes; each piece long enough gets a voice
//! embedding, and the pieces are grouped by average linkage on cosine
//! distance, as pyannote does. A group with little speech is not a person
//! of its own: its pieces join the closest real speaker. Pieces too short
//! for an embedding take the speaker of the nearest piece in time.
//!
//! Measured on Spanish conversations of 2 to 6 speakers through a call
//! codec (2026-10-05): the speaker count came out right in all of them and
//! under 2 % of the speech went to the wrong person, against about 20 % with
//! the diarizer's own clustering.

/// A piece of the recording and its voice embedding, when it has one.
#[derive(Debug, Clone, PartialEq)]
pub struct SpeakerPiece {
    pub start_seconds: f32,
    pub end_seconds: f32,
    pub embedding: Option<Vec<f32>>,
}

impl SpeakerPiece {
    fn seconds(&self) -> f32 {
        (self.end_seconds - self.start_seconds).max(0.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClusteringOptions {
    /// Cosine distance under which two groups are one speaker; it depends
    /// on the embedding model.
    pub threshold: f32,
    /// Shorter pieces do not vote: their embedding is too noisy.
    pub min_piece_seconds: f32,
    /// Less speech than this does not make a speaker of its own.
    pub min_speaker_seconds: f32,
    /// The number of speakers, when the person said it.
    pub speakers: Option<usize>,
}

/// Shortest piece whose embedding votes.
pub const MIN_PIECE_SECONDS: f32 = 1.0;
/// Speech a speaker needs in a long recording; a short one needs a tenth of
/// its speech, and never under `MIN_SPEAKER_FLOOR_SECONDS`.
pub const MIN_SPEAKER_SECONDS: f32 = 12.0;
const MIN_SPEAKER_FLOOR_SECONDS: f32 = 2.0;
const MIN_SPEAKER_SHARE: f32 = 0.1;

impl ClusteringOptions {
    /// The options for `pieces` clustered at `threshold`, with the speech a
    /// speaker needs scaled to how much was said.
    pub fn for_pieces(pieces: &[SpeakerPiece], threshold: f32, speakers: Option<usize>) -> Self {
        let speech = pieces.iter().map(SpeakerPiece::seconds).sum::<f32>();
        Self {
            threshold,
            min_piece_seconds: MIN_PIECE_SECONDS,
            min_speaker_seconds: (speech * MIN_SPEAKER_SHARE).clamp(MIN_SPEAKER_FLOOR_SECONDS, MIN_SPEAKER_SECONDS),
            speakers,
        }
    }
}

/// Lowest threshold tried when the person said more speakers than found.
const MIN_THRESHOLD: f32 = 0.1;
const THRESHOLD_STEP: f32 = 0.05;

/// The speaker of each piece, numbered from 0 in order of appearance.
pub fn cluster_speakers(pieces: &[SpeakerPiece], options: ClusteringOptions) -> Vec<usize> {
    let reliable: Vec<usize> = (0..pieces.len())
        .filter(|&index| pieces[index].embedding.is_some() && pieces[index].seconds() >= options.min_piece_seconds)
        .collect();
    if reliable.is_empty() {
        return vec![0; pieces.len()];
    }
    let vectors: Vec<Vec<f32>> = reliable.iter().map(|&index| unit(pieces[index].embedding.as_deref().unwrap_or_default())).collect();
    let seconds: Vec<f32> = reliable.iter().map(|&index| pieces[index].seconds()).collect();
    let groups = match options.speakers {
        None => agglomerate(&vectors, options.threshold, |_| false),
        Some(count) => groups_for_count(&vectors, &seconds, options, count.max(1)),
    };
    let labels = attach_small_groups(&groups, &vectors, &seconds, options.min_speaker_seconds);
    let mut result = vec![usize::MAX; pieces.len()];
    for (position, &index) in reliable.iter().enumerate() {
        result[index] = labels[position];
    }
    for index in 0..pieces.len() {
        if result[index] == usize::MAX {
            let nearest = reliable.iter().min_by_key(|&&other| other.abs_diff(index)).copied().unwrap_or(index);
            result[index] = result.get(nearest).copied().filter(|label| *label != usize::MAX).unwrap_or(0);
        }
    }
    renumber(result)
}

fn unit(vector: &[f32]) -> Vec<f32> {
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm <= f32::EPSILON {
        return vector.to_vec();
    }
    vector.iter().map(|value| value / norm).collect()
}

fn cosine_distance(left: &[f32], right: &[f32]) -> f32 {
    1.0 - left.iter().zip(right).map(|(a, b)| a * b).sum::<f32>()
}

/// Average linkage: merges the two closest groups while they are closer
/// than `threshold`, or while `keep_merging` says so. Returns the members
/// of each group.
fn agglomerate(vectors: &[Vec<f32>], threshold: f32, mut keep_merging: impl FnMut(&[Vec<usize>]) -> bool) -> Vec<Vec<usize>> {
    let count = vectors.len();
    let mut distance = vec![vec![0.0_f32; count]; count];
    for i in 0..count {
        for j in i + 1..count {
            let value = cosine_distance(&vectors[i], &vectors[j]);
            distance[i][j] = value;
            distance[j][i] = value;
        }
    }
    let mut groups: Vec<Vec<usize>> = (0..count).map(|index| vec![index]).collect();
    let mut alive: Vec<usize> = (0..count).collect();
    while alive.len() > 1 {
        let mut best = (f32::MAX, 0, 0);
        for (position, &i) in alive.iter().enumerate() {
            for &j in &alive[position + 1..] {
                if distance[i][j] < best.0 {
                    best = (distance[i][j], i, j);
                }
            }
        }
        let current: Vec<Vec<usize>> = alive.iter().map(|&index| groups[index].clone()).collect();
        if best.0 > threshold && !keep_merging(&current) {
            break;
        }
        let (_, keep, drop) = best;
        let (keep_size, drop_size) = (groups[keep].len() as f32, groups[drop].len() as f32);
        for &other in &alive {
            if other != keep && other != drop {
                let merged = (keep_size * distance[keep][other] + drop_size * distance[drop][other]) / (keep_size + drop_size);
                distance[keep][other] = merged;
                distance[other][keep] = merged;
            }
        }
        let moved = std::mem::take(&mut groups[drop]);
        groups[keep].extend(moved);
        alive.retain(|&index| index != drop);
    }
    alive.into_iter().map(|index| std::mem::take(&mut groups[index])).collect()
}

fn speakers_in(groups: &[Vec<usize>], seconds: &[f32], min_speaker_seconds: f32) -> usize {
    groups
        .iter()
        .filter(|group| group.iter().map(|&member| seconds[member]).sum::<f32>() >= min_speaker_seconds)
        .count()
        .max(1)
}

/// Groups for a known number of speakers: the highest threshold that still
/// finds that many, then merging until there are no more than that.
fn groups_for_count(vectors: &[Vec<f32>], seconds: &[f32], options: ClusteringOptions, count: usize) -> Vec<Vec<usize>> {
    let mut threshold = options.threshold;
    let mut groups = agglomerate(vectors, threshold, |_| false);
    while speakers_in(&groups, seconds, options.min_speaker_seconds) < count && threshold > MIN_THRESHOLD {
        threshold = (threshold - THRESHOLD_STEP).max(MIN_THRESHOLD);
        groups = agglomerate(vectors, threshold, |_| false);
    }
    agglomerate(vectors, threshold, |current| speakers_in(current, seconds, options.min_speaker_seconds) > count)
}

/// A label per vector: groups with enough speech are speakers; the members
/// of the others join the speaker whose voice is closest.
fn attach_small_groups(groups: &[Vec<usize>], vectors: &[Vec<f32>], seconds: &[f32], min_speaker_seconds: f32) -> Vec<usize> {
    let speech = |group: &Vec<usize>| group.iter().map(|&member| seconds[member]).sum::<f32>();
    let mut big: Vec<usize> = (0..groups.len()).filter(|&index| speech(&groups[index]) >= min_speaker_seconds).collect();
    if big.is_empty() {
        let largest = (0..groups.len()).max_by(|&a, &b| speech(&groups[a]).total_cmp(&speech(&groups[b]))).unwrap_or(0);
        big.push(largest);
    }
    let centroids: Vec<Vec<f32>> = big
        .iter()
        .map(|&group| {
            let mut sum = vec![0.0_f32; vectors[0].len()];
            for &member in &groups[group] {
                for (total, value) in sum.iter_mut().zip(&vectors[member]) {
                    *total += value * seconds[member];
                }
            }
            unit(&sum)
        })
        .collect();
    let mut labels = vec![0; vectors.len()];
    for (index, group) in groups.iter().enumerate() {
        for &member in group {
            labels[member] = match big.iter().position(|&big_group| big_group == index) {
                Some(label) => label,
                None => (0..centroids.len())
                    .min_by(|&a, &b| cosine_distance(&vectors[member], &centroids[a]).total_cmp(&cosine_distance(&vectors[member], &centroids[b])))
                    .unwrap_or(0),
            };
        }
    }
    labels
}

fn renumber(labels: Vec<usize>) -> Vec<usize> {
    let mut seen: Vec<usize> = Vec::new();
    labels
        .into_iter()
        .map(|label| match seen.iter().position(|&known| known == label) {
            Some(position) => position,
            None => {
                seen.push(label);
                seen.len() - 1
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A voice: a direction in embedding space, with a small wobble per piece.
    fn voice(axis: usize, wobble: f32) -> Vec<f32> {
        let mut vector = vec![0.05; 8];
        vector[axis] = 1.0;
        vector[(axis + 1) % 8] += wobble;
        vector
    }

    fn piece(start: f32, seconds: f32, embedding: Option<Vec<f32>>) -> SpeakerPiece {
        SpeakerPiece { start_seconds: start, end_seconds: start + seconds, embedding }
    }

    const OPTIONS: ClusteringOptions = ClusteringOptions { threshold: 0.5, min_piece_seconds: 1.0, min_speaker_seconds: 12.0, speakers: None };

    #[test]
    fn two_voices_alternating_are_two_speakers() {
        let pieces: Vec<SpeakerPiece> = (0..10)
            .map(|turn| piece(turn as f32 * 6.0, 5.0, Some(voice(turn % 2, (turn as f32) * 0.02))))
            .collect();
        assert_eq!(cluster_speakers(&pieces, OPTIONS), vec![0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    }

    #[test]
    fn a_stray_group_with_little_speech_joins_the_closest_speaker() {
        let mut pieces: Vec<SpeakerPiece> = (0..8).map(|turn| piece(turn as f32 * 6.0, 5.0, Some(voice(turn % 2, 0.0)))).collect();
        // A 3 s noisy piece that looks like no one, but nearer to voice 1.
        let mut odd = voice(5, 0.0);
        odd[1] = 0.6;
        pieces.insert(3, piece(15.0, 3.0, Some(odd)));
        let labels = cluster_speakers(&pieces, OPTIONS);
        assert_eq!(labels.iter().collect::<std::collections::BTreeSet<_>>().len(), 2);
        assert_eq!(labels[3], labels[1]);
    }

    #[test]
    fn short_pieces_take_the_speaker_next_to_them() {
        let pieces = vec![
            piece(0.0, 13.0, Some(voice(0, 0.0))),
            piece(13.5, 0.6, None),
            piece(14.5, 0.8, Some(voice(1, 0.0))),
            piece(16.0, 13.0, Some(voice(1, 0.0))),
        ];
        assert_eq!(cluster_speakers(&pieces, OPTIONS), vec![0, 0, 1, 1]);
    }

    #[test]
    fn a_known_number_of_speakers_is_honoured() {
        // Three voices; two of them close enough to merge at the default threshold.
        let mut close = voice(0, 0.0);
        close[1] = 0.9;
        let voices = [voice(0, 0.0), close, voice(4, 0.0)];
        let pieces: Vec<SpeakerPiece> = (0..12).map(|turn| piece(turn as f32 * 6.0, 5.0, Some(voices[turn % 3].clone()))).collect();
        let found = |options: ClusteringOptions| cluster_speakers(&pieces, options).into_iter().collect::<std::collections::BTreeSet<_>>().len();
        assert_eq!(found(ClusteringOptions { threshold: 0.6, ..OPTIONS }), 2);
        assert_eq!(found(ClusteringOptions { threshold: 0.6, speakers: Some(3), ..OPTIONS }), 3);
        assert_eq!(found(ClusteringOptions { speakers: Some(1), ..OPTIONS }), 1);
    }

    /// Clusters the pieces the diarization probe dumped
    /// (`<conv>.reseg-<model>.emb.json` in `NOTIA_CLUSTER_PROBE_DIR`) and
    /// writes `<conv>.rust-<model>-<threshold|k>.diar.txt`.
    #[test]
    #[ignore = "requires NOTIA_CLUSTER_PROBE_DIR"]
    fn clusters_probe_embeddings() {
        let Ok(dir) = std::env::var("NOTIA_CLUSTER_PROBE_DIR") else {
            return;
        };
        let threshold: f32 = std::env::var("NOTIA_CLUSTER_THRESHOLD").ok().and_then(|value| value.parse().ok()).unwrap_or(0.5);
        for entry in std::fs::read_dir(&dir).expect("dir").flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some((conv, model)) = name.strip_suffix(".emb.json").and_then(|stem| stem.split_once(".reseg-")) else {
                continue;
            };
            let value: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(entry.path()).expect("read")).expect("json");
            let pieces: Vec<SpeakerPiece> = value
                .as_array()
                .expect("array")
                .iter()
                .map(|item| SpeakerPiece {
                    start_seconds: item["start"].as_f64().unwrap_or_default() as f32,
                    end_seconds: item["end"].as_f64().unwrap_or_default() as f32,
                    embedding: item["embedding"].as_array().map(|values| values.iter().map(|v| v.as_f64().unwrap_or_default() as f32).collect()),
                })
                .collect();
            let count = std::fs::read_to_string(std::path::Path::new(&dir).join(format!("{conv}.speakers.txt"))).ok().and_then(|text| text.trim().parse().ok());
            for (tag, speakers) in [(format!("{threshold}"), None), ("k".to_string(), count)] {
                let labels = cluster_speakers(&pieces, ClusteringOptions { threshold, speakers, ..OPTIONS });
                let lines: Vec<String> = pieces.iter().zip(&labels).map(|(piece, label)| format!("{:.2} {:.2} {label}", piece.start_seconds, piece.end_seconds)).collect();
                std::fs::write(std::path::Path::new(&dir).join(format!("{conv}.rust-{model}-{tag}.diar.txt")), lines.join("\n")).expect("write");
            }
        }
    }

    #[test]
    fn a_short_recording_keeps_a_speaker_who_said_little() {
        // One minute: Ana talks 48 s, Beto 9 s. Beto is a tenth of it.
        let mut pieces: Vec<SpeakerPiece> = (0..8).map(|turn| piece(turn as f32 * 7.0, 6.0, Some(voice(0, 0.0)))).collect();
        pieces.push(piece(57.0, 4.5, Some(voice(4, 0.0))));
        pieces.push(piece(62.0, 4.5, Some(voice(4, 0.0))));
        let options = ClusteringOptions::for_pieces(&pieces, 0.5, None);
        assert!((options.min_speaker_seconds - 5.7).abs() < 0.01, "{options:?}");
        assert_eq!(cluster_speakers(&pieces, options)[8..], [1, 1]);
        // Hours of speech still ask a speaker for 12 s.
        let long: Vec<SpeakerPiece> = (0..1_000).map(|turn| piece(turn as f32 * 10.0, 9.0, None)).collect();
        assert_eq!(ClusteringOptions::for_pieces(&long, 0.5, None).min_speaker_seconds, MIN_SPEAKER_SECONDS);
    }

    #[test]
    fn nothing_to_compare_is_one_speaker() {
        assert_eq!(cluster_speakers(&[piece(0.0, 0.5, None), piece(1.0, 0.5, None)], OPTIONS), vec![0, 0]);
        assert!(cluster_speakers(&[], OPTIONS).is_empty());
    }
}
