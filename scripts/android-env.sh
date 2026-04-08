#!/usr/bin/env bash

find_android_sdk_root() {
  local candidates=(
    "${ANDROID_HOME:-}"
    "${ANDROID_SDK_ROOT:-}"
    "/opt/android-sdk"
    "$HOME/Android/Sdk"
  )
  local candidate

  for candidate in "${candidates[@]}"; do
    if [[ -n "${candidate}" && -d "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  return 1
}

find_android_ndk_dir() {
  local sdk_root="${1:-}"
  local env_candidates=(
    "${ANDROID_NDK_HOME:-}"
    "${NDK_HOME:-}"
  )
  local candidate

  for candidate in "${env_candidates[@]}"; do
    if [[ -n "${candidate}" && -d "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  if [[ -z "${sdk_root}" || ! -d "${sdk_root}/ndk" ]]; then
    return 1
  fi

  candidate="$(find "${sdk_root}/ndk" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n 1 || true)"
  if [[ -n "${candidate}" && -d "${candidate}" ]]; then
    printf '%s\n' "${candidate}"
    return 0
  fi

  return 1
}

prepend_path_once() {
  local entry="${1:-}"
  if [[ -z "${entry}" || ! -d "${entry}" ]]; then
    return
  fi

  if [[ ":${PATH}:" != *":${entry}:"* ]]; then
    export PATH="${entry}:${PATH}"
  fi
}

configure_android_environment() {
  local sdk_root
  sdk_root="$(find_android_sdk_root || true)"
  if [[ -z "${sdk_root}" ]]; then
    return
  fi

  export ANDROID_HOME="${sdk_root}"
  export ANDROID_SDK_ROOT="${sdk_root}"

  prepend_path_once "${sdk_root}/cmdline-tools/latest/bin"
  prepend_path_once "${sdk_root}/platform-tools"

  local ndk_dir
  ndk_dir="$(find_android_ndk_dir "${sdk_root}" || true)"
  if [[ -z "${ndk_dir}" ]]; then
    return
  fi

  export NDK_HOME="${ndk_dir}"
  export ANDROID_NDK_HOME="${ndk_dir}"

  local toolchain_bin="${ndk_dir}/toolchains/llvm/prebuilt/linux-x86_64/bin"
  if [[ ! -d "${toolchain_bin}" ]]; then
    return
  fi

  prepend_path_once "${toolchain_bin}"
  export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="${toolchain_bin}/aarch64-linux-android24-clang"
  export CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER="${toolchain_bin}/armv7a-linux-androideabi24-clang"
  export CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER="${toolchain_bin}/x86_64-linux-android24-clang"
  export CARGO_TARGET_I686_LINUX_ANDROID_LINKER="${toolchain_bin}/i686-linux-android24-clang"
}

configure_java_environment() {
  local current_java_home="${JAVA_HOME:-}"
  if [[ -n "${current_java_home}" && -x "${current_java_home}/bin/java" ]]; then
    prepend_path_once "${current_java_home}/bin"
    return
  fi

  local candidates=(
    "$HOME/.jdks/ms-21.0.10"
    "$HOME/.jdks/temurin-21"
    "$HOME/.jdks/jbr-21"
    "/usr/lib/jvm/default-java"
    "/usr/lib/jvm/java-21-openjdk"
    "/usr/lib/jvm/java-21-openjdk-amd64"
    "/usr/lib/jvm/java-21-openjdk-x64"
    "/usr/lib/jvm/temurin-21-jdk"
    "/usr/lib/jvm/java-17-openjdk"
    "/usr/lib/jvm/java-17-openjdk-amd64"
    "/usr/lib/jvm/java-17-openjdk-x64"
    "/usr/lib/jvm/temurin-17-jdk"
    "/usr/lib/jvm/default"
  )
  local candidate

  for candidate in "${candidates[@]}"; do
    if [[ -x "${candidate}/bin/java" ]]; then
      export JAVA_HOME="${candidate}"
      prepend_path_once "${candidate}/bin"
      return
    fi
  done

  echo "[notia] No compatible JDK found for Android builds." >&2
  echo "[notia] Install JDK 21 or JDK 17, or set JAVA_HOME to a compatible runtime before building." >&2
  return 1
}
