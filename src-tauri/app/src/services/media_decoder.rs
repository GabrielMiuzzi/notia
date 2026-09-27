//! Audio of an audio or video file, as the 16 kHz mono samples the
//! recognizer reads. Symphonia reads the containers (MP3, WAV, M4A/MP4/MOV,
//! OGG, MKV/WEBM, FLAC) and their codecs; Opus, which Symphonia does not
//! decode, goes through `ropus`. A video keeps only its audio track. Which
//! files are accepted is decided by `backend_core::meeting::media_file_kind`.

use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use notia_backend_core::audio_resample::StreamResampler;
use ropus::{Channels as OpusChannels, DecodeMode, Decoder as OpusDecoder};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL, CODEC_TYPE_OPUS};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub const OUTPUT_SAMPLE_RATE: u32 = 16_000;
/// Bars of the waveform shown for a file.
pub const WAVEFORM_BARS: usize = 70;
/// Samples each waveform point summarizes before the bars are drawn.
const PEAK_WINDOW_SAMPLES: usize = OUTPUT_SAMPLE_RATE as usize / 2;
/// Longest Opus frame (120 ms) at the output rate, for two channels.
const OPUS_FRAME_SAMPLES: usize = OUTPUT_SAMPLE_RATE as usize * 120 / 1_000 * 2;
const CANCELLED: &str = "Se canceló la lectura del archivo.";

/// What the interface shows of a file before it is transcribed.
#[derive(Debug, Clone, PartialEq)]
pub struct MediaSummary {
    pub duration_ms: u64,
    /// `WAVEFORM_BARS` heights between 0 and 1.
    pub peaks: Vec<f32>,
}

/// Reads the whole file once: its duration and its waveform. It also proves
/// the audio can be decoded before the person starts the transcription.
pub fn summarize(path: &Path, cancel: &AtomicBool) -> Result<MediaSummary, String> {
    let mut windows = Vec::new();
    let mut window_peak = 0.0_f32;
    let mut window_len = 0usize;
    let mut total = 0u64;
    decode(path, cancel, |samples| {
        total += samples.len() as u64;
        for sample in samples {
            window_peak = window_peak.max(sample.abs());
            window_len += 1;
            if window_len == PEAK_WINDOW_SAMPLES {
                windows.push(window_peak);
                window_peak = 0.0;
                window_len = 0;
            }
        }
        Ok(())
    })?;
    if window_len > 0 {
        windows.push(window_peak);
    }
    if total == 0 {
        return Err("El archivo no tiene audio.".to_string());
    }
    Ok(MediaSummary { duration_ms: total * 1_000 / u64::from(OUTPUT_SAMPLE_RATE), peaks: waveform(&windows, WAVEFORM_BARS) })
}

/// Groups the window peaks into `bars` heights scaled to the loudest one.
fn waveform(windows: &[f32], bars: usize) -> Vec<f32> {
    if windows.is_empty() || bars == 0 {
        return vec![0.0; bars];
    }
    let heights = (0..bars)
        .map(|bar| {
            let start = bar * windows.len() / bars;
            let end = ((bar + 1) * windows.len() / bars).max(start + 1).min(windows.len());
            windows.get(start..end).map_or(0.0, |group| group.iter().copied().fold(0.0_f32, f32::max))
        })
        .collect::<Vec<_>>();
    let loudest = heights.iter().copied().fold(0.0_f32, f32::max);
    if loudest <= f32::EPSILON {
        return vec![0.0; bars];
    }
    heights.into_iter().map(|height| height / loudest).collect()
}

