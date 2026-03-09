# Notia (Tauri)

Aplicación de notas basada en React + TypeScript + Vite, empaquetada para desktop con Tauri.
Incluye módulo integrado de `task-manager` accesible desde el rail izquierdo (icono de tareas).

## Stack

- React 19
- TypeScript
- Vite
- Tauri 2
- Material UI
- Lucide React

## Requisitos

- Node.js 20+
- Rust toolchain (`rustup`, `cargo`, `rustc`)
- Dependencias de sistema para Tauri en Linux (`webkit2gtk` y relacionadas)

Guía oficial de prerequisitos:
- https://tauri.app/start/prerequisites/

## Scripts

- `npm run dev`: inicia frontend web en Vite (sin runtime Tauri)
- `npm run build`: build de frontend
- `npm run lint`: lint de TypeScript/React
- `npm run dev:tauri`: inicia app desktop con Tauri (Linux autodetecta Wayland/X11)
- `npm run dev:tauri:wayland`: fuerza backend Wayland
- `npm run dev:tauri:x11`: fuerza backend X11
- `npm run build:tauri`: genera build de escritorio

## Desarrollo

1. Instalar dependencias:
   - `npm install`
2. Modo desktop (recomendado):
   - `npm run dev:tauri`

### Linux Wayland

Si tu sesión es Wayland (`XDG_SESSION_TYPE=wayland`), `npm run dev:tauri` usa Wayland automáticamente.
Si necesitás forzarlo manualmente (sin fallback):
- `npm run dev:tauri:wayland`

Si querés modo auto con fallback:
- `npm run dev:tauri:auto`
- `npm run dev:tauri:wayland:fallback`

Si aparece `Gdk-Message ... Protocol error dispatching to Wayland display`, en modo fallback el launcher intenta X11 automáticamente.
También podés forzarlo directamente:
- `npm run dev:tauri:x11`
