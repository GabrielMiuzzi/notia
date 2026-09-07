# Auditoría del módulo de IA y sus consumidores

**Fecha:** 2026-09-07

## Actualización de implementación — 2026-09-07

Cambios incorporados desde la auditoría:

- El editor Markdown tiene `move_document_block`, anchors estables de hunk, aplicación selectiva mediante `hunkIds`, conflicto por revisión/anchor y `verify_operation`.
- La persistencia de planes conserva metadata mínima de un `AgentPlan`, sin prompts, archivos ni argumentos privados, manteniendo compatibilidad con el TO-DO legado del chat.
- Desktop escribe documentos mediante archivo temporal sincronizado y reemplazo por rename; Android conserva el adapter SAF.
- Se incorporó `src-tauri/resources/ai/android/AiBridgePlugin.kt` y su copia versionada desde `build.rs`. El contrato cubre health, modelos, chat, tool chat y web search. `chatStreaming` consume NDJSON y emite Delta/Thinking/Done/Error mediante eventos del plugin; queda validar Gradle y permisos de eventos en Android.
- La búsqueda web mantiene la sanitización antes del proveedor y nunca incorpora contexto privado.
- Las preferencias persistentes no almacenan la API key: Redux y localStorage reciben una versión redacted, mientras la clave permanece solo en memoria de sesión hasta la frontera nativa. La persistencia segura nativa entre reinicios sigue siendo una decisión pendiente.
- Las preferencias antiguas se redaccionan durante la migración de carga y las nuevas acciones Redux se despachan sin credencial; `resolveAiPreferencesForTransport` es la única resolución que vuelve a incorporar la clave de sesión al límite nativo.
- Telegram tiene regresión del adapter mockeado para envío/edición de mensajes y los resultados web incluyen `verificationScore: 0` cuando Ollama no entrega verificación independiente.

El build Android de este entorno llega a compilar Cargo para Android, pero se detiene antes de Gradle porque Windows no permite crear symlinks sin Developer Mode. La prueba en tableta física sigue pendiente.

El preview de confirmación del chat muestra los hunks de `apply_document_edit`/`apply_document_patch` con selección individual; las operaciones directas mantienen confirmación completa hasta que su escritura también acepte selección parcial. El snapshot general del plan se rehidrata en la lista visible del chat, aunque todavía no reanuda automáticamente una ejecución interrumpida.
Además, Android ahora dispone de cancelación nativa del streaming (`cancel_android_ai_chat_streaming`/`cancelStreaming`), la memoria legacy se migra a `.agent/memory/memory.md` con backup versionado y recuperación explícita, y Telegram puede mostrar resúmenes operativos seguros en modo detallado. Nunca se envía el pensamiento crudo del modelo.

**Alcance:** frontend React/TypeScript, runtimes de IA y chat, persistencia de prompts/memoria, consumidores de UI, Telegram, Task Manager publicado, comandos Tauri/Rust, bridge Android, documentación y pruebas.

## 1. Resumen ejecutivo

La arquitectura conversacional principal está encaminada correctamente: el chat persistente, Meeting, Telegram y el chat publicado de Task Manager llegan a `runNotiaChatReply`, que a su vez delega en `runNativeToolAgent`. Los scopes, el catálogo de herramientas, las confirmaciones y la restricción de contexto están centralizados en `chatScopedAgentRuntime.ts`.

Las discrepancias que motivaron esta implementación fueron:

1. El plugin Android `AiBridgePlugin` que Rust registra no existe en el árbol del repositorio ni tiene una generación visible en `build.rs`.
2. El streaming Android documentado no coincide con el código: el bridge Rust emite únicamente `done`, y el loop principal de herramientas Android hace `fetch` directo con `stream: false`.
3. El frontend todavía accede directamente a Ollama para listar modelos, detectar visión y como fallback de health check, aunque la arquitectura del proyecto exige que el desktop use comandos/eventos Tauri.
4. Conviven dos sistemas de memoria: el toggle y la UI operan sobre `.notia/chat/LongTermMemory.md`, mientras el runtime actual carga y escribe `.agent/memory/memory.md`. Desactivar o borrar la memoria desde la UI no desactiva ni borra la memoria efectiva del agente.
5. Meeting se presenta como efímero, pero después de cada turno persiste y reorganiza memoria global en `.agent/memory`.
6. La documentación no está sincronizada con el código en URL por defecto, modo charla, transporte Android, streaming, flujo de memoria y varios diagramas/tablas técnicas.

El informe no modifica el código auditado. El repositorio ya tenía cambios locales extensos antes de esta revisión; se preservaron y solo se agregó este archivo.

## 2. Mapa de la arquitectura actual

```text
UI / Telegram / Task Manager publicado
        |
        +--> createChatScopedAgent()
        |       - scope y contexto autorizado
        |       - prompt, reglas, memorias
        |       - catálogo y ejecución de native tools
        |
        +--> runNotiaChatReply()
                |
                +--> runNativeToolAgent()
                        - rondas de tool calling
                        - validación de respuestas
                        - confirmaciones y cancelación
                        - streaming final cuando corresponde
                        |
                        +--> Desktop: comandos Tauri/Rust
        +--> Android: bridge nativo versionado para chat, tools y búsqueda web
                        +--> Publicado: shim HTTP del servidor de publicación
```

### 2.1 Núcleo frontend

