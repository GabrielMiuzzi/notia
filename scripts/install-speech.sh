#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 0 || "${1:-}" == 'whisper' ]] || { echo 'Uso: install-speech.sh [whisper]' >&2; exit 2; }
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
MODELS="$ROOT/src-tauri/resources/speech/models"
# Whisper large-v3-turbo q8_0 (whisper.cpp) y Silero VAD (sherpa-onnx). Los
# hashes coinciden con src-tauri/resources/speech/model-manifest.json.
install_whisper(){
  local dir="$MODELS/whisper-large-v3-turbo" tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf -- "$tmp"' RETURN
  curl -fL --retry 3 -o "$tmp/ggml-large-v3-turbo-q8_0.bin" \
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin'
  curl -fL --retry 3 -o "$tmp/silero_vad.onnx" \
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx'
  (cd "$tmp" && sha256sum -c - <<'SUMS'
317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1  ggml-large-v3-turbo-q8_0.bin
9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6  silero_vad.onnx
SUMS
  )
  mkdir -p "$dir"
  cp -f -- "$tmp/ggml-large-v3-turbo-q8_0.bin" "$tmp/silero_vad.onnx" "$dir/"
}
# Whisper large-v3 q5_0: la pasada final de Meeting en Windows con GPU. Solo
# el EXE lo empaqueta.
install_final_pass(){
  local dir="$MODELS/whisper-large-v3" tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf -- "$tmp"' RETURN
  curl -fL --retry 3 -o "$tmp/ggml-large-v3-q5_0.bin" \
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin'
  (cd "$tmp" && sha256sum -c - <<'SUMS'
d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1  ggml-large-v3-q5_0.bin
SUMS
  )
  mkdir -p "$dir"
  cp -f -- "$tmp/ggml-large-v3-q5_0.bin" "$dir/"
}
install_whisper
install_final_pass
printf '%s\n' 'Modelos de voz instalados. El runtime whisper.cpp se compila con scripts/build-whisper-runtime.ps1.'
