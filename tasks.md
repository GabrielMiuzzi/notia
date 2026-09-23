# Migración del runtime al backend Rust — plan de desarrollo y validación final

> Este archivo es una versión reorganizada del plan. `tasks.md` no se modifica.
> Las Fases 0 a 11 son exclusivamente desarrollo. La Fase 12 es la única fase
> de ejecución de pruebas y queda reservada para la persona usuaria.

## Objetivo

Convertir Rust en el runtime backend canónico de Notia. React debe limitarse a
renderizar estado, capturar interacción y enviar intents, aclaraciones y
decisiones. El backend debe conservar agentes, tools, autorización,
confirmaciones, persistencia, filesystem, canales y ciclo de vida.

## Reglas de ejecución

- No ejecutar suites, builds de validación ni pruebas manuales durante las Fases 0–11.
- Durante el desarrollo sí se pueden crear DTOs, fixtures, dobles, regresiones y herramientas de prueba.
- La ejecución de todas las pruebas y la decisión de aceptación quedan para la Fase 12.
- No marcar una fase como terminada solo porque exista código: debe quedar implementado su alcance y preparado para la validación final.
- No cerrar una fase por mocks o por compilación parcial de un adaptador.
- No modificar `README.md`, `README-TECH.md`, `FUNCIONALIDADES.md` ni `CHANGELOG.md` durante el desarrollo; documentar al cierre después de la validación final mediante `documentador`.

## Estado de implementación actual

> Estos puntos describen trabajo implementado durante el desarrollo, pero no se
> marcan como tareas completadas hasta ejecutar la validación reservada de la
> Fase 12. Las casillas de las fases continúan representando el alcance
> completo de cada criterio.

- [x] Implementado; validación final pendiente: contexto backend multi-tenant, actor,
  canal, identidad externa de Telegram y políticas de persistencia.
- [x] Implementado; validación final pendiente: catálogo canónico Rust y filtrado de
  tools por autorización, scope, mutabilidad y confirmación.
- [x] Implementado; validación final pendiente: previews y aplicación de ediciones
  Markdown, exportación de documentos y operaciones multi-documento.
- [x] Implementado; validación final pendiente: executor financiero Rust para lecturas,
  snapshots, cuentas, categorías, movimientos, ahorro, servicios, compras,
  sueldos, tarjetas, cuotas, inversiones, auditorías y patrimonio.
- [x] Implementado; validación final pendiente: mutaciones financieras con confirmación,
  extracción documental asíncrona con timeout y proveedores externos de dólar e
  inflación con validación de respuestas.
- [x] Implementado; validación final pendiente: cancelación, errores estructurados,
  journal acotado, búsqueda web sanitizada y propagación de abort al backend.
- [x] Implementado; validación final pendiente: registro de controles compartido y
  escopado (biblioteca, usuario, request), cancel y consulta sin token de
  operación, ejecución en worker bloqueante sin bloquear el WebView,
  cancelación de ejecuciones al revocar una biblioteca.
- [x] Implementado; validación final pendiente: historial de eventos escopado con
  secuencia monótona, replay autorizado por principal y cursor de deduplicación
  en el cliente.
- [x] Implementado; validación final pendiente: runtime backend real en Android
  (transporte Ollama vía `AiBridgePlugin`, búsqueda web normalizada compartida,
  journal en la copia SQLite sincronizada por SAF); sin streaming token a token.
- [x] Implementado; validación final pendiente: prompt del sistema compuesto en
  Rust (prompt y reglas embebidos, reglas por formato de canal, prompt
  personalizado, skills y memoria del Owner) mediante `AgentStateRepository`.

## Revisión de lo marcado — 22 de septiembre de 2026

Revisión estática de las casillas marcadas contra el código, con `cargo check`
y `tsc --noEmit` usados solo como feedback de desarrollo (no cuentan como la
Fase 12; no se ejecutaron suites de pruebas).

Defectos encontrados en trabajo marcado como hecho, ya corregidos:

- `backend-core` no compilaba (llamada a `run_agent_inner` con un argumento de
  menos y comparación `String`/`&&str` en `catalog.rs`) y el crate Tauri tenía 58
  errores (`Manager` sin importar, `FinanceContext` sin `Serialize`/`Clone`,
  `OptionalExtension`, patrones `Option<LibraryBindingRoot>`, rama de resume con
  otro tipo). Ninguna casilla "implementada" era ejecutable.
- El build Android estaba roto: `printpdf 0.8` arrastra `azul-core`, que no
  compila para Android. Se reemplazó por un escritor PDF mínimo sin
  dependencias (Helvetica integrada, WinAnsi, paginado y acotado).
- `android_saf::write_binary_file` no compilaba en Android (bloque final
  inalcanzable con tipo `str`).
- Fase 1 "cancelación": `InteractionRuntime` se creaba por cada invocación
  Tauri con su propio mapa de controles, así que un cancel nunca alcanzaba la
  ejecución activa; además `run_backend_request` era un comando síncrono que
  bloqueaba el hilo principal hasta 600 s.
- Fase 1 "generaciones": `OperationGenerationCache` se indexaba solo por
  `operationId` (id del tool call), compartido entre bibliotecas y usuarios.
- `begin_waiting` devolvía la operación previa del request aunque ya estuviera
  reanudada, por lo que una segunda aclaración/confirmación en el mismo turno
  fallaba como "generación obsoleta".
- El historial de eventos se indexaba solo por `requestId` y
  `replay_backend_events` no verificaba biblioteca ni usuario.
- `refresh_root_tree_cache` usaba un throttle `thread_local` común a todas las
  bibliotecas: refrescar una podía suprimir la invalidación de otra.
- El journal de operaciones solo persistía en desktop; en Android toda
  ejecución fallaba con `Unsupported`, y el runtime backend completo era un
  stub en Android.

Defectos encontrados al continuar la Fase 3, ya corregidos:

- `run_backend_request` proyectaba todos los nombres de `supported_tool_names()`,
  pero ocho no existían en el catálogo canónico (planes y cuatro listas
  financieras): toda ejecución backend fallaba con "La tool solicitada no
  pertenece al catálogo backend".
- Casi todo el catálogo Rust exponía descripción genérica y schema
  `{"type":"object"}`; el modelo no podía saber qué argumentos enviar.
- `create_finance_purchase/salary/credit_card_statement/category/service`
  deserializaban los argumentos crudos en structs que exigen `status`, IDs de
  línea y `active`: esas altas fallaban siempre. Además la confirmación se
  pedía antes de validar y mostraba el JSON crudo.
- Las mutaciones de Task Manager construían `TaskMutationDto` con los
  argumentos crudos (sin tag `kind` ni IDs generados): fallaban siempre.
- `plan_from_call` exigía la estructura interna completa del plan: los planes
  del modelo fallaban siempre.
- Las tools documentales no aceptaban `documentId`/`relativePath`,
  `read_active_markdown_document` exigía una ruta en vez de usar el documento
  activo y `add_agent_memory` leía `content` en lugar de `memory`.

Casillas marcadas cuyo alcance se confirmó en el código: Fase 0 completa
(`docs/backend-runtime-matrix.md`), contexto multi-tenant, errores y límites,
DTOs/eventos versionados, fixtures de transporte y preparación headless.

## Observaciones que originan esta versión

- `chatScopedAgentRuntime.ts` y `aiRuntime.ts` todavía ejecutan las tools desde TypeScript.
- `src-tauri/src/commands/ai.rs` recibe tools y mensajes desde el cliente; `backend_tauri.rs` valida sobres y emite eventos, pero no conecta el runtime completo.
- `useTelegramAgentBridge` mantiene polling, cola y ciclo de vida en React; sus checkpoints y solicitudes pendientes usan `localStorage`; Android desactiva Telegram.
- La exportación y Task Manager conservan fallbacks de escritura mediante `filesystemEngine` y `writeBinaryFile`.
- El store Markdown real de Task Manager y la publicación Windows no tienen todavía validación nativa/LAN completa.
- Finanzas, Graph, Multichat, ColdPass, calendario, backups, voz, adjuntos y varias reglas de biblioteca aún conservan coordinación en TypeScript/React.
- La ejecución del crate Tauri está limitada en el entorno actual por `STATUS_ENTRYPOINT_NOT_FOUND`; la validación Android física y LAN queda para la fase final.