| Módulo | Responsabilidad observada |
|---|---|
| [`src/services/ai/aiRuntime.ts`](src/services/ai/aiRuntime.ts) | Contratos de mensajes, imágenes, modelos y tools; health check; listado de modelos; detección de visión; transporte; parser de tool calls nativo/XML; loop `runNativeToolAgent`; streaming; operaciones auxiliares de título, memoria, OCR y transcripción. |
| [`src/services/ai/agentPromptRuntime.ts`](src/services/ai/agentPromptRuntime.ts) | Estructura `.agent`, prompt seleccionado, `rules.md`, `memory.md`, marcadores administrados, escritura acotada y normalización de reglas/memorias. El directorio de prompts se llama `promps` por compatibilidad histórica. |
| [`src/services/chat/chatScopedAgentRuntime.ts`](src/services/chat/chatScopedAgentRuntime.ts) | Construcción de agentes por scope (`task-manager`, `graph`, `document`, `library`, `finance`), contexto de archivos, prompt de dominio, filtrado de tools, validación y handlers de tools. El máximo común es 64 rondas. |
| [`src/services/chat/notiaChatRuntime.ts`](src/services/chat/notiaChatRuntime.ts) | Fachada conversacional única. Siempre llama a `runNativeToolAgent` y propaga tools, validación, cancelación, timeout, diagnóstico y streaming final. |
| [`src/services/chat/chatLongTermMemorySync.ts`](src/services/chat/chatLongTermMemorySync.ts) | Extracción posterior al turno y reorganización asíncrona de `.agent/memory` y `.agent/rules`. |
| [`src/services/chat/chatDocumentStorage.ts`](src/services/chat/chatDocumentStorage.ts) | Persistencia de documentos/mensajes de chat y API heredada para `LongTermMemory.md`. Sigue siendo consumida por la UI. |
| [`src/services/chat/chatAttachmentRuntime.ts`](src/services/chat/chatAttachmentRuntime.ts) | Selección de archivos, modo referencia/índice frente a contenido directo y adjuntos para el agente. |
| [`src/services/chat/chatTitleSync.ts`](src/services/chat/chatTitleSync.ts) | Generación auxiliar de títulos; no es una conversación y usa la API convencional. |

### 2.2 Qué hace `aiRuntime.ts`

- Normaliza preferencias y resuelve el modelo activo.
- Consulta modelos y capacidades mediante comandos Tauri desktop o el bridge Android; no usa fetch directo a Ollama desde WebView.
- Ejecuta health check con caché de 10 segundos.
- Representa mensajes multimodales, thinking, tool calls nativos y el fallback XML heredado.
- Ejecuta el agente con límite de 600 segundos, límite de rondas, cancelación y timeout por tool.
- En desktop, las rondas de tools usan `run_desktop_ai_tool_chat`; la respuesta final usa `run_desktop_ai_chat_streaming` cuando corresponde. Android usa `run_android_ai_tool_chat` y el bridge versionado.
- Expone `streamAiChatReply` para respuestas convencionales; los chats de agente no la usan como motor principal.
- Expone operaciones auxiliares independientes para título, extracción de memorias, OCR InkMath, organización de conocimiento y mejora de transcripción.

### 2.3 Prompt, reglas, memoria y scopes

`createChatScopedAgent` carga el prompt seleccionado, reglas y memorias para todos los scopes normales. Para `publishedScope` usa prompt/reglas integrados, no lee `.agent`, no carga memorias y restringe las tools a los tableros publicados.

El catálogo se filtra así:

- `finance`: únicamente herramientas financieras; no recibe documentos, reglas ni memorias de biblioteca.
- `publishedScope`: únicamente documentos y Task Manager de los tableros publicados.
- `graph`, `document`, `library` y `task-manager`: pueden recibir contexto de biblioteca según selección/scope y exponen tools generales con las validaciones correspondientes.
- Telegram añade formato `telegram-html` y reglas de confirmación/auto-confirmación específicas del canal.

### 2.4 Capa Rust, Tauri e IPC

| Capa | Observación |
|---|---|
| [`src-tauri/src/commands/ai.rs`](src-tauri/src/commands/ai.rs) | Adapters Tauri desktop para health, chat completo, streaming, tool chat y modelos. Valida DTOs y delega en `ai_service`; en mobile deja comandos stubs o deriva al bridge según plataforma. |
| [`src-tauri/src/services/ai_service.rs`](src-tauri/src/services/ai_service.rs) | Cliente desktop `reqwest` hacia Ollama. Construye endpoints, valida esquema/credenciales, aplica Bearer API key, timeout de chat y stream NDJSON. `run_desktop_ai_tool_chat` valida timeout entre 1 y 600 segundos. |
| [`src-tauri/src/mobile_ai_bridge.rs`](src-tauri/src/mobile_ai_bridge.rs) | Estado del plugin Android, payloads de health/chat/modelos y traducción de eventos `notia-ai-chat-stream`. Es el punto donde debería vivir el transporte Android, pero la implementación Kotlin referenciada no está versionada. |
| [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs) | Registra los comandos AI desktop/mobile y la inicialización del bridge. La ausencia del plugin Android no es detectable en el build desktop. |
| [`src-tauri/src/task_manager_publication.rs`](src-tauri/src/task_manager_publication.rs) | Servidor de publicación: autentica el navegador, restringe filesystem por tablero, ejecuta en el host los comandos AI y retransmite el stream final. No es un acceso directo del WebView a Ollama. |

El contrato de comandos distingue correctamente la respuesta completa de la respuesta por eventos en desktop. El problema no está en la separación nominal de comandos, sino en que algunos consumidores no usan el adapter esperado y en que el bridge Android no tiene una implementación reproducible en el árbol.

### 2.5 Preferencias y secretos

Las preferencias se normalizan por biblioteca y se almacenan en `localStorage`, incluyendo la API key de Ollama en texto plano local. El código no la incorpora a la URL ni la registra, y el servidor publicado evita entregarla al navegador. Esto debe seguir documentado como una decisión de seguridad: cualquier fallback frontend a Ollama amplía la superficie donde esa clave queda disponible.

## 3. Consumidores identificados

