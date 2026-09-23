# Modelos de voz empaquetados

`scripts/install-speech.sh parakeet` instala Parakeet TDT 0.6B v3 int8 y Silero VAD
en `es-parakeet-tdt-v3`, el perfil ASR por defecto. `scripts/install-speech.sh`
o `scripts/install-qwen3-asr-models.ps1` instalan Qwen3-ASR Q8 0.6B/1.7B. Los
archivos se validan contra tamaños y SHA-256 del manifiesto. Los modelos ONNX de
`speaker-diarization-v1` se usan para diarización.
