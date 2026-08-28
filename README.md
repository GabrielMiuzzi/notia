# Notia

## Dictado offline en el chat

El contacto autorizado de Telegram también puede enviar una nota de voz OGG/Opus de hasta 15 minutos y 20 MB. Notia la descarga, la decodifica y la transcribe localmente con el mismo modelo offline precargado. La decodificación admite los modos SILK, CELT e híbrido usados por Telegram, incluso en notas de voz rápidas. Primero responde **Solicitud transcripción recibida y en proceso.**, mostrando la transcripción en negrita, y después procesa ese texto como una consulta normal del agente. El audio no se envía al proveedor de IA; Telegram sí interviene necesariamente en su transporte y descarga.

Notia usa Qwen3-ASR Q8 mediante un runtime nativo basado en `llama.cpp`. El reconocimiento funciona localmente y permite seleccionar 0.6B o 1.7B, CPU/GPU e idioma desde **Configuraciones → Voz**.

Notia precarga en segundo plano los modelos Qwen3-ASR y Qwen3-TTS seleccionados desde el arranque y mantiene ambos runtimes listos para el chat, el dictado y Meeting. Al elegir otro modelo, dispositivo o idioma, prepara inmediatamente la nueva configuración y descarta de forma segura el runtime anterior.

El compositor incluye un botón de micrófono para dictar sin enviar audio ni texto a servicios externos. Cada respuesta del asistente muestra debajo del avatar una acción para leer ese mensaje con Qwen3-TTS usando la voz, el idioma y la velocidad configurados; una segunda pulsación detiene la reproducción. En Windows y Android arm64, Notia muestra texto parcial en tiempo real y, al detener, diariza el audio completo y vuelve a transcribir cada turno detectado para asignar el texto mediante sus límites temporales, separando intervenciones como `Hablante 1` y `Hablante 2` sin repartir palabras proporcionalmente. El resultado queda editable y nunca se envía automáticamente.

El acceso **Meeting**, ubicado debajo de ColdPass en el panel izquierdo, abre un espacio dedicado para transcribir reuniones. Permite iniciar, pausar, reanudar, cancelar y finalizar una sesión, editar el texto en vivo y aplicar diarización al finalizar. Después permite asignar un nombre a cada hablante y reemplaza sus etiquetas en toda la transcripción; la acción **Pasar por IA** usa el modelo Ollama configurado para corregir y organizar el texto sin resumirlo ni cambiar la atribución de las intervenciones. El chat lateral usa la transcripción actual como contexto y el mismo runtime agente, prompt, native tool calling y opciones que el resto de los chats; solo es efímero, por lo que se descarta al salir de Meeting y no crea archivos en la carpeta de chats. En Windows mezcla el micrófono predeterminado con la salida de audio predeterminada mediante captura WASAPI nativa; no requiere dispositivos virtuales ni cambiar la entrada del sistema.

1. Ejecute `scripts/install-qwen3-asr-models.ps1 -Model 0.6b` y `scripts/build-qwen3-asr-runtime.ps1 -Platform windows-x86_64 -Device cpu`. Para Vulkan use `-Device gpu`; en Android use además `-Platform android-arm64-v8a` con NDK y Vulkan SDK disponibles. La diarización conserva sus modelos ONNX independientes y el runtime documentado en `src-tauri/resources/speech/runtime/README.md`.
2. Abra un chat y pulse **Dictar mensaje sin conexión**.
3. En Android, conceda el permiso de micrófono cuando lo solicite el sistema.
4. Use los controles visibles para pausar, reanudar, finalizar o cancelar. Cancelar restaura el borrador anterior.

