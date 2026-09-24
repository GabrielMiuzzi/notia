# Matriz de frontera del runtime backend

Esta matriz es un artefacto de desarrollo. Describe la frontera vigente entre la interfaz y el backend Rust. La arquitectura completa (crates, hosts, registro, transportes y protocolo del servidor) está en `README-TECH.md`, sección «Arquitectura vigente: backend Rust, hosts y transporte».

## Contrato común

| Campo | Regla |
| --- | --- |
| Identidad | `libraryId` + `libraryUserId` + `requestId` + `idempotencyKey` |
| Actor | Resuelto por SQLite nativo; el cliente solo propone el identificador |
| Canal | `app`, `telegram`, `meeting`, `published` o `multichat` |
| Scope | `library`, `document`, `task-manager`, `graph` o `finance` |
| Persistencia | `persistent`, `ephemeral-no-memory` o `published-no-memory` |
| Mutación | Preview, confirmación, revisión, idempotencia y verificación antes de informar éxito |
| Eventos | Sobre versionado con secuencia por request (`notia:backend-event`); el resto de los eventos avisa cambios y la vista vuelve a leer. En el servidor headless todos llevan `seq` y se reproducen al reconectar |
| SAF | Ruta lógica, URI tree y URI document son identidades distintas; la resolución pertenece al adaptador Android |
| Transporte | La interfaz llama con `callBackend` (`src/services/transport`). La ventana entra por `app_invoke`; el servidor headless, por `POST /api/invoke` y `WS /api/events`; la publicación, por su protocolo, que entra al registro con `dispatch_published` |

## Inventario de superficies

«Hecho» significa que la lógica funcional está en Rust y que la interfaz solo presenta. Las excepciones visuales de TypeScript (editor Milkdown, InkMath, Mermaid, pdf.js, lista virtual y expansión del árbol) están listadas en `README-TECH.md`, en la sección «cierre de la fase 1». La validación manual en plataforma sigue pendiente (ver «Casos de validación de cierre»).

| Superficie | Dominio backend | Adaptador | Presentación | Transporte | Estado de migración |
| --- | --- | --- | --- | --- | --- |
| Biblioteca, documentos y búsqueda | `library_tree`, library tools | sesión de biblioteca, registro, SQLite e inventario | explorador y editor React | registro (local y remoto) | hecho |
| Edición Markdown y exportación | `markdown_editing`, `export` | filesystem desktop/SAF | Milkdown y diálogos | registro | hecho |
| Task Manager | `task_manager_tools`, `task_manager_ui`, `pomodoro` | store Markdown y comandos del registro | Kanban, tabla y Pomodoro | registro | hecho |
| Publicación Task Manager | protocolo de publicación | servidor compartido (`server/`), sesión, WebSocket y store | shell publicado | protocolo de la publicación sobre `dispatch_published` (principal restringido) | hecho |
| Chat IA | agente, catálogo, interacción, protocolo, prompt y guía por scope | Ollama desktop nativo / `AiBridgePlugin` Android | compositores de chat | registro y eventos | hecho |
| Finanzas | SQLite, reconciliación, `finance_insights` y extracción nativa | comandos financieros y proveedores | dashboard y formularios | registro | hecho |
| Graph View | índice, referencias y `wiki_links` | inventario SQLite | canvas React | registro | hecho |
| Multichat | sesión efímera y política de lectura | Ollama | sala React | registro y eventos | hecho |
| ColdPass y Bluetooth | cifrado, sesión y generador | vault Rust y enlace Bluetooth nativo | panel de credenciales | registro; Bluetooth e importación CSV solo locales | hecho |
| Voz, Meeting y adjuntos | límites, cola, estado de operación y `remote_audio` | ASR, TTS, captura y decodificación | controles y transcripción | registro; sesiones de voz solo locales; dictado remoto por fragmentos | hecho |
| Telegram | worker por biblioteca, offsets y cola | HTTP/Telegram y multimedia nativos | configuración y feedback | worker Rust sin interfaz | hecho |
| Backups y bandeja Windows | ciclo de vida de aplicación | adaptadores Windows; bandeja en el host Tauri | preferencias | registro (selector de carpeta solo local) | hecho |
| Calendario | normalización y timeout de proveedores | HTTP nativo | calendario React | registro | hecho |

## Matriz de tools

