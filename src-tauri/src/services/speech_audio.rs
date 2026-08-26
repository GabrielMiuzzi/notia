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
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    #[cfg(target_os = "windows")]
    use std::thread::JoinHandle;

    const MIX_CHUNK_SAMPLES: usize = 160;
    const MIX_MAX_SOURCE_SKEW_SAMPLES: usize = 3_200;

    #[derive(Default)]
    struct MeetingMixer {
        microphone: VecDeque<f32>,
        system: VecDeque<f32>,
        target: Option<SharedPcmBuffer>,
        system_active: bool,
    }

    impl MeetingMixer {
        fn microphone_only(target: SharedPcmBuffer) -> Self {
            Self {
                target: Some(target),
                system_active: false,
                ..Self::default()
            }
        }

        #[cfg(target_os = "windows")]
        fn meeting(target: SharedPcmBuffer) -> Self {
            Self {
                target: Some(target),
                system_active: true,
                ..Self::default()
            }
        }

        fn push_microphone(&mut self, samples: Vec<f32>) {
            if !self.system_active {
                if let Some(target) = &self.target {
                    if let Ok(mut target) = target.try_lock() {
                        target.push(samples);
                    }
                }
                return;
            }
            self.microphone.extend(samples);
            self.flush_mix();
        }

        #[cfg(target_os = "windows")]
        fn push_system(&mut self, samples: Vec<f32>) {
            self.system.extend(samples);
            self.flush_mix();
        }

        fn flush_mix(&mut self) {
            while (self.microphone.len() >= MIX_CHUNK_SAMPLES
                && self.system.len() >= MIX_CHUNK_SAMPLES)
                || self.microphone.len() >= MIX_MAX_SOURCE_SKEW_SAMPLES
                || self.system.len() >= MIX_MAX_SOURCE_SKEW_SAMPLES
            {
                let mixed = (0..MIX_CHUNK_SAMPLES)
                    .map(|_| {
                        let microphone = self.microphone.pop_front().unwrap_or_default();
                        let system = self.system.pop_front().unwrap_or_default();
                        (microphone * 0.72 + system * 0.72).clamp(-1.0, 1.0)
                    })
                    .collect::<Vec<_>>();
                if let Some(target) = &self.target {
                    if let Ok(mut target) = target.try_lock() {
                        target.push(mixed);
                    }
                }
            }
        }
    }

    pub struct PlatformAudioCapture {
        stream: Stream,
        paused: Arc<AtomicBool>,
        #[cfg(target_os = "windows")]
        _loopback: Option<WindowsLoopbackCapture>,
    }

    impl PlatformAudioCapture {
        pub fn start_with_buffer(
            buffer: SharedPcmBuffer,
            capture_system_audio: bool,
        ) -> Result<Self, String> {
            #[cfg(not(target_os = "windows"))]
            let _ = capture_system_audio;
            let host = cpal::default_host();
            let device = host
                .default_input_device()
                .ok_or_else(|| "El sistema no informa un microfono predeterminado.".to_string())?;
            let supported_config = device.default_input_config().map_err(|error| {
                format!("No se pudo consultar el formato del microfono: {error}")
            })?;
            let stream_config: StreamConfig = supported_config.clone().into();
            let paused = Arc::new(AtomicBool::new(false));
            #[cfg(target_os = "windows")]
            let mixer = Arc::new(Mutex::new(if capture_system_audio {
                MeetingMixer::meeting(buffer)
            } else {
                MeetingMixer::microphone_only(buffer)
            }));
            #[cfg(not(target_os = "windows"))]
            let mixer = Arc::new(Mutex::new(MeetingMixer::microphone_only(buffer)));
            let stream = build_stream(&device, &supported_config, &stream_config, &paused, &mixer)?;
            #[cfg(target_os = "windows")]
            // La captura de la salida es opcional: si WASAPI no puede abrir el
            // endpoint (por ejemplo, no hay una salida activa), mantenemos el
            // micrófono funcionando para que el dictado no falle por completo.
            let loopback = if capture_system_audio {
                match WindowsLoopbackCapture::start(Arc::clone(&mixer), Arc::clone(&paused)) {
                    Ok(capture) => Some(capture),
                    Err(error) => {
                        log::warn!("[notia:speech_audio] captura de salida no disponible: {error}");
                        if let Ok(mut mixer) = mixer.lock() {
                            mixer.system_active = false;
                        }
                        None
                    }
                }
            } else {
                None
            };
            stream
                .play()
                .map_err(|error| format!("No se pudo iniciar el microfono: {error}"))?;
            Ok(Self {
                stream,
                paused,
                #[cfg(target_os = "windows")]
                _loopback: loopback,
            })
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
        buffer: &Arc<Mutex<MeetingMixer>>,
    ) -> Result<Stream, String> {
        let channels = config.channels;
        let sample_rate = config.sample_rate.0;
        let error_callback =
            |error| log::error!("[notia:speech_audio] input stream error: {error}");
        macro_rules! build_input_stream {
            ($sample_type:ty, $convert:expr) => {{
                let paused = Arc::clone(paused);
                let mixer = Arc::clone(buffer);
                device.build_input_stream(
                    config,
                    move |data: &[$sample_type], _| {
                        if paused.load(Ordering::Acquire) {
                            return;
                        }
                        let normalized: Vec<f32> = data.iter().copied().map($convert).collect();
                        let samples = downmix_and_resample(&normalized, channels, sample_rate);
                        if let Ok(mut target) = mixer.try_lock() {
                            target.push_microphone(samples);
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

    #[cfg(target_os = "windows")]
    struct WindowsLoopbackCapture {
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }

    #[cfg(target_os = "windows")]
    impl WindowsLoopbackCapture {
        fn start(mixer: Arc<Mutex<MeetingMixer>>, paused: Arc<AtomicBool>) -> Result<Self, String> {
            let stop = Arc::new(AtomicBool::new(false));
            let thread_stop = Arc::clone(&stop);
            let (ready_sender, ready_receiver) = std::sync::mpsc::sync_channel(1);
            let error_sender = ready_sender.clone();
            let thread = std::thread::Builder::new()
                .name("notia-wasapi-loopback".to_string())
                .spawn(move || {
                    if let Err(error) =
                        run_wasapi_loopback(mixer, paused, thread_stop, ready_sender)
                    {
                        let _ = error_sender.try_send(Err(error.clone()));
                        log::error!("[notia:speech_audio] WASAPI loopback error: {error}");
                    }
                })
                .map_err(|error| {
                    format!("No se pudo iniciar la captura del audio del sistema: {error}")
                })?;
            match ready_receiver.recv_timeout(std::time::Duration::from_secs(3)) {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    stop.store(true, Ordering::Release);
                    let _ = thread.join();
                    return Err(error);
                }
                Err(_) => {
                    stop.store(true, Ordering::Release);
                    let _ = thread.join();
                    return Err(
                        "WASAPI no respondió al iniciar la captura de la computadora.".to_string(),
                    );
                }
            }
            Ok(Self {
                stop,
                thread: Some(thread),
            })
        }
    }

    #[cfg(target_os = "windows")]
    impl Drop for WindowsLoopbackCapture {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Release);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    #[cfg(target_os = "windows")]
    fn run_wasapi_loopback(
        mixer: Arc<Mutex<MeetingMixer>>,
        paused: Arc<AtomicBool>,
        stop: Arc<AtomicBool>,
        ready: std::sync::mpsc::SyncSender<Result<(), String>>,
    ) -> Result<(), String> {
        use std::slice;
        use std::time::Duration;
        use windows::Win32::Media::Audio::{
            eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
            MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX,
            WAVEFORMATEXTENSIBLE, WAVE_FORMAT_PCM,
        };
        use windows::Win32::Media::Multimedia::{
            KSDATAFORMAT_SUBTYPE_IEEE_FLOAT, WAVE_FORMAT_IEEE_FLOAT,
        };
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
            COINIT_MULTITHREADED,
        };

        // SAFETY: COM is initialized and uninitialized on this dedicated thread. WASAPI owns the
        // mix-format allocation and capture buffers; each allocation/buffer is released exactly
        // once before its client is stopped, and sample slices never outlive ReleaseBuffer.
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|error| format!("No se pudo inicializar WASAPI: {error}"))?;
            let result = (|| -> Result<(), String> {
                let enumerator: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|error| {
                        format!("No se pudo consultar la salida de audio: {error}")
                    })?;
                let device = enumerator
                    .GetDefaultAudioEndpoint(eRender, eConsole)
                    .map_err(|error| {
                        format!("No hay una salida de audio predeterminada: {error}")
                    })?;
                let client: IAudioClient = device
                    .Activate(CLSCTX_ALL, None)
                    .map_err(|error| format!("No se pudo abrir la salida de audio: {error}"))?;
                let format_ptr = client.GetMixFormat().map_err(|error| {
                    format!("No se pudo consultar el formato de salida: {error}")
                })?;
                let format: WAVEFORMATEX = *format_ptr;
                let format_tag = format.wFormatTag;
                let bits_per_sample = format.wBitsPerSample;
                let extensible_subformat = (format_tag == 0xfffe && format.cbSize >= 22)
                    .then(|| (*(format_ptr.cast::<WAVEFORMATEXTENSIBLE>())).SubFormat);
                let is_float = format_tag == WAVE_FORMAT_IEEE_FLOAT as u16
                    || extensible_subformat == Some(KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
                let is_pcm = format_tag == WAVE_FORMAT_PCM as u16
                    || extensible_subformat
                        == Some(windows::core::GUID::from_u128(
                            0x00000001_0000_0010_8000_00aa00389b71,
                        ));
                if !is_float && !is_pcm {
                    CoTaskMemFree(Some(format_ptr.cast()));
                    return Err(format!("Formato WASAPI no soportado: {format_tag}."));
                }
                client
                    .Initialize(
                        AUDCLNT_SHAREMODE_SHARED,
                        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                        1_000_000,
                        0,
                        format_ptr,
                        None,
                    )
                    .map_err(|error| format!("No se pudo activar WASAPI loopback: {error}"))?;
                CoTaskMemFree(Some(format_ptr.cast()));
                let capture: IAudioCaptureClient = client
                    .GetService()
                    .map_err(|error| format!("No se pudo crear el lector WASAPI: {error}"))?;
                client
                    .Start()
                    .map_err(|error| format!("No se pudo iniciar WASAPI loopback: {error}"))?;
                let _ = ready.send(Ok(()));
                while !stop.load(Ordering::Acquire) {
                    let mut packet_size = capture
                        .GetNextPacketSize()
                        .map_err(|error| format!("No se pudo leer WASAPI: {error}"))?;
                    while packet_size > 0 {
                        let mut data = std::ptr::null_mut();
                        let mut frames = 0;
                        let mut flags = 0;
                        capture
                            .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                            .map_err(|error| format!("No se pudo obtener audio WASAPI: {error}"))?;
                        if !paused.load(Ordering::Acquire) {
                            let sample_count = frames as usize * format.nChannels as usize;
                            let normalized = if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                                vec![0.0; sample_count]
                            } else if is_float {
                                slice::from_raw_parts(data.cast::<f32>(), sample_count).to_vec()
                            } else if bits_per_sample == 16 {
                                slice::from_raw_parts(data.cast::<i16>(), sample_count)
                                    .iter()
                                    .map(|value| *value as f32 / i16::MAX as f32)
                                    .collect()
                            } else if bits_per_sample == 24 {
                                slice::from_raw_parts(data, sample_count * 3)
                                    .chunks_exact(3)
                                    .map(|bytes| {
                                        let signed = i32::from_le_bytes([
                                            bytes[0],
                                            bytes[1],
                                            bytes[2],
                                            if bytes[2] & 0x80 == 0 { 0 } else { 0xff },
                                        ]);
                                        signed as f32 / 8_388_607.0
                                    })
                                    .collect()
                            } else if bits_per_sample == 32 {
                                slice::from_raw_parts(data.cast::<i32>(), sample_count)
                                    .iter()
                                    .map(|value| *value as f32 / i32::MAX as f32)
                                    .collect()
                            } else {
                                capture.ReleaseBuffer(frames).ok();
                                return Err(format!(
                                    "PCM WASAPI de {bits_per_sample} bits no soportado."
                                ));
                            };
                            let samples = downmix_and_resample(
                                &normalized,
                                format.nChannels,
                                format.nSamplesPerSec,
                            );
                            if let Ok(mut target) = mixer.lock() {
                                target.push_system(samples);
                            }
                        }
                        capture.ReleaseBuffer(frames).map_err(|error| {
                            format!("No se pudo liberar el buffer WASAPI: {error}")
                        })?;
                        packet_size = capture.GetNextPacketSize().map_err(|error| {
                            format!("No se pudo continuar la captura WASAPI: {error}")
                        })?;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                client.Stop().ok();
                Ok(())
            })();
            CoUninitialize();
            result
        }
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
