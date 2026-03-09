#!/usr/bin/env bash
set -euo pipefail

launch_tauri() {
  echo "[notia] Tauri Linux backend: ${WINIT_UNIX_BACKEND}"
  tauri dev "$@"
}

configure_x11() {
  export GDK_BACKEND=x11
  export WINIT_UNIX_BACKEND=x11
  export WEBKIT_DISABLE_DMABUF_RENDERER=1
}

configure_wayland() {
  # Keep x11 as secondary GDK fallback for better compatibility.
  export GDK_BACKEND=wayland,x11
  export WINIT_UNIX_BACKEND=wayland
  # Some GPU/compositor stacks crash WebKitGTK on dmabuf.
  export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
}

requested_backend="${NOTIA_TAURI_BACKEND:-auto}"

if [[ "${requested_backend}" == "wayland" ]]; then
  if [[ -z "${WAYLAND_DISPLAY:-}" ]]; then
    echo "[notia] WAYLAND_DISPLAY is empty; falling back to X11."
    configure_x11
  else
    configure_wayland
  fi
elif [[ "${requested_backend}" == "x11" ]]; then
  configure_x11
else
  case "${XDG_SESSION_TYPE:-}" in
    wayland)
      if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
        configure_wayland
      else
        echo "[notia] XDG_SESSION_TYPE=wayland but WAYLAND_DISPLAY is empty; using X11."
        configure_x11
      fi
      ;;
    x11)
      configure_x11
      ;;
    *)
      # Default to Wayland first on unknown Linux sessions.
      if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
        configure_wayland
      else
        configure_x11
      fi
      ;;
  esac
fi

if launch_tauri "$@"; then
  exit 0
fi

if [[ "${WINIT_UNIX_BACKEND:-}" == "wayland" && "${NOTIA_TAURI_FALLBACK_X11:-1}" == "1" ]]; then
  echo "[notia] Wayland launch failed; retrying with X11 fallback."
  configure_x11
  exec tauri dev "$@"
fi

exit 1
