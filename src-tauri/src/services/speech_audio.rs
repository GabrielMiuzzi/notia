use crate::dto::speech::SpeechAudioInputStatusDto;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

pub const SPEECH_SAMPLE_RATE: u32 = 16_000;
const MAX_BUFFERED_SECONDS: usize = 2;
const MAX_BUFFERED_SAMPLES: usize = SPEECH_SAMPLE_RATE as usize * MAX_BUFFERED_SECONDS;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PcmBufferStats {
    pub buffered_samples: usize,
    pub dropped_samples: u64,
}

#[derive(Debug)]
pub struct BoundedPcmBuffer {
    samples: VecDeque<f32>,
    capacity: usize,
    dropped_samples: u64,
}

impl BoundedPcmBuffer {
    pub fn with_capacity(capacity: usize) -> Result<Self, String> {
        if capacity == 0 || capacity > MAX_BUFFERED_SAMPLES {
            return Err("La capacidad del buffer PCM no es valida.".to_string());
        }
        Ok(Self {
            samples: VecDeque::with_capacity(capacity),
            capacity,
            dropped_samples: 0,
        })
    }

    pub fn push(&mut self, samples: impl IntoIterator<Item = f32>) {
        for sample in samples {
            if self.samples.len() == self.capacity {
                self.samples.pop_front();
                self.dropped_samples = self.dropped_samples.saturating_add(1);
            }
            self.samples.push_back(sample.clamp(-1.0, 1.0));
        }
    }

    pub fn drain(&mut self, max_samples: usize) -> Vec<f32> {
        let count = max_samples.min(self.samples.len());
        self.samples.drain(..count).collect()
    }

    pub fn stats(&self) -> PcmBufferStats {
        PcmBufferStats {
            buffered_samples: self.samples.len(),
            dropped_samples: self.dropped_samples,
        }
    }
}

pub type SharedPcmBuffer = Arc<Mutex<BoundedPcmBuffer>>;

pub fn create_shared_pcm_buffer() -> SharedPcmBuffer {
    Arc::new(Mutex::new(
        BoundedPcmBuffer::with_capacity(MAX_BUFFERED_SAMPLES)
            .expect("the fixed speech PCM capacity is valid"),
    ))
}

pub fn downmix_and_resample(
    interleaved_samples: &[f32],
    channels: u16,
    input_sample_rate: u32,
) -> Vec<f32> {
    if channels == 0 || input_sample_rate == 0 || interleaved_samples.is_empty() {
        return Vec::new();
    }
    let channels = channels as usize;
    let mono: Vec<f32> = interleaved_samples
        .chunks_exact(channels)
        .map(|frame| frame.iter().copied().sum::<f32>() / channels as f32)
        .collect();
    if mono.is_empty() || input_sample_rate == SPEECH_SAMPLE_RATE {
        return mono;
    }

    let output_len = ((mono.len() as u64 * SPEECH_SAMPLE_RATE as u64) / input_sample_rate as u64)
        .max(1) as usize;
    let ratio = input_sample_rate as f64 / SPEECH_SAMPLE_RATE as f64;
    (0..output_len)
        .map(|output_index| {
            let source_position = output_index as f64 * ratio;
            let left_index = (source_position.floor() as usize).min(mono.len() - 1);
            let right_index = (left_index + 1).min(mono.len() - 1);
            let fraction = (source_position - left_index as f64) as f32;
            mono[left_index] + (mono[right_index] - mono[left_index]) * fraction
        })
        .collect()
}

#[cfg(any(target_os = "windows", target_os = "android"))]
mod native {
    use super::{downmix_and_resample, SharedPcmBuffer, SpeechAudioInputStatusDto};
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{SampleFormat, Stream, StreamConfig, SupportedStreamConfig};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    pub struct PlatformAudioCapture {
        stream: Stream,
        paused: Arc<AtomicBool>,
    }

    impl PlatformAudioCapture {
        pub fn start_with_buffer(buffer: SharedPcmBuffer) -> Result<Self, String> {
            let host = cpal::default_host();
            let device = host
                .default_input_device()
                .ok_or_else(|| "El sistema no informa un microfono predeterminado.".to_string())?;
            let supported_config = device.default_input_config().map_err(|error| {
                format!("No se pudo consultar el formato del microfono: {error}")
            })?;
            let stream_config: StreamConfig = supported_config.clone().into();
            let paused = Arc::new(AtomicBool::new(false));
            let stream =
                build_stream(&device, &supported_config, &stream_config, &paused, &buffer)?;
            stream
                .play()
                .map_err(|error| format!("No se pudo iniciar el microfono: {error}"))?;
            Ok(Self { stream, paused })
        }