/// Decodes the audio of `path` and hands it to `on_samples` as 16 kHz mono
/// chunks, in order. Stops with an error when `cancel` is set or when
/// `on_samples` fails. Damaged packets are skipped, as players do.
pub fn decode(
    path: &Path,
    cancel: &AtomicBool,
    mut on_samples: impl FnMut(&[f32]) -> Result<(), String>,
) -> Result<(), String> {
    let file = File::open(path).map_err(|_| "No se pudo abrir el archivo.".to_string())?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|extension| extension.to_str()) {
        hint.with_extension(extension);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, stream, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|_| "No se reconoce el formato del archivo.".to_string())?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .filter(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .or_else(|| format.tracks().iter().find(|track| track.codec_params.codec != CODEC_TYPE_NULL))
        .ok_or_else(|| "El archivo no tiene una pista de audio.".to_string())?;
    let track_id = track.id;
    let params = track.codec_params.clone();
    if params.codec == CODEC_TYPE_OPUS {
        let channels = params.channels.map_or(1, |channels| channels.count());
        return decode_opus(format.as_mut(), track_id, channels, cancel, &mut on_samples);
    }
    let mut decoder = symphonia::default::get_codecs()
        .make(&params, &DecoderOptions::default())
        .map_err(|_| "El códec de audio del archivo no está soportado.".to_string())?;
    decode_packets(format.as_mut(), decoder.as_mut(), track_id, cancel, &mut on_samples)
}

fn decode_packets(
    format: &mut dyn FormatReader,
    decoder: &mut dyn Decoder,
    track_id: u32,
    cancel: &AtomicBool,
    on_samples: &mut impl FnMut(&[f32]) -> Result<(), String>,
) -> Result<(), String> {
    let mut resampler: Option<(u16, u32, StreamResampler)> = None;
    let mut interleaved: Option<SampleBuffer<f32>> = None;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.to_string());
        }
        let Some(packet) = next_packet(format)? else {
            return Ok(());
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(_) => return Err("No se pudo decodificar el audio del archivo.".to_string()),
        };
        let spec = *decoded.spec();
        let channels = u16::try_from(spec.channels.count()).unwrap_or(u16::MAX);
        if channels == 0 {
            continue;
        }
        let buffer = match interleaved.as_mut() {
            Some(buffer) if buffer.capacity() >= decoded.capacity() * usize::from(channels) => buffer,
            _ => interleaved.insert(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec)),
        };
        buffer.copy_interleaved_ref(decoded);
        // A stream that changes its layout gets a new resampler.
        if resampler.as_ref().is_none_or(|(current_channels, rate, _)| *current_channels != channels || *rate != spec.rate) {
            resampler = Some((channels, spec.rate, StreamResampler::new(channels, spec.rate)));
        }
        let Some((_, _, resampler)) = resampler.as_mut() else { continue };
        let samples = resampler.process(buffer.samples());
        if !samples.is_empty() {
            on_samples(&samples)?;
        }
    }
}

/// Opus packets of an OGG, MKV or WEBM file, decoded straight at 16 kHz.
fn decode_opus(
    format: &mut dyn FormatReader,
    track_id: u32,
    channels: usize,
    cancel: &AtomicBool,
    on_samples: &mut impl FnMut(&[f32]) -> Result<(), String>,
) -> Result<(), String> {
    let layout = match channels {
        1 => OpusChannels::Mono,
        2 => OpusChannels::Stereo,
        _ => return Err("El audio Opus del archivo tiene más de dos canales.".to_string()),
    };
    let mut decoder = OpusDecoder::new(OUTPUT_SAMPLE_RATE, layout)
        .map_err(|_| "No se pudo iniciar el decodificador Opus.".to_string())?;
    let mut frame = vec![0.0_f32; OPUS_FRAME_SAMPLES];
    let mut mono = Vec::new();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.to_string());
        }
        let Some(packet) = next_packet(format)? else {
            return Ok(());
        };
        if packet.track_id() != track_id {
            continue;
        }
        let Ok(per_channel) = decoder.decode_float(&packet.data, &mut frame, DecodeMode::Normal) else {
            continue;
        };
        let decoded = &frame[..per_channel * channels];
        mono.clear();
        if channels == 1 {
            mono.extend_from_slice(decoded);
        } else {
            mono.extend(decoded.chunks_exact(2).map(|pair| (pair[0] + pair[1]) * 0.5));
        }
        if !mono.is_empty() {
            on_samples(&mono)?;
        }
    }
}

