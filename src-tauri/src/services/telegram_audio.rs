use ogg::reading::PacketReader;
use ropus::{Channels, DecodeMode, Decoder};
use std::io::Cursor;

const OPUS_HEAD: &[u8] = b"OpusHead";
const OPUS_TAGS: &[u8] = b"OpusTags";
const OUTPUT_SAMPLE_RATE: u32 = 16_000;
const MAX_AUDIO_SECONDS: usize = 15 * 60;
const MAX_OUTPUT_SAMPLES: usize = OUTPUT_SAMPLE_RATE as usize * MAX_AUDIO_SECONDS;

pub fn decode_telegram_ogg_opus(bytes: Vec<u8>) -> Result<Vec<f32>, String> {
    let mut reader = PacketReader::new(Cursor::new(bytes));
    let head = reader
        .read_packet()
        .map_err(|_| "La nota de voz OGG esta dañada.".to_string())?
        .ok_or_else(|| "La nota de voz OGG esta vacia.".to_string())?;
    if head.data.len() < 19 || !head.data.starts_with(OPUS_HEAD) {
        return Err("Telegram envio un audio que no es OGG/Opus.".to_string());
    }
    let channels = usize::from(head.data[9]);
    if !(1..=2).contains(&channels) {
        return Err("La nota de voz tiene una cantidad de canales no soportada.".to_string());
    }
    let pre_skip_48k = usize::from(u16::from_le_bytes([head.data[10], head.data[11]]));
    let pre_skip = pre_skip_48k * OUTPUT_SAMPLE_RATE as usize / 48_000;
    let stream_serial = head.stream_serial();
    let channel_layout = if channels == 1 {
        Channels::Mono
    } else {
        Channels::Stereo
    };
    let mut decoder = Decoder::new(OUTPUT_SAMPLE_RATE, channel_layout)
        .map_err(|_| "No se pudo inicializar el decodificador Opus.".to_string())?;
    // Opus permite paquetes de hasta 120 ms. El decoder recupera del paquete
    // la duracion real y devuelve muestras por canal.
    let mut frame = vec![0.0_f32; OUTPUT_SAMPLE_RATE as usize * 120 / 1_000 * channels];
    let mut output = Vec::new();

    while let Some(packet) = reader
        .read_packet()
        .map_err(|_| "La nota de voz OGG esta dañada.".to_string())?
    {
        if packet.stream_serial() != stream_serial || packet.data.starts_with(OPUS_TAGS) {
            continue;
        }
        let samples_per_channel = decoder
            .decode_float(&packet.data, &mut frame, DecodeMode::Normal)
            .map_err(|_| "No se pudo decodificar un fragmento Opus.".to_string())?;
        let decoded = &frame[..samples_per_channel * channels];
        if output.len().saturating_add(samples_per_channel) > MAX_OUTPUT_SAMPLES + pre_skip {
            return Err("La nota de voz supera los quince minutos permitidos.".to_string());
        }
        if channels == 1 {
            output.extend_from_slice(decoded);
        } else {
            output.extend(
                decoded
                    .chunks_exact(2)
                    .map(|sample| (sample[0] + sample[1]) * 0.5),
            );
        }
    }
    if output.len() <= pre_skip {
        return Err("La nota de voz no contiene audio util.".to_string());
    }
    output.drain(..pre_skip);
    if output.is_empty() {
        return Err("La nota de voz no contiene audio util.".to_string());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::decode_telegram_ogg_opus;
    use ogg::{PacketWriteEndInfo, PacketWriter};
    use ropus::{Application, Channels, Encoder};

    #[test]
    fn rejects_non_opus_payloads() {
        assert!(decode_telegram_ogg_opus(b"not an ogg stream".to_vec()).is_err());
    }

    #[test]
    fn decodes_a_valid_telegram_compatible_ogg_opus_stream() {
        let mut encoder = Encoder::builder(48_000, Channels::Mono, Application::Voip)
            .build()
            .expect("test encoder");
        let mut encoded_packet = [0_u8; 4_000];
        let packet_len = encoder
            .encode(&[0_i16; 960], &mut encoded_packet)
            .expect("encode test frame");

        let mut head = Vec::from(&b"OpusHead"[..]);
        head.extend_from_slice(&[1, 1]); // version, mono
        head.extend_from_slice(&0_u16.to_le_bytes()); // pre-skip
        head.extend_from_slice(&48_000_u32.to_le_bytes());
        head.extend_from_slice(&0_i16.to_le_bytes()); // output gain
        head.push(0); // channel mapping family

        let mut bytes = Vec::new();
        {
            let mut writer = PacketWriter::new(&mut bytes);
            writer
                .write_packet(head, 7, PacketWriteEndInfo::EndPage, 0)
                .expect("write OpusHead");
            writer
                .write_packet(
                    Vec::from(&b"OpusTags\0\0\0\0\0\0\0\0"[..]),
                    7,
                    PacketWriteEndInfo::EndPage,
                    0,
                )
                .expect("write OpusTags");
            writer
                .write_packet(
                    encoded_packet[..packet_len].to_vec(),
                    7,
                    PacketWriteEndInfo::EndStream,
                    960,
                )
                .expect("write audio packet");
        }

        let samples = decode_telegram_ogg_opus(bytes).expect("decode Ogg/Opus");
        assert_eq!(samples.len(), 320);
    }
}
