//! Conversion of any capture to the mono 16 kHz audio the speech recognizer
//! works with.

/// Sample rate of the speech recognizer.
pub const RECOGNIZER_SAMPLE_RATE: u32 = 16_000;
// Everything above this frequency is removed before downsampling, so it does
// not fold back into the speech band. Whisper's log-mel features reach 8 kHz.
const CUTOFF_HZ: f64 = 7_300.0;
// Taps per unit of the downsampling ratio: 127 taps at 48 kHz, whose
// transition band ends before 8 kHz.
const TAPS_PER_RATIO: f64 = 21.0;
// Speaker positions of a Windows channel mask (`dwChannelMask`).
const SPEAKER_FRONT_LEFT: u32 = 0x1;
const SPEAKER_FRONT_RIGHT: u32 = 0x2;
const SPEAKER_FRONT_CENTER: u32 = 0x4;

/// Weight of each channel of a frame in the mono speech the recognizer
/// hears. Speech lives in the front left, front right and center channels;
/// the bass (LFE) and the surround channels of a 5.1 or 7.1 output carry no
/// words, and a virtual surround fills them with delayed or filtered copies
/// that blur the voice, so they are left out. Each front channel weighs a
/// half, so a call playing in the front pair keeps its level. Without a
/// channel mask the first two channels are taken as front left and right.
pub fn speech_downmix_weights(channels: u16, channel_mask: Option<u32>) -> Vec<f32> {
    let channels = usize::from(channels.max(1));
    if channels == 1 {
        return vec![1.0];
    }
    let positions: Vec<u32> = channel_mask
        .map(|mask| (0..32).map(|bit| 1_u32 << bit).filter(|position| mask & position != 0).collect())
        .unwrap_or_default();
    let mut weights = if positions.len() == channels {
        positions
            .iter()
            .map(|position| match *position {
                SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER => 0.5,
                _ => 0.0,
            })
            .collect::<Vec<f32>>()
    } else {
        (0..channels).map(|index| if index < 2 { 0.5 } else { 0.0 }).collect()
    };
    if weights.iter().all(|weight| *weight == 0.0) {
        let even = 1.0 / channels as f32;
        weights.iter_mut().for_each(|weight| *weight = even);
    }
    weights
}

/// Converts one source to mono 16 kHz as its buffers arrive. Above 16 kHz a
/// low-pass FIR removes what would fold into the speech band, then the
/// band-limited signal is interpolated linearly. It keeps its state between
/// buffers (the filter history and the position between two input samples),
/// so buffers of any size join without clicks or drift.
pub struct StreamResampler {
    /// Weight of each channel of a frame in the mono signal.
    weights: Vec<f32>,
    /// Input samples per output sample.
    step: f64,
    /// Low-pass FIR, empty when the source does not need downsampling.
    taps: Vec<f32>,
    /// Last `taps.len()` mono input samples, oldest first from `next_slot`.
    history: Vec<f32>,
    next_slot: usize,
    started: bool,
    previous: f32,
    /// Position of the next output sample after `previous`, in input samples.
    position: f64,
}

impl StreamResampler {
    pub fn new(channels: u16, input_sample_rate: u32) -> Self {
        Self::with_channel_mask(channels, None, input_sample_rate)
    }

    /// A source whose channels follow `channel_mask` (Windows speaker
    /// positions): see [`speech_downmix_weights`].
    pub fn with_channel_mask(channels: u16, channel_mask: Option<u32>, input_sample_rate: u32) -> Self {
        let step = f64::from(input_sample_rate.max(1)) / f64::from(RECOGNIZER_SAMPLE_RATE);
        let taps = if step > 1.0 { low_pass_taps(input_sample_rate, step) } else { Vec::new() };
        Self {
            weights: speech_downmix_weights(channels, channel_mask),
            step,
            history: vec![0.0; taps.len()],
            taps,
            next_slot: 0,
            started: false,
            previous: 0.0,
            position: 0.0,
        }
    }

    pub fn process(&mut self, interleaved_samples: &[f32]) -> Vec<f32> {
        let channels = self.weights.len();
        let frames = interleaved_samples.len() / channels;
        let mut output = Vec::with_capacity((frames as f64 / self.step) as usize + 1);
        for frame in interleaved_samples.chunks_exact(channels) {
            let mono = frame.iter().zip(&self.weights).map(|(sample, weight)| sample * weight).sum::<f32>();
            if !self.started {
                // The recording starts at its first level instead of rising from silence.
                self.started = true;
                self.history.fill(mono);
                let current = self.filter(mono);
                output.push(current);
                self.previous = current;
                self.position = self.step;
                continue;
            }
            let current = self.filter(mono);
            while self.position <= 1.0 {
                output.push(self.previous + (current - self.previous) * self.position as f32);
                self.position += self.step;
            }
            self.position -= 1.0;
            self.previous = current;
        }
        output
    }

    fn filter(&mut self, sample: f32) -> f32 {
        if self.taps.is_empty() {
            return sample;
        }
        self.history[self.next_slot] = sample;
        self.next_slot = (self.next_slot + 1) % self.history.len();
        let (newer, older) = self.history.split_at(self.next_slot);
        // The taps are symmetric, so their order against the history does not matter.
        older
            .iter()
            .chain(newer)
            .zip(&self.taps)
            .map(|(sample, tap)| sample * tap)
            .sum()
    }
}

