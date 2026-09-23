# Matriz de frontera del runtime backend

Esta matriz es un artefacto de desarrollo. Describe la frontera actual y no
declara completada una migración mientras el estado indique `parcial` o
`pendiente`.

## Contrato común

| Campo | Regla |
| --- | --- |
| Identidad | `libraryId` + `libraryUserId` + `requestId` + `idempotencyKey` |
| Actor | Resuelto por SQLite nativo; el cliente solo propone el identificador |
| Canal | `app`, `telegram`, `meeting`, `published` o `multichat` |
| Scope | `library`, `document`, `task-manager`, `graph` o `finance` |
| Persistencia | `persistent`, `ephemeral-no-memory` o `published-no-memory` |
| Mutación | Preview, confirmación, revisión, idempotencia y verificación antes de informar éxito |
| Eventos | Sobre versionado, secuencia por request y replay acotado |
| SAF | Ruta lógica, URI tree y URI document son identidades distintas; la resolución pertenece al adaptador Android |

## Inventario de superficies

| Superficie | Dominio backend | Adaptador | Presentación | Estado de migración |
| --- | --- | --- | --- | --- |
| Biblioteca, documentos y búsqueda | `backend-core` library tools | registro de bibliotecas, SQLite e inventario | explorador y editor React | parcial |
| Edición Markdown y exportación | `markdown_editing`, `export` | filesystem desktop/SAF | Milkdown y diálogos | parcial |
| Task Manager | `task_manager_tools` | store Markdown y comandos Tauri | Kanban, tabla y Pomodoro | parcial |
| Publicación Task Manager | protocolo de publicación | sesión Windows, WebSocket y store | shell publicado | parcial |
| Chat IA | agente, catálogo, interacción, protocolo y prompt | Ollama desktop nativo / `AiBridgePlugin` Android | compositores de chat | parcial (runtime Rust en Windows y Android; guía por scope pendiente) |
| Finanzas | SQLite, reconciliación y extracción nativa | comandos financieros y proveedores | dashboard y formularios | parcial |
| Graph View | índice y referencias de biblioteca | inventario SQLite | canvas React | pendiente |
| Multichat | sesión efímera y política de lectura | Ollama | sala React | pendiente |
| ColdPass y Bluetooth | cifrado y política de sesión | adaptador Bluetooth nativo | panel de credenciales | pendiente |
| Voz, Meeting y adjuntos | límites, cola y estado de operación | ASR, TTS, captura y decodificación | controles y transcripción | parcial |
| Telegram | worker por biblioteca, offsets y cola | HTTP/Telegram y multimedia nativos | configuración y feedback | pendiente |
| Backups y bandeja Windows | ciclo de vida de aplicación | adaptadores Windows | preferencias | parcial |
| Calendario | normalización y timeout de proveedores | HTTP nativo | calendario React | pendiente |

## Matriz de tools

| Grupo | Scope | Mutabilidad | Autorización | Confirmación | Verificación | Límite principal | Consumidor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `search_*`/`read_*` de biblioteca | library/document/graph | no | biblioteca + contexto del recurso | no | revisión/revisión de lectura | páginas y candidatos bounded | chat, Graph, editor |
| metadata, referencias y comparación | document/graph | no | biblioteca + ruta lógica validada | no | fingerprint/revisión | documentos y líneas bounded | chat y Graph |
| edición Markdown y exportación | document/library | sí | usuario + scope + revisión | sí | anchors, receipt y read-back | caracteres, hunks y bytes | editor y exportación |
| lectura Task Manager | task-manager | no | usuario + tablero permitido | no | snapshot/revisión | tableros, grupos, tickets y comentarios bounded | Kanban, publicación, chat |
| mutación Task Manager | task-manager | sí | usuario + tablero permitido | sí | preview/apply/receipt | lote, orden y contenido bounded | Kanban, publicación |
| `get_finance_*`/`list_finance_*` | finance | no | `#Confidencial` + usuario | no | snapshot local | paginación y períodos | Finanzas, chat, Telegram |
| `create_`, `save_`, `update_`, `delete_`, `apply_finance_*` | finance | sí | `#Confidencial` + usuario + canal | sí, una por mutación | persistencia y relectura | centavos, períodos y payload | Finanzas, chat, Telegram |
| `search_web` | library/finance | no | scope público, sin contexto privado | no | URLs devueltas | seis búsquedas únicas | chat y Telegram |
| memoria, reglas y skills | library | sí | Owner para memoria/reglas | política de memoria | read-back y deduplicación | paths y caracteres bounded | chat persistente, Telegram Owner |
| aclaración, plan y confirmación | scope de la operación | no directo | actor de la solicitud | decisión explícita | generación y revisión | texto, pasos y opciones bounded | todos los canales |

La fuente de metadata de catálogo para nuevas ejecuciones es Rust: política,
scopes y confirmación en `catalog.rs`; descripción y schema de argumentos en
`backend-core/src/defaults/tool_schemas.json`; la guía de uso por scope en
`prompt_guidance.rs` solo menciona tools presentes en la proyección. Los nombres
seleccionados por el cliente solo actúan como filtro; no pueden cambiar schema,
scope, mutabilidad ni confirmación. Los grupos cuya ejecución nativa todavía no
está conectada devuelven un error estructurado `unsupported` y no mutan.