## Criterios transversales de implementación

- Aislamiento estricto por `libraryId`, `libraryUserId`, actor, canal y `requestId`.
- Errores estructurados, seguros, recuperables y sin secretos, prompts, contenido privado o URI SAF completas en logs.
- Preview, confirmación, idempotencia, verificación persistida, cancelación, timeout y descarte de resultados obsoletos.
- Separación explícita entre ruta lógica, URI tree SAF y URI document real.
- Ninguna autoridad de escritura, ejecución de tools o autorización en React, WebView, `window`, `localStorage` o `@tauri-apps/api`.
- Compatibilidad Windows/Android, touch, suspensión, pérdida de foco, reinicio y permisos revocados.

## Fase 0 — Auditoría de alcance y contratos

- [x] Reconciliar el inventario de `FUNCIONALIDADES.md` con módulos, comandos, adaptadores y persistencia reales.
- [x] Clasificar cada capacidad como dominio backend, adaptador de plataforma o renderizado React.
- [x] Actualizar la matriz de tools con scope, mutabilidad, autorización, confirmación, verificación, límites y consumidor.
- [x] Definir para cada superficie el request, actor, canal, scope, snapshot, política de persistencia, eventos y resultado.
- [x] Definir la matriz Windows, Android embebido, publicación y futuro headless.
- [x] Definir qué datos permanecen en `.notia`, qué datos van a SQLite y qué estado es efímero.
- [x] Definir los casos de aislamiento, cancelación, concurrencia, permisos revocados y resultados obsoletos que se ejecutarán en Fase 12.

## Fase 1 — Core Rust independiente

- [x] Consolidar el crate core sin dependencias directas de Tauri, WebView, navegador o filesystem global.
- [x] Completar contexto multi-tenant, actor, canal, request, scope y política de persistencia.
- [x] Completar puertos de biblioteca, `.notia`, SQLite, filesystem, memoria, prompts, adjuntos y operaciones.
  - Hecho: prompts, reglas, skills y memoria vía `AgentStateRepository`; journal de operaciones en SQLite desktop y Android.
  - Hecho (Fases 6 y 8): la memoria y las reglas se escriben por un único camino (`agent_workspace::append_agent_item`, el mismo formato que lee la interfaz); los adjuntos persistidos del chat pasan por `backend-core::chat_history` y los del mensaje por `backend-core::chat_attachments`.
- [x] Completar errores estructurados y límites de payload, rondas, resultados, eventos y adjuntos.
- [x] Completar reloj, timeout, cancelación, cleanup, generaciones y eventos.
- [x] Completar cachés con propietario, clave, límite, TTL/generación, invalidación y deduplicación en vuelo.
- [x] Eliminar estados globales que puedan cruzar bibliotecas o usuarios.
  - Hecho en Rust: controles, generaciones, historial de eventos y throttle SAF escopados.
  - Hecho (Fase 10): eliminados los journals TS (`aiOperationJournal`, `aiMultiDocumentJournal`, `aiMultiDocumentPatchJournal`); el historial vive en `agent_history.rs` por biblioteca. `taskManagerVaultCache` queda como caché de la vista de Task Manager, con clave por biblioteca y sin autoridad (el store Rust es la fuente).
- [x] Dejar preparada la ejecución headless sin inicializar ventana, WebView ni frontend.

## Fase 2 — Contrato y transporte backend

- [x] Completar DTOs versionados para ejecución, reanudación, cancelación, consulta, snapshots, tools, previews, confirmaciones y errores.
- [x] Completar eventos de thinking resumido, fases, tools, aclaraciones, confirmaciones, progreso, resultado, cancelación y fallo.
- [x] Implementar el adaptador Tauri que conecte requests/events con el runtime real, sin duplicar dominio ni autorización.
- [x] Conectar reanudación y reconexión por cursor, secuencia y generación.
  - La rehidratación visual tras recargar el WebView (guardar `requestId` activo y re-adjuntar) queda en la Fase 10.
- [x] Integrar fixtures de transporte con el cliente local sin que el fixture sea la autoridad.
- [x] Mantener preparado el contrato HTTP/WebSocket futuro sin implementar servidor remoto.

## Fase 3 — Runtime IA Rust integrado

- [x] Conectar `backend-core` con Ollama mediante el adaptador Rust, incluyendo texto, visión, thinking, streaming y tool calling.
  - Desktop: cliente HTTP nativo. Android: `AiBridgePlugin` con tool calling, visión, thinking, búsqueda web y streaming token a token (`rawChatStreaming`) por un `Channel` IPC único enrutado por `requestId`, con cancelación que desconecta el stream.
- [x] Reemplazar la ejecución real de `executeToolUnsafe` y `input.executeTool` por el runtime backend.
  - En hosts Tauri (Windows y Android) todo chat va al runtime Rust y `runNotiaChatReply` rechaza ejecutar tools en el WebView. El código TS queda solo para entornos sin Tauri y se retira en la Fase 10.
- [x] Dejar de recibir catálogo, autorización y ejecución de tools como autoridad desde TypeScript.
  - Catálogo, descripciones y schemas canónicos en Rust (`backend-core/src/defaults/tool_schemas.json`); el cliente envía `tools: []`.
  - Retirados `run_desktop_ai_tool_chat`, `run_desktop_ai_web_search`, `run_android_ai_tool_chat` y `run_android_ai_web_search`: el WebView ya no puede pedir tool-chat ni búsquedas con tools propias. El código TS que los invocaba solo es alcanzable fuera de Tauri y se retira en la Fase 10.
- [x] Conectar prompts, reglas, memoria, skills, búsqueda web, citas, aclaraciones, planes, confirmaciones, undo y revisiones.
  - Citas: si la request usó `search_web`, la respuesta final persistida reemplaza por "[enlace no verificado]" toda URL que la búsqueda no devolvió.
  - Hecho: prompt/reglas/skills/memoria compuestos en Rust y `promptName` en el contrato; búsqueda web en ambas plataformas; varias interacciones por turno.
  - Hecho: guía por scope y canal en `backend-core/src/prompt_guidance.rs`, filtrada por las tools proyectadas del request (nunca nombra una tool invisible); guía XGraph embebida.
  - Hecho: planes del modelo normalizados en Rust; input inválido en un preview vuelve al modelo como resultado de tool sin pedir confirmación.
  - Hecho: undo nativo de mutaciones documentales (crear, reemplazar, eliminar, aplicar edición Markdown). El journal guarda el estado previo y la revisión resultante; solo se restaura si el documento no cambió después. El cliente reenvía `tool-completed` con `operationId` y ejecuta el undo por el backend.
  - Hecho: selección del editor en el snapshot backend, validada (misma biblioteca, documento activo, límites) e incluida en la guía del scope documento.
  - Limitación: solo la última operación confirmada de cada request es deshacible; mutaciones de Finanzas y Task Manager no tienen undo.
- [x] Mantener deduplicación, límites, reintentos seguros, idempotencia y detección de respuestas vacías.
  - Confirmado en `agent.rs`: clave canónica por tool call, reintento solo de errores `retryable` sin cambios, respuesta idempotente por `idempotencyKey` desde el journal, corrección acotada ante respuestas vacías o acciones anunciadas sin tool.
- [x] Implementar adaptadores de resultados para chat, Telegram, publicación y vistas estructuradas.
  - `ChannelResponse` entrega Markdown y Telegram HTML derivado (HTML del modelo escapado); el modelo responde siempre en Markdown y el cliente envía `telegramHtml` a Telegram. Los datos estructurados viajan en `toolResults`.
- [x] Asegurar que ningún paso del runtime dependa de React, callbacks de componentes o almacenamiento de navegador.
  - El runtime corre en un worker Rust, persiste en SQLite y continúa aunque el WebView se oculte o recargue; React solo aporta decisiones (aclaración, confirmación, plan) por `resume`. El worker de Telegram sin React es la Fase 9.