        pub fn pause(&self) -> Result<(), String> {
            self.paused.store(true, Ordering::Release);
            self.stream
                .pause()
                .map_err(|error| format!("No se pudo pausar el microfono: {error}"))
        }

        pub fn resume(&self) -> Result<(), String> {
            self.stream
                .play()
                .map_err(|error| format!("No se pudo reanudar el microfono: {error}"))?;
            self.paused.store(false, Ordering::Release);
            Ok(())
        }
    }

    fn build_stream(
        device: &cpal::Device,
        supported_config: &SupportedStreamConfig,
        config: &StreamConfig,
        paused: &Arc<AtomicBool>,
        buffer: &SharedPcmBuffer,
    ) -> Result<Stream, String> {
        let channels = config.channels;
        let sample_rate = config.sample_rate.0;
        let error_callback =
            |error| log::error!("[notia:speech_audio] input stream error: {error}");
        macro_rules! build_input_stream {
            ($sample_type:ty, $convert:expr) => {{
                let paused = Arc::clone(paused);
                let buffer = Arc::clone(buffer);
                device.build_input_stream(
                    config,
                    move |data: &[$sample_type], _| {
                        if paused.load(Ordering::Acquire) {
                            return;
                        }
                        let normalized: Vec<f32> = data.iter().copied().map($convert).collect();
                        let samples = downmix_and_resample(&normalized, channels, sample_rate);
                        if let Ok(mut target) = buffer.try_lock() {
                            target.push(samples);
                        }
                    },
                    error_callback,
                    None,
                )
            }};
        }

        let result = match supported_config.sample_format() {
            SampleFormat::F32 => build_input_stream!(f32, |value: f32| value),
            SampleFormat::I16 => {
                build_input_stream!(i16, |value: i16| value as f32 / i16::MAX as f32)
            }
            SampleFormat::U16 => {
                build_input_stream!(u16, |value: u16| (value as f32 / u16::MAX as f32) * 2.0
                    - 1.0)
            }
            format => return Err(format!("Formato de microfono no soportado: {format:?}.")),
        };
        result.map_err(|error| format!("No se pudo abrir el microfono: {error}"))
    }

    pub fn probe() -> SpeechAudioInputStatusDto {
        let host = cpal::default_host();
        let Some(device) = host.default_input_device() else {
            return unavailable("El sistema no informa un microfono predeterminado.");
        };
        let device_label = device.name().ok().filter(|value| !value.trim().is_empty());
        match device.default_input_config() {
            Ok(config) => SpeechAudioInputStatusDto {
                supported: true,
                available: true,
                device_label,
                sample_rate: Some(config.sample_rate().0),
                channels: Some(config.channels()),
                error_message: None,
            },
            Err(error) => unavailable(&format!("No se pudo consultar el microfono: {error}")),
        }
    }

    fn unavailable(message: &str) -> SpeechAudioInputStatusDto {
        SpeechAudioInputStatusDto {
            supported: true,
            available: false,
            device_label: None,
            sample_rate: None,
            channels: None,
            error_message: Some(message.to_string()),
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub use native::{probe as probe_audio_input, PlatformAudioCapture};

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub fn probe_audio_input() -> SpeechAudioInputStatusDto {
    SpeechAudioInputStatusDto {
        supported: false,
        available: false,
        device_label: None,
        sample_rate: None,
        channels: None,
        error_message: Some(
            "La captura nativa de voz todavia no esta integrada en esta plataforma.".to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{downmix_and_resample, BoundedPcmBuffer};

    #[test]
    fn bounded_buffer_drops_oldest_samples() {
        let mut buffer = BoundedPcmBuffer::with_capacity(3).expect("valid buffer");
        buffer.push([0.0, 0.5, 1.0, -0.5]);
        assert_eq!(buffer.stats().dropped_samples, 1);
        assert_eq!(buffer.drain(10), vec![0.5, 1.0, -0.5]);
    }

    #[test]
    fn downmixes_stereo_and_resamples() {
        let output = downmix_and_resample(&[1.0, -1.0, 0.5, 0.5], 2, 32_000);
        assert_eq!(output, vec![0.0]);
    }

    #[test]
    fn rejects_invalid_buffer_capacity() {
        assert!(BoundedPcmBuffer::with_capacity(0).is_err());
    }
}
