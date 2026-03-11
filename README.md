# Notia

Notia es una app de notas construida con React + TypeScript + Vite y empaquetada con Tauri 2.
El workspace integra vistas de documentos, grafo de enlaces y un modulo de gestion de tareas.

## Que podes hacer en Notia

- Trabajar con carpetas locales como "librerias" de notas.
- Crear y editar notas Markdown y texto plano.
- Abrir y editar archivos `inkdoc` (con guardado en archivo).
- Visualizar imagenes dentro del area principal.
- Navegar un grafo de relaciones entre notas.
- Gestionar tareas con tableros, estados, grupos y Pomodoro.
- Buscar archivos por nombre dentro de la libreria activa.
- Operar archivos con menu contextual: copiar, mover, pegar, renombrar y eliminar.

## Recorrido rapido para usuario final

1. Abri la app.
2. En el footer del panel izquierdo, entra a `Administrar librerias`.
3. Agrega una carpeta de trabajo.
4. Usa la barra superior para crear:
   - `New Note`
   - `New InkDoc`
   - `New Folder`
5. Hace click en un archivo del arbol para abrirlo en pestana.
6. Cambia de vista con el rail izquierdo:
   - `Graph view`
   - `Task manager`

## Funciones por seccion

### Explorador de archivos

- Arbol de carpetas y archivos de la libreria activa.
- Click derecho para abrir menu contextual:
  - Crear carpeta/nota/inkdoc
  - Copiar o mover
  - Pegar en carpeta destino
  - Renombrar
  - Eliminar (con confirmacion)
- Busqueda integrada en el panel lateral.
- Refresco del arbol configurable desde Settings.

### Editor de documentos

- Pestanas para multiples archivos abiertos.
- Guardado automatico para documentos de texto y markdown.
- Estado visual de guardado: guardando, guardado o error.
- Vista Markdown con soporte de wikilinks entre notas.
- Vista dedicada para archivos `inkdoc`.

### Vista Graph

- Muestra nodos y conexiones de la libreria activa.
- Permite abrir archivos desde el grafo.

### Task Manager

- Tableros personalizados.
- Grupos por tablero.
- Tareas con estados, prioridad, subtareas y comentarios.
- Secciones de tareas completadas y canceladas.
- Panel Pomodoro integrado con registro de sesiones.
- Confirmaciones para acciones destructivas (ej: eliminar tarea/tablero).

### Configuracion

- Ajuste de intervalo de refresco del explorador.
- Visualizacion del dispositivo en ejecucion.
- Selector de tema claro/oscuro desde la barra de titulo.

## Atajos y productividad

- `Ctrl + Tab`: ir a la siguiente pestana abierta.
- `Ctrl + W`: cerrar pestana activa.

## Requisitos

- Node.js 20 o superior
- npm 10 o superior
- Rust toolchain (`rustup`, `cargo`, `rustc`)
- Dependencias de sistema para Tauri en Linux (`webkit2gtk` y relacionadas)

Guia oficial de prerequisitos Tauri:
- https://tauri.app/start/prerequisites/

## Inicio rapido

1. Instalar dependencias:
   - `npm install`
2. Levantar frontend web:
   - `npm run dev`
3. Levantar app desktop (Linux, con deteccion Wayland/X11):
   - `npm run dev:tauri`

## Scripts

- `npm run dev`: Vite dev server (solo web).
- `npm run build`: compilacion TypeScript + build Vite.
- `npm run preview`: preview del build web.
- `npm run lint`: analisis estatico con ESLint.
- `npm run tauri`: wrapper del CLI de Tauri (desktop y mobile).
- `npm run dev:tauri`: dev desktop en Linux con backend auto (Wayland/X11).
- `npm run dev:tauri:linux`: alias de `dev:tauri`.
- `npm run dev:tauri:auto`: alias de `dev:tauri`.
- `npm run dev:tauri:wayland`: fuerza backend Wayland sin fallback.
- `npm run dev:tauri:wayland:fallback`: Wayland con fallback a X11.
- `npm run dev:tauri:x11`: fuerza backend X11.
- `npm run dev:android`: dev en Android usando Tauri mobile.
- `npm run build:tauri`: build empaquetado con Tauri.

## Tecnico (resumen corto)

- Frontend: React 19 + TypeScript + Vite 7.
- Desktop/mobile shell: Tauri 2 (Rust).
- UI: componentes propios + Material UI (en modulo de tareas).
- Iconos: Lucide React.

## Notas Linux (Wayland/X11)

- `scripts/tauri-dev-linux.sh` detecta sesion Linux y configura variables de entorno para mejorar compatibilidad de WebKitGTK.
- Si Wayland falla al iniciar, el modo fallback reintenta en X11 automaticamente.

## Notas Android

- `npm run dev:android` intenta detectar el NDK mas reciente en `$HOME/Android/Sdk/ndk/*`.
- El wrapper tambien autoselecciona `ANDROID_SERIAL` cuando hay dispositivos conectados por `adb`.

## Convenciones del proyecto

- Evitar logica de negocio en componentes de UI.
- Centralizar reglas de dominio en engines/services/hooks reutilizables.
- Priorizar compatibilidad multiplataforma (Linux, Windows, macOS, Android, iOS).
- Mantener commands Tauri delgados y delegar en capas de servicio.
