#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"

tauri_args=("$@")

if [[ "$(uname -s)" == "Linux" ]] && ! command -v linuxdeploy >/dev/null 2>&1; then
  echo "[notia] linuxdeploy is not installed. Building Linux bundles without AppImage (deb,rpm)." >&2
  exec "${project_root}/scripts/tauri-cli.sh" build --bundles deb,rpm "${tauri_args[@]}"
fi

exec "${project_root}/scripts/tauri-cli.sh" build "${tauri_args[@]}"
