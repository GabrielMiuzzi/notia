#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
apk_path="${project_root}/builds/android/notia-release.apk"

if ! command -v adb >/dev/null 2>&1; then
  echo "[notia] adb is required to install the Android APK." >&2
  exit 1
fi

configure_android_device() {
  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    return
  fi

  mapfile -t connected_devices < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')
  if [[ "${#connected_devices[@]}" -eq 0 ]]; then
    return
  fi

  if [[ "${#connected_devices[@]}" -eq 1 ]]; then
    export ANDROID_SERIAL="${connected_devices[0]}"
    echo "[notia] Using Android device: ${ANDROID_SERIAL}" >&2
    return
  fi

  mapfile -t physical_devices < <(printf '%s\n' "${connected_devices[@]}" | awk '!/^emulator-/')
  if [[ "${#physical_devices[@]}" -ge 1 ]]; then
    export ANDROID_SERIAL="${physical_devices[0]}"
  else
    export ANDROID_SERIAL="${connected_devices[0]}"
  fi

  echo "[notia] Multiple devices detected. Auto-selected for install: ${ANDROID_SERIAL}" >&2
}

"${project_root}/scripts/android-build-release.sh" "$@"

configure_android_device

mapfile -t connected_devices < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')
if [[ "${#connected_devices[@]}" -eq 0 ]]; then
  echo "[notia] No Android device detected. Connect a device with USB debugging enabled." >&2
  exit 1
fi

if [[ ! -f "${apk_path}" ]]; then
  echo "[notia] APK not found: ${apk_path}" >&2
  exit 1
fi

adb -s "${ANDROID_SERIAL}" install -r "${apk_path}"
echo "[notia] Installed APK on device from ${apk_path}"