| Grupo | Scope | Mutabilidad | Autorización | Confirmación | Verificación | Límite principal | Consumidor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `search_*`/`read_*` de biblioteca | library/document/graph | no | biblioteca + contexto del recurso | no | revisión/revisión de lectura | páginas y candidatos acotados | chat, Graph, editor |
| metadata, referencias y comparación | document/graph | no | biblioteca + ruta lógica validada | no | fingerprint/revisión | documentos y líneas acotados | chat y Graph |
| edición Markdown y exportación | document/library | sí | usuario + scope + revisión | sí | anchors, receipt y read-back | caracteres, hunks y bytes | editor y exportación |
| lectura Task Manager | task-manager | no | usuario + tablero permitido | no | snapshot/revisión | tableros, grupos, tickets y comentarios acotados | Kanban, publicación, chat |
| mutación Task Manager | task-manager | sí | usuario + tablero permitido | sí | preview/apply/receipt | lote, orden y contenido acotados | Kanban, publicación |
| `get_finance_*`/`list_finance_*` | finance | no | `#Confidencial` + usuario | no | snapshot local | paginación y períodos | Finanzas, chat, Telegram |
| `create_`, `save_`, `update_`, `delete_`, `apply_finance_*` | finance | sí | `#Confidencial` + usuario + canal | sí, una por mutación | persistencia y relectura | centavos, períodos y payload | Finanzas, chat, Telegram |
| `search_web` | library/finance | no | scope público, sin contexto privado | no | URLs devueltas | seis búsquedas únicas | chat y Telegram |
| memoria, reglas y skills | library | sí | Owner para memoria/reglas | política de memoria | read-back y deduplicación | paths y caracteres acotados | chat persistente, Telegram Owner |
| aclaración, plan y confirmación | scope de la operación | no directo | actor de la solicitud | decisión explícita | generación y revisión | texto, pasos y opciones acotados | todos los canales |

La fuente de metadata de catálogo para nuevas ejecuciones es Rust:
- política, scopes y confirmación en `catalog.rs`;
- descripción y schema de argumentos en `backend-core/src/defaults/tool_schemas.json`;
- la guía de uso por scope en `prompt_guidance.rs`, que solo menciona tools presentes en la proyección.

Los nombres seleccionados por el cliente solo actúan como filtro: no pueden cambiar schema, scope, mutabilidad ni confirmación. Los grupos cuya ejecución nativa todavía no está conectada devuelven un error estructurado `unsupported` y no mutan.

## Requests y resultados por superficie

| Superficie | Request | Actor/canal | Scope/snapshot | Persistencia | Eventos | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| Chat de biblioteca/documento | `BackendRequest::Run` con mensajes, selección de tools y snapshot | usuario de biblioteca / app | library o document + snapshot visual | persistent | fase, thinking, tool, interacción, resultado/fallo | respuesta de canal + `ToolResult` |
| Graph y Multichat | Run read-only o sesión efímera | usuario / app o multichat | graph/library + snapshot acotado | ephemeral-no-memory | progreso y respuesta | respuesta sin mutación |
| Task Manager | snapshot, preview/apply y receipt | usuario / app o published | task-manager + tablero autorizado | según canal | snapshot, preview, conflicto, receipt | snapshot/receipt verificable |
| Finanzas | lectura, preview o mutación tipada | usuario / app, Telegram o publicado | finance + contexto confidencial | persistent o ephemeral-no-memory | fase, confirmación, persistencia y fallo | entidades, auditoría o error recuperable |
| Telegram | request/continuación con identidad externa | usuario vinculado / telegram | scope autorizado de la biblioteca | Owner persistent; resto efímero | progreso editable, aclaración, confirmación y resultado | texto seguro y evidencia |
| Meeting/voz | control de sesión y procesamiento de adjunto | usuario / meeting | document read-only | ephemeral-no-memory | estado de captura, parcial, cancelación, diarización | transcripción editable |
| Dictado remoto | fragmentos PCM ordenados (`speech_remote_audio`) | dueño / app remota | grabación de la sesión | ephemeral-no-memory | ninguno (la respuesta del último fragmento trae el texto) | texto reconocido o error del reconocedor |
| Publicación | login, snapshot, mutación o chat proxy | usuario autenticado / published | tablero publicado | published-no-memory | ACK, cursor, conflicto, expiración | snapshot/receipt/evento |
| Cliente remoto (headless) | `POST /api/invoke { command, args }` | dueño con sesión | el del comando | la del comando | `WS /api/events?since=N` con `{ seq, event, payload }` | `{ result }` o `{ error }` del backend |

## Persistencia y estado

| Datos | `.notia` | SQLite | Datos de la app (`app_data`) | Efímero |
| --- | --- | --- | --- | --- |
| Configuración de biblioteca, prompts alternativos, reglas, memoria y skills | sí | no | no | cachés de lectura |
| Inventario, revisiones, usuarios, roles, contextos y Finanzas | metadatos de configuración | sí | no | snapshots de consulta |
| Documentos de usuario y adjuntos Markdown | sí, dentro de la biblioteca | índices y metadata acotados | no | previews de UI |
| Operaciones, confirmaciones, resultados e idempotencia | no | `backend_operation_journal` (desktop directo, Android copia sincronizada por SAF) | no | controles activos e historial de eventos acotado |
| Catálogo y registro de bibliotecas, preferencias del dispositivo, Pomodoro por usuario | no | no | sí | no |
| Telegram: offsets, updates procesados y cola durable | no | no | `telegram/<biblioteca>-<bot>.json` y cola | estado de conexión |
| Servidor headless: hash de la contraseña del dueño y certificado TLS | no | no | `headless-server/owner.json` y `headless-server/tls/` | sesiones y suscriptores de eventos |
| Bloqueo de la carpeta de datos | no | no | `notia.lock` (bloqueo del sistema) | no |
| Meeting, streaming, dictado remoto, cancelación y modelos cargados | no | no | no | sí, con límites de tamaño y duración |

