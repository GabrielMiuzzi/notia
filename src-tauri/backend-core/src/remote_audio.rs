//! Audio sent by a remote client (a future companion app or web client)
//! instead of the native capture: ordered chunks of a speech session. The
//! contract is validated here so a remote transport can feed the same
//! recognition pipeline as the Windows and Android capture.

use serde::{Deserialize, Serialize};

use crate::error::BackendError;

pub const MAX_CHUNK_BYTES: usize = 256 * 1024;
const SAMPLE_RATES: [u32; 5] = [8_000, 16_000, 22_050, 44_100, 48_000];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteAudioEncoding {
    /// Interleaved signed 16-bit little-endian PCM.
    PcmS16le,
    /// Ogg pages with Opus packets (the format Telegram voice notes use).
    OggOpus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAudioChunk {
    pub session_id: String,
    /// Starts at 0 and increases by one per chunk of the session.
    pub sequence: u64,
    pub encoding: RemoteAudioEncoding,
    pub sample_rate: u32,
    pub channels: u16,
    /// The client stopped recording; no chunk follows.
    #[serde(default)]
    pub last: bool,
    pub data_base64: String,
}

impl RemoteAudioChunk {
    /// Decoded bytes of a well-formed chunk that continues the session
    /// (`expected_sequence` is the next sequence the session accepts).
    pub fn validate(&self, expected_sequence: u64) -> Result<Vec<u8>, BackendError> {
        use base64::Engine as _;
        let session_ok = !self.session_id.is_empty()
            && self.session_id.len() <= 128
            && self.session_id.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'));
        if !session_ok {
            return Err(BackendError::invalid_input("La sesión de audio remota no es válida."));
        }
        if self.sequence != expected_sequence {
            return Err(BackendError::invalid_input("El fragmento de audio llegó fuera de orden."));
        }
        if !SAMPLE_RATES.contains(&self.sample_rate) || !(1..=2).contains(&self.channels) {
            return Err(BackendError::invalid_input("El formato de audio remoto no es compatible."));
        }
        if self.data_base64.len() > MAX_CHUNK_BYTES.div_ceil(3) * 4 {
            return Err(BackendError::invalid_input("El fragmento de audio supera el límite."));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(self.data_base64.trim())
            .map_err(|_| BackendError::invalid_input("El fragmento de audio no es Base64 válido."))?;
        let frame = 2 * usize::from(self.channels);
        if self.encoding == RemoteAudioEncoding::PcmS16le && bytes.len() % frame != 0 {
            return Err(BackendError::invalid_input("El fragmento PCM no contiene muestras completas."));
        }
        if bytes.is_empty() && !self.last {
            return Err(BackendError::invalid_input("El fragmento de audio está vacío."));
        }
        Ok(bytes)
    }
}

/// Mono samples in [-1, 1] from interleaved 16-bit PCM (channels averaged).
pub fn pcm_s16le_to_mono(bytes: &[u8], channels: u16) -> Vec<f32> {
    let channels = usize::from(channels.max(1));
    bytes
        .chunks_exact(2 * channels)
        .map(|frame| {
            let sum = frame
                .chunks_exact(2)
                .map(|sample| f32::from(i16::from_le_bytes([sample[0], sample[1]])) / 32_768.0)
                .sum::<f32>();
            sum / channels as f32
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;

    fn chunk(sequence: u64, bytes: &[u8]) -> RemoteAudioChunk {
        RemoteAudioChunk {
            session_id: "session-1".into(),
            sequence,
            encoding: RemoteAudioEncoding::PcmS16le,
            sample_rate: 16_000,
            channels: 2,
            last: false,
            data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        }
    }

    #[test]
    fn chunks_must_be_ordered_and_complete() {
        let samples = [0x00, 0x40, 0x00, 0xC0];
        assert_eq!(chunk(0, &samples).validate(0).expect("valid"), samples.to_vec());
        assert!(chunk(1, &samples).validate(0).is_err());
        assert!(chunk(0, &samples[..3]).validate(0).is_err());
        let mut rate = chunk(0, &samples);
        rate.sample_rate = 12_345;
        assert!(rate.validate(0).is_err());
    }

    #[test]
    fn stereo_pcm_is_averaged_to_mono() {
        assert_eq!(pcm_s16le_to_mono(&[0x00, 0x40, 0x00, 0xC0, 0x00, 0x40, 0x00, 0x40], 2), vec![0.0, 0.5]);
    }
}