## Fase 4 — Biblioteca, documentos y filesystem

- [x] Conectar al backend las tools de búsqueda, lectura, metadata, RAG, referencias, comparación y reindexación.
  - Las tools (`search_library_documents`, `search_library_context`, `search_library_exact`, `read_library_documents`, `get_document_metadata`, `find_document_references`, `compare_documents`) ya se ejecutaban en Rust sobre `TauriLibraryDocumentReadAdapter`, pero había dos defectos: (1) el inventario lo escribía React con rutas absolutas del árbol y el lector Rust exige rutas lógicas, así que en producción las búsquedas y metadata por id fallaban; (2) en Android el inventario devolvía siempre "no disponible".
  - Reindexación en Rust (`library_inventory::backend_reindex_library`): recorre la biblioteca por su binding (desktop sin seguir symlinks, con profundidad y tope de 100.000 entradas; SAF por `readFlatFileList` validando que cada entrada sea hija real del árbol) y publica rutas lógicas en una sola transacción con generación propia. Retirados `upsert/begin/commit_library_inventory_snapshot` y `delete_library_inventory_subtree`: el WebView ya no escribe el inventario.
  - `query_library_inventory` usa la generación activa del backend y traduce rutas lógicas a la ruta visible de la biblioteca, así búsqueda y Graph View en React mantienen su formato; en desktop rechaza bibliotecas no registradas.
  - Android: el lector abre la copia SQLite móvil (`with_app`), así que las tools de inventario funcionan también en móvil. El "RAG" sigue siendo recuperación léxica acotada (sin embeddings).
- [x] Conectar edición Markdown, bloques, frontmatter, wikilinks, tags, facts, plantillas y operaciones multi-documento.
  - Defecto corregido: `apply_markdown_edit`, el undo y la memoria del agente pasaban la revisión del core (FNV `u64`) al filesystem, que compara `sha256:`; toda aplicación terminaba en conflicto. Nuevo `write_locator_at_revision`: verifica la revisión del core sobre el contenido actual y escribe con la revisión de plataforma de ese mismo contenido. `replace_library_document` acepta ambas formas.
  - Nueva tool `apply_multi_document_markdown_edit` (el preview multi-documento existía pero no se podía aplicar): materializa y verifica la revisión de todos los documentos antes de la primera escritura y, si una escritura falla, restaura los ya escritos e informa cuáles no pudieron revertirse. Confirmación visible con hunks por documento y selección parcial.
  - Nueva tool `reindex_changed_documents` conectada a la reindexación Rust.
- [x] Implementar previews con anchors, hunks, fingerprint, revisión y verificación posterior.
  - Anchors, hunks y revisión vienen de `backend-core::markdown_editing`; la verificación posterior es el read-back de `write_locator` en desktop y SAF.
- [x] Eliminar fallbacks de escritura frontend para documentos con identidad completa.
  - Hecho: con `libraryId` + `logicalPath` la escritura va siempre a `backend_write_library_document`, sin fallback. Exportación: en Tauri solo backend; el render JS queda para el navegador. Retirado `write_binary_file` (escritura binaria arbitraria desde el WebView).
  - Hecho (seguridad, desktop): los comandos de mutación del filesystem (`write_library_file`, `create_library_file`, `create_library_directory`, `create_library_entry`, `library_entry_operation`) rechazan rutas fuera de las bibliotecas registradas. Antes aceptaban cualquier ruta absoluta.
  - Hecho (seguridad, desktop): las lecturas de contenido (`read_library_file`, `read_library_tree`, `read_library_tree_signature`, `search_library_files`, `read_markdown_files`) también se limitan a las bibliotecas registradas. `path_exists`/`is_directory_path` quedan abiertos porque solo revelan existencia y validan raíces antes de registrarlas. La carga de biblioteca registra el binding antes del primer acceso para no competir con el arranque.
  - Hecho: nuevo comando por identidad `backend_library_entry_operation` (`libraryId` + rutas lógicas; `create`/`delete`/`rename`/`paste`). Rust resuelve la ubicación física desde el binding (raíz canónica desktop o `tree/lógica` SAF) y crea las notas con su frontmatter inicial en una sola escritura verificada; esa lógica salió de React. Migrados: explorador (`useFileTreeActions`, `NotiaModals`), borradores de chat (`chatSessionStorage`), estructura de chats (`chatLibraryStructure`) y de agente (`agentPromptRuntime`).
  - Hecho: configuración de biblioteca en Rust (`backend-core::library_config` + comandos `backend_read/write/ensure_library_config` por `libraryId`). Normalización, migración de contextos por defecto, límites de Telegram/credenciales y escritura atómica verificada en desktop y SAF salieron de `libraryConfig.ts`, que queda como cliente delgado. Corrige además un defecto: la sincronización de la UI borraba la credencial `llamacloud` en cada guardado; ahora las secciones no enviadas conservan su valor.
  - Hecho: `linkCache.md` solo por identidad; el backend lo crea junto con `.notia/` si falta (`createIfMissing` → `upsert_text_locator`), sin el fallback por ruta absoluta ni el `createFile` SAF previo.
  - Hecho: los defaults de frontmatter al abrir una nota (`createdAt`, `nextPage`, `previousPage`, `contexto`) los decide y persiste Rust (`ensure_markdown_defaults` + `ensureMarkdownDefaults` en `backend_read_library_document`), con la revisión recién leída; si la escritura falla se devuelve el contenido almacenado sin cambios. Eliminada la versión TS.
  - Pendiente (resuelto en Fases 5 y 10): el runtime TS de tools se eliminó; `vaultRuntime` y `libraryDocumentRuntime` solo usan la escritura por ruta cuando no hay identidad de biblioteca (con identidad siempre van al backend), y esa ruta ahora verifica por relectura.
- [x] Portar exportación PDF/DOCX y creación binaria con límites de entrada/salida, atomicidad o recuperación y verificación persistida.
  - Una sola ruta (`filesystem::adapter::export_library_document`) para el comando de la UI y la tool `export_document`: render acotado en el core, escritura atómica con read-back en desktop y SAF, y nombre numerado (`doc (2).pdf`) en lugar de fallar o sobrescribir. El PDF del backend es texto con Helvetica integrada: no conserva el formato visual ni las fórmulas del render JS anterior.
- [x] Aplicar límites y verificación equivalentes en desktop y Android; no dejar una ruta SAF sin read-back o sin límite.
  - Hecho: toda escritura o creación de texto del adaptador (`write_locator`, `create_text_locator`) relee y compara el contenido persistido en desktop y SAF; los proveedores SAF que ignoran el truncado `"wt"` ahora fallan de forma recuperable en lugar de informar éxito. Las exportaciones binarias ya tenían read-back.
  - Hecho: los comandos heredados por ruta (`write_library_file`, `create_library_file`) releen el archivo en desktop y SAF y fallan si el contenido guardado no coincide; la escritura devuelve la revisión verificada.
- [ ] Completar la resolución SAF sin confundir tree URI, document URI, ruta lógica o documento sintético.
  - Sin cambios en esta etapa: la resolución se centraliza en `android_saf.rs`/`mobile_directory_picker.rs` y todo acceso nuevo pasa por los adaptadores por identidad, pero la verificación con proveedores reales (Drive, almacenamiento externo, revocación) requiere dispositivo y queda para la Fase 12.
- [x] Invalidar cachés por mutación y descartar resoluciones obsoletas.
  - Las mutaciones SAF ya invalidaban por prefijo; ahora además avanzan una época por árbol (`mark_tree_mutated`) y toda lectura de árbol que empezó antes se descarta al intentar repoblar la caché (`refresh_android_tree_path_cache`, `update_cache_from_nodes`). El mapa ruta→URI queda acotado (`MAX_SAF_PATH_CACHE_ENTRIES`); por encima se resuelve de forma lazy.