## Matriz de plataformas

| Capacidad | Windows embebido | Android embebido | Headless (Windows/Linux) | Navegador remoto | Publicación |
| --- | --- | --- | --- | --- | --- |
| Core de protocolo/agente | sí | sí (mismo runtime) | sí (mismo runtime) | por el servidor | proyección restringida |
| Entrada | `app_invoke` | `app_invoke` | `/api/invoke` y `/api/events` | transporte remoto | protocolo propio sobre `dispatch_published` |
| Filesystem | raíz canónica | SAF tree/document | raíz canónica; alta con `--add-library` | `/api/file` para mostrar archivos | nunca expuesto |
| SQLite | archivo en `.notia` | copia/adaptador SAF | archivo en `.notia` | por el servidor | host |
| UI | Tauri/WebView | Tauri/WebView/touch | no aplica | navegador (`RemoteApp`) | navegador cliente |
| Ollama | HTTP nativo con streaming | `AiBridgePlugin` con streaming por `Channel` IPC único enrutado por `requestId` | HTTP nativo | por el servidor | host autorizado |
| Voz y modelos | runtime nativo | runtime nativo | dictado remoto en Windows; Linux sin reconocedor | captura en el navegador | no expuesto |
| Telegram | worker Rust | worker Rust | worker Rust (Linux sin transcripción de audios) | por el servidor | no aplica |

## Transporte local

| Aspecto | Regla |
| --- | --- |
| Entrada | Un solo comando Tauri, `app_invoke { command, args }`, que llega a `registry::dispatch_app_invoke`; los comandos de ventana quedan fuera del registro |
| Ejecución | Los comandos síncronos corren en el hilo que llama; los `async`, en el runtime tokio compartido |
| Cancelación | Registro compartido por host, escopado por biblioteca, usuario y request; `cancel` sin `operation` detiene la ejecución activa |
| Reconexión | La ventana no pierde eventos mientras la vista vive. En el servidor headless, el WebSocket reconecta con `?since=` y recibe lo perdido o `notia:events-lost` |
| Eventos | Secuencia monótona por stream aunque se recorte el historial (512 eventos, 256 streams); el cliente aplica cada secuencia una sola vez |
| Revocación | Revocar una biblioteca cancela sus ejecuciones activas |
| Filesystem desktop | Las mutaciones por ruta absoluta solo se aceptan dentro de bibliotecas registradas; el registro persiste en datos de la app y el cliente no puede registrar carpetas arbitrarias |
| Undo | Solo mutaciones documentales confirmadas, verificando que el documento conserve la revisión producida |

## Transporte remoto (servidor headless)

| Aspecto | Regla |
| --- | --- |
| Autenticación | Contraseña del dueño (hash PBKDF2) y cookie `HttpOnly; Secure; SameSite=Strict` de 12 h; máximo 64 sesiones |
| Autorización | La sesión da acceso de dueño a los comandos remotos. `LOCAL_ONLY_COMMANDS` (micrófono, Bluetooth, selectores nativos) responde 403 |
| Errores | `400 { error }` con el error del backend tal cual; 401 sin sesión; 403 por origen o comando local; 429 por límite de pedidos |
| Eventos | Un WebSocket por cliente; cada evento lleva `seq`. Al reconectar se reproducen los últimos 512 o, si ya no están o el servidor se reinició, llega `notia:events-lost` y la interfaz ofrece recargar. Los clientes lentos se descartan y reconectan |
| Archivos | `/api/file` solo dentro de bibliotecas registradas, hasta 64 MB y con `Content-Security-Policy: sandbox` |
| Datos | La misma carpeta de datos que la app, con acceso exclusivo (`notia.lock`) |

## Casos de validación de cierre

La aceptación debe cubrir, como mínimo:
- aislamiento entre dos bibliotecas y dos usuarios;
- autorización de `#Confidencial`;
- doble ejecución idempotente;
- preview obsoleto;
- cancelación durante proveedor y tool;
- timeout;
- reanudación por cursor y replay acotado;
- permiso SAF revocado;
- cambio de biblioteca;
- suspensión y reinicio;
- conflicto de Task Manager;
- sesión publicada expirada;
- ausencia de modelo;
- adjunto sobredimensionado;
- cola Telegram sin React;
- ausencia de autoridad de escritura en WebView.

Para el transporte remoto se agregan:
- sesión vencida y logout;
- comando local rechazado;
- archivo fuera de bibliotecas;
- reconexión del WebSocket de eventos;
- dictado remoto con y sin voz;
- segunda instancia sobre la misma carpeta de datos.

La cobertura automatizada y las pruebas de punta a punta ejecutadas están registradas en `README-TECH.md`. El servidor se compiló y probó en Linux y la interfaz remota con Edge sin ventana; la validación manual en Android real y en otros navegadores sigue pendiente.