| Consumidor | Entrada principal | Persistencia/historial | Transporte y observaciones |
|---|---|---|---|
| Chat principal y chats laterales de Graph, Task Manager y documentos | [`useChatSubmitMessage.ts`](src/components/notia/views/chat/useChatSubmitMessage.ts), `ChatWorkspaceView` | Documento de chat persistente; título y extracción posterior | `createChatScopedAgent` + `startNotiaChatReply`; es el camino conversacional principal. |
| Meeting lateral | [`MeetingEphemeralChat.tsx`](src/components/notia/views/chat/MeetingEphemeralChat.tsx) | No crea documento de chat y descarta el hilo al salir, pero actualmente sí persiste memoria global | Usa el transcript actual como contexto y el mismo runtime común. Scope `library`. |
| Telegram | [`useTelegramAgentBridge.ts`](src/components/notia/hooks/useTelegramAgentBridge.ts) | Cola/checkpoints en `localStorage`, historial efímero acotado; memorias/reglas globales persistentes | Usa el mismo agente, imágenes descargadas por comando nativo, formato HTML y políticas de timeout propias. |
| Task Manager publicado | [`publishedTaskManagerChatRuntime.ts`](src/modules/task-manager/services/publishedTaskManagerChatRuntime.ts), `PublishedTaskManagerChat` | Hilo efímero en el navegador; no carga ni escribe `.agent` | Pasa por la fachada común. El navegador llama al servidor de publicación; el host ejecuta Ollama con su configuración. |
| Título de chat | [`chatTitleSync.ts`](src/services/chat/chatTitleSync.ts) | Persiste el título en el documento de chat | Operación auxiliar convencional; no debe pasar por el agente de tools. |
| Memoria de turno | [`chatLongTermMemorySync.ts`](src/services/chat/chatLongTermMemorySync.ts) | Escribe `.agent/memory/memory.md` y reorganiza en background | Operación auxiliar que usa `generateAiLongTermMemories` y `organizeAiAgentKnowledge`. |
| Meeting: “Pasar por IA” | [`MeetingView.tsx`](src/components/notia/views/MeetingView.tsx) | Guarda el transcript mejorado en la vista/documento correspondiente | Usa `improveMeetingTranscript` y `streamAiChatReply`; no es una conversación interactiva. |
| InkMath | [`MarkdownView.tsx`](src/components/notia/views/MarkdownView.tsx), `inkmath` | Persiste la fórmula reconocida en el documento | Usa `recognizeInkMathWithAi`; operación de visión auxiliar. |
| Configuración y estado del chat | [`SettingsModal.tsx`](src/components/notia/SettingsModal.tsx), `useChatState.ts`, preferencias Redux/storage | Persiste URL, API key, modelo y thinking por biblioteca | Consume `checkAiHealth`, `listAiModels` y `resolveActiveModel`. |
| Voz | `ChatComposer`, `useVoiceTranscription`, `qwen3TtsRuntime`, `speechService` | Runtime separado de ASR/TTS | Dictado y TTS no deben considerarse otro motor conversacional. Los handlers de “modo charla” están aislados y no se renderizan. |
| Preparación de estructura | `useLibraryTreeSync.ts` | Crea la estructura `.agent` y los archivos administrados | No genera una respuesta de IA; prepara el límite de persistencia del agente. |

## 4. Recorridos relevantes

### 4.1 Chat persistente

1. `useChatSubmitMessage` verifica disponibilidad de IA y crea/hidrata el documento de chat.
2. Lee `LongTermMemory.md` solo si `longTermMemoryEnabled` está activo.
3. Construye el agente con `createChatScopedAgent`.
4. Ejecuta `startNotiaChatReply`, que termina en `runNativeToolAgent`.
5. Persiste mensajes, actualiza título y, si el toggle está activo, programa extracción de memoria.

El paso 2 y el paso 5 pertenecen al sistema legado; el paso 3 carga además `.agent/memory` sin consultar ese toggle. Esto produce la discrepancia de memoria descrita en la sección 5.

### 4.2 Meeting

El transcript se incorpora al prompt/contexto del agente. El hilo no se guarda como documento de chat, pero después de responder `MeetingEphemeralChat` carga memorias y llama a `scheduleLongTermMemoriesForTurn`. Por lo tanto, “efímero” describe el historial visible/archivo de chat, no todos los efectos duraderos.

### 4.3 Telegram

El bridge checkpointa updates y solicitudes pendientes, descarga imágenes mediante Tauri con límite de tamaño, selecciona el scope y ejecuta el mismo runtime. El canal desactiva el streaming final (`streamFinalResponse: false`), fija 90 segundos por tool y limita a 12 rondas las solicitudes con imagen. Después persiste la memoria extraída en `.agent`.

### 4.4 Task Manager publicado

La entrada pública intercepta el `invoke` para enviar comandos al servidor de publicación. El bootstrap no entrega la URL real ni la API key; usa un valor neutral y el host toma las preferencias reales. El stream final se retransmite por `/task-manager/ai/stream`. El scope publicado omite memorias globales y limita cada operación a las rutas de tableros autorizados.

### 4.5 Operaciones auxiliares

Título, OCR, mejora de transcripción, extracción de memoria y reorganización de reglas/memorias usan APIs especializadas de `aiRuntime`. Esto es consistente con la regla arquitectónica: no son conversaciones y no deben forzarse artificialmente dentro del loop de tools.

## 5. Informe de discrepancias

### AI-01 — Plugin Android ausente o no reproducible

**Severidad: crítica.**

`src-tauri/src/mobile_ai_bridge.rs` registra `AiBridgePlugin` con `register_android_plugin`, pero no existe `AiBridgePlugin.kt` en el repositorio, ni en `src-tauri/gen/android`, ni en la generación visible de `src-tauri/build.rs`. La búsqueda del árbol solo encuentra el bridge Rust. `cargo check` desktop no puede detectar esta ausencia porque la integración Android queda condicionada por plataforma.

**Impacto:** en un checkout limpio no hay una implementación versionada que atienda `healthCheck`, `chat`, `chatStreaming` y `listModels`. El bridge puede quedar no disponible o fallar durante la inicialización Android.

**Acción recomendada:** versionar el plugin Android y su contrato, o eliminar el registro y reemplazarlo por un adapter Android real. Añadir build Android y una prueba/instrumentación que verifique registro, health, listado y chat.

### AI-02 — Streaming Android no coincide con el contrato documentado

**Severidad: crítica.**

El enum Rust contempla `Delta`, `Done` y `Error`, pero `run_android_ai_chat_streaming` invoca `chatStreaming` y luego emite un único `Done` con la respuesta completa. No emite deltas ni thinking. Además, el loop `runNativeToolAgent` para Android usa `fetch(buildOllamaUrl(..., '/api/chat'))` con `stream: false`, en vez del bridge Android.

