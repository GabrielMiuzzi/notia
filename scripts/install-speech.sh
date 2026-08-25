#!/usr/bin/env bash
set -euo pipefail
VERSION="1.13.4"; PROFILE_ID="es-parakeet-tdt-v3"; SKIP_ANDROID_INIT=0; KEEP=0
usage(){ printf '%s\n' 'Uso: bash scripts/install-speech.sh [--profile-id ID] [--skip-android-init] [--keep-downloads]' 'Descarga Parakeet TDT v3, Silero VAD, diarización y runtimes Windows x64/Android arm64.'; }
while [[ $# -gt 0 ]]; do case "$1" in --profile-id) PROFILE_ID="${2:-}"; shift 2;; --skip-android-init) SKIP_ANDROID_INIT=1; shift;; --keep-downloads) KEEP=1; shift;; -h|--help) usage; exit 0;; *) echo "Argumento desconocido: $1" >&2; exit 2;; esac; done
case "$PROFILE_ID" in ''|*[!A-Za-z0-9._-]*) echo 'profile-id inválido.' >&2; exit 1;; esac
for tool in curl python3; do command -v "$tool" >/dev/null || { echo "Falta $tool dentro de este entorno bash." >&2; exit 1; }; done
if [[ "$SKIP_ANDROID_INIT" -eq 0 ]]; then
  command -v node >/dev/null || { echo 'Falta node dentro de este entorno bash. Para preparar solo Windows, use --skip-android-init.' >&2; exit 1; }
  command -v npx >/dev/null || { echo 'Falta npx dentro de este entorno bash. Para preparar solo Windows, use --skip-android-init.' >&2; exit 1; }
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"; TMP="$(mktemp -d)"
cleanup(){ [[ "$KEEP" -eq 1 ]] && echo "Descargas: $TMP" || rm -rf -- "$TMP"; }; trap cleanup EXIT
download(){ echo "Descargando $2..."; curl -fL --retry 3 --retry-delay 2 -o "$TMP/$2.part" "$1/$2"; mv -- "$TMP/$2.part" "$TMP/$2"; }
find_one(){ local root="$1" pattern="$2"; local -a files=(); while IFS= read -r -d '' f; do files+=("$f"); done < <(find "$root" -type f -iname "$pattern" -print0); [[ ${#files[@]} -eq 1 ]] || { echo "Se esperaba un $pattern; encontrados ${#files[@]}." >&2; exit 1; }; printf '%s' "${files[0]}"; }
extract_tar_bz2(){
  python3 - "$1" "$2" <<'PY'
import pathlib
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2]).resolve()
with tarfile.open(archive, mode="r:bz2") as bundle:
    for member in bundle.getmembers():
        target = (destination / member.name).resolve()
        if destination != target and destination not in target.parents:
            raise SystemExit(f"Ruta insegura dentro de {archive.name}: {member.name}")
    bundle.extractall(destination, filter="data")
PY
}
RUNTIME="https://github.com/k2-fsa/sherpa-onnx/releases/download/v$VERSION"; MODELS="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models"
WIN="sherpa-onnx-v$VERSION-win-x64-shared-MD-Release-no-tts.tar.bz2"; ANDROID="sherpa-onnx-v$VERSION-android.tar.bz2"; ASR="sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2"; VAD="silero_vad.onnx"; SEG="sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"; EMB="3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
download "$RUNTIME" "$WIN"; download "$RUNTIME" "$ANDROID"; download "$MODELS" "$ASR"; download "$MODELS" "$VAD"
download 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models' "$SEG"; download 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models' "$EMB"
for dir in win android asr seg; do mkdir -p "$TMP/$dir"; done
extract_tar_bz2 "$TMP/$WIN" "$TMP/win"
extract_tar_bz2 "$TMP/$ANDROID" "$TMP/android"
extract_tar_bz2 "$TMP/$ASR" "$TMP/asr"
extract_tar_bz2 "$TMP/$SEG" "$TMP/seg"
WIN_DLL="$(find_one "$TMP/win" 'sherpa-onnx-c-api.dll')"
mapfile -d '' ANDROID_LIBS < <(find "$TMP/android" -type f -path '*arm64-v8a*' -name 'libsherpa-onnx-c-api.so' -print0)
[[ ${#ANDROID_LIBS[@]} -eq 1 ]] || { echo "No se pudo resolver el runtime Android arm64-v8a." >&2; exit 1; }
ANDROID_SO="${ANDROID_LIBS[0]}"
ENC="$(find_one "$TMP/asr" 'encoder*.onnx')"; DEC="$(find_one "$TMP/asr" 'decoder*.onnx')"; JOIN="$(find_one "$TMP/asr" 'joiner*.onnx')"; TOK="$(find_one "$TMP/asr" 'tokens.txt')"; SEG_MODEL="$(find_one "$TMP/seg" 'model.onnx')"
WIN_OUT="$ROOT/src-tauri/resources/speech/runtime/windows-x86_64"; ANDROID_OUT="$ROOT/src-tauri/resources/speech/runtime/android-arm64-v8a"; PROFILE="$ROOT/src-tauri/resources/speech/models/$PROFILE_ID"; mkdir -p "$WIN_OUT" "$ANDROID_OUT" "$PROFILE"
find "$(dirname "$WIN_DLL")" -maxdepth 1 -type f -iname '*.dll' -exec cp -f -- {} "$WIN_OUT/" \;; find "$(dirname "$ANDROID_SO")" -maxdepth 1 -type f -iname '*.so' -exec cp -f -- {} "$ANDROID_OUT/" \;
cp -f -- "$ENC" "$PROFILE/encoder.onnx"; cp -f -- "$DEC" "$PROFILE/decoder.onnx"; cp -f -- "$JOIN" "$PROFILE/joiner.onnx"; cp -f -- "$TOK" "$PROFILE/tokens.txt"; cp -f -- "$TMP/$VAD" "$PROFILE/silero_vad.onnx"; cp -f -- "$SEG_MODEL" "$PROFILE/segmentation.onnx"; cp -f -- "$TMP/$EMB" "$PROFILE/embedding.onnx"
python3 - "$PROFILE" "$PROFILE_ID" "$ROOT/src-tauri/resources/speech/model-manifest.json" <<'PY'
import hashlib,json,pathlib,sys
root,pid,out=pathlib.Path(sys.argv[1]),sys.argv[2],pathlib.Path(sys.argv[3]); names=['encoder.onnx','decoder.onnx','joiner.onnx','tokens.txt','silero_vad.onnx','segmentation.onnx','embedding.onnx']; files=[]
for name in names:
 p=root/name; h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''): h.update(b)
 files.append({'relativePath':name,'bytes':p.stat().st_size,'sha256':h.hexdigest()})
m={'schemaVersion':1,'profiles':[{'profileId':pid,'language':'es','asr':{'type':'offlineNemoTransducer','encoder':'encoder.onnx','decoder':'decoder.onnx','joiner':'joiner.onnx','tokens':'tokens.txt','vad':'silero_vad.onnx'},'diarization':{'type':'pyannote','segmentation':'segmentation.onnx','embedding':'embedding.onnx'},'files':files}]}; out.write_text(json.dumps(m,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
PY
if [[ ! -d "$ROOT/src-tauri/gen/android" && "$SKIP_ANDROID_INIT" -eq 0 ]]; then (cd "$ROOT" && npx tauri android init); fi
if [[ "$SKIP_ANDROID_INIT" -eq 1 ]]; then
  echo 'Voz offline preparada para Windows. Ejecute desde PowerShell: npm run dev:tauri:windows'
else
  echo 'Voz offline preparada para Windows y Android.'
fi