## Requests y resultados por superficie

| Superficie | Request | Actor/canal | Scope/snapshot | Persistencia | Eventos | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| Chat de biblioteca/documento | `BackendRequest::Run` con mensajes, selección de tools y snapshot | usuario de biblioteca / app | library o document + snapshot visual | persistent | fase, thinking, tool, interacción, resultado/fallo | respuesta de canal + `ToolResult` |
| Graph y Multichat | Run read-only o sesión efímera | usuario / app o multichat | graph/library + snapshot acotado | ephemeral-no-memory | progreso y respuesta | respuesta sin mutación |
| Task Manager | snapshot, preview/apply y receipt | usuario / app o published | task-manager + tablero autorizado | según canal | snapshot, preview, conflicto, receipt | snapshot/receipt verificable |
| Finanzas | lectura, preview o mutación tipada | usuario / app, Telegram o publicado | finance + contexto confidencial | persistent o ephemeral-no-memory | fase, confirmación, persistencia y fallo | entidades, auditoría o error recuperable |
| Telegram | request/continuación con identidad externa | usuario vinculado / telegram | scope autorizado de la biblioteca | Owner persistent; resto efímero | progreso editable, aclaración, confirmación y resultado | texto seguro y evidencia |
| Meeting/voz | control de sesión y procesamiento de adjunto | usuario / meeting | document read-only | ephemeral-no-memory | estado de captura, parcial, cancelación, diarización | transcripción editable |
| Publicación | login, snapshot, mutación o chat proxy | usuario autenticado / published | tablero publicado | published-no-memory | ACK, cursor, conflicto, expiración | snapshot/receipt/evento |

## Persistencia y estado

| Datos | `.notia` | SQLite | Efímero |
| --- | --- | --- | --- |
| Configuración de biblioteca, prompts alternativos, reglas, memoria y skills | sí | no | cachés de lectura |
| Inventario, revisiones, usuarios, roles, contextos y Finanzas | metadatos de configuración | sí | snapshots de consulta |
| Documentos de usuario y adjuntos Markdown | sí, dentro de la biblioteca | índices y metadata bounded | previews de UI |
| Operaciones, confirmaciones, resultados e idempotencia | no | `backend_operation_journal` (desktop directo, Android copia sincronizada por SAF) | controles activos e historial de eventos acotado |
| Telegram offsets, solicitudes pendientes y sesiones | pendiente de worker backend | destino previsto por biblioteca | estado de conexión |
| Meeting, streaming, cancelación y modelos cargados | no | no | sí, con límites de tamaño y duración |

## Matriz de plataformas

| Capacidad | Windows embebido | Android embebido | Publicación | Headless futuro |
| --- | --- | --- | --- | --- |
| Core de protocolo/agente | sí | sí (mismo runtime) | proyección restringida | preparado |
| Filesystem | raíz canónica | SAF tree/document | nunca expuesto | puerto |
| SQLite | archivo en `.notia` | copia/adaptador SAF | host | puerto |
| UI | Tauri/WebView | Tauri/WebView/touch | navegador cliente | no aplica |
| Ollama | transporte HTTP nativo con streaming | `AiBridgePlugin` con streaming por `Channel` IPC único enrutado por `requestId` | host autorizado | puerto |
| Voz y modelos | runtime nativo | runtime nativo | no expuesto | payload futuro |
| Telegram | servicio host | servicio pendiente de worker | no aplica | worker previsto |

## Transporte local

| Aspecto | Regla |
| --- | --- |
| Ejecución | `run_backend_request` corre en un worker bloqueante; el WebView no se bloquea y ocultarlo o recargarlo no cancela la ejecución |
| Cancelación | Registro compartido por host, escopado por biblioteca, usuario y request; `cancel` sin `operation` detiene la ejecución activa |
| Reconexión | `get-operation` sin `operation` devuelve resultado, interacción pendiente o `running`; `replay_backend_events` exige biblioteca y usuario autorizados |
| Eventos | Secuencia monótona por stream aunque se recorte el historial (512 eventos, 256 streams); el cliente aplica cada secuencia una sola vez |
| Revocación | Revocar una biblioteca cancela sus ejecuciones activas |
| Filesystem desktop | Las mutaciones por ruta absoluta solo se aceptan dentro de bibliotecas registradas; el registro persiste en datos de la app y el cliente no puede registrar carpetas arbitrarias |
| Undo | Solo mutaciones documentales confirmadas, verificando que el documento conserve la revisión producida |

## Casos de validación de cierre

La aceptación debe cubrir, como mínimo, aislamiento entre dos bibliotecas y
dos usuarios, autorización de `#Confidencial`, doble ejecución idempotente,
preview obsoleto, cancelación durante proveedor y tool, timeout, reanudación
por cursor, replay acotado, permiso SAF revocado, cambio de biblioteca,
suspensión/reinicio, conflicto de Task Manager, sesión publicada expirada,
ausencia de modelo, adjunto sobredimensionado, cola Telegram sin React y
ausencia de autoridad de escritura en WebView.

Las pruebas y validaciones de plataforma permanecen reservadas a la Fase 12
de `tasks.md`.