**Impacto:** el usuario Android no recibe streaming incremental en el camino principal del agente; la API documentada en `README-TECH.md` promete un comportamiento que el código actual no puede producir. También se envía la API key desde el WebView en ese camino.

**Acción recomendada:** definir un único contrato Android de streaming/tool-agent en el bridge nativo, emitir eventos incrementales reales y cubrirlo con una prueba de contrato. Mientras no exista, documentar explícitamente que el agente Android es respuesta completa y no anunciar streaming.

### AI-03 — Fallbacks directos de desktop a Ollama desde el frontend

**Severidad: alta.**

`aiRuntime.ts` hace fetch directo a `/api/tags` y `/api/show` para modelos/capacidad de visión. `listAiModels` lo intenta antes del bridge y `checkAiHealth` puede caer en `checkDesktopAiHealthViaFetch`. Esto contradice la regla del repositorio de que desktop debe acceder a Ollama exclusivamente mediante comandos/eventos Tauri.

**Impacto:** se salta la frontera nativa, se duplica la validación/transporte y la API key puede circular por el WebView. La política de seguridad y el comportamiento pueden diferir entre el health check, la detección de visión y la ejecución del agente.

**Acción recomendada:** mover listado, `/api/show`, health y cualquier capacidad adicional a comandos Rust tipados. Mantener como excepción separada únicamente el endpoint HTTP del servidor de publicación, que no es un fetch directo a Ollama desde el cliente.

### AI-04 — Dos fuentes de verdad para memoria de largo plazo

**Severidad: alta.**

La UI y el modelo persistido de chat siguen usando `.notia/chat/LongTermMemory.md`: `longTermMemoryEnabled`, `loadLongTermMemories`, `clearLongTermMemories` y el modal de borrar memoria apuntan a ese archivo. El runtime actual carga y escribe `.agent/memory/memory.md`; `createChatScopedAgent` carga esa memoria siempre para scopes normales, sin recibir `longTermMemoryEnabled`.

**Impacto:** apagar el toggle no impide que el agente lea `.agent/memory`; borrar `LongTermMemory.md` no borra los hechos que el agente usa; la extracción actual no alimenta el archivo que la UI afirma administrar. Es una discrepancia de funcionalidad y privacidad.

**Acción recomendada:** elegir `.agent/memory/memory.md` como fuente única, migrar/retirar el archivo legado y hacer que la política de lectura/escritura viaje explícitamente en el contexto del agente. La UI de borrar y el toggle deben operar sobre esa misma fuente.

### AI-05 — “Efímero” de Meeting permite efectos persistentes

**Severidad: alta.**

Meeting no guarda el hilo, pero ejecuta `scheduleLongTermMemoriesForTurn` después de cada respuesta. Como el scope es `library`, también usa el catálogo general de herramientas, que incluye las herramientas internas de reglas/memorias cuando corresponden.

**Impacto:** salir de Meeting descarta el chat visible, pero puede dejar datos personales, reglas o cambios de conocimiento en la biblioteca. Esto no coincide con la descripción de “solo efímero” si el usuario interpreta efímero como ausencia de efectos duraderos.

**Acción recomendada:** introducir una política explícita de persistencia (`persistent`, `ephemeral-no-memory`, etc.) en `createChatScopedAgent`/`runNotiaChatReply`. Para Meeting efímero, no cargar ni escribir memoria global y decidir explícitamente si las tools de mutación de biblioteca siguen habilitadas.

### AI-06 — URL por defecto y modelo de despliegue contradicen la documentación

**Severidad: media-alta.**

`src/services/preferences/aiSettingsStorage.ts` y `SettingsModal.tsx` usan `https://ollama.com` como default y describen Ollama Cloud. `README.md` todavía indica varias veces `http://localhost:11434`, “IA local” y una instalación local como flujo predeterminado.

**Impacto:** el usuario puede creer que la aplicación es offline/local cuando la primera configuración apunta a un servicio cloud. Además, reglas/memorias pueden enviarse al servicio configurado durante la reorganización.

**Acción recomendada:** sincronizar README, FAQ, onboarding y documentación técnica con la decisión actual. Si el producto debe ser offline-first, considerar volver a un default local y hacer opt-in explícito de Cloud; en ambos casos mostrar claramente el destino de datos.

### AI-07 — Documentación anuncia un modo charla que no está expuesto

**Severidad: media.**

`README.md` anuncia un botón de llamada junto al micrófono. En `ChatComposer.tsx`, `startConversation` y `stopConversation` quedan declarados pero se consumen con `void` y no se renderiza ningún botón de llamada; el control visible es dictado.

**Impacto:** documentación y UI prometen una capacidad que el usuario no puede descubrir ni activar. `README-TECH.md` conserva además una descripción extensa del flujo de llamada.

**Acción recomendada:** retirar o marcar como pendiente esa documentación, o exponer una superficie de llamada completa. No dejar handlers heredados como si fueran una capacidad activa.

### AI-08 — Opciones del runtime difieren por canal sin una política formal

**Severidad: media.**

El runtime común acepta `toolCallTimeoutMs`, `maxRounds` y `streamFinalResponse`, pero Telegram fija 90 segundos, desactiva el stream final y usa 12 rondas con imagen; el resto usa el default de 600 segundos/64 rondas y el publicado fuerza streaming final.

**Impacto:** “mismo runtime” no implica las mismas garantías operativas. Esto puede ser correcto por Telegram, pero contradice la expectativa de opciones idénticas salvo contexto/prompt/persistencia si no está documentado como una política de canal.

**Acción recomendada:** modelar estas diferencias en una `ChatRuntimePolicy` nombrada y documentada, con pruebas por canal. Separar explícitamente límites de seguridad del canal de opciones funcionales del agente.

### AI-09 — Posible fuga de listeners en el streaming Android

**Severidad: media.**

`invokeAndroidAiChatStreaming` agrega un listener de `abort`, pero su cleanup no lo retira. También existe una carrera si el comando termina antes de que `listen` resuelva: el `unlisten` puede agregarse después de ejecutar cleanup y quedar sin llamar.