- [x] Hacer que la UI reciba únicamente resultado, preview, metadata y eventos.
  - Hecho (Fase 10): sin el runtime TS de tools, la interfaz solo recibe el resultado, los previews, las interacciones pendientes y los eventos del runtime Rust.
- [x] Mantener el soporte acotado de adjuntos de imagen en chats Markdown sin mezclar límite de lectura y mutación.
  - Defecto corregido: los chats guardan las imágenes en Base64 dentro del Markdown y se escriben por `backend_write_library_document`, cuyo tope era 500.000 caracteres, mientras la lectura admite 16 MiB; un chat con una foto se podía abrir pero no volver a guardar. `max_write_document_chars` aplica el límite de lectura solo a transcripciones `chat/chats/*.md`; el resto de documentos y las mutaciones del agente siguen en 500.000. La vista previa de imágenes sigue acotada a 24 por documento.

## Fase 5 — Task Manager y publicación

- [x] Conectar todas las lecturas y mutaciones al store Markdown Rust real.
  - Hecho (agente): traducción canónica tool → `TaskMutationDto` en `backend-core/src/task_manager_tool_input.rs` con IDs generados por el backend, lectura de varios tickets y preview validado con resumen legible.
  - Hecho (Android): el store Markdown usa una capa de E/S (`task_manager_fs`) con implementación desktop (`std::fs`) y SAF (listado plano por operación, lectura/escritura con revisión, creación y borrado por el grant del árbol). Antes el store Rust devolvía "no disponible" en Android y la UI escribía por TS.
  - Hecho (UI): con identidad de biblioteca la UI lee el snapshot Rust (`task_manager_snapshot`) y todas sus acciones pasan por preview/apply Rust, también en Android. Nuevos comandos para lo que solo existía en TS: Pomodoro (`task_manager_pomodoro_entries/append/delete`, formato de tabla legado portado a `backend-core::pomodoro_log`) y editor de Markdown crudo (`task_manager_read/write_ticket_source`, con revisión, sin cambiar el `id` y con read-back). `create` envía padre, fechas, estimación y contexto (`CreateTicket.initialFields`), que antes se perdían en la ruta Rust.
  - Corregido: el mapeo del snapshot Rust a la UI usaba `boardId`/`groupId` (minúsculas e ids `legacy-group-…`) donde la UI espera nombres, y el título del padre donde la UI usa el nombre de archivo.
- [x] Completar hidratación, IDs legacy, comentarios, metadata, relaciones padre/hijo, huérfanos y rollback.
  - Hecho: la hidratación ya no descarta todo el workspace por un archivo editado a mano: una subtarea huérfana, de otro tablero o hija de otra subtarea se muestra como principal; los campos inválidos toman su valor por defecto (`1,5` se acepta como 1.5) y los textos/listas se recortan; un id duplicado (archivo de tarea copiado) recibe un id derivado de su ruta, en orden estable. Antes cualquiera de estos casos dejaba el Task Manager sin cargar, y ahora la UI depende solo de Rust. Las mutaciones nuevas siguen validándose de forma estricta. Test de regresión `hand_edited_workspaces_still_load`.
  - Hecho: `PersistentTaskManager` releía el workspace solo al abrirse; ediciones externas (otra ventana, sincronización, editor) dejaban el backend desactualizado y los commits fallaban por generación. Ahora compara un token barato (ruta, tamaño y mtime en desktop; SAF siempre relee) y recarga conservando previews, idempotencia y usuarios; un preview sobre entidades reemplazadas falla por revisión base.
  - Hecho: `.notia-task-manager.json` lo deriva Rust en cada commit a partir del snapshot; antes lo escribía React y su merge podía resucitar grupos o tableros borrados por una mutación Rust.
  - Hecho: un único candado de commit por biblioteca compartido entre usuarios (antes cada usuario tenía el suyo y podían intercalar escrituras).
- [x] Completar preview/apply/receipt, revisión, conflicto, confirmación e idempotencia.
  - El core ya exigía confirmación explícita, revisiones base por entidad, receipts con revisiones y replay idempotente; ahora un replay no vuelve a escribir en el store y las previews sobreviven a una recarga del workspace. Las acciones directas de la UI se confirman al aplicarse; las del agente pasan por la confirmación visible del runtime.
- [x] Eliminar autoridad de escritura de `runSync`, `taskManagerService`, Pomodoro y fallbacks no justificados.
  - `runEmbeddedMutation` es solo-Rust (sin identidad falla con un mensaje explícito) y se quitaron los 15 fallbacks TS de las acciones; `executeTaskManagerAgentMutation` perdió su implementación TS alternativa. Con identidad, `ensureTaskWorkspace`, `cleanupEmptyWorkspaceBoards`, `syncTaskIndexesAndMetadata`, `reconcileBoardMarkdownContext`, la metadata compartida y el journal TS no escriben: el commit Rust es atómico, verificado y regenera índices y metadata.
  - Pendiente de revisar: al cambiar el contexto de un tablero, React reescribía el `contexto` de todas sus notas; en Rust solo lo toma el tablero y los tickets nuevos.
- [x] Conectar publicación Windows con autenticación, sesiones, expiración, revocación, límites y autorización server-side.
  - Existente: login con usuarios de la biblioteca, sesiones con TTL de 12 h, límite de sesiones y rate limit. Nuevo: cada petición de una sesión publicada revalida al usuario contra la biblioteca; un usuario desactivado o borrado pierde la sesión en la siguiente operación en vez de conservarla hasta el TTL.
- [x] Mantener la vista publicada como cliente del backend sin aceptar identidad, scope, tablero o ruta arbitrarios del navegador.
  - La publicación ya no acepta escrituras de filesystem crudo (`write_library_file`, `append_task_comment`, `create_library_entry`, `library_entry_operation`): toda escritura publicada va por preview/apply del store Rust o por los comandos tipados `task_manager_write_ticket_source` y `task_manager_append_pomodoro`, con biblioteca, usuario y tableros permitidos fijados por la sesión del servidor. El historial Pomodoro no se expone a sesiones publicadas porque mezcla tableros. Las lecturas de filesystem que quedan son solo lectura y siguen acotadas a las rutas del tablero publicado.
- [x] Implementar reconexión, ACK, cursor, snapshot, conflictos y cierre de streams.
  - Ya implementado en el protocolo de publicación (reconexión con backoff, ACK con timeout y resultado incierto, secuencia/revisión como cursor, `resync-required`, conflictos por revisión y cierre con `access-revoked`/`publication-stopped`); esta etapa solo cambió los comandos que viajan por él.
- [x] Dejar preparados escenarios de aislamiento de tableros, autorización, sesiones, desconexión, reintento y LAN.
  - Tests Rust y Vitest de publicación actualizados al nuevo conjunto de comandos (incluyen que los comandos crudos ya no se aceptan). La ejecución y la prueba LAN/multiusuario quedan para la Fase 12.

## Fase 6 — Capacidades transversales

- [x] Mover al backend bibliotecas, sesiones, usuarios, roles, contraseñas, permisos y selección de biblioteca.
  - Hecho (desktop): el registro de bibliotecas persiste en el directorio de datos de la app y se carga antes del WebView. `register_library_binding` desde el cliente solo acepta la raíz ya registrada o una biblioteca Notia existente (`.notia/`); una carpeta nueva solo entra por el selector nativo.
  - Hecho: el catálogo de bibliotecas y la selección activa pasan de `localStorage` a `library_catalog.rs` (JSON atómico en el directorio de datos de la app, validado: ids únicos, grants SAF solo si son URI tree, selección coherente). Se migra una sola vez desde el almacenamiento del WebView y luego se borra. Quitar una biblioteca del catálogo revoca su binding y bloquea su ColdPass. El slice de Redux quedó puro y se hidrata desde el backend (`useLibraryCatalogPersistence`); eliminado `useLibrarySession`, que no se usaba.
  - Usuarios, roles, contraseñas y contextos ya vivían en `library_users.rs`; la autorización TS (`aiAuthorizationEngine`) solo la usa el runtime TS legado que se retira en la Fase 10. Las sesiones publicadas se revalidan por petición (Fase 5).
