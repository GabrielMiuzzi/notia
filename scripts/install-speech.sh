#!/usr/bin/env bash
set -euo pipefail
MODEL="${1:-0.6b}"
[[ "$MODEL" =~ ^(0\.6b|1\.7b|all)$ ]] || { echo 'Uso: install-speech.sh [0.6b|1.7b|all]' >&2; exit 2; }
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
download_model(){
  local size="$1" upper dir repo main projector
  [[ "$size" == '0.6b' ]] && upper='0.6B' || upper='1.7B'
  dir="$ROOT/src-tauri/resources/speech/models/qwen3-asr-$size-q8"
  repo="https://huggingface.co/ggml-org/Qwen3-ASR-$upper-GGUF/resolve/main"
  main="Qwen3-ASR-$upper-Q8_0.gguf"
  projector="mmproj-Qwen3-ASR-$upper-Q8_0.gguf"
  mkdir -p "$dir"
  curl -fL --retry 3 -o "$dir/$main" "$repo/$main"
  curl -fL --retry 3 -o "$dir/$projector" "$repo/$projector"
}
if [[ "$MODEL" == 'all' ]]; then download_model '0.6b'; download_model '1.7b'; else download_model "$MODEL"; fi
printf '%s\n' 'Qwen3-ASR instalado. La diarización conserva su runtime sherpa independiente.'
