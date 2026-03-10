#!/usr/bin/env bash
set -euo pipefail

configure_android_toolchain() {
  local cmd="${1:-}"
  if [[ "${cmd}" != "android" ]]; then
    return
  fi

  local sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
  local ndk_dir="${ANDROID_NDK_HOME:-${NDK_HOME:-}}"
  if [[ -z "${ndk_dir}" ]]; then
    ndk_dir="$(ls -d "${sdk_root}"/ndk/* 2>/dev/null | sort -V | tail -1 || true)"
  fi

  if [[ -z "${ndk_dir}" ]]; then
    echo "[notia] No Android NDK found. Continuing without Android linker overrides." >&2
    return
  fi

  local toolchain_bin="${ndk_dir}/toolchains/llvm/prebuilt/linux-x86_64/bin"
  if [[ ! -d "${toolchain_bin}" ]]; then
    echo "[notia] Android NDK toolchain not found at ${toolchain_bin}. Continuing without overrides." >&2
    return
  fi

  export NDK_HOME="${ndk_dir}"
  export ANDROID_NDK_HOME="${ndk_dir}"
  export PATH="${toolchain_bin}:${PATH}"
  export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="${toolchain_bin}/aarch64-linux-android24-clang"
  export CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER="${toolchain_bin}/armv7a-linux-androideabi24-clang"
  export CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER="${toolchain_bin}/x86_64-linux-android24-clang"
  export CARGO_TARGET_I686_LINUX_ANDROID_LINKER="${toolchain_bin}/i686-linux-android24-clang"
}

configure_android_device() {
  local cmd="${1:-}"
  if [[ "${cmd}" != "android" ]]; then
    return
  fi

  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    return
  fi

  if ! command -v adb >/dev/null 2>&1; then
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
  echo "[notia] Multiple devices detected. Auto-selected: ${ANDROID_SERIAL}" >&2
}

configure_android_toolchain "$@"
configure_android_device "$@"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
tauri_bin="${project_root}/node_modules/.bin/tauri"

if [[ -x "${tauri_bin}" ]]; then
  exec "${tauri_bin}" "$@"
fi

exec npx tauri "$@"