**Impacto:** listeners acumulados, callbacks sobre operaciones finalizadas y cancelaciones inconsistentes durante uso prolongado o repetidos cambios de vista.

**Acción recomendada:** hacer cleanup simétrico del listener de abort y, al resolver `listen`, ejecutar inmediatamente el `unlisten` si la operación ya terminó. Añadir una prueba de cancelación antes y después de registrar el listener.

### AI-10 — Documentación técnica describe una arquitectura anterior

**Severidad: media.**

`README-TECH.md` todavía contiene, entre otros, estos modelos antiguos:

- chat principal basado en `streamAiChatReply`/fetch directo;
- memoria persistida en `LongTermMemory.md`;
- streaming Android producido por un plugin Kotlin existente;
- máximo persistido de 200 memorias;
- tablas de comandos que no reflejan el uso principal de `run_desktop_ai_tool_chat`.

Hay secciones nuevas que sí describen `.agent/memory`, Task Manager publicado y `runNotiaChatReply`, por lo que el problema es la coexistencia de versiones incompatibles dentro del mismo documento.

**Acción recomendada:** actualizar diagramas, secuencias, tabla de comandos, límites y ejemplos después de resolver los contratos Android/memoria. Eliminar las rutas históricas o rotularlas como legacy.

### AI-11 — Cobertura insuficiente en las fronteras de plataforma y persistencia

**Severidad: media.**

La suite frontend pasa, incluyendo pruebas de parser, continuación del agente, fachada común, scopes y publicación. Sin embargo, no hay prueba observable que cubra el flujo completo de cada consumidor hasta una implementación nativa real, ni una prueba Android del plugin/streaming, ni una regresión para “Meeting efímero no persiste memoria”, “toggle desactivado no carga memoria” o “desktop no hace fetch directo”. Rust solo tiene cobertura visible para el parser de stream de `ai_service`.

**Acción recomendada:** añadir pruebas de contrato con adapters fake para desktop/Android/publicado y pruebas de política de persistencia. Mantener una prueba por superficie que demuestre el paso por `notiaChatRuntime`.

### AI-12 — Telegram no comunica el progreso general ni un plan ejecutable

**Severidad: media-alta.**

`useTelegramAgentBridge.ts` solo envía algunos mensajes de avance para solicitudes con imagen, basados en rondas del agente. Las solicitudes de texto no reciben información general sobre si el agente está leyendo, planificando, ejecutando una tool, esperando una aclaración/confirmación o verificando un resultado. El callback `onThinkingDelta` del runtime tampoco está conectado al canal.

**Impacto:** una operación larga parece detenida y el usuario no puede distinguir espera, fallo, ejecución o necesidad de intervención. Con el soporte de planes multi-step, Telegram también necesita mostrar el TO-DO y el paso actual. Exponer el thinking crudo para resolverlo introduciría riesgo de filtrar chain-of-thought, prompts, argumentos de tools, contenido privado o secretos.

**Acción recomendada:** agregar eventos tipados de progreso separados del thinking interno, mostrar resúmenes breves y seguros del enfoque, renderizar un único mensaje de estado editable y mantener aclaraciones/confirmaciones en mensajes separados. Aplicar rate limit, deduplicación, recuperación tras reinicio y pruebas que demuestren que nunca se envían datos sensibles.

## 6. Elementos que sí están alineados

- El chat principal, Meeting, Telegram y Task Manager publicado usan la fachada conversacional común.
- `runNotiaChatReply` delega siempre en `runNativeToolAgent`; no existe un motor conversacional alternativo en esas superficies.
- Los scopes filtran contexto y herramientas; Finance y el scope publicado tienen restricciones especialmente claras.
- El servidor de Task Manager publicado no entrega al navegador la URL real ni la API key y vuelve a autorizar operaciones por ruta en Rust.
- Las operaciones auxiliares están separadas del chat interactivo y no fuerzan un uso artificial del agente.
- La cancelación y los límites existen en el loop de tools y en el stream desktop, aunque el camino Android tiene el problema de cleanup indicado.
- La voz Qwen3-ASR/TTS está separada del runtime conversacional, tal como exige la arquitectura.

## 7. Plan de remediación priorizado

### P0 — Android y contratos de transporte

1. Decidir si `AiBridgePlugin` forma parte del producto. Si la respuesta es sí, añadir su fuente/build/registro versionados.
2. Definir un contrato único para chat Android con tools y streaming incremental.
3. Eliminar el fetch directo de `runNativeToolAgent` Android o justificarlo formalmente como excepción temporal.
4. Añadir pruebas de contrato y una validación en dispositivo Android.

### P1 — Memoria y semántica de “efímero”

1. Consolidar `.agent/memory/memory.md` y retirar/migrar `LongTermMemory.md`.
2. Llevar la política de persistencia como opción explícita de la fachada común.
3. Hacer que el toggle, “borrar memoria”, Meeting y Telegram respeten la misma política.
4. Revisar si Meeting puede ejecutar tools con efectos persistentes cuando se presenta como efímero.

### P1 — Frontera desktop

1. Pasar modelos, `/api/show`, health y capacidades al servicio Rust.
2. Mantener API key y URL fuera del WebView salvo el DTO estrictamente necesario hacia Tauri.
3. Añadir una prueba que falle si una ruta de desktop conversacional intenta `fetch` a Ollama.

### P2 — Documentación y pruebas

1. Corregir README/README-TECH en una única actualización coordinada.
2. Retirar la promesa de modo charla mientras no exista UI activa.
3. Añadir pruebas de integración por consumidor y de persistencia efímera.
4. Corregir el cleanup Android y cubrir las carreras de cancelación.

### P2 — Feedback operativo de Telegram

1. Implementar `AgentProgressEvent` y conectarlo al runtime común sin reutilizar `onThinkingDelta` como canal visible.
2. Añadir edición segura del mensaje de progreso y una política de rate limit/deduplicación.
3. Mostrar el plan, el paso actual, las esperas de aclaración/confirmación y la verificación final.
4. Cubrir texto, multimodalidad, búsqueda web, cancelación, reinicio, cola y fallos sin filtrar contenido sensible.

