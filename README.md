# Notia

![Versión](https://img.shields.io/badge/version-1.0.12-blue)
![Tauri](https://img.shields.io/badge/Tauri-2-orange)
![React](https://img.shields.io/badge/React-19-blue)
![Rust](https://img.shields.io/badge/Rust-2021-orange)

**Notia** es una aplicación de gestión de conocimiento **local-first**, **offline-first** y **privacy-first** para escritorio y dispositivos móviles. Permite organizar notas, documentos, diagramas, credenciales cifradas y tareas, todo viviendo en el filesystem del usuario. Sin servidor cloud. Sin suscripciones. Tus datos, siempre bajo tu control.

---

## 📋 Índice

- [Filosofía](#filosofía)
- [Características Principales](#características-principales)
- [Módulos Funcionales](#módulos-funcionales)
- [Consumo de Funcionalidades](#consumo-de-funcionalidades)
- [Guía de Uso](#guía-de-uso)
- [Requisitos de Sistema](#requisitos-de-sistema)
- [Instalación y Desarrollo](#instalación-y-desarrollo)
- [Configuración de Entorno y Preferencias](#configuración-de-entorno-y-preferencias)
- [FAQ y Troubleshooting](#faq-y-troubleshooting)
- [Licencia](#licencia)

---

## 🧭 Filosofía

- **Local-first**: todos tus datos viven en carpetas locales de tu dispositivo. No hay servidor externo que almacene tu información.
- **Offline-first**: la aplicación funciona completamente sin conexión a internet. La integración con IA es opcional y requiere un servicio local (Ollama).
- **Privacy-first**: tus credenciales en ColdPass se cifran con estándares robustos (AES-256-GCM) y nunca salen de tu dispositivo en texto plano.
- **Cross-platform**: disponible para Windows, macOS, Linux y Android.

---

## ✨ Características Principales

- **Librerías de Notas**: organiza carpetas locales del filesystem como bibliotecas de documentos.
- **Editor de Markdown enriquecido**: edición WYSIWYG con soporte para wikilinks (`[[nota]]`), frontmatter y propiedades.
- **InkDoc**: editor especializado para documentos de tinta manuscrita, con reconocimiento de texto y fórmulas matemáticas vía IA.
- **Diagramas Mermaid**: incrusta y edita diagramas de flujo, arquitectura y más dentro de tus notas.
- **Graph View**: visualización interactiva de relaciones entre notas mediante nodos y conexiones.
- **AI Chat local**: conversación con modelos de lenguaje ejecutados localmente via Ollama, con memoria a largo plazo y contexto de archivos de la librería.
- **ColdPass**: gestor de credenciales cifradas con generador de contraseñas y sincronización segura entre dispositivos vía Bluetooth.
- **Task Manager**: tableros Kanban personalizables, tareas con estados, prioridad, subtareas, comentarios y temporizador Pomodoro integrado.
- **Búsqueda integrada**: búsqueda de archivos por nombre dentro de la librería activa.
- **Temas**: soporte para tema claro y oscuro.
- **Multiplataforma**: Windows, macOS, Linux y Android.

---

## 📦 Módulos Funcionales

### Librerías y Explorador de Archivos

El corazón de Notia son las **librerías**: carpetas locales del filesystem que la app indexa y presenta como un árbol jerárquico interactivo.

Desde el panel izquierdo (Explorador) podés:
- Navegar carpetas y archivos en forma de árbol expandible.
- Crear carpetas, notas Markdown, documentos InkDoc o diagramas Mermaid.
- Copiar, mover, renombrar y eliminar archivos mediante el **menú contextual** (clic derecho).
- Buscar archivos por nombre con la barra de búsqueda integrada.
- En escritorio, el árbol se actualiza automáticamente cuando detecta cambios externos en el filesystem.
- En Android, podés elegir una carpeta mediante el selector del sistema (SAF) y refrescar manualmente o con intervalo configurable.

### Editor de Markdown

El editor de Markdown utiliza una experiencia WYSIWYG (lo que ves es lo que obtenés) basada en Milkdown Crepe.

Características:
- **Pestañas múltiples**: abrí varios archivos simultáneamente y navegá entre ellos.
- **Guardado automático**: los cambios se guardan automáticamente tras un breve período de inactividad.
- **Wikilinks**: escribí `[[Nombre de Nota]]` para crear enlaces bidireccionales entre documentos. Al hacer clic en un wikilink, la nota destino se abre en una nueva pestaña.
- **Frontmatter y propiedades**: cada nota puede tener metadatos (título, etiquetas, fecha, etc.) editables desde el panel de propiedades lateral.
- **Indicadores de estado**: visualización de "Guardando...", "Guardado ✓" o "Error ✗" en la pestaña activa.

### InkDoc

InkDoc es un formato propio de Notia para documentos que combinan texto manuscrito (tinta) y contenido estructurado.

- Dibujá a mano alzada con stylus o dedo (en dispositivos táctiles).
- La IA local puede reconocer selecciones manuscritas y convertirlas en bloques de texto o fórmulas LaTeX.
- Ideal para tomar notas rápidas, esquemas y anotaciones matemáticas.

### Diagramas Mermaid

Integración nativa de diagramas tipo Mermaid dentro del ecosistema de Notia.

- Creá diagramas de flujo, arquitectura de sistemas, mapas mentales y más.
- Los diagramas se guardan como archivos `.mmd` dentro de tu librería.
- Edición visual completa con arrastrar y soltar, conectores, formas y estilos.

### Graph View

Visualización gráfica de las relaciones entre todas tus notas.

- Cada nota es un **nodo**; cada wikilink es una **conexión**.
- Navegación interactiva: zoom, paneo, clic para abrir la nota desde el grafo.
- Diseño automático en clusters para mantener la legibilidad en bibliotecas grandes.
- Filtro de búsqueda integrado dentro de la vista de grafo.

### AI Chat

Chat con inteligencia artificial local via **Ollama**.

- Configurá la URL de tu instancia de Ollama desde **Settings → IA**.
- Podés adjuntar archivos de la librería como contexto para la conversación (modos: directo, indexado o sin archivos).
- La IA mantiene **memoria a largo plazo**: extrae hechos, preferencias y datos personales de la conversación para personalizar respuestas futuras.
- Soporte para modelos multimodales: enviá imágenes (capturas, fotos) para que la IA las analice (requiere modelo con soporte de visión).
- Generación automática de títulos para las sesiones de chat.
- Soporte tanto en escritorio como en Android (a través de un bridge interno).

### ColdPass

Gestor de credenciales cifradas integrado en Notia.

- Tus credenciales se almacenan en un archivo `ColdPass.md` dentro de cada librería, **cifrado con AES-256-GCM**.
- La **passkey** (contraseña maestra) nunca sale del dispositivo: el cifrado y descifrado ocurren localmente en la app.
- Generador de contraseñas seguras integrado.
- **Sincronización Bluetooth**: podés sincronizar tu bóveda de credenciales entre dispositivos de forma segura mediante Bluetooth Low Energy (BLE). El proceso incluye emparejamiento con PIN y autenticación de aplicación.

### Task Manager

Sistema completo de gestión de tareas con tableros Kanban y vista de tabla.

- **Tableros personalizables**: creá múltiples tableros para diferentes áreas de tu vida (trabajo, personal, proyectos). Cada tablero vive como una carpeta dentro de tu librería.
- **Vista Kanban**: organizá tareas en columnas (grupos) con arrastre visual.
- **Vista de tabla**: alterná a una vista tabular para ver y ordenar tareas por estado, prioridad o fecha de fin.
- **Tareas con subtareas**: cada tarea puede tener subtareas anidadas mediante wikilinks.
- **Estados**: pendiente, en progreso, completada, cancelada.
- **Prioridad**: alta, media, baja.
- **Comentarios**: discusión y notas adjuntas a cada tarea.
- **Pomodoro integrado**: temporizador de 25/5 minutos con registro histórico de sesiones y estadísticas de productividad.
- **Persistencia transparente**: cada tarea se guarda como un archivo Markdown con metadatos (frontmatter) dentro de la carpeta del tablero correspondiente.

---

## 🧩 Consumo de Funcionalidades

> Esta sección describe, para cada módulo funcional, **qué hace**, **cuándo usarlo**, los **pasos para consumirlo**, las **entradas esperadas**, las **salidas/resultados** y los **errores comunes** con su resolución. Se expresa en lenguaje funcional (orientado a analistas y usuarios finales).

### Librerías y Explorador de Archivos

| Campo | Descripción |
|---|---|
| **Qué hace** | Indexa una carpeta local del filesystem y la presenta como un árbol jerárquico interactivo. Permite navegar, crear, copiar, mover, renombrar, eliminar y buscar archivos. |
| **Cuándo usarlo** | Siempre que necesites organizar, acceder o modificar tus notas y documentos dentro de una carpeta de trabajo. |
| **Pasos para consumir** | 1. Abrir Notia. 2. En el panel izquierdo, clic en **"Administrar librerías"** (footer). 3. Clic en **"Agregar librería"**. 4. Seleccionar una carpeta del filesystem (escritorio) o conceder permisos SAF (Android). 5. La carpeta aparece en el Explorador. |
| **Entradas esperadas** | Una ruta absoluta de carpeta (escritorio) o una URI de árbol SAF (Android). En Android, también un nombre descriptivo para la librería. |
| **Salidas / Resultado** | Árbol de archivos renderizado en el panel izquierdo. Los archivos y carpetas se listan con íconos según tipo. En escritorio, el árbol se actualiza automáticamente ante cambios externos. |
| **Errores comunes** | **"No se pudo acceder a la carpeta"**: la app no tiene permisos de lectura. Solución: verificar permisos del SO o reseleccionar la carpeta en Android SAF. **"El árbol está vacío"**: la carpeta seleccionada realmente no tiene archivos, o el path es incorrecto. |

### Crear una Nota Markdown

| Campo | Descripción |
|---|---|
| **Qué hace** | Crea un archivo de texto con formato Markdown dentro de una carpeta del Explorador. |
| **Cuándo usarlo** | Cuando querés documentar información estructurada con formato enriquecido, wikilinks, frontmatter y propiedades. |
| **Pasos para consumir** | 1. Seleccionar una carpeta en el Explorador. 2. Clic derecho → **"Nueva nota"** (o usar el botón **"New Note"** en la barra superior). 3. Ingresar el nombre del archivo. 4. Presionar Enter o clic fuera. 5. El archivo se crea y se abre automáticamente en una pestaña. |
| **Entradas esperadas** | Nombre del archivo (string, sin caracteres especiales `/`, `\`, `.`, `..`). El sistema agrega automáticamente la extensión `.md`. |
| **Salidas / Resultado** | Archivo `Nombre.md` creado en el filesystem. Pestaña abierta con el editor Markdown listo para edición. |
| **Errores comunes** | **"Nombre inválido"**: contiene caracteres prohibidos o está vacío. Solución: usar solo letras, números, espacios, guiones y guiones bajos. |

### Editar una Nota Markdown (Wikilinks)

| Campo | Descripción |
|---|---|
| **Qué hace** | Permite vincular notas entre sí mediante la sintaxis `[[Nombre de Nota]]`, creando un grafo de conocimiento bidireccional. |
| **Cuándo usarlo** | Cuando querés relacionar conceptos, ideas o documentos entre sí para navegación rápida y descubrimiento de conexiones. |
| **Pasos para consumir** | 1. Abrir una nota Markdown. 2. En cualquier parte del texto, escribir `[[Nombre de otra nota]]`. 3. Notia resaltará el wikilink y mostrará sugerencias mientras escribís. 4. Hacer clic en el wikilink para abrir la nota destino en una nueva pestaña. 5. Si la nota destino no existe, Notia ofrecerá crearla. |
| **Entradas esperadas** | Texto con patrón `[[nombre de nota]]`. El nombre debe coincidir (case-insensitive) con un archivo `.md` existente en la librería. |
| **Salidas / Resultado** | Enlace bidireccional activo. Al hacer clic se abre la nota destino. El Graph View utiliza estos enlaces para construir el mapa de relaciones. |
| **Errores comunes** | **Wikilink rojo/quebrado**: la nota destino no existe. Solución: crear la nota destino o corregir el nombre. |

### Graph View

| Campo | Descripción |
|---|---|
| **Qué hace** | Visualiza todas las notas Markdown de la librería como nodos y los wikilinks entre ellas como conexiones, permitiendo navegación visual interactiva. |
| **Cuándo usarlo** | Cuando querés explorar visualmente las relaciones entre tus notas, encontrar notas aisladas o descubrir clusters de conocimiento. |
| **Pasos para consumir** | 1. Asegurate de tener notas Markdown con wikilinks en la librería. 2. En el **Icon Rail** (barra lateral izquierda), seleccionar **"Graph view"**. 3. Esperar a que se cargue el grafo (puede tomar segundos en bibliotecas grandes). 4. Usar zoom y paneo para explorar. 5. Hacer clic en un nodo para abrir la nota. 6. Usar la barra de búsqueda para filtrar nodos. |
| **Entradas esperadas** | Librería activa con al menos un archivo Markdown. No requiere entrada manual del usuario. |
| **Salidas / Resultado** | Canvas interactivo con nodos (títulos de notas) y líneas de conexión (wikilinks). Al hacer clic en un nodo se abre la nota correspondiente en pestaña. |
| **Errores comunes** | **"El grafo está vacío"**: no hay archivos Markdown en la librería. Solución: crear notas Markdown. **"Lentitud"**: bibliotecas con miles de notas pueden tardar en inicializar. Solución: esperar o dividir en librerías más pequeñas. |

### AI Chat con Ollama

| Campo | Descripción |
|---|---|
| **Qué hace** | Permite conversar con modelos de lenguaje locales (Ollama) con soporte de memoria a largo plazo, contexto de archivos de la librería y análisis de imágenes. |
| **Cuándo usarlo** | Cuando necesitás asistencia de IA para redactar, resumir, analizar imágenes o consultar sobre el contenido de tus notas. |
| **Pasos para consumir** | 1. Instalar y ejecutar Ollama localmente (`ollama serve`). 2. En Notia, abrir **Settings → IA**. 3. Ingresar la URL de Ollama (default: `http://localhost:11434`). 4. Opcional: ingresar API Key. 5. Hacer clic en **"Verificar conexión"**. 6. Seleccionar un modelo de la lista. 7. En el Icon Rail, abrir **"AI Chat"**. 8. Escribir un mensaje y presionar Enter. 9. Opcional: adjuntar archivos de la librería como contexto. |
| **Entradas esperadas** | Texto del mensaje (string, máximo ~30k caracteres de contexto acumulado). Opcional: imagen en base64 (para modelos multimodales). Opcional: archivos de la librería como contexto. |
| **Salidas / Resultado** | Respuesta de texto del modelo de IA. La sesión se guarda automáticamente con un título generado por IA. Las memorias de largo plazo se extraen y persisten para futuras conversaciones. |
| **Errores comunes** | **"No se pudo conectar con Ollama"**: Ollama no está corriendo o la URL es incorrecta. Solución: verificar `ollama serve` en terminal y la URL en Settings. **"La IA no devolvió contenido"**: el modelo no respondió. Solución: reintentar o cambiar de modelo. |

### ColdPass (Credenciales Cifradas)

| Campo | Descripción |
|---|---|
| **Qué hace** | Almacena credenciales (usuarios, contraseñas, URLs, notas) en un archivo cifrado dentro de la librería activa. El cifrado ocurre localmente en el dispositivo. |
| **Cuándo usarlo** | Cuando necesitás guardar contraseñas, claves API, datos bancarios o cualquier información sensible de forma segura dentro de tu espacio de conocimiento. |
| **Pasos para consumir** | 1. En el Icon Rail, seleccionar **"ColdPass"**. 2. Si es la primera vez, se creará automáticamente la carpeta `ColdPass/` y el archivo `ColdPass.md` cifrado. 3. Ingresar una **passkey** (contraseña maestra) para descifrar. 4. Agregar nuevas credenciales mediante el formulario (nombre, usuario, contraseña, URL, notas). 5. Guardar. Los cambios se cifran automáticamente. |
| **Entradas esperadas** | Passkey (string, mínimo recomendado 12 caracteres). Credenciales: nombre (string, obligatorio), usuario, contraseña, URL, notas (todos strings opcionales). |
| **Salidas / Resultado** | Archivo `ColdPass/ColdPass.md` cifrado en el filesystem. Lista de credenciales descifradas visualizable solo con la passkey correcta. |
| **Errores comunes** | **"Passkey incorrecta"**: la contraseña maestra no descifra el archivo. Solución: verificar mayúsculas/minúsculas. Si se olvida, no hay recuperación posible (diseño privacy-first). |

### Sincronización ColdPass por Bluetooth

| Campo | Descripción |
|---|---|
| **Qué hace** | Transfiere la bóveda de credenciales cifrada de un dispositivo a otro mediante Bluetooth Low Energy (BLE) con emparejamiento seguro (PIN + autenticación de aplicación). |
| **Cuándo usarlo** | Cuando querés tener la misma bóveda de credenciales en tu computadora y tu dispositivo móvil (o viceversa). |
| **Pasos para consumir** | 1. Asegurate de que ambos dispositivos tengan Bluetooth activado y estén a menos de 1 metro. 2. En el dispositivo origen, abrir ColdPass y hacer clic en **"Conectar Bluetooth"**. 3. Esperar a que detecte el dispositivo destino (nombre "ColdPass"). 4. Ingresar el PIN mostrado en el dispositivo destino. 5. Esperar la confirmación de emparejamiento. 6. Hacer clic en **"Autenticar"** para establecer canal seguro. 7. Hacer clic en **"Enviar bóveda"** para transferir las credenciales cifradas. |
| **Entradas esperadas** | PIN numérico (4-6 dígitos, mostrado en el dispositivo destino). Dispositivos con BLE compatible. En Linux, requiere BlueZ. |
| **Salidas / Resultado** | Bóveda cifrada transferida al dispositivo destino. El destino debe ingresar la misma passkey para descifrarla. |
| **Errores comunes** | **"No se encontró dispositivo"**: BLE no está activado o los dispositivos están muy lejos. Solución: acercar dispositivos y verificar Bluetooth. **"PIN incorrecto"**: solución: reintentar con el PIN correcto. **"Bluetooth no soportado"**: en Android/iOS o Windows/macOS el soporte es limitado; Linux tiene soporte completo. |

### Task Manager (Kanban y Tabla)

| Campo | Descripción |
|---|---|
| **Qué hace** | Gestiona tareas organizadas en tableros con dos vistas disponibles: Kanban (columnas drag-and-drop) y tabla (listado ordenable). Cada tarea incluye estado, prioridad, subtareas, comentarios y fecha de fin. |
| **Cuándo usarlo** | Cuando necesitás organizar proyectos, seguimiento de actividades o gestión personal de tareas de forma visual o tabular. |
| **Pasos para consumir** | 1. En el Icon Rail, seleccionar **"Task Manager"**. 2. Hacer clic en **"Nuevo tablero"** e ingresar un nombre (ej. "Proyecto Alpha"). 3. Agregar tareas al tablero. 4. Para cada tarea, definir estado, prioridad, subtareas y comentarios. 5. Cambiar entre vista Kanban y vista Tabla según prefieras. 6. Al completar o cancelar una tarea, ésta se archiva automáticamente en la carpeta correspondiente. |
| **Entradas esperadas** | Nombre del tablero (string). Tarea: título (string, obligatorio), descripción, prioridad (alta/media/baja), estado (pendiente/en progreso/completada/cancelada), subtareas (lista de wikilinks), comentarios (lista). |
| **Salidas / Resultado** | Cada tarea se guarda como un archivo `.md` individual con metadatos YAML (frontmatter) dentro de la carpeta `task-mannager/<tablero>/` en tu librería. Los metadatos del tablero (nombres, colores, horas de actividad) se guardan en `localStorage`. |
| **Errores comunes** | **"No se pudo guardar la tarea"**: error de escritura en el filesystem. Solución: verificar permisos de la carpeta de la librería. **"No se encuentra el tablero"**: la carpeta del tablero fue renombrada o eliminada fuera de Notia. Solución: refrescar el Explorador. |

### Pomodoro

| Campo | Descripción |
|---|---|
| **Qué hace** | Temporizador de productividad con ciclos de 25 minutos de trabajo y 5 minutos de descanso. Registra cada sesión en un archivo `PomodoroLog.md` dentro de la carpeta `task-mannager/` de tu librería, con timestamp y duración. |
| **Cuándo usarlo** | Durante sesiones de trabajo enfocado para medir y mejorar la productividad. |
| **Pasos para consumir** | 1. Abrir el Task Manager. 2. En el panel lateral, abrir **"Pomodoro"**. 3. Hacer clic en **"Iniciar"** para comenzar un ciclo de 25 minutos. 4. Al finalizar, se registra automáticamente la sesión en `PomodoroLog.md`. 5. Hacer clic en **"Descanso"** para iniciar los 5 minutos de pausa. 6. Consultar el historial de sesiones y estadísticas acumuladas. |
| **Entradas esperadas** | Ninguna entrada manual. El temporizador se controla con botones de inicio, pausa y reset. |
| **Salidas / Resultado** | Registro de sesión completada con timestamp en `task-mannager/PomodoroLog.md`. Estadísticas: total de sesiones, tiempo acumulado, distribución por día. |
| **Errores comunes** | **"El temporizador no avanza"**: la pestaña o ventana está inactiva y el navegador limita los timers. Solución: mantener la ventana visible o usar la app en modo ventana maximizada. |

### Búsqueda de Archivos

| Campo | Descripción |
|---|---|
| **Qué hace** | Busca archivos por nombre dentro de la librería activa, mostrando resultados en tiempo real mientras escribís. |
| **Cuándo usarlo** | Cuando necesitás encontrar rápidamente una nota o documento sin navegar manualmente por el árbol. |
| **Pasos para consumir** | 1. En el panel del Explorador (izquierda), hacer clic en la barra de búsqueda. 2. Escribir el nombre o parte del nombre del archivo. 3. Los resultados se filtran automáticamente en el árbol. 4. Hacer clic en un resultado para abrirlo. |
| **Entradas esperadas** | Query de búsqueda (string, mínimo 1 carácter). Búsqueda case-insensitive y sin acentos. |
| **Salidas / Resultado** | Lista de archivos cuyo nombre coincide con el query. Si no hay coincidencias, el árbol muestra estado vacío. |
| **Errores comunes** | **"No hay resultados"**: el archivo no existe o está en otra librería. Solución: verificar la librería activa o el nombre del archivo. |

---

## 📖 Guía de Uso

### Inicio Rápido

1. **Abrir la aplicación**: al iniciar por primera vez, Notia no tiene librerías configuradas.
2. **Agregar una librería**:
   - En el panel izquierdo, en el footer, hacé clic en **"Administrar librerías"**.
   - Seleccioná **"Agregar librería"** y elegí una carpeta de tu filesystem (escritorio) o concedé permisos de carpeta (Android).
   - La carpeta seleccionada se indexará y aparecerá en el Explorador.
3. **Crear contenido**:
   - Desde la **barra superior** (Toolbar): **"New Note"** (nota Markdown), **"New InkDoc"** (documento de tinta), **"New Folder"** (carpeta).
   - O desde el **menú contextual** (clic derecho) en cualquier carpeta del Explorador.
4. **Abrir archivos**: hacé clic en cualquier archivo del árbol de archivos. Se abrirá en una pestaña.
5. **Navegar entre vistas**: el **Icon Rail** (barra vertical izquierda) permite cambiar entre:
   - **Explorer**: árbol de archivos.
   - **Graph view**: mapa de relaciones entre notas.
   - **Task manager**: gestión de tareas.
   - **ColdPass**: credenciales cifradas.
   - **AI Chat**: chat con IA local.
6. **Cerrar pestañas**: clic en la "X" de la pestaña, o atajo `Ctrl + W`.

### Uso de Wikilinks

1. En cualquier nota Markdown, escribí `[[Nombre de otra nota]]`.
2. Notia resaltará el wikilink y mostrará sugerencias mientras escribís.
3. Hacé clic en el wikilink para abrir la nota destino en una nueva pestaña.
4. Si la nota destino no existe, Notia te ofrecerá crearla.

### Configurar el Chat con IA

1. Asegurate de tener **Ollama** instalado y corriendo localmente en tu máquina (o accesible en red local).
2. En Notia, abrí **Settings** (⚙️) → **IA**.
3. Ingresá la URL de Ollama (por defecto: `http://localhost:11434`).
4. Opcional: ingresá una API Key si usás Ollama Cloud o un servicio con autenticación.
5. Hacé clic en **"Verificar conexión"** para confirmar que Notia puede comunicarse con Ollama.
6. Seleccioná un modelo de la lista de modelos multimodales disponibles.

### Usar ColdPass

1. En el **Icon Rail**, seleccioná **ColdPass**.
2. La primera vez, se creará automáticamente una carpeta `ColdPass/` y un archivo `ColdPass.md` cifrado en tu librería activa.
3. Ingresá una **passkey** (contraseña maestra) para descifrar la bóveda.
4. Agregá, editá o eliminá credenciales. Cada cambio se cifra automáticamente al guardar.
5. Para sincronizar con otro dispositivo:
   - Asegurate de que ambos dispositivos tengan Bluetooth activado.
   - En el dispositivo origen, iniciá la conexión Bluetooth desde ColdPass.
   - Seguí las instrucciones de emparejamiento (PIN y autenticación).
   - Transferí la bóveda cifrada de forma segura.

### Usar el Task Manager y Pomodoro

1. En el **Icon Rail**, seleccioná **Task Manager**.
2. Creá un **tablero** nuevo dándole un nombre (ej. "Proyecto Alpha"). Notia creará automáticamente la carpeta `task-mannager/Proyecto Alpha/` en tu librería.
3. Agregá **tareas** al tablero. Podés definir prioridad, estado, fecha de fin, subtareas y comentarios.
4. Cambiá entre la **vista Kanban** (columnas visuales) y la **vista Tabla** (listado ordenable) según prefieras.
5. Al completar o cancelar una tarea, ésta se archiva automáticamente en la carpeta `finished/` o `cancelled/` respectivamente.
6. Para usar el **Pomodoro**:
   - Abrí el panel Pomodoro desde la barra lateral del Task Manager.
   - Iniciá una sesión de 25 minutos.
   - Al completarla, se registrará automáticamente en el archivo `PomodoroLog.md` dentro de `task-mannager/`.
   - Consultá las estadísticas de productividad acumuladas.

### Cambiar el Tema y Preferencias

1. Abrí **Settings** (⚙️) desde la barra de título o el menú.
2. En **Apariencia**, seleccioná **Claro** u **Oscuro**.
3. En **Explorador**, ajustá el **intervalo de refresco** (útil en Android para detectar cambios externos).
4. En **InkDoc**, configurá preferencias de estilo y comportamiento.

---

## 🛠️ Requisitos de Sistema

### Para ejecutar la aplicación

- **Sistema operativo**: Windows 10+, macOS 11+, Linux (kernel 5.x+), Android 10+.
- **Para IA local**: instancia de **Ollama** corriendo localmente o accesible en red (opcional).
- **Para ColdPass Bluetooth**: adaptador Bluetooth Low Energy (BLE) compatible (Linux requiere BlueZ; Windows y macOS tienen soporte limitado actualmente).

### Para desarrollo

- **Node.js**: 20 o superior.
- **npm**: 10 o superior.
- **Rust Toolchain**: `rustup`, `cargo`, `rustc` (edición 2021).
- **Git**: para control de versiones.

### Dependencias del sistema (Linux)

Para compilar y ejecutar Notia en Linux, se requieren los siguientes paquetes del sistema:

```bash
# Ubuntu / Debian
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

📖 **Guía oficial de prerequisitos de Tauri**:  
https://tauri.app/start/prerequisites/

---

## 🚀 Instalación y Desarrollo

### Clonar el repositorio

```bash
git clone <repository-url>
cd notia
```

### Instalar dependencias

```bash
# Frontend (Node.js)
npm install

# Backend (Rust) — se descarga automáticamente con cargo durante el build
```

### Modo desarrollo

```bash
# Solo frontend web (Vite, puerto 1420)
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
# Desarrollo en dispositivo Android (auto-detecta NDK y dispositivo adb)
npm run dev:android

# Build debug APK
npm run build:android:debug

# Build release AAB (Android App Bundle para Play Store)
npm run build:android:aab

# Instalar release en dispositivo conectado
npm run install:android:release
```

---

## ⚙️ Configuración de Entorno y Preferencias

Notia almacena las preferencias del usuario localmente en el navegador (localStorage). Las siguientes configuraciones están disponibles:

### Apariencia
- **Tema**: claro u oscuro. Persiste entre sesiones.

### IA (Ollama)
- **URL de Ollama**: dirección del servidor local de Ollama (default: `http://localhost:11434`).
- **API Key**: opcional, para servicios que requieren autenticación.
- **Modelo seleccionado**: elegí entre los modelos multimodales disponibles detectados automáticamente.

### Explorador de archivos
- **Intervalo de refresco**: en Android, podés configurar un intervalo en milisegundos para que el árbol de archivos se refresque periódicamente (default: deshabilitado).

### InkDoc
- **Preferencias de estilo**: configuración visual y comportamiento del editor de tinta.

### Logging (Android)
- Podés habilitar o deshabilitar el envío de logs a `logcat` para diagnóstico de rendimiento:
  ```js
  localStorage.setItem('notia.logcat.enabled', '1') // habilitar
  localStorage.setItem('notia.logcat.enabled', '0') // deshabilitar
  ```

---

## ❓ FAQ y Troubleshooting

### No veo mis archivos en Android
- Verificá que hayas concedido los permisos de acceso a la carpeta mediante el selector del sistema (SAF).
- Asegurate de que la URI de la carpeta (Android Tree URI) esté correctamente asociada a la librería.
- Si la carpeta fue modificada externamente, usá el botón de refresco manual o configurá un intervalo de refresco automático en Settings.

### La IA no responde o da error de conexión
- Verificá que **Ollama** esté corriendo localmente (`ollama serve` en terminal).
- Confirmá que la URL en **Settings → IA** coincida con la dirección de Ollama (generalmente `http://localhost:11434`).
- Si estás en Android, asegurate de que el dispositivo tenga acceso de red a la instancia de Ollama (no funciona offline a menos que Ollama corra en el mismo dispositivo).

### El tema no se guarda entre sesiones
- Verificá que tu navegador o WebView no esté en modo privado/incógnito (bloquea localStorage).
- Si estás en Android, asegurate de que la app tenga permisos de almacenamiento local.

### Wayland no funciona en Linux o la ventana se ve mal
- Probá forzar el backend X11: `NOTIA_TAURI_BACKEND=x11 npm run dev:tauri:x11`.
- O usá el modo fallback a X11: `NOTIA_TAURI_BACKEND=wayland NOTIA_TAURI_FALLBACK_X11=1 npm run dev:tauri:wayland:fallback`.

### ColdPass no sincroniza por Bluetooth
- Asegurate de que el Bluetooth esté activado en ambos dispositivos.
- En Linux, verificá que el servicio BlueZ esté corriendo y que tu adaptador soporte BLE.
- Confirmá que ingresaste el PIN correcto durante el emparejamiento.
- Mantené los dispositivos a menos de 1 metro de distancia durante la sincronización.

### La aplicación se siente lenta con bibliotecas muy grandes
- El Graph View delega el procesamiento a workers internos, pero en bibliotecas con miles de notas puede haber latencia inicial.
- Considerá dividir tu conocimiento en múltiples librerías más pequeñas.

---

## 📝 Licencia

Copyright © 2026 Gabriel. Todos los derechos reservados.

---

**Notia** — Tu espacio de conocimiento, organizado.
