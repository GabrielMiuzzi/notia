# Notia (Tauri)

Aplicación de notas basada en React + TypeScript + Vite, empaquetada para desktop con Tauri.

## Stack

- React 19
- TypeScript
- Vite
- Tauri 2

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
- `npm run dev:tauri`: inicia app desktop con Tauri
- `npm run build:tauri`: genera build de escritorio

## Desarrollo

1. Instalar dependencias:
   - `npm install`
2. Modo desktop (recomendado):
   - `npm run dev:tauri`