## Actualizacion de implementacion 2026-09-07 — consumidores y calidad

- El chat principal evita persistir una respuesta tardia despues del desmontaje; la respuesta se aborta y el guard de montaje bloquea mensajes, titulos y memoria posteriores.
- Se agregaron pruebas de consumidor para edicion documental con seleccion, preview, confirmacion, aplicacion y escritura; tambien para seleccion ausente y target ambiguo.
- Telegram tiene un ciclo mockeado del hook que cubre respuesta por la fachada comun, memoria, aclaraciones con botones, imagen, error/reintento y cancelacion. El feedback visible usa resumenes operativos y no pensamientos crudos.
- La busqueda web se verifico desde cada scope autorizado y se bloqueo antes de confirmar o invocar el proveedor cuando la consulta contiene datos privados; Finance y Task Manager publicado no exponen la tool.
- La validacion global de ESLint quedo en verde tras corregir refs durante render, dependencias de hooks y callbacks sin uso.
- Validacion actual: `npm test -- --run` pasa con 88 archivos y 451 pruebas; `npm run build`, `npx tsc -b --pretty false`, `npm run lint`, `cargo fmt --all -- --check`, `cargo check --all-targets` y `git diff --check` tambien pasan. El build conserva solo advertencias conocidas de chunks grandes/imports.

## Actualización de implementación — cierre de cobertura Telegram 2026-09-07

- El test de integración del bridge cubre ahora texto, audio transcripto, imagen, PDF con extracción textual, PDF escaneado renderizado por páginas, búsqueda web pública, TO-DO multi-step, aclaraciones, reintento, cancelación, cola serializada, concurrencia y reanudación explícita.
- El flujo de Telegram conserva la fachada `notiaChatRuntime` también en esos casos y no serializa el token del bot, IDs de plan internos, rutas privadas ni contenido privado en el feedback.
- Validación focalizada de esta iteración: `useTelegramAgentBridge.integration.test.ts` pasa con 12 casos.
- Validación nativa actualizada: `cargo test --all-targets` compila pero el runner Windows aborta con `0xc0000139 / STATUS_ENTRYPOINT_NOT_FOUND`; `cargo clippy --all-targets --all-features -- -D warnings` permanece bloqueado por 52 diagnósticos de la librería y 54 en tests, fuera del vertical slice IA.

## Validacion adicional 2026-09-07

- La suite de privacidad web agrega corpus de headers, encoding, rutas, datos laborales, legales y calendario, IPs privadas y redaccion de secretos/instrucciones en resultados externos; la frontera nativa mantiene la misma barrera.
- La validacion nativa de Telegram rechaza IDs, texto vacio y parse mode invalido antes de abrir una conexion.

## 8. Validaciones historicas ejecutadas

- `npm test`: **OK**, 88 archivos y 434 pruebas.
- `npm run build`: **OK**. Vite emitió advertencias de chunks grandes y de imports dinámicos/estáticos, pero terminó correctamente.
- `cargo fmt --all -- --check`: **OK**.
- `cargo check --all-targets`: **OK** en el target disponible, con 39 warnings Rust preexistentes; entre ellos aparecen símbolos del bridge Android no usados en el build desktop.
- `cargo clippy --all-targets --all-features -- -D warnings`: **falló** por 51 diagnósticos preexistentes de imports/dead code y reglas Clippy en módulos Rust no relacionados con el vertical slice.
- `npm run lint`: **falló** con 24 errores y 7 warnings. Los errores reportados se concentran principalmente en módulos Mermaid y `speechService`; también hay warnings de dependencias de hooks en módulos preexistentes. Los archivos afectados por esta implementación pasan el lint focalizado y no se modificó código para ocultar deuda previa.
- `node --test scripts/tauri-watcher.test.mjs`: **OK**.
- Continuacion 2026-09-07: el runtime incorpora undo multiarchivo con conflicto por revision para renombrados y links, y Task Manager incorpora duplicar, archivar, restaurar y resumen de tablero.
- Continuacion 2026-09-07: `bulk_update_tasks` valida scope, IDs y campos antes de confirmar; los presets Markdown (`clarity`, `grammar`, `tone`, `shorten`, `expand`, `technical`, `format`, `translate`, `custom`) generan instrucciones acotadas y testeables.
- Continuacion 2026-09-07: el engine de planes soporta deteccion determinista de complejidad, dependencias, bloqueo transitivo, reintento aislado, cancelacion y ciclos invalidos.
- Continuacion 2026-09-07: `search_web` admite frescura y la normalizacion de resultados redacciona secretos y limpia credenciales, tokens y parametros sensibles de URLs externas.
- Actualizacion de implementacion 2026-09-07: Telegram persiste `requestId`, `progressMessageId` y presupuesto de reintentos. Al reabrir, una request activa queda en estado desconocido y requiere `/reanudar`; no se reejecuta automaticamente solo para reconstruir feedback.
- Actualizacion de implementacion 2026-09-07: `apply_multi_document_patch` ofrece preview combinado, revision exacta, hunks parciales, rollback y undo; `bulk_update_tasks` agrega excepciones por hunk y rollback fisico.
- Actualizacion de implementacion 2026-09-07: la validacion Markdown cubre saltos de headings, enlaces sin cierre y columnas inconsistentes en tablas.
- Actualizacion de implementacion 2026-09-07: la deteccion local de complejidad se conecta al runtime comun para exigir plan aprobado antes de mutaciones compuestas, manteniendo las solicitudes simples sin TO-DO innecesario.
- Actualizacion de implementacion 2026-09-07: el runtime bloquea una tool mutante si ese preflight compuesto no tiene un plan aprobado y devuelve una correccion estructurada para que el agente lo cree antes de continuar.
- Actualizacion de implementacion 2026-09-07: las escrituras AI invalidan el indice de busqueda/graph y emiten cambios de biblioteca; `reindex_changed_documents` permite pedir esa invalidacion de forma explicita y autorizada.
- Actualizacion de implementacion 2026-09-07: el agregador de progreso de Telegram conserva correlacion y timestamp, descartando eventos atrasados o de otra request antes de renderizar.
- Actualizacion de implementacion 2026-09-07: el logger central redacta secretos, JWT, emails, rutas privadas y campos sensibles anidados antes de escribir en consola o reenviar diagnosticos al backend nativo; la cobertura incluye regresion de API key, token, ruta y email.
- Actualizacion de implementacion 2026-09-07: la busqueda web conserva errores tipados de credencial rechazada, rate limit, timeout y respuesta invalida, sin reenviar el detalle remoto ni la consulta original bloqueada.
- El build Android directo alcanza Cargo para `aarch64` pero Gradle queda bloqueado al crear symlinks en Windows sin Developer Mode; no hay tableta Android física disponible.
- La ejecución final de `cargo test --all-targets` sigue bloqueada fuera del código: los binarios compilan, pero Windows aborta el runner con `0xc0000139 / STATUS_ENTRYPOINT_NOT_FOUND` antes de ejecutar las pruebas.
- Actualización de seguridad: el Task Manager publicado usa el alias opaco `published-vault`; Rust traduce las rutas para autorizar/ejecutar y vuelve a publicarlas con el alias. El bootstrap no devuelve la ruta real del vault ni credenciales, y existe una regresión nativa para ambos invariantes.
- Actualización de diagnósticos: `notiaLogger` centraliza la redacción de secretos, JWT, emails, rutas y campos sensibles anidados. El adapter de búsqueda web conserva errores tipados para credencial, rate limit, timeout y respuesta inválida sin propagar detalles remotos.
- Actualización de seguridad de contexto: el prompt común declara documentos, adjuntos, transcripciones, web y resultados de tools como datos no confiables; cada resultado de tool llega delimitado para impedir que instrucciones embebidas alteren permisos, scope o confirmaciones.
- Actualización documental: README y README-TECH fueron sincronizados con el endpoint local/Cloud vigente, el transporte nativo del chat y la ausencia de modo llamada en la UI. Las aclaraciones persistentes también pueden reanudarse desde una pregunta válida al reabrir el panel, con invalidación por contexto y revisión.
- Actualización de observabilidad: el baseline de performance reutiliza la redacción central para no persistir ni imprimir metadatos sensibles o errores con rutas/credenciales.
## Actualización de implementación 2026-09-07

