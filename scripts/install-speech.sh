#!/usr/bin/env bash
set -euo pipefail
MODEL="${1:-parakeet}"
[[ "$MODEL" == 'parakeet' ]] || { echo 'Uso: install-speech.sh [parakeet]' >&2; exit 2; }
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
MODELS="$ROOT/src-tauri/resources/speech/models"
# Parakeet TDT 0.6B v3 int8 y Silero VAD publicados por sherpa-onnx. Los
# hashes coinciden con src-tauri/resources/speech/model-manifest.json.
install_parakeet(){
  local releases='https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
  local archive='sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2'
  local dir="$MODELS/es-parakeet-tdt-v3" tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf -- "$tmp"' RETURN
  curl -fL --retry 3 -o "$tmp/$archive" "$releases/$archive"
  curl -fL --retry 3 -o "$tmp/silero_vad.onnx" "$releases/silero_vad.onnx"
  if tar -tjf "$tmp/$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    echo "Ruta insegura dentro de $archive." >&2; exit 1
  fi
  tar -xjf "$tmp/$archive" -C "$tmp"
  mkdir -p "$dir"
  for role in encoder decoder joiner; do
    cp -f -- "$(find "$tmp" -type f -name "$role*.onnx" | head -n 1)" "$dir/$role.onnx"
  done
  cp -f -- "$(find "$tmp" -type f -name 'tokens.txt' | head -n 1)" "$dir/tokens.txt"
  cp -f -- "$tmp/silero_vad.onnx" "$dir/silero_vad.onnx"
  (cd "$dir" && sha256sum -c - <<'SUMS'
acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247  encoder.onnx
179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e  decoder.onnx
3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3  joiner.onnx
d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d  tokens.txt
9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6  silero_vad.onnx
SUMS
  )
}
install_parakeet
printf '%s\n' 'Modelos de voz instalados. La diarización conserva su runtime sherpa independiente.'
