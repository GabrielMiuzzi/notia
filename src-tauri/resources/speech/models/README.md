# Modelos de voz empaquetados

`scripts/install-speech.sh` instala Whisper large-v3-turbo q8_0 (formato
whisper.cpp) y Silero VAD en `whisper-large-v3-turbo`, el único perfil ASR. Los
archivos se validan contra tamaños y SHA-256 del manifiesto. Los modelos ONNX de
`speaker-diarization-v1` se usan para diarización.
