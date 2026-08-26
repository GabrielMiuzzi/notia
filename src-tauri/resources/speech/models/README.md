# Modelos de voz empaquetados

`scripts/install-speech.sh` o `scripts/install-qwen3-asr-models.ps1` instalan
Qwen3-ASR Q8 0.6B/1.7B. Los archivos se validan contra tamaños y SHA-256 del
manifiesto. Los modelos ONNX de este directorio se usan únicamente para
diarización.

El reconocimiento anterior fue retirado por completo; estos perfiles GGUF son la única fuente ASR.