- [x] Mover ColdPass, cifrado, Bluetooth, backups Windows, bandeja y sus políticas de ciclo de vida a adaptadores backend/nativos.
  - Hecho (ColdPass): cifrado AES-256-GCM/PBKDF2 compatible con los archivos existentes, formato Markdown del vault, alta/edición con historial de contraseñas, borrado e importación CSV pasan a Rust (`backend-core::coldpass` + `coldpass.rs`, con `ring` ya presente en el lockfile). La passkey queda en la sesión del backend (comparación en tiempo constante para confirmar borrados e importaciones); el WebView solo recibe las entradas que muestra. El CSV se elige con el selector nativo desde Rust: el WebView ya no envía rutas de archivos (además corrige que la contención de lecturas bloqueaba importar un CSV fuera de la biblioteca). Revocar la biblioteca o cerrar la vista bloquea el vault. Eliminados `coldpassCrypto.ts`, `coldpassMarkdown.ts` y `coldpassCsvImport.ts`.
  - Hecho (backups Windows): el planificador corre en Rust (`backup::service`, hilo en segundo plano cada minuto que respalda cada hora la biblioteca seleccionada del catálogo, aunque el WebView esté oculto). La carpeta destino se elige con el selector nativo desde Rust y se guarda en el directorio de datos de la app; se rechaza si queda dentro de una biblioteca. Se retiró `create_windows_library_backup`, que aceptaba rutas arbitrarias de biblioteca y destino desde el WebView, junto con `useWindowsBackups`; la preferencia antigua se migra una vez desde `localStorage`.
  - La bandeja de Windows ya era nativa (`windows_tray.rs`).
  - Hecho (Bluetooth): el paquete `AUTH`/`MSG` (PBKDF2-HMAC-SHA256 120.000 iteraciones y AES-256-CBC con PKCS#7) se arma en Rust (`services::coldpass_secure_link`, con `aes` y `cbc` que ya estaban en el lockfile); la interfaz envía el challenge o el mensaje y la passkey de la sesión queda en el estado del backend (se borra al desconectar) en lugar de la memoria de React. Eliminado `coldpassSecureLink.ts`.
  - Limitación que se mantiene: el transporte BLE solo existe en Linux; en Windows y Android los comandos responden "no soportado". Sin hardware para validar.
- [x] Mover calendario y normalización de feriados a un adaptador Rust con timeout y validación.
  - `backend-core::calendar` valida año, fechas y nombres y fusiona feriados nacionales y bancarios; `services/calendar_holidays.rs` consulta ArgentinaDatos con timeout de 10 s, respuesta acotada a 512 KiB y caché de 12 h por año. `argentinaHolidaysService.ts` quedó como cliente del comando `calendar_argentina_holidays`.
- [x] Mover índices, relaciones, permisos y datos de Graph View; React solo renderiza.
  - `backend-core::library_graph` construye el grafo (wikilinks, wikilinks escapados legados, enlaces Markdown relativos, nombres ambiguos sin enlace, grado, contexto del tablero o del frontmatter), la búsqueda de Graph View (título y contenido, sin acentos), la búsqueda del explorador y el Mermaid de `.notia/linkCache.md`. `library_graph.rs` lo arma desde el inventario Rust, lee las fuentes con límites (5.000 documentos, 64 MiB) y lo cachea por generación del índice y revisión del cliente.
  - React ya no lee todas las fuentes Markdown ni arma índices: `useLibraryGraphData`, `librarySearchGraphIndex` y `rebuildLibraryLinkCache` son clientes de `backend_library_graph`, `backend_library_graph_search`, `backend_library_search` y `backend_rebuild_link_cache`. Eliminados `libraryGraphEngine.ts`, `graphSearchEngine.ts` y `linkCacheMermaidEngine.ts` (con sus tests; la cobertura pasó a Rust). Los contextos de tablero salen del store de Task Manager, no de la configuración local de React.
- [x] Mantener Mermaid, XGraph, Milkdown y KaTeX aislados como presentación sin autoridad de dominio.
  - Revisado: Mermaid, XGraph y KaTeX solo renderizan; Milkdown solo edita el documento abierto, que se guarda por `backend_write_library_document`. La única lógica de dominio del editor era la sincronización bidireccional de `nextPage`/`previousPage`, que leía y escribía otras notas desde React: ahora la hace `backend_sync_page_link` (detección de ciclos, actualización del enlace opuesto con revisión). `pageLinkSyncEngine.ts` quedó solo con el parser que usa el orden del explorador.
- [x] Portar historial, adjuntos, prompts, reglas y preferencias al almacenamiento backend compatible.
  - Hecho (prompts, reglas, memoria): `backend-core::agent_workspace` (bloque de reglas por defecto, reglas agregadas por el agente, reclasificación de hechos personales a memoria, memorias con deduplicación y tope, contexto `#Confidencial`, nombres de prompts) y `agent_workspace.rs` (estructura `.agent`, copia visual de `default.md`, migración única de `chat/LongTermMemory.md` con backup, prompts listados desde el inventario, selección de prompt por biblioteca en el directorio de datos de la app con migración única desde `localStorage`). Las tools `add_agent_rule`/`add_agent_memory` escriben con el mismo formato que lee la interfaz (antes agregaban líneas fuera del bloque de reglas). Sin prompt explícito, el backend usa el prompt seleccionado (también Telegram y Meeting). `agentPromptRuntime.ts` quedó como cliente; conserva solo los textos y clasificadores que usa el runtime TS legado fuera de Tauri (se retira en la Fase 10).
  - Hecho (historial y adjuntos): `backend-core::chat_history` (frontmatter del chat, bloques por mensaje, adjuntos Base64 JSON, append del último turno, previsualización de imágenes con tope, nombre del chat desde la hora local del dispositivo) y `chat_history.rs` (estructura `chat/chats`, contexto confidencial, crear, leer, guardar y append con revisión; si el append no aplica, reescribe el documento completo en el backend). `chatDocumentStorage`, `chatSessionStorage` y `chatLibraryStructure` quedaron como clientes; eliminado `confidentialContextFiles.ts`. Helper compartido `library_documents.rs`.
  - Preferencias de biblioteca (IA con credencial, Telegram, contextos, Ink Math, explorador) ya persisten en la configuración de biblioteca Rust (`backend_write_library_config`).
  - Hecho (Fase 10): preferencias del dispositivo en `device_preferences.rs` y estado del agente en `agent_history.rs`/`agent_pending.rs`; en `localStorage` solo quedan preferencias visuales (tema, paneles, Mermaid, Ink Math, intervalo del explorador) y la configuración local de tableros de la vista de Task Manager.
- [x] Preparar escenarios de roles, contextos, aislamiento, cifrado, backups, sincronización, calendario, índices y reinicio.
  - Preparados en «Escenarios para la Fase 12» al final de este archivo.

## Fase 7 — Finanzas

- [x] Portar catálogo completo de tools financieras, lectura, mutación y extracción al runtime Rust.
  - Verificado: el executor Rust cubre las 41 tools financieras del runtime TS legado y agrega las de guardado directo (`save_finance_*`), cuotas, inversiones y artefactos.
- [x] Portar autorización `#Confidencial`, actor, canal, confirmación individual y verificación de respuestas.
  - La autorización por contexto, actor, canal y confirmación ya estaba en el catálogo Rust. Hecho (verificación de respuestas): `backend-core::finance_answer` corrige una respuesta final que afirma o promete una escritura financiera no ejecutada, que deja sin persistir un ticket, recibo, resumen o factura recibido por Telegram, o que pregunta datos faltantes como texto en lugar de `request_user_clarification`. Se integra en el loop del agente para el scope Finanzas; si tras los reintentos la respuesta sigue informando una operación inexistente, el request falla en lugar de entregarla. La detección solo toma primera persona o perfecto/pasivo resultativo, así «el gasto registrado ayer» no es una afirmación.
- [x] Portar cuentas, categorías, movimientos, transferencias, ahorro, compras, sueldos, tarjetas, cuotas, inversiones, servicios, facturas y auditorías.
  - Hecho: altas de compra, sueldo, resumen de tarjeta, categoría y servicio desde el agente en `src-tauri/src/finance_agent_inputs.rs` (decimales locales, resolución por nombre, duplicados, líneas agregadas, errores por campo).
  - Hecho: `create_finance_transaction` usa `finance_agent_inputs::build_transaction` (importes locales, fecha por defecto, cuenta, destino, categoría y servicio por ID o nombre, moneda de la cuenta, categoría obligatoria para gastos por Telegram, negativos solo en ajustes), valida antes de pedir confirmación con un resumen legible, deduplica por referencia de origen (la del adjunto o una estable por llamada, así un reintento no duplica), marca la ocurrencia mensual del servicio pagado e informa si esa asociación falla. Ante un error de almacenamiento verifica si el movimiento quedó persistido antes de informar el fallo.
- [x] Mantener conciliación determinista, comparación por centavos, monedas, períodos, matching por palabra completa y resolución manual.
  - Hecho: la vista previa de conciliación de resúmenes de tarjeta usa la misma función Rust que la persistencia (`finance_preview_card_services`); se retiró la copia TS de la interfaz. `finance_views.rs` calcula además el resumen del período (`finance_period_summary`, centavos exactos, cobertura dentro del rango), la auditoría de relaciones (`finance_relation_audit`, del mes del tablero o de todos los registros), la aritmética del ticket en edición con las reglas de guardado (`finance_validate_purchase`, antes la copia TS tenía otra tolerancia) y el borrador de sueldo desde la extracción (`finance_salary_draft`, importes locales). Eliminados `financeDailySummary.ts`, `financeRelations.ts`, `ticketValidation.ts` y `salaryExtraction.ts` con sus tests (cobertura en Rust).
  - Pendiente (Fase 10): `serviceEngine.ts` sigue en uso por el runtime TS legado y por la diferencia esperado/pagado que muestra la vista de servicios.
- [x] Portar previews, huellas, propuestas, obsolescencia, reversión, limpieza y verificación persistida.
  - Revisado: auditorías deterministas, propuestas con decisión, reparación de relaciones, reversión y limpieza ya viven en `finance.rs`; las altas del agente muestran una vista previa construida por el backend.
- [x] Implementar proveedores externos Rust con sanitización, timeout, cancelación y resultados seguros.
  - Hecho: la interfaz también usa los proveedores Rust (`finance_dollar_quotes`, `finance_inflation_indices`, `finance_historical_dollar_quotes`); `dollarQuotesService`, `argentinaDollarHistoryService` y `argentinaInflationService` quedaron como clientes y el WebView ya no consulta DolarApi ni ArgentinaDatos.
- [x] Mantener extracción sin persistencia automática ni mutaciones parciales.
  - Revisado: `extract_finance_document` devuelve el resultado crudo sin escribir; el alta posterior pasa por la confirmación de la tool correspondiente.
- [x] Preparar escenarios de idempotencia, concurrencia, moneda, duplicados, permisos, auditoría y reinicio.
  - Preparados en «Escenarios para la Fase 12» al final de este archivo.

## Fase 8 — Voz, imágenes, adjuntos y agentes efímeros

- [x] Portar coordinación backend de imagen, PDF, audio y texto con límites, cola, descarga, extracción y clasificación.
  - Hecho: `backend-core::chat_attachments` clasifica los archivos (imagen, PDF, texto) con sus límites (40 MB, 120.000 caracteres de texto, 24 páginas, 16 adjuntos), los valida de nuevo al recibir el request y compone el mensaje para el modelo (texto citado como referencia, nunca instrucciones; páginas en orden en la lista de imágenes). El protocolo agrega `attachments` a `BackendMessage`; el cliente envía los archivos y ya no arma el prompt ni la lista de imágenes (`buildChatAttachmentPrompt`/`buildChatImageAttachment` eliminados). El WebView solo lee el archivo elegido y rasteriza el PDF con pdf.js: no hay un renderizador PDF en las dependencias Rust (`lopdf` no rasteriza). El audio de Telegram ya se decodifica en Rust (`telegram_audio.rs`).
- [x] Integrar Qwen3-ASR, diarización, Qwen3-TTS y decodificación con carga bajo demanda y liberación segura.
  - Revisado: ASR, diarización Sherpa y síntesis TTS ya corren en Rust con preparación y recarga explícitas. Hecho: el texto a leer (quitar Markdown, HTML, enlaces y tablas; una inferencia hasta 5.900 caracteres, fragmentos de 280 por oraciones si es más largo) pasa a `backend-core::speech_text` (`qwen3_tts_speech_plan`); el WebView solo reproduce el audio. Eliminado el streaming de voz TS sin uso (`createQwen3TtsStreamingSpeech`, `takeQwen3TtsStreamChunk`).
- [x] Integrar Ollama Rust para texto, visión, thinking y tool calling sin delegar autorización ni persistencia al proveedor.
  - Revisado: el transporte Ollama del runtime Rust (desktop y `AiBridgePlugin` en Android) envía imágenes, thinking y tools; la autorización y la persistencia quedan en el catálogo y los adaptadores Rust.
- [x] Mantener captura nativa Windows/Android y preparar el payload de audio del futuro cliente remoto.
  - Hecho: `backend-core::remote_audio` define el fragmento de audio remoto (sesión, secuencia, PCM s16le u Ogg/Opus, frecuencia, canales, último fragmento) con validación de orden, formato, tamaño y muestras completas, y la conversión PCM a mono. La captura nativa (cpal/WASAPI y Android) no cambia.
- [x] Portar Meeting con estados iniciar, pausar, reanudar, cancelar, finalizar y diarizar.
  - Revisado: la sesión de voz (`start/pause/resume/stop/cancel_speech_session`, `consume_speech_turn`) y la diarización ya están en Rust; las respuestas de Meeting se ejecutan en el runtime Rust con canal `meeting`, sin memoria ni escrituras.
- [x] Portar adjuntos persistidos sin exponer Base64 innecesario a eventos UI.
  - Revisado: los eventos del backend (`assistant-delta`, progreso, herramientas) no incluyen adjuntos; el historial se lee con `backend_load_chat` y las previsualizaciones de imágenes se calculan en Rust con tope (Fase 6).
- [x] Preparar escenarios de tamaño, duración, formato, cancelación, presión de memoria, modelos ausentes y reanudación.
  - Preparados en «Escenarios para la Fase 12» al final de este archivo.

## Fase 9 — Telegram backend

- [x] Reemplazar `useTelegramAgentBridge` por worker Rust por biblioteca/bot.
  - Hecho: `telegram_worker.rs` (plugin `telegram-worker`) supervisa la biblioteca seleccionada del catálogo y su sección `telegram` de la configuración, y mantiene un worker por (biblioteca, token): un hilo hace long polling y otro ejecuta la cola con `execute_backend_request`, igual que la interfaz. Eliminados `useTelegramAgentBridge` (y sus tests), `telegramProgressRuntime`, `telegramPdfRenderer`, el checkpoint y la cola en `localStorage`, y los comandos que dejaban al WebView leer updates o enviar mensajes con el token (queda `check_telegram_bot` para validar el token). La interfaz solo escucha `notia://telegram-library-changed` para refrescar.
- [x] Mover polling, vinculación, autenticación, offsets, callbacks, cola, progreso y recuperación al backend.
  - Hecho: vinculación con `/start` (usuario, contraseña nueva o existente, confirmación, 5 intentos y 30 s de espera, 2 minutos de vigencia) contra `library_users`; offset y últimos 200 updates procesados en `app_data/telegram/<biblioteca>-<bot>.json` con escritura atómica; callbacks de confirmación y opciones; cola de 10 solicitudes; progreso editable según `progressMode`/`editProgressMessage` a partir de los eventos del request (`backend-core::telegram_bot::progress_message`); al reiniciar, la cola queda interrumpida y solo se reanuda con `/reanudar` (los documentos se recuperan; el texto nunca se guarda y se pide reenviarlo).
- [x] Aislar updates, chats, tokens, requests, memoria y permisos por biblioteca y usuario.
  - Hecho: estado persistido por biblioteca y bot; solo chats privados; cada request usa el usuario de biblioteca vinculado a esa cuenta y chat de Telegram (con identidad externa), memoria persistente solo para el propietario y el historial conversacional en memoria por chat (20 mensajes). Los permisos siguen en el catálogo Rust.
- [x] Portar confirmaciones, aclaraciones, límites, HTML seguro, fallback a texto y revocación.
  - Hecho: las confirmaciones (con vista previa redactada: sin ids de operación, secretos ni rutas privadas), los planes y las aclaraciones pausan el request del runtime Rust y se reanudan con la respuesta (botón, «sí/no» escrito o número de opción); la confirmación vence a los 2 minutos sin aplicar cambios. La respuesta usa el HTML que deriva el backend y, si Telegram lo rechaza, se reenvía como texto. Deshabilitar Telegram, cambiar el token o la biblioteca detiene el worker.
  - Limitación: un PDF sin texto extraíble (escaneado) no se puede rasterizar en Rust sin un renderizador PDF; el bot pide fotos de las páginas.
- [x] Mantener Telegram activo aunque React esté desmontado, oculto o reiniciado.
  - Hecho: el worker vive en el proceso Rust y lee la configuración, el proveedor de IA (`configure_from_library_config`) y el catálogo sin el WebView. También corre en Android mientras el proceso esté vivo (antes estaba deshabilitado allí).
- [x] Preparar escenarios Rust de parsing, colas, workers, aislamiento, interrupción, recuperación y errores.
  - Preparados en «Escenarios para la Fase 12» al final de este archivo.

## Fase 10 — React como carcasa visual

- [x] Reemplazar usos directos del runtime TypeScript de tools por cliente backend versionado.
  - Hecho: eliminado `chatScopedAgentRuntime.ts` (≈6.900 líneas) con sus tests, el loop `runNativeToolAgent` y los parsers de tool calls de `aiRuntime.ts`, y los motores que solo usaba el runtime TS (intención, plan, rondas, acciones pendientes, búsqueda web, comparación/relaciones/hechos/etiquetas/wikilinks de documentos, reemplazo de bloques, diffs, validación Markdown, autorización y confirmación de IA, scope de chat de Task Manager, comentarios de tareas). `createGlobalAiAgent` es ahora un adaptador de UI (identidad, prompt elegido, deshacer y callbacks de aclaración/confirmación/plan); el único ejecutor es el runtime Rust versionado. Chat, Meeting, publicación y Telegram usan esa fachada.
- [x] Mantener React solo para composición visual, inputs, selección, foco, gestos, renderizado y decisiones.
  - Hecho: el título de chats nuevos (`backend_title_chat`, guarda el título en el archivo) y el aprendizaje de memorias con la reorganización de reglas y memorias (`backend_learn_from_turn`) se ejecutan en Rust (`backend-core::agent_knowledge` + `agent_knowledge.rs`) con el proveedor de la configuración de la biblioteca; se retiraron de `aiRuntime.ts` los generadores que llamaban al modelo y parseaban su respuesta.
  - Pendiente (Fase 11): la publicación de Task Manager todavía arma su payload en TS (`taskManagerPublicationRuntime`) y arranca desde un hook de React.
- [x] Derivar previews, confirmaciones, aclaraciones, progreso, errores y resultados de eventos backend.
  - Hecho: el plan que muestra el chat es el que el backend pide aprobar (antes solo lo actualizaba el runtime TS); el historial de cambios del agente y su diff salen de `agent_history.rs`, que el backend registra en cada cambio deshacible y marca al deshacer; tras una respuesta que modificó la nota activa, el editor la recarga desde el backend. Se eliminó «aplicar automáticamente cambios de riesgo bajo»: dependía de un riesgo que los previews del backend no informan y era una decisión de confirmación tomada en la interfaz.
- [x] Hacer que el editor envíe operaciones semánticas y revisiones, sin escribir directamente.
  - Hecho: el editor guarda por `backend_write_library_document` con la revisión que cargó o guardó (`latestSavedRevision`, que el backend devuelve al escribir); si la nota cambió fuera del editor (por ejemplo, por el agente), el backend responde conflicto y el editor avisa sin sobrescribir. Las ediciones del agente siguen siendo operaciones semánticas con preview y revisión.
- [x] Eliminar persistencia de agente en `localStorage` y rehidratar por request/biblioteca/usuario.
  - Hecho: historial de operaciones y diffs (`agent_history.rs`), aclaración pendiente (`agent_pending.rs`: la pregunta reaparece tras recargar si aplica a la misma nota y revisión; la respuesta arma la continuación en Rust), selección de prompt (Fase 6) y preferencias del dispositivo (`device_preferences.rs` + `backend-core::device_preferences`: publicación y modelos de voz, con migración única desde `localStorage`). Eliminados los journals TS de operaciones, `agentPlanPersistence` (el plan vive solo en la sesión) y `aiAutoApplyPreference`.
- [x] Mantener accesibilidad, touch, teclado, mouse, suspensión, reanudación y errores recuperables.
  - Revisado: los cambios de interfaz de esta etapa reutilizan controles existentes (botones, selects, checkboxes con label) y no agregan interacciones solo por hover o menú contextual. Los errores del backend (conflicto al guardar, publicación, historial, aclaraciones) se muestran con diálogos o estados recuperables; las recargas de la vista rehidratan historial, aclaración pendiente, preferencias y selección de prompt desde el backend.
- [x] Preparar escenarios de eventos fuera de orden, reconexión, confirmación, cancelación y ausencia de tool execution en WebView.
  - Preparados en «Escenarios para la Fase 12» al final de este archivo.

## Fase 11 — Ciclo de vida y cierre de desarrollo

- [x] Integrar el runtime backend con el ciclo de vida Tauri sin cancelar operaciones válidas al ocultar o destruir WebView.
  - Hecho: los requests del agente corren en workers bloqueantes del backend y no dependen del WebView; el worker de Telegram (`telegram-worker`), los backups (`library-backups`) y la restauración de la publicación de Task Manager (`task-manager-publication-autostart`, que arma el payload en Rust desde el store, las preferencias del dispositivo y la configuración) son plugins con su propio hilo. Eliminado `useTaskManagerPublicationAutostart` y el armado del payload en TS (`buildTaskManagerPublicationPayload`); publicar desde Configuración usa `backend_publish_task_manager`.
- [x] Implementar recuperación ante reinicio, cambio de biblioteca, suspensión, pérdida de SAF, pérdida de red y cierre de ventana.
  - Reinicio: journal SQLite de requests, cola de Telegram interrumpida con `/reanudar`, historial de operaciones, aclaración pendiente, catálogo, preferencias y publicación se restauran desde el backend. Cambio de biblioteca: el supervisor de Telegram detiene y crea el worker; revocar una biblioteca cancela sus requests, bloquea ColdPass y olvida la preparación de `.agent`. Pérdida de SAF: errores `Forbidden` recuperables que piden volver a autorizar. Pérdida de red: el polling de Telegram reintenta cada 3 s y los errores del proveedor se informan sin marcar éxito. Cierre de ventana: en Windows la app queda en la bandeja con los workers activos.
- [x] Revisar tray Windows, permisos Android, SAF, audio, modelos nativos y cleanup de workers.
  - Revisado en código: el worker de Telegram se detiene con una bandera al cambiar biblioteca, token o estado (el hilo de polling termina tras su long poll de hasta 35 s y la cola pendiente se guarda como interrumpida); la transcripción de audios de Telegram respeta el reconocedor ocupado por el dictado. Sin validar en dispositivo (Fase 12).
- [x] Garantizar que toda operación tenga estado verificable y nunca informe éxito sin persistencia confirmada.
  - Hecho: relectura en toda escritura de texto (adaptador por identidad y comandos por ruta), confirmación de movimientos financieros aun ante errores de almacenamiento posteriores al commit, verificación de respuestas financieras que afirman escrituras inexistentes, guardado del editor con revisión (conflicto en lugar de sobrescritura) e historial de cambios registrado por el backend.
- [x] Revisar el diff completo y eliminar adaptadores temporales, logs de diagnóstico y código muerto.
  - Hecho: eliminados el runtime TS de tools y sus motores, los journals y persistencias TS del agente, `useTelegramAgentBridge`, el streaming de voz sin uso, `confidentialContextFiles`, las copias TS de conciliación, resumen, auditoría de relaciones, ticket y sueldo, y los comandos de Telegram que exponían el token al WebView. Un script de huérfanos no encuentra módulos sin uso creados o dejados por esta migración.
  - No tocado por ser anterior a esta etapa (quedan para decisión de la persona usuaria): módulos TS sin importadores (`TopToolbar.tsx`, `explorerSelectors.ts`, `MermaidShapePalette.tsx`, `useMermaidEditor.ts`, `useMermaidInlineResize.ts`, `libraryRoles.ts`, `performanceScenarios.ts`) y código Rust sin uso de la publicación (registro de dispositivos, validaciones de usuario/contraseña de publicación) y de Bluetooth.
- [x] Confirmar que no se editen artefactos generados fuera del mecanismo documentado.
  - Confirmado: no se editaron copias Android generadas ni fuentes Kotlin en esta etapa; `backend-core/target/` quedó en `.gitignore`.
- [x] Dejar listos los informes de plataformas, modelos, proveedores, dispositivos y pruebas que deberá completar la Fase 12.
  - Ver «Escenarios para la Fase 12» e «Informe para la Fase 12» al final de este archivo.

## Fase 12 — Pruebas y validación final — ejecutar por la persona usuaria

> No ejecutar esta fase durante la implementación. Marcar cada casilla únicamente con evidencia del comando o validación realizada.

- [ ] Ejecutar pruebas dirigidas Rust, TypeScript y Kotlin de cada dominio migrado.
- [ ] Ejecutar regresiones de aislamiento, autorización, concurrencia, cancelación, timeout, stale results, idempotencia y rollback.
- [ ] Ejecutar regresiones de Task Manager y publicación: tableros, sesiones, desconexión, reconexión, reintento, conflictos y LAN/multiusuario.
- [ ] Ejecutar regresiones de Finanzas, proveedores, extracción y ausencia de mutaciones parciales.
- [ ] Ejecutar regresiones de voz, imágenes, PDF, adjuntos, Meeting, modelos ausentes, presión de memoria y reanudación.
- [ ] Ejecutar regresiones de Telegram con worker backend sin React montado.
- [ ] Ejecutar `cargo fmt --manifest-path src-tauri/backend-core/Cargo.toml -- --check`.
- [ ] Ejecutar `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [ ] Ejecutar `cargo check --manifest-path src-tauri/Cargo.toml --tests`.
- [ ] Ejecutar `npx tsc --noEmit`.
- [ ] Ejecutar `npm run lint`.
- [ ] Ejecutar `npm test -- --run` y comparar con el baseline.
- [ ] Ejecutar `npm run build -- --minify=false` y verificar que el cliente no incluya credenciales ni autoridad backend indebida.
- [ ] Compilar los targets Windows y Android disponibles sin firmar ni instalar automáticamente.
- [ ] Validar manualmente chat, edición, Finanzas, Task Manager, Telegram, voz, imágenes, PDF, reinicio, suspensión, permisos SAF y cambio de biblioteca.
- [ ] Validar manualmente que React no ejecute tools ni mantenga autoridad de escritura.
- [ ] Declarar plataformas, modelos, proveedores, dispositivos y validaciones no disponibles.
- [ ] Completar los criterios de aceptación del proyecto con evidencia.
- [ ] Invocar a `documentador` con cambios, archivos, contratos, validaciones ejecutadas y pendientes.
- [ ] Revisar el resultado de `documentador` y confirmar la sincronización documental.

## Criterios de aceptación

- [ ] El runtime completo funciona sin montar React ni WebView.
- [ ] React solo renderiza, captura interacción y envía decisiones.
- [ ] Rust ejecuta chat, Telegram, Finanzas, documentos, Task Manager, memoria, voz, imágenes y PDF.
- [ ] Las bibliotecas y usuarios permanecen aislados bajo concurrencia.
- [ ] Las mutaciones tienen preview, confirmación, idempotencia, verificación y recuperación.
- [ ] Telegram funciona embebido sin React.
- [ ] Windows y Android conservan sus capacidades y la frontera SAF.
- [ ] El core no depende de Tauri, WebView, `window`, `localStorage` ni APIs del navegador.
- [ ] Las validaciones automatizadas y manuales están ejecutadas o declaradas como no disponibles.

## Escenarios para la Fase 12

Casos a ejecutar o convertir en pruebas; los unitarios Rust nuevos ya cubren
la lógica pura indicada entre paréntesis.

- Bibliotecas y usuarios: dos bibliotecas abiertas en secuencia con usuarios y contextos distintos; un usuario sin `#Confidencial` no ve finanzas ni chats; revocar una biblioteca cancela sus requests, bloquea ColdPass y detiene su bot de Telegram.
- Agente `.agent`: primera apertura crea carpetas, reglas, memoria y `default.md`; una regla personal mal clasificada pasa a memoria; `LongTermMemory.md` se migra una sola vez con backup (`agent_workspace`).
- Chats: crear, renombrar por IA, adjuntar imagen/PDF/texto, reabrir tras reiniciar, chat con fotos de varios MB, append que falla por edición externa y reescribe (`chat_history`, `chat_attachments`).
- Finanzas: alta de movimiento por nombre de cuenta/categoría, en otra moneda, transferencia entre monedas, gasto sin categoría por Telegram, reintento con la misma referencia (sin duplicado), pago de servicio que marca la ocurrencia, error de almacenamiento después del commit (`finance_agent_inputs`, `finance_answer`, `finance_views`).
- Proveedores externos: sin red, respuesta con formato inválido, timeout.
- Voz: TTS de respuesta corta y de más de 5.900 caracteres, cancelación a mitad, dictado activo mientras llega un audio de Telegram (`speech_text`).
- Telegram (sin abrir la ventana): vinculación completa, 5 intentos fallidos y espera, cola de 10, confirmación por botón y por texto, aclaración con opciones, vencimiento de 2 minutos, reinicio con cola pendiente y `/reanudar`, PDF escaneado, token cambiado mientras hay un request activo (`telegram_bot`).
- Editor: guardar una nota que el agente modificó mientras estaba abierta (conflicto sin pérdida), recarga automática de la nota tras una edición del agente.
- Publicación de Task Manager: arranque de la app con tableros publicados (sin interacción), tablero eliminado, puerto ocupado.
- Eventos: recarga del WebView durante un request y durante una confirmación; cancelación durante una tool; aclaración pendiente tras recargar que se responde después; comprobar que ninguna tool se ejecuta en el WebView.
- Android: todo lo anterior con SAF, revocación del permiso de la carpeta, proveedor que ignora el truncado, suspensión con un request en curso.

## Informe para la Fase 12

- Plataformas: se compiló con `cargo check --offline` para Windows (lib y tests), `backend-core` (lib y tests) y el target Android del script del proyecto; TypeScript con `npx tsc --noEmit -p tsconfig.app.json` y ESLint sobre los archivos tocados. No se ejecutaron pruebas, builds de release, firmas ni instalaciones.
- Modelos y proveedores: no se probó ningún modelo de Ollama, Qwen3-ASR/TTS ni Sherpa; no se consultaron DolarApi, ArgentinaDatos ni Telegram.
- Dispositivos: sin validación en Android real (SAF, permisos, suspensión) ni en red LAN para la publicación.
- Limitaciones conocidas: el WebView sigue rasterizando PDFs con pdf.js (no hay renderizador PDF en Rust) y el bot de Telegram pide fotos cuando un PDF no tiene texto; el transporte Bluetooth de ColdPass solo existe en Linux; la selección de prompt y las preferencias del dispositivo son por dispositivo, no por biblioteca.