/// The next packet, or `None` at the end of the file.
fn next_packet(format: &mut dyn FormatReader) -> Result<Option<symphonia::core::formats::Packet>, String> {
    match format.next_packet() {
        Ok(packet) => Ok(Some(packet)),
        Err(SymphoniaError::IoError(error)) if error.kind() == std::io::ErrorKind::UnexpectedEof => Ok(None),
        // A chained stream that changes its codec ends what can be read.
        Err(SymphoniaError::ResetRequired) => Ok(None),
        Err(_) => Err("El archivo está dañado o incompleto.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_wav(path: &Path, sample_rate: u32, channels: u16, seconds: f32) {
        let spec = hound::WavSpec { channels, sample_rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        let mut writer = hound::WavWriter::create(path, spec).expect("wav");
        let frames = (sample_rate as f32 * seconds) as usize;
        for index in 0..frames {
            // A tone that gets louder, so the waveform rises.
            let amplitude = index as f32 / frames as f32;
            let value = (amplitude * (index as f32 * 0.05).sin() * i16::MAX as f32 * 0.8) as i16;
            for _ in 0..channels {
                writer.write_sample(value).expect("sample");
            }
        }
        writer.finalize().expect("finalize");
    }

    #[test]
    fn a_stereo_44k_wav_becomes_16k_mono_with_its_duration_and_waveform() {
        let directory = std::env::temp_dir().join(format!("notia-media-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("directory");
        let path = directory.join("reunion.wav");
        write_wav(&path, 44_100, 2, 3.0);
        let summary = summarize(&path, &AtomicBool::new(false)).expect("summary");
        assert!((2_950..=3_050).contains(&summary.duration_ms), "{}", summary.duration_ms);
        assert_eq!(summary.peaks.len(), WAVEFORM_BARS);
        assert!(summary.peaks.iter().all(|peak| (0.0..=1.0).contains(peak)));
        assert!(summary.peaks[WAVEFORM_BARS - 1] > summary.peaks[5], "the tone gets louder");
        let mut samples = 0usize;
        decode(&path, &AtomicBool::new(false), |chunk| {
            samples += chunk.len();
            Ok(())
        })
        .expect("decode");
        assert!((47_000..=49_000).contains(&samples), "{samples}");
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn a_cancelled_read_stops_and_an_unknown_file_is_refused() {
        let directory = std::env::temp_dir().join(format!("notia-media-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("directory");
        let path = directory.join("audio.wav");
        write_wav(&path, 16_000, 1, 1.0);
        assert_eq!(summarize(&path, &AtomicBool::new(true)), Err(CANCELLED.to_string()));
        let text = directory.join("notas.mp3");
        std::fs::write(&text, b"esto no es audio").expect("text");
        assert!(summarize(&text, &AtomicBool::new(false)).is_err());
        std::fs::remove_dir_all(&directory).ok();
    }

    /// Decodes every file of `NOTIA_MEDIA_PROBE_DIR` (one per format, made
    /// with ffmpeg) and prints its duration. Run by hand:
    /// `NOTIA_MEDIA_PROBE_DIR=… cargo test -p notia-app media_formats_probe -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn media_formats_probe() {
        let directory = std::path::PathBuf::from(std::env::var("NOTIA_MEDIA_PROBE_DIR").expect("NOTIA_MEDIA_PROBE_DIR"));
        let mut entries = std::fs::read_dir(&directory).expect("directory").flatten().map(|entry| entry.path()).collect::<Vec<_>>();
        entries.sort();
        let mut failures = Vec::new();
        for path in entries {
            let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default().to_string();
            match summarize(&path, &AtomicBool::new(false)) {
                Ok(summary) => println!("{name:12} {:>6} ms  pico máx {:.2}", summary.duration_ms, summary.peaks.iter().copied().fold(0.0_f32, f32::max)),
                Err(error) => {
                    println!("{name:12} ERROR {error}");
                    failures.push(name);
                }
            }
        }
        assert!(failures.is_empty(), "{failures:?}");
    }

    #[test]
    fn the_waveform_scales_to_the_loudest_bar() {
        let bars = waveform(&[0.1, 0.2, 0.4, 0.8], 2);
        assert_eq!(bars, vec![0.25, 1.0]);
        assert_eq!(waveform(&[], 3), vec![0.0; 3]);
        assert_eq!(waveform(&[0.5], 3).len(), 3);
    }
}
