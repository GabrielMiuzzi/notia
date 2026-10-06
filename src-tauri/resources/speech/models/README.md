# Modelos de voz empaquetados

`scripts/install-speech.sh` instala Whisper large-v3-turbo q8_0 (formato
whisper.cpp) y Silero VAD en `whisper-large-v3-turbo`, el único perfil ASR. Los
archivos se validan contra tamaños y SHA-256 del manifiesto. También instala
Whisper large-v3 q5_0 en `whisper-large-v3`: solo el EXE de Windows lo
empaqueta y lo usa la segunda pasada de Meeting con GPU; si falta, no hay
segunda pasada y queda el texto en vivo. Los modelos ONNX de
`speaker-diarization-v2` se usan para diarización: `segmentation.onnx` es
pyannote segmentation-3.0 y `embedding.onnx` es NeMo TitaNet small
(`nemo_en_titanet_small.onnx` de las versiones de sherpa-onnx), que en
conversaciones en español separó mejor que el ERes2Net chino de la v1.
