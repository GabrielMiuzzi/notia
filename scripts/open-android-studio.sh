#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
android_project_dir="${project_root}/src-tauri/gen/android"

source "${script_dir}/android-env.sh"

find_android_studio_launcher() {
  local explicit_launcher="${ANDROID_STUDIO_BIN:-${NOTIA_ANDROID_STUDIO_BIN:-}}"
  if [[ -n "${explicit_launcher}" ]]; then
    if [[ -x "${explicit_launcher}" ]]; then
      printf '%s\n' "${explicit_launcher}"
      return 0
    fi

    echo "[notia] ANDROID_STUDIO_BIN points to a non-executable path: ${explicit_launcher}" >&2
    return 1
  fi

  if command -v studio >/dev/null 2>&1; then
    command -v studio
    return 0
  fi

  if command -v android-studio >/dev/null 2>&1; then
    command -v android-studio
    return 0
  fi

  local candidates=(
    "/opt/android-studio/bin/studio.sh"
    "/usr/local/android-studio/bin/studio.sh"
    "$HOME/android-studio/bin/studio.sh"
    "$HOME/Android/android-studio/bin/studio.sh"
  )
  local candidate

  for candidate in "${candidates[@]}"; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  while IFS= read -r candidate; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done < <(
    find \
      "$HOME/.local/share/JetBrains/Toolbox/apps/AndroidStudio" \
      "$HOME/.local/share/JetBrains/Toolbox/apps/android-studio" \
      -type f -name 'studio.sh' 2>/dev/null
  )

  return 1
}

main() {
  local launcher
  launcher="$(find_android_studio_launcher || true)"
  if [[ -z "${launcher}" ]]; then
    cat >&2 <<EOF
[notia] Android Studio launcher was not detected.
[notia] Set ANDROID_STUDIO_BIN=/ruta/a/studio.sh and rerun.
EOF
    exit 1
  fi

  if [[ ! -d "${android_project_dir}" ]]; then
    cat >&2 <<EOF
[notia] Android project was not generated yet.
[notia] Run 'npm run tauri android init' or 'npm run dev:android' once before opening Android Studio.
EOF
    exit 1
  fi

  local open_target="${android_project_dir}"
  if [[ -f "${android_project_dir}/settings.gradle.kts" ]]; then
    open_target="${android_project_dir}/settings.gradle.kts"
  elif [[ -f "${android_project_dir}/settings.gradle" ]]; then
    open_target="${android_project_dir}/settings.gradle"
  fi

  "${launcher}" "${open_target}" >/dev/null 2>&1 &
}

main "$@"
