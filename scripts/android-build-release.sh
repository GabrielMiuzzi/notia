#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"

signing_file="${project_root}/android-signing.properties"
default_store_relative=".secrets/android/notia-upload.jks"
artifact_dir="${project_root}/builds/android"
android_build_tools_dir="$(find "${HOME}/Android/Sdk/build-tools" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n 1)"

generate_secret() {
  dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 | tr -dc 'A-Za-z0-9' | cut -c1-24
}

resolve_value() {
  local property_key="${1}"
  local env_key="${2}"

  if [[ -n "${!env_key:-}" ]]; then
    printf '%s' "${!env_key}"
    return
  fi

  if [[ -f "${signing_file}" ]]; then
    local raw
    raw="$(sed -n "s/^${property_key}=//p" "${signing_file}" | head -n 1)"
    if [[ -n "${raw}" ]]; then
      printf '%s' "${raw}"
    fi
  fi
}

write_signing_file() {
  local file_path="${1}"
  local store_path="${2}"
  local store_pass="${3}"
  local alias_name="${4}"
  local key_pass="${5}"

  cat >"${file_path}" <<EOF
storeFile=${store_path}
storePassword=${store_pass}
keyAlias=${alias_name}
keyPassword=${key_pass}
EOF
}

run_apksigner_sign() {
  local apksigner_bin="${1}"
  local key_pass_value="${2}"
  local aligned_apk="${3}"
  local signed_apk="${4}"

  "${apksigner_bin}" sign \
    --ks "${store_file}" \
    --ks-pass "pass:${store_password}" \
    --ks-key-alias "${key_alias}" \
    --key-pass "pass:${key_pass_value}" \
    --out "${signed_apk}" \
    "${aligned_apk}"
}

ensure_local_signing_config() {
  local current_store_file="${1:-}"
  local current_store_password="${2:-}"
  local current_key_alias="${3:-}"
  local current_key_password="${4:-}"

  if [[ -n "${current_store_file}" && -n "${current_store_password}" && -n "${current_key_alias}" && -n "${current_key_password}" ]]; then
    return
  fi

  local generated_store_relative="${current_store_file:-${default_store_relative}}"
  local generated_store_absolute="${generated_store_relative}"
  local generated_store_password="${current_store_password:-$(generate_secret)}"
  local generated_key_alias="${current_key_alias:-notia}"
  local generated_key_password="${current_key_password:-${generated_store_password}}"

  if [[ "${generated_store_absolute}" != /* ]]; then
    generated_store_absolute="${project_root}/${generated_store_absolute}"
  fi

  mkdir -p "$(dirname "${generated_store_absolute}")"

  if [[ ! -f "${generated_store_absolute}" ]]; then
    if ! command -v keytool >/dev/null 2>&1; then
      echo "[notia] keytool is required to generate the Android signing keystore." >&2
      exit 1
    fi

    keytool -genkeypair \
      -keystore "${generated_store_absolute}" \
      -storepass "${generated_store_password}" \
      -alias "${generated_key_alias}" \
      -keypass "${generated_key_password}" \
      -keyalg RSA \
      -keysize 2048 \
      -validity 10000 \
      -dname "CN=Notia, OU=Development, O=Notia, L=Local, S=Local, C=AR" \
      -noprompt >/dev/null
  fi

  write_signing_file \
    "${signing_file}" \
    "${generated_store_relative}" \
    "${generated_store_password}" \
    "${generated_key_alias}" \
    "${generated_key_password}"

  echo "[notia] Generated local Android signing config at ${signing_file}" >&2
}

copy_ready_apk() {
  local signed_apk
  signed_apk="$(find "${project_root}/src-tauri/gen/android/app/build/outputs/apk" -type f -name '*.apk' ! -name '*-unsigned.apk' | sort | tail -n 1)"

  if [[ -z "${signed_apk}" ]]; then
    signed_apk="$(sign_unsigned_apk)"
  fi

  if [[ -z "${signed_apk}" ]]; then
    echo "[notia] Signed APK not found after build." >&2
    exit 1
  fi

  mkdir -p "${artifact_dir}"
  local ready_apk="${artifact_dir}/notia-release.apk"
  cp "${signed_apk}" "${ready_apk}"

  echo "[notia] APK ready: ${ready_apk}"
}

sign_unsigned_apk() {
  local unsigned_apk
  unsigned_apk="$(find "${project_root}/src-tauri/gen/android/app/build/outputs/apk" -type f -name '*-unsigned.apk' | sort | tail -n 1)"

  if [[ -z "${unsigned_apk}" ]]; then
    return
  fi

  if [[ -z "${android_build_tools_dir}" ]]; then
    echo "[notia] Android build-tools not found. Cannot sign unsigned APK." >&2
    exit 1
  fi

  local zipalign_bin="${android_build_tools_dir}/zipalign"
  local apksigner_bin="${android_build_tools_dir}/apksigner"

  if [[ ! -x "${zipalign_bin}" || ! -x "${apksigner_bin}" ]]; then
    echo "[notia] zipalign/apksigner not found in ${android_build_tools_dir}." >&2
    exit 1
  fi

  local aligned_apk="${artifact_dir}/notia-release-aligned.apk"
  local signed_apk="${artifact_dir}/notia-release-signed.apk"
  mkdir -p "${artifact_dir}"

  "${zipalign_bin}" -f -p 4 "${unsigned_apk}" "${aligned_apk}"

  if ! run_apksigner_sign "${apksigner_bin}" "${key_password}" "${aligned_apk}" "${signed_apk}"; then
    if [[ "${key_password}" != "${store_password}" ]]; then
      run_apksigner_sign "${apksigner_bin}" "${store_password}" "${aligned_apk}" "${signed_apk}"
    else
      exit 1
    fi
  fi

  "${apksigner_bin}" verify -v "${signed_apk}" >/dev/null

  printf '%s\n' "${signed_apk}"
}

store_file="$(resolve_value storeFile NOTIA_ANDROID_KEYSTORE_PATH)"
store_password="$(resolve_value storePassword NOTIA_ANDROID_KEYSTORE_PASSWORD)"
key_alias="$(resolve_value keyAlias NOTIA_ANDROID_KEY_ALIAS)"
key_password="$(resolve_value keyPassword NOTIA_ANDROID_KEY_PASSWORD)"

ensure_local_signing_config "${store_file}" "${store_password}" "${key_alias}" "${key_password}"

store_file="$(resolve_value storeFile NOTIA_ANDROID_KEYSTORE_PATH)"
store_password="$(resolve_value storePassword NOTIA_ANDROID_KEYSTORE_PASSWORD)"
key_alias="$(resolve_value keyAlias NOTIA_ANDROID_KEY_ALIAS)"
key_password="$(resolve_value keyPassword NOTIA_ANDROID_KEY_PASSWORD)"

if [[ "${store_file}" != /* ]]; then
  store_file="${project_root}/${store_file}"
fi

if [[ ! -f "${store_file}" ]]; then
  echo "[notia] Keystore not found: ${store_file}" >&2
  exit 1
fi

"${project_root}/scripts/tauri-cli.sh" android build --apk --target aarch64 "$@"
copy_ready_apk