- Los planes persistidos ahora rehidratan primero el snapshot detallado y conservan dependencias, riesgo, tool prevista y `operationId`; el formato legacy queda como fallback.
- El chat muestra acciones para continuar un TO-DO pendiente, reintentar únicamente el primer paso fallido reintentable y cancelar las nuevas ejecuciones. El reintento limpia el `operationId` anterior y reabre dependientes bloqueados sin repetir pasos completados.
- Se incorporó `compare_documents`, una tool de solo lectura con diff lineal acotado, rutas y números de línea para fundamentar comparaciones y posibles contradicciones sin cargar dos documentos completos en la respuesta.
- Se incorporó `link_ticket_document`, que actualiza `relatedDocuments` y `relatedTasks` en ambos frontmatter con deduplicación, preview de dos archivos, revisión exacta, rollback y journal reversible.
- Los presets de edición Markdown incluyen resumen, outline, FAQ, tabla, checklist, TOC, extracción de tareas/fechas/decisiones/personas/riesgos y corrección de LaTeX/Mermaid. Todos siguen el flujo preview/confirmación/validación.
- `extract_document_facts` devuelve candidatos explícitos con categoría, evidencia y línea para que el agente los convierta en tickets/notas únicamente mediante un plan y destino explícitos.
- `update_document_tags` agrega, quita o reemplaza tags con deduplicación, preview, revisión exacta, confirmación y undo; `find_document_references` y el renombrado controlado cubren backlinks/wikilinks sin mutaciones silenciosas.
- El hook del chat cancela la respuesta activa al desmontar la vista o recibir `pagehide`, evitando streams huérfanos y permitiendo que el estado de la mutación quede en el runtime/journal.

## Actualización de implementación — extracción y wikilinks

- `materialize_document_facts` completa el flujo de extracción hacia un destino explícito: recibe documentos autorizados y categorías, genera candidatos con evidencia de ruta/línea, permite crear una nota nueva o anexar/reemplazar una existente, muestra diff, exige confirmación, verifica la revisión antes de escribir, invalida el índice y deja journal para undo.
- `update_document_wikilink` agrega o quita un enlace exacto entre documentos autorizados. Es idempotente, conserva el resto del Markdown, exige preview/confirmación, aplica revisión exacta y registra undo; `find_document_references` mantiene la lectura de backlinks.
- Ambos contratos se ejecutan por el runtime común, quedan fuera de Finance y del scope publicado, y tienen etiquetas humanas para el feedback de Telegram.
- La suite focalizada de esta iteración cubre materialización, evidencia, idempotencia, eliminación exacta, catálogo y etiquetas de progreso.
- `materialize_document_facts` y `link_ticket_document` también están reconocidas por la barrera de mutaciones del planificador automático; los pedidos compuestos no pueden ejecutar esas escrituras sin un plan aprobado.

## Actualización de implementación — confirmaciones reforzadas

- `aiConfirmationPolicy` exige una segunda aceptación explícita para borrados, renombrados críticos, mutaciones multiarchivo, lotes de Task Manager y operaciones financieras.
- La primera decisión conserva sus hunks seleccionados; la segunda solo confirma el riesgo y no puede ampliar silenciosamente el alcance.
- Las operaciones de bajo riesgo y las confirmaciones no mutantes no reciben una segunda interrupción.
- Telegram también usa confirmación reforzada para ingestas y movimientos financieros; no se persiste una operación financiera antes de la aceptación.
- El catálogo financiero ya no ofrece una variante de tools que saltee la confirmación para Telegram: la descripción y el runtime comparten el mismo contrato reforzado.

## Actualización de implementación — reanudación de planes

