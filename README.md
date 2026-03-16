# Notia

**Notia** es una aplicación de notas multiplataforma construida con **React + TypeScript + Vite** en el frontend y **Tauri 2** en el backend. Ofrece una experiencia unificada para gestión de documentos, mapas de conocimiento y administración de tareas.

![Versión](https://img.shields.io/badge/version-1.0.1--ALPHA-blue)
![Tauri](https://img.shields.io/badge/Tauri-2-orange)
![React](https://img.shields.io/badge/React-19-blue)
![Rust](https://img.shields.io/badge/Rust-2021-orange)

---

## 📋 Índice

- [Características Principales](#características-principales)
- [Arquitectura](#arquitectura)
- [Módulos](#módulos)
- [Funcionalidades por Sección](#funcionalidades-por-sección)
- [Integración Bluetooth (ColdPass)](#integración-bluetooth-coldpass)
- [Guía de Usuario](#guía-de-usuario)
- [Requisitos](#requisitos)
- [Instalación y Desarrollo](#instalación-y-desarrollo)
- [Scripts Disponibles](#scripts-disponibles)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Tecnologías](#tecnologías)

---

## ✨ Características Principales

- **Librerías de Notas**: Trabaja con carpetas locales organizadas como bibliotecas de documentos
- **Multi-formato**: Soporte para Markdown, texto plano y archivos `.inkdoc`
- **Grafo de Conocimiento**: Visualización de relaciones entre notas mediante grafos interactivos
- **Task Manager Completo**: Tableros Kanban, grupos, tareas con subtareas, prioridad y comentarios
- **Pomodoro Integrado**: Temporizador Pomodoro con registro histórico de sesiones
- **Gestión de Archivos**: Operaciones completas (copiar, mover, pegar, renombrar, eliminar)
- **Búsqueda Integrada**: Búsqueda de archivos por nombre dentro de librerías activas
- **Temas**: Selector de tema claro/oscuro desde la barra de título
- **Multi-plataforma**: Windows, macOS, Linux, Android (en desarrollo)

---

## 🏗️ Arquitectura

### Frontend (TypeScript + React)
- **Framework**: React 19 con TypeScript
- **Build Tool**: Vite 7
- **UI**: Material UI v7 + Emotion
- **Iconos**: Lucide React
- **Markdown**: Milkdown Crepe para edición rica

### Backend (Rust + Tauri 2)
- **Lenguaje**: Rust 2021
- **Framework**: Tauri 2 para aplicaciones desktop
- **Plugins**: `tauri-plugin-dialog` para diálogos nativos
- **Serialización**: Serde para JSON
- **Bluetooth**: `btleplug` para comunicación Bluetooth LE (Linux)

### Comunicación Frontend-Backend
- **Commands**: Invocations desde TypeScript a funciones Rust
- **DTOs**: Objetos de transferencia de datos serializados
- **Estado Global**: Context API de React para gestión de estado

---

## 📦 Módulos

### 1. **DrawIO** (`src/modules/drawio/`)
Motor de renderizado y manipulación de diagramas Draw.io integrados en las notas.

### 2. **InkDoc** (`src/modules/inkdoc/`)
- Editor especializado para archivos `.inkdoc`
- Motor de renderizado personalizado
- Transformadores de contenido
- Configuración de estilo y persistencia

### 3. **Task Manager** (`src/modules/task-manager/`)
- **Componentes**: UI de tableros, tareas, grupos
- **Engines**: Lógica de negocio para gestión de tareas
- **Hooks**: React hooks para estado y efectos
- **Services**: Comunicación con backend Rust
- **Types**: Definiciones TypeScript de dominios

---

## 🗂️ Funcionalidades por Sección

### Explorador de Archivos
- Árbol jerárquico de carpetas y archivos
- **Menú contextual** (click derecho):
  - Crear carpeta / nota / inkdoc
  - Copiar o mover archivos
  - Pegar en carpeta destino
  - Renombrar archivos
  - Eliminar (con confirmación)
- Búsqueda integrada en panel lateral
- Refresco del árbol configurable desde Settings

### Editor de Documentos
- **Pestañas múltiples**: Varios archivos abiertos simultáneamente
- **Guardado automático**: Para texto y Markdown
- **Indicadores de estado**: Guardando ✓ / Error ✗
- **Markdown con wikilinks**: Enlaces entre notas `[[nota]]`
- **Vista InkDoc dedicada**: Editor especializado

### Vista Graph
- Visualización de nodos (archivos) y conexiones (enlaces)
- Navegación interactiva del grafo
- Apertura de archivos desde nodos del grafo

### Task Manager
- **Tableros personalizados**: Múltiples kanbans
- **Grupos**: Organización por categorías
- **Tareas completo**:
  - Estados (pendiente, en progreso, completada, cancelada)
  - Prioridad (alta, media, baja)
  - Subtareas anidadas
  - Comentarios y discusiones
- **Secciones históricas**: Tareas completadas y canceladas
- **Panel Pomodoro**:
  - Temporizador 25/5 minutos
  - Registro de sesiones completadas
  - Estadísticas de productividad

### Configuración
- Intervalo de refresco del explorador de archivos
- Visualización de dispositivo en ejecución
- Selector de tema claro/oscuro
- Preferencias de usuario persistentes

---

## 🔵 Integración Bluetooth (ColdPass)

Notia incluye integración con dispositivos **ColdPass** mediante Bluetooth Low Energy (BLE).

### Arquitectura Bluetooth

#### Backend Rust (`src-tauri/src/`)
- **`commands/bluetooth.rs`**: Commands expuestos al frontend
  - `get_bluetooth_status()`: Estado actual del adaptador
  - `send_message()`: Envío de mensajes a dispositivos
  - `authenticate()`: Autenticación con ColdPass
  - Platform-specific con conditional compilation:
    - Linux: Implementación completa con GATT
    - macOS/Windows: Implementación limitada
    - Android/iOS: Stubs para futura implementación

- **`services/bluetooth_service.rs`**: Lógica de negocio BLE
  - Escaneo de dispositivos
  - Conexión GATT (Linux)
  - Gestión de características y descriptores

- **`dto/bluetooth.rs`**: Data Transfer Objects
  - `BluetoothStatus`: Estado del adaptador
  - `SendMessageRequest`: Payload para envío de mensajes

#### Frontend TypeScript (`src/`)
- **`components/notia/ColdPassBluetoothCard.tsx`**: UI Card de estado
- **`services/coldpass/coldpassBluetooth.ts`**: Servicio de comunicación
- **Integration**: Invoca commands Rust vía Tauri API

### Soporte por Plataforma

| Plataforma | Estado | Características |
|------------|--------|-----------------|
| **Linux**  | ✅ Completo | GATT connection, scan, send, auth |
| **macOS**  | ⚠️ Limitado | Operaciones básicas |
| **Windows**| ⚠️ Limitado | Operaciones básicas |
| **Android**| 🚧 Pendiente | Stub implementado |
| **iOS**    | 🚧 Pendiente | Stub implementado |

---

## 📖 Guía de Usuario

### Inicio Rápido

1. **Abrir la aplicación**
2. **Configurar librería**:
   - Footer del panel izquierdo → `Administrar librerías`
   - Agregar carpeta de trabajo local
3. **Crear contenido** (barra superior):
   - `New Note` → Nota Markdown/texto
   - `New InkDoc` → Documento InkDoc
   - `New Folder` → Carpeta organizadora
4. **Abrir archivos**: Click en el árbol de archivos
5. **Navegar entre vistas** (rail izquierdo):
   - `Graph view` → Mapa de relaciones
   - `Task manager` → Gestión de tareas

### Atajos de Teclado

| Atajo | Acción |
|-------|--------|
| `Ctrl + Tab` | Ir a siguiente pestaña abierta |
| `Ctrl + W` | Cerrar pestaña activa |

---

## 🛠️ Requisitos

### Sistema

- **Node.js**: 20 o superior
- **npm**: 10 o superior
- **Rust Toolchain**: `rustup`, `cargo`, `rustc` (edición 2021)
- **Git**: Para control de versiones

### Dependencias de Sistema (Linux)

Para Tauri en Linux, se requieren:

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libdbus-1-dev \
    libbluetooth-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel \
    gcc \
    gcc-c++ \
    make \
    curl \
    wget \
    openssl-devel \
    gtk3-devel \
    libayatana-appindicator3-devel \
    librsvg2-devel \
    dbus-devel \
    bluez-devel
```

📖 **Guía oficial de prerequisitos Tauri**:  
https://tauri.app/start/prerequisites/

---

## 🚀 Instalación y Desarrollo

### Clonar Repositorio

```bash
git clone <repository-url>
cd notia
```

### Instalar Dependencias

```bash
# Frontend (Node.js)
npm install

# Backend (Rust - automático con Tauri)
# Se descarga con cargo durante el build
```

### Modo Desarrollo

```bash
# Solo frontend web (Vite)
npm run dev

# App desktop completa (Linux, auto-detecta Wayland/X11)
npm run dev:tauri

# Forzar backend Wayland
NOTIA_TAURI_BACKEND=wayland npm run dev:tauri:wayland

# Forzar backend X11
NOTIA_TAURI_BACKEND=x11 npm run dev:tauri:x11

# Wayland con fallback a X11
NOTIA_TAURI_BACKEND=wayland NOTIA_TAURI_FALLBACK_X11=1 npm run dev:tauri:wayland:fallback
```

### Desarrollo para Android

```bash
# Configurar NDK (se auto-detecta)
npm run dev:android

# Build debug APK
npm run build:android:debug

# Build release AAB
npm run build:android:aab

# Instalar release en dispositivo
npm run install:android:release
```

---

## 📜 Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Vite dev server (solo web, puerto 1420) |
| `npm run build` | Compilación TypeScript + build Vite |
| `npm run lint` | Ejecutar ESLint en el código |
| `npm run preview` | Preview del build en producción |
| `npm run tauri` | CLI de Tauri (pasa argumentos) |
| `npm run dev:tauri` | Desarrollo desktop Linux (auto-detect) |
| `npm run dev:tauri:wayland` | Desarrollo con backend Wayland |
| `npm run dev:tauri:x11` | Desarrollo con backend X11 |
| `npm run dev:android` | Desarrollo en dispositivo Android |
| `npm run build:android:debug` | Build APK debug para aarch64 |
| `npm run build:android:release` | Build APK release |
| `npm run build:android:aab` | Build Android App Bundle (Play Store) |
| `npm run install:android:release` | Instalar APK release en dispositivo |
| `npm run build:tauri` | Build release para plataforma actual |

---

## 📁 Estructura del Proyecto

```
notia/
├── src/                          # Frontend TypeScript/React
│   ├── components/               # Componentes React reutilizables
│   │   ├── common/               # Componentes genéricos
│   │   └── notia/                # Componentes específicos de Notia
│   ├── modules/                  # Módulos de negocio
│   │   ├── drawio/               # Motor Draw.io
│   │   ├── inkdoc/               # Editor InkDoc
│   │   └── task-manager/         # Gestión de tareas
│   ├── services/                 # Servicios de comunicación
│   │   ├── coldpass/             # Bluetooth ColdPass
│   │   ├── files/                # Operaciones de archivos
│   │   ├── libraries/            # Gestión de librerías
│   │   ├── preferences/          # Preferencias de usuario
│   │   ├── runtime/              # Servicios runtime
│   │   ├── views/                # Servicios de vistas
│   │   └── window/               # Gestión de ventanas
│   ├── hooks/                    # Custom React hooks
│   ├── context/                  # Context API providers
│   ├── engines/                  # Motores de procesamiento
│   ├── types/                    # Definiciones TypeScript
│   ├── constants/                # Constantes de la app
│   ├── utils/                    # Utilidades
│   ├── styles/                   # Estilos globales
│   ├── App.tsx                   # Componente raíz
│   └── main.tsx                  # Entry point
├── src-tauri/                    # Backend Rust
│   ├── src/
│   │   ├── commands/             # Commands expuestos a frontend
│   │   │   └── bluetooth.rs      # Commands Bluetooth
│   │   ├── services/             # Lógica de negocio
│   │   │   └── bluetooth_service.rs
│   │   ├── dto/                  # Data Transfer Objects
│   │   │   └── bluetooth.rs      # DTOs Bluetooth
│   │   ├── state/                # Estado global Rust
│   │   │   └── bluetooth_state.rs
│   │   ├── mobile_directory_picker.rs  # Picker para móviles
│   │   ├── lib.rs                # Lib root con exports
│   │   └── main.rs               # Entry point Tauri
│   ├── capabilities/             # Permisos y capacidades
│   ├── icons/                    # Íconos de la aplicación
│   ├── gen/                      # Código generado
│   ├── Cargo.toml                # Dependencias Rust
│   ├── build.rs                  # Build script Tauri
│   └── tauri.conf.json           # Configuración Tauri
├── public/                       # Assets estáticos
├── scripts/                      # Scripts de utilidad
│   ├── tauri-dev-linux.sh        # Dev launcher Linux
│   ├── tauri-build-release.sh    # Build release
│   └── android-*.sh              # Scripts Android
├── package.json                  # Dependencias Node
├── tsconfig.json                 # Configuración TypeScript
├── vite.config.ts                # Configuración Vite
└── README.md                     # Esta documentación
```

---

## 🧰 Tecnologías

### Frontend
- **React 19** - UI library
- **TypeScript 5.9** - Tipado estático
- **Vite 7** - Build tool y dev server
- **Material UI v7** - Componentes UI
- **Emotion** - CSS-in-JS
- **Lucide React** - Sistema de íconos
- **Milkdown Crepe** - Editor Markdown rico

### Backend
- **Rust 2021** - Lenguaje de sistemas
- **Tauri 2** - Framework desktop
- **Serde** - Serialización JSON
- **btleplug 0.11.7** - Bluetooth LE (Linux)
- **Tokio** - Runtime async
- **Futures** - Programación async

### DevOps
- **ESLint** - Linting de código
- **Node.js 20+** - Runtime JavaScript
- **Cargo** - Package manager Rust
- **Android NDK** - Build para Android

---

## 📝 Licencia

Copyright © 2026 Gabriel. Todos los derechos reservados.

---

## 🤝 Contribución

Para contribuir al proyecto:
1. Fork el repositorio
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

---

## 📞 Contacto

Para consultas o soporte, contactar al equipo de desarrollo.

---

**Notia** - Tu espacio de conocimiento, organizado.
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
- `npm run build:android:debug`: genera APK debug firmado para pruebas locales.
- `npm run build:android:release`: genera APK release firmado.
- `npm run build:android:aab`: genera APK release firmado y AAB.
- `npm run install:android:release`: genera el APK release firmado y lo instala por `adb`.
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
- `npm run build:android:release` crea automaticamente una keystore local de desarrollo si no encuentra configuracion de firma.
- El APK firmado listo para instalar se copia a `builds/android/notia-release.apk`.
- `npm run install:android:release` usa ese APK y ejecuta `adb install -r`.
- Si queres usar tu propia firma, podes crear `android-signing.properties` y completar:
  - `storeFile`
  - `storePassword`
  - `keyAlias`
  - `keyPassword`
- Tambien se pueden usar variables de entorno:
  - `NOTIA_ANDROID_KEYSTORE_PATH`
  - `NOTIA_ANDROID_KEYSTORE_PASSWORD`
  - `NOTIA_ANDROID_KEY_ALIAS`
  - `NOTIA_ANDROID_KEY_PASSWORD`
- El build release firmado queda disponible con `npm run build:android:release`.

## Convenciones del proyecto

- Evitar logica de negocio en componentes de UI.
- Centralizar reglas de dominio en engines/services/hooks reutilizables.
- Priorizar compatibilidad multiplataforma (Linux, Windows, macOS, Android, iOS).
- Mantener commands Tauri delgados y delegar en capas de servicio.