/// Hamming-windowed sinc low-pass with unit gain at 0 Hz.
fn low_pass_taps(input_sample_rate: u32, step: f64) -> Vec<f32> {
    let count = 2 * (TAPS_PER_RATIO * step).round() as usize + 1;
    let cutoff = CUTOFF_HZ / f64::from(input_sample_rate);
    let middle = (count / 2) as f64;
    let taps = (0..count)
        .map(|index| {
            let offset = index as f64 - middle;
            let sinc = if offset == 0.0 {
                2.0 * cutoff
            } else {
                (2.0 * std::f64::consts::PI * cutoff * offset).sin() / (std::f64::consts::PI * offset)
            };
            let window = 0.54 - 0.46 * (2.0 * std::f64::consts::PI * index as f64 / (count - 1) as f64).cos();
            sinc * window
        })
        .collect::<Vec<_>>();
    let gain = taps.iter().sum::<f64>();
    taps.into_iter().map(|tap| (tap / gain) as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::StreamResampler;

    fn tone(frequency: f32, sample_rate: u32, seconds: f32) -> Vec<f32> {
        (0..(sample_rate as f32 * seconds) as usize)
            .map(|index| (2.0 * std::f32::consts::PI * frequency * index as f32 / sample_rate as f32).sin())
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[test]
    fn downmixes_stereo_without_resampling_at_16_khz() {
        let mut resampler = StreamResampler::new(2, 16_000);
        assert_eq!(resampler.process(&[1.0, -1.0, 0.5, 0.5]), vec![0.0, 0.5]);
    }

    #[test]
    fn keeps_speech_and_removes_what_would_fold_into_it() {
        // Skips the filter's start-up and compares one second of steady tone.
        let steady = |samples: Vec<f32>| rms(&samples[1_600..17_600]);
        let speech = steady(StreamResampler::new(1, 48_000).process(&tone(1_000.0, 48_000, 1.2)));
        assert!((speech - std::f32::consts::FRAC_1_SQRT_2).abs() < 0.02, "1 kHz rms {speech}");
        // Plain decimation turns 12 kHz into a full-level 4 kHz tone.
        let folded = steady(StreamResampler::new(1, 48_000).process(&tone(12_000.0, 48_000, 1.2)));
        assert!(folded < 0.01, "12 kHz rms {folded}");
    }

    #[test]
    fn a_steady_level_starts_at_that_level() {
        let output = StreamResampler::new(1, 48_000).process(&[0.5; 4_800]);
        assert_eq!(output.len(), 1_600);
        assert!(output.iter().all(|sample| (sample - 0.5).abs() < 1e-4));
    }

    #[test]
    fn uneven_buffers_match_one_pass_without_drift() {
        let input = tone(440.0, 44_100, 3.0);
        let whole = StreamResampler::new(1, 44_100).process(&input);
        let mut resampler = StreamResampler::new(1, 44_100);
        let mut chunked = Vec::new();
        let mut rest = input.as_slice();
        for size in [441, 448, 1, 1_000, 17].into_iter().cycle() {
            if rest.is_empty() {
                break;
            }
            let (head, tail) = rest.split_at(size.min(rest.len()));
            chunked.extend(resampler.process(head));
            rest = tail;
        }
        assert_eq!(chunked, whole);
        assert!(whole.len().abs_diff(48_000) <= 1, "{} samples for 3 s", whole.len());
    }

    #[test]
    fn a_surround_output_keeps_the_front_and_center_and_drops_bass_and_surrounds() {
        // 7.1 (FL FR FC LFE BL BR SL SR), as a gaming headset reports it.
        let mask = 0x63F;
        let weights = super::speech_downmix_weights(8, Some(mask));
        assert_eq!(weights.len(), 8);
        let mut resampler = StreamResampler::with_channel_mask(8, Some(mask), 16_000);
        // A call plays in the front pair: its level stays whole.
        let front = resampler.process(&[0.4, 0.4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        assert!((front[0] - 0.4).abs() < 1e-6, "{front:?}");
        // What a virtual surround adds to the rest does not reach the voice.
        let rest = StreamResampler::with_channel_mask(8, Some(mask), 16_000).process(&[0.0, 0.0, 0.0, 0.9, 0.5, -0.5, 0.3, -0.3]);
        assert_eq!(rest, vec![0.0]);
        // Without a mask, the first two channels are the front pair.
        assert_eq!(super::speech_downmix_weights(4, None), vec![0.5, 0.5, 0.0, 0.0]);
        assert_eq!(super::speech_downmix_weights(2, Some(0x3)), vec![0.5, 0.5]);
        assert_eq!(super::speech_downmix_weights(1, None), vec![1.0]);
        // A mask without a front channel still hears every channel.
        assert_eq!(super::speech_downmix_weights(2, Some(0x30)), vec![0.5, 0.5]);
    }

    #[test]
    fn upsamples_a_narrowband_source() {
        // An 8 kHz Bluetooth microphone: two outputs per input sample.
        let output = StreamResampler::new(1, 8_000).process(&[0.0, 1.0, 0.0]);
        assert_eq!(output, vec![0.0, 0.5, 1.0, 0.5, 0.0]);
    }
}