- Un TO-DO bloqueado por confirmación o aclaración puede reanudarse explícitamente desde la vista de chat.
- La reanudación reabre únicamente el primer paso bloqueado y sus dependientes bloqueados; no repite pasos completados ni reutiliza `operationId` antiguos.
- Los fallos conservan su flujo separado de reintento aislado y la cancelación no se convierte automáticamente en reanudación.

## Actualización de implementación — recuperación de Telegram

- El bridge aborta el `runNotiaChatReply` activo durante cleanup o cambio de canal.
- La request activa se conserva como `interrupted`, sin guardar prompts derivados, resultados privados ni argumentos de tools; al recargar se mantiene la misma política y se informa al usuario.
- `/reanudar` sigue siendo una acción explícita: reencola la solicitud y evita repetirla automáticamente al iniciar la aplicación.

## Actualización de implementación — background y ciclo de vida

- El chat persistente y Meeting cancelan el stream cuando la pestaña pasa a background o la vista se desmonta.
- Telegram aborta la request activa al pasar a background, la conserva como `interrupted` y no ejecuta la reanudación sin `/reanudar`.
- La cancelación no dispara escritura de memoria ni una respuesta final; quedan pendientes la pausa específica de reindexación y la validación en Android.

## Actualización de implementación — TO-DO persistible en Telegram

- Las requests de Telegram conservan, además del `requestId` y el mensaje de progreso, solo los IDs opacos y estados del TO-DO (máximo 20 pasos); el prompt original se mantiene únicamente en memoria.
- Al reanudar, el feedback muestra que continúa el plan previo sin guardar labels del modelo, rutas, contexto, argumentos de tools ni contenido sensible. Los adjuntos pueden reconstruirse desde su referencia; una solicitud de texto que sobrevivió a un reinicio requiere reenviarse.

## Actualización de implementación — errores de búsqueda web

- El fallback Android de Ollama Web Search ya no propaga el último error nativo al modelo, la UI ni Telegram; devuelve un mensaje genérico y conserva el código tipado de reintento.
- Esto evita que una respuesta del proveedor incluya accidentalmente URLs, cuerpos HTTP o material de autorización.
## Actualización de implementación — planes editables y transporte publicado

- El plan general ahora muestra y conserva descripción, dependencias, riesgo, herramienta prevista y archivos o entidades afectados. Antes de aprobarlo, el usuario puede editar esos campos desde el chat; el runtime normaliza el resultado y vuelve a validar que haya al menos dos pasos.
- Meeting muestra el TO-DO en memoria únicamente durante la sesión efímera. Task Manager publicado mantiene su plan dentro de la sesión publicada y no lo persiste como memoria global.
- El streaming publicado consume `thinking`, `delta`, `done` y `error`, libera el reader al terminar o cancelar y solo reconecta una vez si la conexión falla antes del primer evento. Si ya hubo un delta, falla sin duplicar la respuesta ni cambiar al backend desktop.
- El contrato Android tiene fake ejecutable en Vitest para health, modelos, thinking, delta, done, error y cancelación; la validación Gradle y la prueba en dispositivo siguen siendo externas.

## Validación más reciente — 2026-09-07

- `npm test -- --run`: OK — 86 archivos y 420 pruebas.
- `npm run build`: OK — TypeScript y Vite completaron el build.
- `npx tsc -b --pretty false`: OK.
- ESLint focalizado sobre los archivos modificados del vertical slice: OK.
- `git diff --check`: OK; las advertencias restantes son de normalización LF/CRLF del checkout.
- El runtime publicado no hace fallback al transporte desktop general si falla su stream; existe regresión automatizada para ese aislamiento.
- Telegram reutiliza el `requestId` persistido al reanudar, manteniendo la correlación de progreso sin persistir prompts, argumentos ni contenido privado.
- El preview de cambios tiene semántica de diálogo y, en dispositivos coarse, se presenta como bottom sheet con hunks desplazables, handle visual y cierre explícito.
- Cada tool del agente registra una medición segura (`scope`, `tool`, resultado, duración, cancelación o error) a través del baseline redactado; no se guardan argumentos.
- La frontera nativa Android reutiliza la misma validación de query pública del backend desktop: también bloquea secretos, PII, rutas, encoding y límites antes de llegar al plugin de Ollama Web Search.
- Meeting delega su caso de uso a `meetingEphemeralChatRuntime.ts`, que fuerza `ephemeral-no-memory` y `readOnly`; su prueba demuestra el paso por `runNotiaChatReply`.
- El catálogo de mutaciones expone `planStepId` y `operationId` de forma uniforme, y `AI_CONTEXT_BUDGET` centraliza los límites principales de contexto.
- Se agregaron fixtures Rust de DTO para chat/tools/web search desktop y Android, junto con correlación `requestId` en eventos streaming.
- La comparación documental ahora incluye contradicciones posibles, conservadoras y citables para frontmatter/afirmaciones etiquetadas; una diferencia genérica no se eleva a contradicción.
- La fachada común clasifica localmente pedidos explícitos o dependientes de información cambiante para orientar `search_web`, sin crear consultas ni relajar la sanitización.
- Los fixtures del runtime cubren filtros de tags/tipo, metadata sin cuerpo, documento dirty, selección y autorización de contexto; también cubren seis escenarios multi-step de documento, web, biblioteca, Task Manager, aclaración y conflicto.
- Una regresión combinada confirma que una edición del cuerpo conserva frontmatter, Mermaid, fórmulas, links y tablas fuera del hunk; los aliases de plan emiten el mismo feedback y las mutaciones rechazan una tool distinta del paso aprobado.
- El cache de enlaces no se reconstruye mientras la aplicación está oculta: el scheduler conserva la última solicitud y la ejecuta con debounce al volver a estar visible; la configuración portable de biblioteca redacciona las API keys antes de leer/escribir.
- Telegram recibe etapas multimodales tipadas y seguras para transcripción, extracción, análisis de imagen y construcción de contexto; solo se muestran resúmenes operativos, nunca contenido del adjunto.
- La persistencia durable de requests de Telegram elimina el prompt original antes de escribir en `localStorage`; tras un reinicio solo se reanudan sobres con adjuntos reconstruibles y las solicitudes textuales se reenvían explícitamente.
