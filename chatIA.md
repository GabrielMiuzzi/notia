# Chat IA en Notia — Guía funcional

> Esta guía describe la funcionalidad del chat con inteligencia artificial de Notia desde una perspectiva de usuario y de comportamiento del sistema. No incluye detalles de implementación de código.

---

## 1. Propósito

El chat IA permite conversar con modelos de lenguaje ejecutados **localmente** a través de **Ollama**. La idea es tener un asistente integrado dentro del espacio de trabajo de Notia, sin depender de servicios en la nube.

Se puede usar para:

- Resumir notas o contenido de la librería.
- Redactar, reformular o generar texto.
- Hacer preguntas sobre archivos específicos de la librería.
- Analizar imágenes (si el modelo lo soporta).
- Mantener conversaciones que recuerdan datos previos gracias a la **memoria a largo plazo**.

---

## 2. Cómo se accede

Hay dos formas de usar el chat:

| Vista | Cómo se abre | Diferencia |
|---|---|---|
| **Chat lateral** | Icono de chat en el rail derecho (panel desplegable) | Acceso rápido, sin panel de historial de chats. Suele usarse con contexto de una nota o vista activa. |
| **Chat principal** | Icono "AI Chat" en el menú izquierdo | Ocupa el workspace completo, con panel de historial de conversaciones. |

Ambas vistas usan el **mismo componente de chat**. Solo cambian algunas opciones: el panel derecho no muestra historial y puede arrastrar contexto automático de la vista activa.

---

## 3. Configuración previa

Antes de usar el chat hay que configurar la conexión con Ollama:

1. Tener Ollama instalado y corriendo (`ollama serve`).
2. En Notia, ir a **Settings → IA**.
3. Ingresar la URL de Ollama (por defecto `http://localhost:11434`).
4. Opcional: ingresar una API key.
5. Verificar la conexión.
6. Seleccionar un modelo de la lista (cualquier modelo de Ollama; para imágenes, elegir uno con visión).

Si la conexión falla, la app muestra un mensaje amigable indicando que no se pudo conectar con la IA.

---

## 4. Ciclo de una conversación

1. El usuario escribe un mensaje y presiona Enter.
2. El mensaje se guarda en el archivo de chat.
3. Se arma el contexto completo que se enviará al modelo:
   - Instrucciones del sistema.
   - Memorias a largo plazo (si están habilitadas).
   - Historial reciente de la conversación.
   - El mensaje del usuario.
   - Contenido de archivos adjuntos (si eligió alguno).
   - Imagen adjunta (si el modelo es multimodal).
4. Se envía todo a Ollama.
5. La respuesta del asistente se muestra en streaming, palabra por palabra.
6. Al terminar, se guarda la respuesta completa en el archivo de chat.
7. Opcionalmente, se genera un título para la conversación.
8. Opcionalmente, se extraen memorias a largo plazo de ese intercambio.

---

## 5. Persistencia de las conversaciones

Cada sesión de chat se guarda como un archivo `.md` dentro de la carpeta `.notia/chat/chats/` de la librería activa. El archivo contiene:

- Un **frontmatter** con la configuración del chat (título, si la memoria largo plazo está activada, cantidad de mensajes de contexto, archivos seleccionados como contexto).
- El **historial de mensajes** del usuario y el asistente, marcados dentro del Markdown.

Esto permite que las conversaciones sean portables: al abrir la librería en otro dispositivo, los chats aparecen en el historial.

---

## 6. Contexto de archivos de la librería

El usuario puede adjuntar archivos de la librería al chat. Hay dos modos:

| Modo | Qué envía al modelo | Cuándo usarlo |
|---|---|---|
| **Directo** | El contenido completo del archivo. | Cuando el archivo es corto y querés que la IA lo lea completo. |
| **Referencia** | Solo nombres y rutas de los archivos seleccionados. | Cuando son muchos archivos o muy largos; la IA conoce su existencia pero no todo el contenido. |

Además, el panel lateral de chat puede arrastrar automáticamente el contexto de la vista activa. Por ejemplo, si estás viendo una nota y abrís el chat lateral, esa nota puede pasar como contexto sin tener que adjuntarla manualmente.

---

## 7. Memoria a largo plazo

Es una de las funciones clave del chat. Funciona así:

- Después de cada intercambio, el sistema le pide al modelo que extraiga **hechos, preferencias o datos personales** relevantes de la conversación.
- Esos datos se guardan en un archivo común de la librería: `.notia/chat/LongTermMemory.md`.
- En futuros mensajes, esas memorias se incluyen como contexto para que la IA "recuerde" cosas previas.

Ejemplo: si le decís "mi color favorito es el azul", en futuras conversaciones la IA puede usar ese dato.

### Detalles del almacenamiento de memorias

- El archivo `LongTermMemory.md` es **común para toda la librería**, no por chat individual.
- Tiene un formato simple: una lista de bullets Markdown bajo un encabezado.
- Se mantiene un límite de **200 memorias**. Cuando se supera, las más antiguas se descartan.
- Se eliminan automáticamente los duplicados al guardar.
- Al ser un archivo dentro de la librería, se porta entre dispositivos junto con el resto de los datos.

Cada chat tiene una configuración `longTermMemoryEnabled` que indica si ese chat en particular debe usar y actualizar las memorias, pero el archivo de almacenamiento siempre es el mismo.

---

## 8. Multimodalidad (imágenes)

Si se selecciona un modelo con soporte de visión (como `llava`), se puede adjuntar una imagen al mensaje. La imagen se codifica en base64 y se envía junto con el texto. La IA puede entonces describir, analizar o responder sobre la imagen.

---

## 9. Generación automática de títulos

Cuando se inicia un chat nuevo y se envía el primer mensaje, el sistema le pide a la IA un título corto para la conversación. Ese título aparece luego en el panel de historial.

---

## 10. Errores y estados comunes

| Situación | Qué pasa |
|---|---|
| Ollama no responde | Aparece "La IA no está disponible". La app no se bloquea. |
| Modelo no devuelve contenido | Se muestra un error y el mensaje del usuario queda guardado. |
| Envío sin conexión | Se deshabilita el botón de enviar hasta que la verificación de salud termine. |
| Modelo no admite imágenes | Aparece un mensaje indicando que se necesita un modelo con capacidad de visión. |
| Cancelar respuesta | Durante la generación, se muestra un botón **Cancelar** que detiene la respuesta y conserva el texto generado hasta ese momento. |
| Chat en Android | Usa un bridge nativo para hablar con Ollama, con streaming real palabra por palabra. |

---

## 11. Decisiones recientes de diseño

- **Streaming real**: tanto en escritorio como en Android, la respuesta se muestra progresivamente, palabra por palabra.
- **Cancelación**: el usuario puede detener una respuesta en curso; el texto parcial ya generado se conserva.
- **Persistencia incremental**: los mensajes se agregan al final del archivo `.md` en lugar de reescribirlo completamente en cada turno, salvo que cambie el título.
- **No se virtualizan los mensajes**: cada mensaje se renderiza con su altura real. Esto evita que mensajes largos del asistente se corten visualmente.
- **Lazy loading**: el componente de chat se carga bajo demanda para no pesar el inicio de la app.
- **Memoización**: el componente compara props para evitar re-renderizados innecesarios cuando el panel principal cambia de estado.

---

> Última actualización: 2026-06-24