Las sesiones admiten hasta 15 minutos. La captura conserva una cola acotada para absorber el costo temporal del reconocimiento. El texto en vivo adapta su actualización entre 1,5 y 6 segundos: responde con mayor frecuencia cuando el equipo va holgado y reduce parciales provisionales si detecta audio pendiente, priorizando que la transcripción no acumule retraso. Las intervenciones continuas se confirman en segmentos de hasta 6 segundos con CPU, con solapamiento corto, o 12 segundos contiguos y sin solapamiento con GPU para evitar frases duplicadas; si la GPU acumula un segundo de cola vuelve automáticamente al límite conservador de CPU. Las pausas claras también confirman el segmento actual. Qwen3-ASR admite CPU o GPU Vulkan en Windows y Android arm64 cuando el runtime GPU y el controlador son compatibles; la síntesis conserva sus opciones propias por plataforma. Las etiquetas de hablante se calculan únicamente al finalizar, con cantidad automática y un clustering conservador; voces solapadas, ruido y fragmentos breves pueden reducir la precisión. Si falla únicamente la diarización, se conserva el texto sin etiquetas. Si Android denegó el permiso permanentemente, habilítelo desde Ajustes. En Windows, compruebe el dispositivo predeterminado y los permisos de privacidad.

![Versión](https://img.shields.io/badge/version-1.0.13-blue)
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
- **Editor de Markdown enriquecido**: edición WYSIWYG con soporte para wikilinks (`[[nota]]`), frontmatter y propiedades. Optimizado para baja memoria con memoización selectiva y selectores de acciones.
- **Enlaces secuenciales (Page Links)**: definí relaciones de orden entre notas con `nextPage` y `previousPage` en el frontmatter. Notia actualiza automáticamente el vínculo inverso y ordena las notas conectadas en bloques secuenciales en el explorador.
- **InkMath en Markdown**: dibujá una fórmula desde los bloques Math y obtené su transcripción LaTeX mediante el modelo de visión configurado en Ollama.
- **Diagramas Mermaid**: incrusta y edita diagramas de flujo, arquitectura y más dentro de tus notas. Los diagramas embebidos en Markdown y los archivos `.mmd` comparten el **mismo motor visual**, temas y estilos. Renderizado lazy con `IntersectionObserver`, cancelación vía `AbortSignal` y caché LRU.
- **Graph View**: visualización interactiva de relaciones entre notas mediante nodos y conexiones.
- **AI Chat local**: conversación con modelos de lenguaje ejecutados localmente via Ollama, con memoria a largo plazo y contexto de archivos de la librería.
- **ColdPass**: gestor de credenciales cifradas con generador de contraseñas y sincronización segura entre dispositivos vía Bluetooth.
- **Task Manager**: tableros Kanban personalizables, tareas con estados, prioridad, subtareas, comentarios y temporizador Pomodoro integrado.
- **Búsqueda integrada**: búsqueda de archivos por nombre dentro de la librería activa.
- **Temas**: soporte para tema claro y oscuro.
- **Multiplataforma**: Windows, macOS, Linux y Android.
- **Bandeja del sistema en Windows**: al cerrar la ventana principal, Notia continúa ejecutándose en segundo plano y puede restaurarse desde el icono junto al reloj.
- **Agente por Telegram**: vinculá de forma explícita un chat privado para buscar, leer y modificar la biblioteca activa desde el bot, conservando confirmaciones individuales para cada escritura.

En Windows, pulsar la **X** oculta Notia en la bandeja del sistema en vez de finalizarla. Para volver, hacé doble clic izquierdo en el icono de Notia o abrí su menú y elegí **Abrir Notia**. Para terminar completamente la aplicación, elegí **Salir** desde ese mismo menú. Este comportamiento no se aplica en Android, macOS ni Linux.

Para conectar Telegram, creá un bot con BotFather, copiá su token y abrí **Configuraciones → Telegram**. Pegá el token, pulsá **Probar y emparejar**, activá la integración y enviá `/start` al bot. Notia mostrará la identidad solicitante: revisala y pulsá **Autorizar**. Solo coincidir simultáneamente con el `chat_id` y el identificador de usuario autorizados permite consultar esa biblioteca. Las acciones de creación, reemplazo y eliminación muestran botones **Confirmar** y **Cancelar** en Telegram antes de ejecutarse. Revocá el acceso desde la misma pantalla cuando ya no lo necesites.

El token se almacena sin cifrar en `.notia/notiaConfig.json`. No compartas ese archivo ni lo subas a un repositorio; si el token se expone, revocalo inmediatamente desde BotFather. El bot funciona únicamente mientras Notia está ejecutándose y requiere conectividad tanto con Telegram como con el backend de IA configurado.

---

## 📦 Módulos Funcionales

### Librerías y Explorador de Archivos

El corazón de Notia son las **librerías**: carpetas locales del filesystem que la app indexa y presenta como un árbol jerárquico interactivo.

Desde el panel izquierdo (Explorador) podés:
- Navegar carpetas y archivos en forma de árbol expandible. El nombre se muestra separado del formato, que se conserva al renombrar.
- Crear carpetas, notas Markdown o diagramas Mermaid.
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
- **Zoom de lectura**: ampliá o reducí el contenido con `Ctrl + rueda del mouse` en Windows, con el gesto de pinza de dos dedos en Android o con el deslizador junto al estado de guardado. El porcentaje visible y el botón **Restablecer** permiten consultar o volver rápidamente al 100%.
- **Diagramas Mermaid embebidos**: insertá bloques de código con lenguaje `mermaid` dentro de cualquier nota Markdown. El editor renderiza el diagrama con el **mismo motor visual** que los archivos `.mmd` (temas Notia, zoom/pan interactivo, manejo de errores uniforme). Los diagramas embebidos son de **solo lectura**: se pueden explorar (zoom, paneo, exportar a PNG/SVG) pero no se pueden editar nodos ni flechas desde el editor Markdown. Desde la versión 1.0.13, el renderizado embebido es **lazy** (solo renderiza cuando el diagrama entra en el viewport), cancela renders previos al cambiar de archivo y gestiona la memoria mediante una caché LRU con límite de tamaño.
- **InkMath**: el botón **OCR** de cada bloque Math abre un lienzo compatible con mouse, stylus y touch. Al terminar de escribir, espera el intervalo configurado, rasteriza los trazos y solicita a Ollama la fórmula en LaTeX; una entrada nueva invalida cualquier resultado anterior.
- **Exportación**: el menú de tres puntos junto a **Restablecer** permite exportar la nota Markdown como PDF o como `.docx` importable en Google Docs. Las fórmulas LaTeX se renderizan con formato matemático en ambos destinos.

### Diagramas Mermaid

Integración nativa de diagramas tipo Mermaid dentro del ecosistema de Notia.

- Creá diagramas de flujo, arquitectura de sistemas, mapas mentales y más.
- Los diagramas se guardan como archivos `.mmd` dentro de tu librería.
- Edición visual completa con arrastrar y soltar, conectores, formas y estilos.
- El **Graph View** reutiliza el mismo motor Mermaid para visualizar el grafo de wikilinks de la librería.

### Graph View

Visualización gráfica de las relaciones entre todas tus notas.

- Cada nota es un **nodo**; cada wikilink es una **conexión**.
- Navegación interactiva: zoom, paneo, clic para abrir la nota desde el grafo.
- El layout se genera como un diagrama Mermaid agrupado por carpetas, manteniendo la legibilidad en bibliotecas grandes.
- Búsqueda integrada por título y contenido: muestra las notas coincidentes en un desplegable sobre la barra, permite enfocarlas en el grafo, agregarlas al contexto del chat o abrirlas, y resalta sus nodos.
- Los chats laterales de Graph View, Task Manager y archivos comparten el mismo flujo persistente de creación, selección, hidratación y visualización. Cada contexto usa una clave estable y su propio archivo dentro del historial de chats. En Graph View, sin selección consulta la biblioteca mediante RAG local, incluyendo nombres y rutas de carpetas; por ejemplo, preguntar por `chats` recupera los documentos ubicados dentro de esa carpeta. Al seleccionar archivos usa su contenido completo como contexto directo. También puede buscar y leer por título mediante tool calling nativo de Ollama.
- Durante una consulta con herramientas, el panel muestra si está analizando, ejecutando una búsqueda o procesando resultados. Los modelos grandes disponen de un tiempo ampliado para completar las distintas rondas del agente y la operación se puede cancelar desde el compositor.
- Notia mantiene un archivo `linkCache.md` dentro de `.notia/` con el diagrama del grafo, que se regenera automáticamente en segundo plano cuando cambian las notas.

### AI Chat

Chat con inteligencia artificial local via **Ollama**.

- Configurá la URL de tu instancia de Ollama desde **Settings → IA**.
- Funciona con **cualquier modelo de Ollama**, no solo modelos de visión.
- El selector enumera todos los modelos informados por Ollama y marca Thinking, Vision y Tools; para los chats con agente se recomienda elegir uno con **Tools**.
- En Task Manager, las consultas temáticas usan RAG; los pedidos exhaustivos como “todos los tickets” activan una lectura completa del corpus y reportan si algún contenido debió truncarse.
- Podés adjuntar archivos de la librería como contexto para la conversación (modos: directo, referencia o sin archivos).
- En el chat lateral de un archivo abierto, el archivo activo está autorizado como contexto; la IA solicita permiso visible antes de leer cualquier otro archivo.
- La vista principal de chat, los chats laterales y Telegram comparten el mismo agente con tool calling nativo, herramientas de biblioteca y Task Manager, aclaraciones, planes y confirmaciones individuales. El contexto activo solo limita qué archivos están autorizados inicialmente y qué tablero se considera activo.
- Los chats incluyen un **modo charla** mediante el botón de llamada junto al micrófono. Qwen3-TTS 0.6B CustomVoice Q4_K_M reproduce el saludo y Qwen3-ASR reconoce cada turno mediante llama.cpp; la captura solo se pausa mientras habla la IA y se reanuda sin recrear el micrófono. Ambos motores funcionan localmente, sin servidor de voz ni Python, en Windows y Android arm64. La sección **Configuraciones → Voz** permite elegir modelo ASR, CPU/GPU, idioma, una de las nueve voces de Qwen, velocidad, pausa y saludo. Los scripts `install-qwen3-*-models.ps1` instalan los pesos y `build-qwen3-*-runtime.ps1` construye los runtimes nativos.
- Cuando el agente necesita una aclaración abierta, muestra la pregunta dentro del hilo y pausa la ejecución. La respuesta escrita en el compositor reanuda la misma consulta; también puede cancelarse mientras espera.
- Cada librería mantiene sus agentes como archivos Markdown en `.agent/promps/`. La carpeta `.agent` es visible y editable desde el explorador de Notia, aunque las demás carpetas ocultas continúan excluidas. Notia crea `default.md` automáticamente con el prompt general completo de Notia y lo repone si falta o está vacío. El chat lateral muestra un selector superior con `default` y cada archivo adicional —usando su nombre sin `.md`—, recuerda la elección por librería y usa su contenido en las siguientes consultas.
- Cuando hay muchos adjuntos, se muestran dentro de un bloque compacto con desplazamiento propio para mantener visible el campo de mensaje.
- La IA mantiene **memoria a largo plazo**: extrae hechos, preferencias y datos personales de la conversación para personalizar respuestas futuras.
- Soporte para modelos multimodales: enviá imágenes (capturas, fotos) para que la IA las analice (requiere modelo con soporte de visión).
- Generación automática de títulos para las sesiones de chat.
- Streaming progresivo de respuestas en escritorio y Android.
- Cancelación de respuestas en curso.
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
- **Agente contextual**: el chat lateral conoce el panel activo de Task Manager pero no adjunta todos los tickets. Las búsquedas y lecturas quedan limitadas al tablero o panel visible; para consultar otro contexto primero hay que cambiar a ese panel. Usa RAG local para consultas generales y lee archivos completos bajo demanda mediante tool calling nativo de Ollama. Cuando recupera o lee un ticket padre, incorpora automáticamente las subtareas declaradas en `childs` y su contenido, de forma recursiva, para que la respuesta no pierda sus seguimientos.
- **Edición asistida y confirmada**: el agente puede crear tickets, reemplazar su contenido Markdown, agregar comentarios o subtareas, moverlos de grupo y cambiar estado o prioridad. También puede consultar y crear grupos, y eliminarlos únicamente cuando no tengan ningún ticket asignado. Consulta las opciones válidas del tablero y, ante cualquier dato faltante, definición imprecisa o coincidencia ambigua, pausa para preguntar en vez de inventar. Toda interacción pendiente aparece en una tarjeta dentro del chat: si encuentra varias opciones, cada alternativa se presenta como una opción clickeable; si necesita autorización, muestra los valores concretos, una vista previa del contenido y las acciones **Confirmar** y **Cancelar**. El runtime impide modificar entidades ambiguas hasta resolver la selección. Rechazar una autorización garantiza que no se escriba nada y una aprobación solo autoriza esa operación individual.
- **Planes para operaciones compuestas**: cuando un pedido requiere dos o más escrituras, el agente crea primero un TO-DO visible dentro del chat. El usuario debe aprobarlo antes de comenzar o puede elegir **Sugerir cambios**, escribir la corrección en el compositor y revisar una nueva versión. Cada operación se ejecuta por separado y en orden, conserva su propia confirmación y actualiza el paso como pendiente, en curso, completado o bloqueado. Un rechazo o error detiene el avance del plan.
- **Resúmenes por persona**: cuando se solicita una vista completa por responsables, el agente inspecciona todos los tickets del panel, releva las atribuciones explícitas tanto de los metadatos como de los detalles y evita agrupar el trabajo de distintas personas bajo el primer nombre encontrado.
- **Búsqueda de personas**: los resultados relevantes se diversifican entre archivos para que un historial con muchas menciones no desplace otros tickets coincidentes. La cantidad informada corresponde a rutas de tickets únicas, no a comentarios o estados dentro de un mismo archivo.
- **Panel adaptable**: el borde izquierdo del chat lateral permite ajustar su ancho con arrastre o teclado y conserva la medida elegida entre sesiones.

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

### Enlaces Secuenciales — Page Links (`nextPage` / `previousPage`)

| Campo | Descripción |
|---|---|
| **Qué hace** | Vincula notas Markdown en una secuencia ordenada mediante las propiedades de frontmatter `nextPage` y `previousPage`. Útil para navegar entre capítulos, pasos de un proceso o entradas de un diario. |
| **Cuándo usarlo** | Cuando necesitás que varias notas estén conectadas en un orden específico y que el explorador las agrupe como un bloque secuencial. |
| **Pasos para consumir** | 1. Abrí una nota Markdown y abrí el panel de **Propiedades** (a la izquierda del editor). 2. Encontrá la propiedad `nextPage` (se crea automáticamente al abrir una nota si no existe). 3. Hacé **doble clic** en el valor de `nextPage` para editarlo. 4. Escribí `[[Nombre de la siguiente nota]]` y presioná **Enter**. 5. Notia actualizará automáticamente la nota destino para que tenga `previousPage: [[Nombre de la nota actual]]`. 6. Repetí el proceso para `previousPage` si es necesario. |
| **Entradas esperadas** | Un wikilink válido: `[[nombre-de-archivo.md]]`. Se aceptan referencias sin extensión (ej. `[[6-10]]`) que se resuelven automáticamente a `.md`. |
| **Salidas / Resultado** | Las dos notas quedan vinculadas bidireccionalmente. El **Explorador** renderiza las notas conectadas con una línea vertical que las agrupa como un bloque. Los bloques se ordenan por la fecha de creación (`createdAt`) de la primera nota. |
| **Errores comunes** | **Ciclo detectado**: si A → B → C, intentar que C apunte a A es rechazado. Solución: mantener una cadena lineal sin ciclos. **Link roto**: si `nextPage` apunta a un archivo inexistente, se ordena como nota suelta por fecha. Solución: verificar que el archivo exista. |

### Graph View

| Campo | Descripción |
|---|---|
| **Qué hace** | Visualiza todas las notas Markdown de la librería como nodos y los wikilinks entre ellas como conexiones, permitiendo navegación visual interactiva. |
| **Cuándo usarlo** | Cuando querés explorar visualmente las relaciones entre tus notas, encontrar notas aisladas o descubrir clusters de conocimiento. |
| **Pasos para consumir** | 1. Asegurate de tener notas Markdown con wikilinks en la librería. 2. En el **Icon Rail** (barra lateral izquierda), seleccionar **"Graph view"**. 3. Esperar a que se cargue el grafo (puede tomar segundos en bibliotecas grandes). 4. Usar zoom y paneo para explorar. 5. Hacer clic en un nodo para abrir la nota. 6. Usar la barra de búsqueda para encontrar texto en el título o contenido. 7. En una coincidencia, usar el ojo para centrar su nodo, `+` para agregarla o quitarla del contexto visible del chat, o el icono de archivo para abrirla. |
| **Entradas esperadas** | Librería activa con al menos un archivo Markdown. No requiere entrada manual del usuario. |
| **Salidas / Resultado** | Canvas interactivo con nodos (títulos de notas) y líneas de conexión (wikilinks). Al hacer clic en un nodo se abre la nota correspondiente en pestaña. |
| **Errores comunes** | **"El grafo está vacío"**: no hay archivos Markdown en la librería. Solución: crear notas Markdown. **"Lentitud"**: bibliotecas con miles de notas pueden tardar en construir el modelo. El archivo `linkCache.md` dentro de `.notia/` acelera la vista previa del grafo y se regenera automáticamente en segundo plano; si aún se siente lento, considerá dividir la librería en partes más pequeñas. |

### AI Chat con Ollama

| Campo | Descripción |
|---|---|
| **Qué hace** | Permite conversar con modelos de lenguaje locales (Ollama) con soporte de memoria a largo plazo, contexto de archivos de la librería y análisis de imágenes. |
| **Cuándo usarlo** | Cuando necesitás asistencia de IA para redactar, resumir, analizar imágenes o consultar sobre el contenido de tus notas. |
| **Pasos para consumir** | 1. Instalar y ejecutar Ollama localmente (`ollama serve`). 2. En Notia, abrir **Settings → IA** (desde el mensaje de IA no disponible en el chat, si preferís). 3. Ingresar la URL de Ollama (default: `http://localhost:11434`). 4. Opcional: ingresar API Key. 5. Hacer clic en **"Verificar conexión"**. 6. Seleccionar un modelo de la lista. 7. En el Icon Rail, abrir **"AI Chat"**. 8. Escribir un mensaje y presionar Enter. 9. Opcional: adjuntar archivos de la librería como contexto (modo **Directo** para contenido completo, **Referencia** para lista de nombres/rutas). 10. Opcional: cancelar una respuesta en curso con el botón **Cancelar** del composer. |
| **Entradas esperadas** | Texto del mensaje (string, límite flexible ~30k caracteres de contexto acumulado). Opcional: imagen en base64 (para modelos multimodales). Opcional: archivos de la librería como contexto. |
| **Salidas / Resultado** | Respuesta de texto del modelo de IA. Durante la generación, el pensamiento ocupa un bloque de altura fija que avanza hacia el fragmento más reciente y el hilo mantiene visible la parte inferior de la respuesta. Si todavía no hay una sesión seleccionada, el primer envío crea y muestra el chat inmediatamente en el panel lateral. La sesión se guarda automáticamente con un título generado por IA. Las memorias de largo plazo se extraen y persisten para futuras conversaciones. |
| **Errores comunes** | **"No se pudo conectar con Ollama"**: Ollama no está corriendo o la URL es incorrecta. Solución: verificar `ollama serve` en terminal y la URL en Settings; clic en **"Configurar IA"** en el mensaje de error del chat abre Settings directamente en la sección IA. **"La IA no devolvió contenido"**: el modelo no respondió. Solución: reintentar o cambiar de modelo. **"El modelo seleccionado no admite imágenes"**: se adjuntó una imagen a un modelo de solo texto. Solución: elegir un modelo con capacidad de visión en Settings → IA. |

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
   - Desde la **barra superior** (Toolbar): **"New Note"** (nota Markdown) o **"New Folder"** (carpeta).
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

### Usar Enlaces Secuenciales (Page Links)

1. Abrí una nota Markdown desde el Explorador.
2. En el panel **Propiedades** (a la izquierda del editor), buscá la propiedad `nextPage`. Si no existe, se crea automáticamente al abrir la nota por primera vez.
3. Hacé **doble clic** en el valor de `nextPage` para editarlo.
4. Escribí `[[nombre-del-siguiente-archivo]]` (puede ser sin `.md`, se resuelve automáticamente). Aparecerá un menú de autocompletado con las notas de la librería.
5. Presioná **Enter** para confirmar.
6. Notia guardará automáticamente:
   - La nota actual con `nextPage: [[nombre-del-siguiente-archivo]]`
   - La nota destino con `previousPage: [[nombre-de-la-nota-actual]]`
7. En el **Explorador**, ambas notas aparecerán conectadas visualmente como un bloque secuencial.
8. Para **romper un link**, editá `nextPage` (o `previousPage`) y dejalo en `N/A`. Notia limpiará el vínculo opuesto automáticamente.
9. Para **cambiar el destino**, editá `nextPage` a un nuevo archivo. Notia limpiará el vínculo en el destino anterior y lo creará en el nuevo.
10. **Nota**: No se permiten ciclos (A → B → C → A). Si intentás crear un ciclo, Notia mostrará un error.

### Configurar el Chat con IA

1. Asegurate de tener **Ollama** instalado y corriendo localmente en tu máquina (o accesible en red local).
2. En Notia, abrí **Settings** (⚙️) → **IA**.
3. Ingresá la URL de Ollama (por defecto: `http://localhost:11434`).
4. Opcional: ingresá una API Key si usás Ollama Cloud o un servicio con autenticación.
5. Hacé clic en **"Verificar conexión"** para confirmar que Notia puede comunicarse con Ollama.
6. Seleccioná un modelo de la lista de modelos disponibles. Para enviar imágenes, elegí uno con capacidad de visión.

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
4. En **InkMath**, configurá el intervalo de inactividad previo al reconocimiento OCR.

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

# App desktop completa en Windows
npm run dev:tauri:windows

# Forzar backend Wayland
NOTIA_TAURI_BACKEND=wayland npm run dev:tauri:wayland

# Forzar backend X11
NOTIA_TAURI_BACKEND=x11 npm run dev:tauri:x11

# Wayland con fallback a X11
NOTIA_TAURI_BACKEND=wayland NOTIA_TAURI_FALLBACK_X11=1 npm run dev:tauri:wayland:fallback
```

En Windows, si el puerto 1420 ya está ocupado por una instancia de Vite iniciada desde este mismo repositorio, el comando la reutiliza. Si pertenece a otra aplicación o proyecto, informa el proceso que debe cerrarse y no inicia Tauri contra un servidor incorrecto.

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

### InkMath
- **Espera de OCR**: intervalo de inactividad antes de enviar a Ollama los trazos de una fórmula dibujada.

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

### Al abrir el chat IA la pantalla se queda en blanco o se dejan de ver los mensajes
- Si la app se volvía blanca, ese problema fue corregido. Si persistiera, reiniciá la app y verificá que no haya quedado cacheado el bundle anterior (`npm run dev:tauri` o volvé a instalar la app en Android).
- Si los mensajes del asistente aparecen cortados, asegurate de usar la última versión del código: el hilo de chat ahora renderiza cada mensaje con su altura real, sin forzar un tamaño fijo que recorte contenido largo.
- Reportá cualquier traza adicional que aparezca en la consola de desarrollo.

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
- El Explorador usa virtualización (`useVirtualList`) para renderizar solo los nodos visibles; árboles de miles de archivos deberían mantenerse fluidos.
- Los diagramas Mermaid embebidos renderizan de forma **lazy** (solo cuando entran al viewport) y cancelan renders previos al cambiar de archivo.
- Notia aplica memoización selectiva (`React.memo`, `useMemo`, `useCallback`) y selectores de acciones (`useNotiaAction`) para reducir re-renders del panel izquierdo, el workspace y el panel derecho.
- En Android, Notia aplaza la carga de vistas pesadas (Graph, Chat, Task Manager) un par de frames para mantener la UI responsiva.
- En Android, Notia ajusta automáticamente la caché de renders Mermaid a 10 entradas / 2 MB para reducir consumo de memoria, mientras que en desktop conserva 20 / 5 MB.
- Al cambiar de biblioteca o cerrar todos los documentos, Notia invalida la caché de renders Mermaid para liberar SVGs de la librería anterior.
- Los componentes pesados (`MarkdownView`, `MermaidView`, `GraphView`) limpian sus recursos al desmontar: destruyen editores, remueven canvas, cancelan timeouts y limpian listeners globales.
- Las vistas pesadas usan selectores Redux memoizados (`selectTheme`, `selectMermaidViewerState`, `selectActiveLibraryPath`) en lugar de funciones inline, reduciendo re-renders en cadena.
- Las vistas más pesadas (`MarkdownView`, `MermaidView`, `ChatWorkspaceView`, `GraphView` y `TaskManagerApp`) se cargan bajo demanda mediante `React.lazy`, con `Suspense` y fallback mínimo, así el bundle inicial no incluye el editor Milkdown/Crepe, Monaco, Mermaid, Cytoscape ni MUI.
- En escritorio, Notia precarga esas vistas de forma inteligente durante los momentos de inactividad (`requestIdleCallback`) para que la primera apertura de archivo sea instantánea; en Android la precarga se omite por defecto para ahorrar memoria y datos.
- `vite.config.ts` agrupa dependencias grandes en chunks separados (`vendor-milkdown`, `vendor-mermaid`, `vendor-iconify-packs`, `vendor-mui`, `vendor-cytoscape`, `vendor-lucide`, etc.), manteniendo el bundle inicial en ~460 KB gzip.
- Los icon packs de Mermaid (`@iconify-json/*`) y las librerías de exportación PDF (`jspdf`, `html2canvas`) se cargan dinámicamente solo cuando se abre el menú de iconos o se exporta un PDF, respectivamente.
- El backend Rust se compila con perfil de release optimizado (`lto = true`, `codegen-units = 1`, `strip = true`, `panic = "abort"`) para reducir tamaño de binario y mejorar rendimiento en Android.
- Los commands de lectura de árbol (`read_library_tree`, `search_library_files`, `read_markdown_files`) se ejecutan de forma asíncrona en un thread pool (`tokio::task::spawn_blocking`) para no bloquear el hilo principal de Tauri en bibliotecas grandes.
- En Android, Notia cachea resoluciones SAF en una LRU Rust-side de 500 entradas y throttlea refrescos de cache a 200 ms, reduciendo llamadas JNI.
- Los eventos de cambio en el árbol de archivos (`notia-library-tree-changed`) se agrupan (batch) 160 ms para evitar refrescos en cascada durante guardados o pegados múltiples.
- Considerá dividir tu conocimiento en múltiples librerías más pequeñas si un solo árbol supera varios miles de archivos.

---

## 📝 Licencia

Copyright © 2026 Gabriel. Todos los derechos reservados.

---

**Notia** — Tu espacio de conocimiento, organizado.
