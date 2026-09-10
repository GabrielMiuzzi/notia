# Task Manager publicado — colaboración multiusuario en tiempo real

Plan para convertir la publicación LAN de Task Manager en una sesión colaborativa. La biblioteca del host continúa siendo la fuente de verdad: varias personas se conectan a la misma URL, las personas remotas envían mutaciones al host y el host retransmite el resultado a todos los clientes autorizados, incluida la instancia de Notia.

Fecha de la auditoría: 2026-09-09.

## Estado de esta implementación

El backlog conserva el diagnóstico inicial y separa lo implementado de las validaciones que todavía requieren un servidor Windows real o una prueba E2E. El núcleo colaborativo solicitado quedó implementado con WebSocket sobre TLS:

- [x] Transporte WebSocket en `/task-manager/ws`, handshake autenticado por cookie/origen, `publicationEpoch`, `sequence`, `revision`, replay, `resync-required`, ACK, ping/pong y eventos terminales.
- [x] Mutaciones remotas pasan por el mismo ejecutor de publicación; el host y el agente notifican la revisión después de persistir. Hay cola acotada, serialización, límites de sesiones/conexiones y cierre por revocación, stop o republicación.
- [x] Cliente publicado dedicado con cursor, reconexión con backoff, reintento idempotente por `messageId` estable y correlación por `operationId`, resync de bootstrap y coalescing de reloads.
- [x] El bootstrap publica la carpeta raíz lógica de Task Manager para eliminar las sondas HTTP repetidas por cada escritura; el bridge corta cascadas tras `401` y aplica `Retry-After` tras `429`.
- [x] El arrastre mantiene la ruta del ticket en una referencia síncrona y centraliza su limpieza, permitiendo mover consecutivamente el mismo ticket; la publicación responde el favicon sin exigir autenticación para evitar un `401` ajeno al flujo de sesión.
- [x] Propagar un único `operationId` por cada lote guest, conservarlo durante una gracia de reconexión de 20 segundos, revalidar `begin` antes de reintentar escrituras y reenviar directamente un `end` pendiente sin revivir un lote ya cerrado.
- [x] Hacer que el host espere asincrónicamente el cierre normal de un lote guest; las mutaciones de tickets usan revisión por archivo para permitir trabajo concurrente sobre tickets distintos, y los settings conservan revisión global.
- [x] Calcular el orden del ticket entre sus vecinos para escribir normalmente solo el elemento movido, rebalancear únicamente la columna destino cuando sea imprescindible y cubrir movimientos consecutivos del mismo ticket.
- [x] En la URL, escribir frontmatter directamente desde el snapshot confirmado con precondición SHA-256, eliminando la lectura HTTP por ticket; un fallo de snapshot se propaga y conserva la última vista válida en vez de vaciar el tablero.
- [x] Mantener el drenaje de recargas activo hasta consumir también una invalidación que llegue durante la finalización de la Promise anterior; las pruebas fuerzan 100 límites de finalización, 100 lotes y 100 mutaciones alternadas entre tres clientes sin perder cursores ni cambios.
- [x] Reintentar con backoff acotado la reconciliación completa cuando falle una lectura transitoria, sin vaciar el snapshot ni esperar otro evento; evitar además que el host reescriba metadata ya persistida por la mutación remota.
- [x] Metadata compartida de tableros/grupos distribuida sin sincronizar preferencias de presentación como `activeTab`, `pomodoro` o la ruta local.
- [x] Metadata compartida de tableros/grupos persistida y versionada en `.notia-task-manager.json`; `localStorage` queda como cache/preferencia y la migración conserva settings existentes.
- [x] Revisión SHA-256 por archivo para lecturas/escrituras Markdown y protección del editor completo contra sobrescrituras por revisión obsoleta.
- [x] Documentación de usuario, arquitectura y protocolo actualizada; se preservaron las eliminaciones preexistentes de `AI.md` y `AI-mejoras.md`.
- [x] El cliente pausa socket, timers y reconexiones en background, resincroniza por bootstrap al volver y conserva las mutaciones pendientes.
- [x] El cliente WebSocket no deja una mutaciÃ³n pendiente indefinidamente: usa reintentos acotados, informa resultado `unknown` si nunca recibe ACK y libera el formulario para una recuperaciÃ³n segura.
- [x] El cliente publicado no sincroniza Ã­ndices virtuales ni prepara el vault remoto en cada reload; solo carga el snapshot y deja las escrituras derivadas bajo responsabilidad del host.
- [x] La configuración del host muestra sesiones autenticadas, WebSockets activos y revisión/cursor actuales.
- [x] La configuración del host muestra la época, última operación/actor y un estado accionable de recuperación cuando una operación multiarchivo queda parcial o sin verificar.
- [x] El host reconcilia cambios externos detectados por el watcher del filesystem, publica una nueva revisión solo cuando el snapshot cambió y evita duplicar sus propias escrituras.
- [x] La sincronización de índices registra el contenido que acaba de asegurar y evita una segunda sustitución atómica del mismo archivo; los errores tipados de creación desde el cliente publicado se conservan para no ocultar conflictos ni estados desconocidos. Los reloads son de solo lectura y no vuelven a escribir índices como reacción a cada evento del watcher.
- [x] La barrera de mutaciones del host ahora difiere y coalesce los avisos hasta cerrar el lote; el cierre devuelve el cursor final y conserva `operationId`/actor opacos.
- [x] Antes de ejecutar una operación remota, el servidor vuelve a resolver el vault y los ancestros existentes con canonicalización física; rechaza rutas que atraviesan symlinks o salen del root.
- [x] Las operaciones locales agrupadas y las del agente registran un journal acotado y opaco; al iniciar el workspace se detectan entradas `pending` para recuperación explícita sin reejecutar escrituras automáticamente. Si un lote local falla después de una escritura parcial, compara snapshot y metadata, anuncia el estado realmente persistido antes de liberar la barrera WebSocket y conserva el estado de recuperación activo.

Quedan explícitamente pendientes las pruebas de carga/E2E con varios navegadores, la medición extremo a extremo, el journal transaccional completo del filesystem y la migración de todas las operaciones locales a un caso de uso de dominio único. El servidor ya aplica rate limiting por IP y por sesión, el host persiste telemetría agregada acotada y el bridge remoto usa comandos tipados. La cancelación del stream de IA publicado ya propaga el cierre al upstream; una mutación de filesystem ya iniciada informa `unknown` cuando no puede confirmarse, y una mutación que aún espera el lock puede cancelarse sin tocar el filesystem. No se deben marcar los criterios finales como completos hasta ejecutar esas validaciones.

La capacidad operativa ahora es configurable por publicación (maxClients, 1–64, 64 por defecto); el host aplica el límite a sesiones/WebSockets y rechaza el siguiente acceso sin expulsar a los conectados. También se cerró el bridge de mutaciones: el navegador no puede crear Mermaid, copiar entradas, modificar índices protegidos ni borrar/renombrar raíces de tablero; el log de Pomodoro continúa siendo un archivo compartido real.

## Objetivo

Permitir que N personas autorizadas y la persona que usa Notia trabajen simultáneamente sobre los tableros publicados y observen los cambios en ambas direcciones, en tiempo real y sin perder escrituras.

“N personas” significa una cantidad concurrente finita, configurable y limitada por recursos. No se debe conservar el límite actual de 64 como un comportamiento implícito que borra sesiones existentes; se debe definir una capacidad operativa, rechazar nuevas conexiones de forma explícita cuando se alcance y conservar las sesiones ya activas.

## Alcance y decisiones base

- La primera versión sigue siendo local: un host Windows ejecuta Notia y sirve HTTPS dentro de la red LAN. No se agrega un backend cloud ni sincronización entre dos hosts.
- El canal colaborativo principal será WebSocket sobre TLS (`/task-manager/ws`): cada cliente envía mutaciones, recibe su acknowledgement y recibe los eventos ordenados de todos los demás clientes. HTTP queda para registro/login, bootstrap, assets, health y APIs auxiliares que no necesiten una sesión colaborativa persistente. No se agrega WebSocket para reemplazar el runtime común de IA; el stream de IA publicado puede conservar su endpoint separado.
- El servidor/servicio de publicación es la autoridad para ordenar mutaciones, asignar revisiones, resolver idempotencia y decidir conflictos. Ningún cliente puede imponer el orden escribiendo directamente en el filesystem.
- El filesystem del host sigue almacenando tareas como Markdown. El evento se emite solo después de completar la mutación lógica y las actualizaciones derivadas necesarias.
- El chat publicado continúa pasando por `notiaChatRuntime.ts` y conserva su alcance de tableros publicados, su historial efímero y su política `published-no-memory`.
- Estado local de cada cliente —pestaña activa, vista, diálogos, selección y timer en curso— no se sincroniza. Los datos de dominio sí se sincronizan: tareas, contenido, estado, prioridad, horas, comentarios, subtareas, relaciones, movimientos, archivado, restauración, registro de Pomodoro y metadata compartida que permanezca visible.
- La creación, edición y eliminación de tableros sigue siendo una capacidad del host mientras la URL pase `canManageBoards: false`. Los controles no disponibles no deben aparecer en clientes remotos. Los grupos hoy sí aparecen en la URL y, por lo tanto, deben volverse operaciones compartidas o dejar de exponerse; no se acepta que parezcan guardados y queden solo en el `localStorage` de un navegador.

### Matriz de operaciones vigente

| Operación | Datos compartidos | Regla actual | Transporte publicado |
| --- | --- | --- | --- |
| Crear tarea o subtarea | Archivo Markdown e índices | Secuencial y atómica por ruta; no colisiona con cambios sobre otro ticket | WebSocket |
| Editar campos, prioridad, estado u horas | Frontmatter y, si corresponde, ubicación | Rebase explícito de campos no solapados; conflicto si se editó el mismo campo | WebSocket |
| Editar Markdown completo | Fuente completa del archivo | `expectedRevision` exacto; conserva el borrador ante conflicto | WebSocket |
| Agregar comentario | Cuerpo Markdown | Read-modify-write con revisión; conflicto si la fuente cambió | WebSocket |
| Mover, reordenar, archivar o restaurar | Uno o más archivos e índices | Batch serializado y revisión por archivo; el journal transaccional queda pendiente | WebSocket |
| Crear, editar, borrar o reordenar grupos | Metadata compartida de settings | Revisión global exacta y sanitización contra tableros publicados | WebSocket |
| Registro de Pomodoro y horas | `pomodoro.md` y frontmatter | Mutación compartida; las preferencias del timer en curso son locales | WebSocket |
| Chat/stream de IA | No agrega estado colaborativo por sí mismo | Mantiene el runtime común; las herramientas que escriben usan WebSocket | HTTP streaming + WebSocket para mutaciones |

Las preferencias `activeTab`, selección, diálogos, vista y timer en curso no se distribuyen. Una edición externa del vault debe volver a validarse contra la revisión del archivo y provocar resync/conflicto; no puede sobrescribir silenciosamente una propuesta abierta.

## Estado auditado

Se verificó el siguiente comportamiento en el código actual:

- [x] Antes de esta implementación, `src-tauri/src/task_manager_publication.rs` servía HTTPS, login por dispositivo, `/task-manager/bootstrap`, `/task-manager/invoke` y `/task-manager/events`.
- [x] Antes de esta implementación, `serve_publication_events` usaba SSE y `useTaskManager` escuchaba ese stream junto con el evento Tauri del host.
- [x] El transporte de colaboración actual reemplaza SSE por `/task-manager/ws`; el host conserva el evento Tauri y los clientes publicados escuchan el cliente WebSocket dedicado.
- [x] Las mutaciones remotas sobre `write_library_file`, `append_task_comment`, `create_library_entry` y `library_entry_operation` generan avisos desde Rust.
- [x] Las mutaciones normales de la UI de Task Manager llaman a `notifyTaskManagerPublicationChanged` desde `runSync` después de persistir/sincronizar índices, calculan `changedPaths` a partir del snapshot nuevo y luego actualizan el snapshot local. Cuando hay una publicación activa, `runSync` abre una barrera de lote del host y la cierra en `finally` para que las mutaciones remotas esperen durante la operación.
- [x] La suite focalizada existente pasó; cubre el cliente WebSocket, el runtime y preferencias de publicación.
- [x] Existe un protocolo WebSocket con `revision`, `sequence`, `messageId`, `operationId`, `baseRevision`, cursor de reconexión y `changedPaths` acotados a aliases lógicos; los DTOs versionados están centralizados en `taskManagerPublicationProtocol.ts`.
- [ ] El host todavía realiza el filesystem local mediante los servicios TypeScript, fuera de un caso de uso Rust único; `runSync`, el agente y las reconciliaciones del watcher pasan por el coordinador FIFO y la barrera de lote bloquea mutaciones remotas durante sus operaciones. HTTP y WebSocket remotos comparten el ejecutor serializado; falta migrar todas las escrituras locales y el agente al coordinador de dominio único.
- [x] `updateTaskFrontmatter`, `updateTaskBody` y `writeTaskMarkdownSource` conservan una precondición SHA-256; una edición concurrente devuelve conflicto y no pisa datos.
- [x] El host y el cliente publicado agrupan operaciones compuestas dentro de un batch WebSocket acotado. El `begin` funciona como semáforo global: un solo host o cliente remoto puede aplicar una operación compuesta, los demás esperan o reciben un resultado incierto acotado, y el servidor emite una sola revisión al cerrar. Si la conexión cae, conserva el lote hasta 20 segundos para permitir una reconexión segura; sin actividad posterior, libera la barrera y publica lo que ya se aplicó. El journal mínimo del agente conserva el estado de recuperación; una transacción de filesystem completo sigue fuera de alcance.
- [x] La capacidad de sesiones se rechaza con 429 sin limpiar las sesiones existentes.
- [x] SSE fue reemplazado por WebSocket; los suscriptores se asocian a dispositivo, la revocación cierra sus sockets y cancela sus streams HTTP de IA mediante un token de cancelación que libera el upstream.
- [x] El cliente expone una UI accesible para `connecting`, `offline`, `syncing`, `conflict`, `revoked` y `stopped/reconfigured`; descarta eventos duplicados y snapshots tardíos mediante generación.
- [x] Crear, editar o reordenar grupos actualiza metadata compartida mediante la mutación de settings; `activeTab`, `pomodoro` y la ruta local siguen siendo preferencias locales.
- [x] Las mutaciones del agente notifican el adaptador de publicación después de persistir y sincronizar índices, incluyendo las rutas afectadas filtrables por Rust.
- [ ] Existe el probe reproducible `npm run test:publication:e2e`, pero todavía no se ejecutó contra un host Windows real con dos o más clientes, conflicto concurrente, reconexión con eventos perdidos, revocación de un stream y límite de capacidad.

## Contrato de colaboración

### PUB-001 — Definir la matriz de operaciones y la política de estado

- [x] Enumerar cada acción visible en host y URL: crear tarea/subtarea, editar campos, editar Markdown completo, comentario, prioridad, horas dedicadas, estado, mover grupo, reordenar, archivar, restaurar, borrar, grupos, índices y Pomodoro.
- [x] Para cada operación indicar si es `commutative`, si puede rebajarse sobre el estado actual o si exige revisión exacta. La matriz vigente exige revisión exacta para comentarios, edición completa, reordenamiento y movimientos; el append/rebase seguro queda explícitamente pendiente.
- [x] Separar datos compartidos de preferencias de presentación. El log/horas y metadata de grupos son compartidos; timer en curso, pestaña, vista, diálogos y selección son locales.
- [x] Definir la política para una edición externa del archivo mientras hay clientes conectados: detectar mediante el watcher, reconsultar el snapshot y emitir una nueva revisión segura; la precondición de escritura devuelve conflicto si alguien intenta sobrescribirla.
- [x] Documentar el resultado en `README-TECH.md` y mantener el contrato estable entre TypeScript, Rust y el cliente publicado.

### PUB-002 — Crear el protocolo de revisión, eventos y acknowledgements

- [x] Definir DTOs camelCase versionados en `taskManagerPublicationProtocol.ts`: `PublicationSession`, `PublicationSnapshot`, `TaskManagerMutation`, `MutationAck`, `PublicationEvent`, `PublicationConflict` y `ResyncRequired`; el cliente los reutiliza como contrato de wire.
- [x] Cada publicación tiene un `publicationEpoch` opaco y contadores monotónicos `sequence`/`revision`; las mutaciones llevan `operationId` y `baseRevision` sin exponer rutas locales. `changedPaths` se transporta como alias lógico acotado y `actorId` como hash corto derivado del dispositivo; el bridge genérico sigue pendiente de migración a comandos de dominio completos.
- [x] Bootstrap y `ack` incluyen la revisión/cursor confirmados; el `ack` agrega `changed`/`changedPaths` seguros y el cambio solo se anuncia después del resultado real del servicio de persistencia.
- [x] El protocolo implementa `hello`, `welcome`, `mutate`, `ack`, `changed`, `resync-required`, `publication-reconfigured`, `access-revoked`, `publication-stopped`, `ping` y `pong`, versionados y con época/ID de mensaje.
- [x] El handshake autentica la cookie de sesión, valida el origen HTTPS esperado y usa `lastSequence` para replay o snapshot.
- [x] Si el historial no alcanza, responde `resync-required`; el cliente descarga bootstrap antes de reanudar mutaciones.
- [x] No incluir passwords, API keys, rutas absolutas ni contenido completo de tareas en bootstrap/eventos; `vaultPath` queda únicamente en el evento Tauri interno del host y las lecturas/errores publicados pasan por alias/filtros seguros.

### PUB-003 — Elegir y versionar la fuente de metadata compartida

- [x] Mantener `localStorage` del navegador únicamente como cache/preferencia local; los cambios de boards/groups del cliente publicado se envían al host por WebSocket.
- [x] Persistir de forma versionada en el workspace del Task Manager los grupos, su color y su orden mediante `.notia-task-manager.json`; la URL comparte esas operaciones por WebSocket.
- [x] Sanitizar nombres/colores de tableros y grupos contra la selección publicada y distribuir la metadata con `changed`; una republicación crea nueva época y reconfigura clientes.
- [x] Añadir migración recuperable desde `taskManagerStorage.ts` hacia metadata `version: 1`, preservando compatibilidad con bibliotecas existentes y diferenciando metadata compartida de `activeTab` y estado visual.

## Núcleo de autoridad y persistencia

### PUB-010 — Implementar el coordinador único de mutaciones

- [ ] Crear una frontera de dominio única para las mutaciones colaborativas. El host, el endpoint HTTP y el agente de Task Manager deben llamar al mismo caso de uso, con `actorId`, `operationId`, `baseRevision` y precondiciones. El host ya cuenta con un coordinador FIFO que comparte UI, Pomodoro y agente, y la publicación remota con Rust; queda migrar las operaciones locales al mismo caso de uso tipado de dominio.
- [x] Hacer que cada request remoto sea una unidad serializada y emitir un único `changed` después de su resultado; las operaciones multiarchivo del comando genérico todavía requieren journal explícito.
- [x] El serializador remoto usa un lock independiente y lo libera antes de emitir eventos; no mantiene un `MutexGuard` de runtime a través de I/O async.
- [x] Definir el comportamiento de cancelación de mutaciones: el cliente cancela antes de enviar sin tocar el filesystem, envía un frame `cancel` si la mutación ya fue enviada y no reintenta una operación cerrada con resultado `unknown`; conserva su `operationId`. El servidor cancela una mutación mientras espera el lock, responde `cancelled: true` y no ejecuta la escritura; si la operación ya comenzó, devuelve `applied`, `failed` o `unknown`. El stream de IA publicado propaga el error de escritura al consumidor de Ollama y libera el upstream cuando el cliente se desconecta. La transacción completa del filesystem sigue pendiente.
- [x] Deduplicar reintentos por sesión y `messageId`, conservándolo estable durante el retry; `operationId` queda como correlación del batch para que begin, varias escrituras y end no se confundan entre sí. El caché se limpia al cambiar `publicationEpoch`, por lo que un retry no duplica la mutación confirmada.

### PUB-011 — Añadir revisión por archivo y detección de conflictos

- [x] Calcular una revisión SHA-256 estable y opaca de cada fuente Markdown para detectar cambios sin revelar contenido.
- [x] Exigir `expectedRevision` en las escrituras Markdown de edición completa y en las actualizaciones de campos/body que dependen de una lectura previa; borrar/mover todavía requieren migración a operaciones tipadas.
- [x] Exigir `baseRevision` para toda mutación WebSocket, incluida metadata compartida de tableros/grupos; una revisión global obsoleta devuelve un conflicto estructurado y no pisa el estado vigente.
- [x] Completar la UI de conflictos estructurados con revisión esperada/actual, operación afectada, título seguro y acciones recargar/reintentar/cancelar. La comparación lado a lado queda pendiente; el backend devuelve `conflict.kind`, `expectedRevision` y `currentRevision`.
- [x] Aplicar parches de frontmatter sobre la versión actual cuando la operación sea explícitamente compatible, conservando campos modificados por otra persona. `rebaseMarkdownFrontmatter` se usa en acciones de UI y agente; rechaza campos solapados en vez de usar last-write-wins.
- [x] Implementar append atómico para comentarios y cualquier otra operación que pueda conservar aportes independientes. El canal publicado usa `append_task_comment` bajo el lock de mutaciones; el host local y el log de Pomodoro usan read-modify-write con precondición de revisión y los flujos automáticos se agrupan en el mismo batch. El rebase automático sobre una revisión vieja sigue siendo explícitamente rechazado.
- [x] El editor de Markdown completo conserva la revisión con la que abrió el diálogo; una fuente cambiada muestra conflicto, mantiene el texto del usuario y nunca reemplaza el contenido nuevo.

### PUB-012 — Hacer atómicas las operaciones de varios archivos

- [x] Envolver `moveTaskByState`, reordenamientos, subtareas, archivado/restauración, mutaciones del agente y sincronización de índices en un batch del host o remoto cuando existe una publicación activa; el batch usa la misma cola FIFO y ACK WebSocket, y el servidor mantiene un propietario global para no entrelazar operaciones locales ni remotas.
- [x] Usar escritura temporal + rename atómico donde corresponda: el adapter desktop crea archivos mediante temporal sincronizado y rename, y el adapter Android delega la creación indivisible al proveedor SAF; la prueba Rust verifica que el target no aparece antes del contenido.
- [x] Para operaciones multiarchivo, registrar un journal mínimo de `pending`, `committed` o `rolled-back` con `operationId` y scopes opacos; la UI local y el agente lo cierran al completar o revertir y el workspace detecta operaciones pendientes al iniciar el host. El journal conserva además un manifiesto acotado de rutas lógicas observadas, sin snapshots ni rutas absolutas. La recuperación automática queda deliberadamente bloqueada hasta una revisión explícita.
- [x] Si el rollback no puede completarse, marcar la publicación en estado de recuperación, revalidar el snapshot completo y comunicar un error accionable sin fingir éxito; el estado se limpia solo después de una operación verificada y nunca reejecuta escrituras automáticamente.
- [x] Actualizar índices y metadata derivados una sola vez por operación agrupada; los archivos intermedios no generan eventos independientes.

### PUB-013 — Pasar también las mutaciones del host por la autoridad

- [x] Adaptar `useTaskManager.runSync` para notificar al host después de la persistencia y mantener el camino local cuando no hay publicación.
- [x] Hacer que `taskManagerAgentMutationService` notifique el adaptador de publicación después de persistir; en cliente publicado la operación espera el ACK WebSocket tipado y en host el journal/coordinador conserva el resultado local.
- [x] Mantener una sola acción de dominio para mouse, teclado y touch; el transporte publicado solo traduce la mutación hacia WebSocket.
- [x] Después del acknowledgement, actualizar el cursor de la instancia host desde la revisión devuelta, sin depender de una recarga provocada por el mismo evento que ella originó; `runSync` conserva `publicationCursor` junto al snapshot persistido.

### PUB-014 — Reemplazar el `invoke` genérico remoto por operaciones seguras

- [x] El endpoint HTTP `/invoke` rechaza mutaciones con `426 WEBSOCKET_REQUIRED`; las mutaciones publicadas solo tienen como transporte operativo el WebSocket.
- [x] Definir el contrato tipado de mutaciones de Task Manager. `TaskManagerPublicationMutationRequest` valida el comando y sus argumentos en TypeScript, Rust usa una unión cerrada de DTOs y el adapter compatible solo traduce la inicialización/operaciones locales; `read_library_*` queda para lecturas.
- [x] Validar en Rust actor derivado, `operationId`, tamaño, board seleccionado, task ID/path lógico, revisión y límites antes de tocar el filesystem. Los comandos mutantes se parsean a una unión cerrada de DTOs y no se confía en `publishedBoardNames` del cliente.
- [x] Restringir creación, rename, delete y escritura a entidades/formatos de Task Manager autorizados; impedir usar el bridge genérico para crear archivos arbitrarios dentro del vault publicado. El bridge conserva solo las operaciones de Markdown, carpetas estructurales, movimientos de tareas y el log compartido de Pomodoro; rechaza Mermaid, copias, índices protegidos y raíces de tablero.
- [x] Devolver resultados tipados y seguros: `ok`, `changed`, `operationId`, `revision`, `conflict`, `retryable` y `changedPaths` publicables. El ACK filtra errores, aliases y rutas absolutas antes de llegar al navegador.
- [x] Conservar un adapter compatible para la inicialización de `TaskManagerApp` mientras cada operación se migra. La capa delega mutaciones publicadas al WebSocket tipado y no mantiene una segunda implementación de dominio.

## Servidor y sesiones concurrentes

### PUB-020 — Sustituir el límite destructivo de sesiones

- [x] Reemplazar el `clear()` al alcanzar 64 sesiones por límites explícitos: hasta `maxClients` sesiones autenticadas y WebSockets configurables entre 1 y 64, y 128 conexiones TCP.
- [x] Cuando se alcanza la capacidad, rechazar solo el nuevo login con `429 Too Many Requests` y `Retry-After`; nunca desconectar ni invalidar clientes existentes.
- [x] Separar dispositivos aprobados, sesiones autenticadas, conexiones WebSocket y conexiones TCP, con límites independientes.
- [x] Aplicar límites básicos y backoff a registro de dispositivos, login, bootstrap, stream de IA e invocaciones/mutaciones; cada frame/request tiene tamaño máximo, el cliente limita operaciones pendientes y el servidor aplica ventanas por IP y por sesión. La publicación sigue siendo un único host LAN; no pretende rate limiting distribuido entre nodos.
- [ ] Probar la capacidad con N parametrizable y degradación controlada: memoria acotada, sin crecimiento infinito de threads, colas o buffers. El probe ya permite conectar 1–64 clientes y ejecutar hasta 48 mutaciones secuenciales con métricas p50/p95/p99; la memoria/CPU/threads del host y el rechazo de N+1 deben medirse contra Windows real.

### PUB-021 — Implementar un event hub WebSocket con backpressure y cleanup

- [x] Reemplazar `Vec<mpsc::Sender<()>>` por conexiones WebSocket identificadas internamente y asociadas a dispositivo, con canal acotado; un consumidor lento se retira.
- [x] Coalescer cambios de la misma operación/revisión dentro de cada batch de sesión/host; si un cliente pierde eventos o la cola se llena, se retira el consumidor y la reconexión obtiene `resync-required` o replay acotado.
- [x] Registrar y retirar la conexión ante `close`, error de frame/escritura, timeout, revocación, stop o republicación.
- [x] Asociar cada conexión al dispositivo de la sesión para revocar únicamente sus WebSockets y cancelar el upstream del stream de IA si el cliente deja de aceptar datos.
- [x] Añadir una época nueva cuando se republica con otra selección, password o vault; los clientes de la época anterior reciben `publication-reconfigured` y vuelven al login.

### PUB-022 — Robustecer el servidor HTTP/TLS para sesiones largas

- [x] Mantener la lectura de HTTP, TLS y el handshake WebSocket dentro de una implementación con límites, timeout de handshake, validación de método/headers/content-length, `Sec-WebSocket-*` y manejo explícito de desconexión del peer.
- [x] Acotar las conexiones aceptadas a 128, además de limitar sesiones y WebSockets; un pool de hilos y la medición del costo quedan como optimización operativa.
- [x] Definir frames de texto JSON, tamaño máximo de 2 MiB, ping/pong, cola acotada y cierre terminal. El escritor de cada socket queda separado del loop de mutaciones.
- [x] Mantener cookies `Secure`, `HttpOnly`, `SameSite=Strict`, validar Origin en operaciones autenticadas y WebSocket, y aceptar redirects HTTP solo hacia localhost o direcciones IP válidas.
- [x] Revisar path containment con canonicalización Windows, separadores, junctions/symlinks, archivos archivados y ambas raíces `task-mannager`/`task-manager`; el servidor falla cerrado si no puede resolver el root físico y valida también los ancestros de rutas nuevas.

## Cliente host y clientes publicados

### PUB-030 — Crear el runtime de sincronización del cliente

- [x] Extraer la conexión WebSocket, el protocolo, la cola de resync y el retry de mutaciones a `taskManagerPublicationClient.ts`.
- [x] Abrir WebSocket después del bootstrap y enviar época/cursor en cada reconexión; revocación, stop y republicación detienen el retry.
- [x] Coalescer recargas del snapshot en `useTaskManager`, con un contador de generación que descarta resultados tardíos.
- [x] No aplicar eventos duplicados y bloquear mutaciones mientras se descarga el bootstrap de resync.
- [x] Exponer estados accesibles: conectado, sincronizando, sin conexión, conflicto, acceso revocado y publicación detenida/reconfigurada. Los estados terminales detienen el retry y muestran una acción visible para volver al login.
- [x] Enviar mutaciones con `operationId`, esperar `ack` y usar UI pesimista: el cambio no se considera confirmado antes de persistirlo.

### PUB-031 — Reducir recargas y hacer observable el tiempo real

- [x] Eliminar el refresh completo por cada `write_library_file` intermedio: se publica una revisión por request y `useTaskManager` coalesce la actualización del snapshot.
- [x] Implementar invalidación acotada por `changedPaths` y relectura de las fuentes afectadas; los hints ambiguos, ilegibles o sobredimensionados caen a snapshot completo, sin construir deltas parciales.
- [x] Usar snapshot completo como estrategia segura, con cola de última revisión, descarte de generaciones viejas y backpressure en el hub WebSocket.
- [ ] Medir en LAN latencia de cambio a render, cantidad de bytes, tiempo de lectura, recargas descartadas y memoria por cliente. Objetivo recomendado: p95 de propagación menor o igual a 1 segundo en el corpus de referencia.
- [x] Suspender socket, timers y reintentos cuando la pestaña pase a background y resincronizar al volver, respetando el ciclo de vida del WebView; la prueba física Android sigue pendiente.

### PUB-032 — Resolver conflictos desde la UI

- [x] Mostrar qué operación produjo el conflicto y el actor mediante un identificador corto derivado del dispositivo, sin rutas privadas ni contenido no autorizado.
- [x] Para edición completa, conservar la propuesta, mostrar conflicto y permitir recargar/cancelar sin reemplazar automáticamente la versión actual.
- [x] Para operaciones rechazadas por revisión, conservar el formulario del usuario para reintentar sin perderlo; el rebase automático por campo queda pendiente.
- [x] Evitar doble envío por doble toque, Enter repetido y reintento de red: diálogos deshabilitan acciones durante el submit y el transporte conserva `operationId` para deduplicar reintentos. La matriz visual completa de estados `pressed/loading/success` queda para una pasada de UI.
- [ ] Probar la misma interacción con mouse/teclado y touch; ningún cambio colaborativo esencial debe depender del drag, hover o botón derecho.

### PUB-033 — Sincronizar el alcance publicado y los permisos

- [x] Mantener el filtro de tableros en Rust y volver a comprobarlo al recibir cada operación. El navegador no puede expandir el scope cambiando bootstrap, paths o argumentos.
- [x] Si el host cambia la selección publicada, cerrar con `publication-reconfigured`, renovar bootstrap/epoch y evitar que una lista vieja siga escribiendo.
- [x] Al revocar un dispositivo, cerrar sus WebSockets y hacer que la UI vuelva al login con un mensaje/acción accionable. Los streams HTTP de IA propagan el cierre del cliente al upstream; una segunda pestaña comparte la sesión autenticada pero mantiene su propio socket.
- [x] Al detener Notia o la publicación, enviar un evento terminal a todos los WebSocket y evitar reintentos indefinidos contra una publicación inexistente.

## Pruebas

### PUB-040 — Tests puros de protocolo y concurrencia

- [x] Probar incremento monotónico de `revision`, unicidad de IDs de evento, separación por `publicationEpoch` e idempotencia por `operationId` mediante tests Rust y del cliente WebSocket.
- [x] Probar rebase permitido y conflicto por campo solapado en frontmatter, edición completa contra revisión vieja, append independiente de comentarios y reordenamiento concurrente/no-op.
- [x] Probar en TypeScript frames duplicados, cursor de secuencia, `resync-required` con reintento idempotente, cancelación antes/después del envío y tres clientes simultáneos; quedan pendientes canal lleno, `resync-required` E2E y close codes. El probe real también verifica reconexión con replay y entrega exact-once observable por `operationId`.
- [x] Proteger contra respuestas tardías de `reload` con generación, estado en vuelo y descarte de resultados obsoletos; la cobertura queda integrada en las pruebas del runtime y del cliente WebSocket.

### PUB-041 — Tests Rust de servidor

- [x] Añadir fixtures DTO para bootstrap, handshake, frames `mutate`/`cancel`/`ack`, conflictos y todos los mensajes WebSocket.
- [x] Conectar varios suscriptores autenticados a un fake event hub y verificar que todos reciben la misma revisión exactamente una vez o reciben resync si se atrasan.
- [x] Verificar que una mutación del host y una remota pasan por la misma serialización y que una falla multiarchivo no emite `changed` falso; los tests cubren la barrera host/remota, batches exclusivos y que una mutación fallida no avanza `revision` ni `sequence`.
- [x] Verificar capacidad: el login N+1 recibe 429 sin borrar las N sesiones; revocar un dispositivo cierra solo sus streams; stop/reconfigure cierra correctamente todos los streams afectados.
- [x] Mantener pruebas de autorización por ruta, path traversal, symlinks/junctions, archivos fuera de scope, tamaños máximos, rate limit y ausencia de secretos en respuestas/logs; la suite Rust las compila para Windows y su ejecución queda condicionada al loader de DLL documentado en la sección de validación.

### PUB-042 — Tests TypeScript de consumidores

- [ ] Probar `useTaskManager` host + publicado con adapters fake: una mutación host llega a todos los clientes y una mutación de cualquier cliente llega al host y a los demás.
- [ ] Cubrir create/edit/delete, estado, prioridad, horas, comentario, subtarea, movimiento, archivado/restauración, edición Markdown, grupos compartidos y Pomodoro compartido.
- [ ] Cubrir eventos duplicados, eventos fuera de orden, varias mutaciones en un lote, pérdida de conexión, eventos perdidos, bootstrap de resync, revocación y publicación detenida.
- [ ] Cubrir las mutaciones del `taskManagerAgentMutationService` desde host y navegador, asegurando que ambas notifican mediante el coordinador común.
- [x] Mantener la prueba existente de que el chat publicado usa `notiaChatRuntime` y no exponerle herramientas, memoria, rutas o credenciales fuera del scope.

### PUB-043 — E2E multiusuario

- [ ] Crear un vault temporal, levantar el servidor de publicación y conectar un host y al menos tres clientes autenticados con actores distintos.
- [ ] Verificar la matriz completa de operaciones con una aserción observable: todos los clientes convergen a la misma revisión y contenido final.
- [ ] Ejecutar operaciones simultáneas sobre tareas distintas y sobre la misma tarea. Confirmar que no hay pérdida silenciosa y que los conflictos son recuperables.
- [ ] Cortar/reanudar la conexión WebSocket de un cliente durante una mutación y verificar idempotencia, recuperación por cursor de secuencia o resync.
- [ ] Ejecutar prueba de carga con N clientes, registrar p50/p95/p99 de propagación, CPU, memoria, threads, bytes por evento y tasa de resync. El comando reproducible es `npm run test:publication:e2e -- --status --clients N --file ALIAS --append-comment TEXTO --load-mutations 48`; `--status` aporta métricas agregadas del servidor y CPU/memoria/threads del host todavía requieren observación adicional en Windows.
- [ ] Repetir el flujo en Chromium con ventanas estrechas, touch/pointer events, orientación y teclado virtual cuando el cliente se ejecute en Android; si no hay dispositivo físico, dejar esa validación explícitamente pendiente.

## Seguridad, observabilidad y documentación

### PUB-050 — Seguridad de colaboración

- [x] Mantener la contraseña solo como hash en el host y nunca enviarla en bootstrap, evento, acknowledgement, URL, Redux o logs.
- [x] Usar tokens de sesión y operación opacos; `deviceName` y cualquier identificador enviado por el navegador nunca autorizan por sí mismos. `actorId` se deriva en Rust como hash corto del dispositivo; `changedPaths` no contiene rutas absolutas.
- [x] Limitar/sanitizar nombres de dispositivo, mensajes y aliases de ruta; el contenido de tareas se trata como dato no confiable.
- [x] Limitar cada frame WebSocket a 2 MiB, la cola de eventos a 64, la memoria de historial a 256 cambios y las ventanas de rate limit por IP/sesión.
- [x] Mantener certificado autofirmado versionado, cookies Secure/HttpOnly/SameSite y validación de Origin; firewall y prueba de confianza en dispositivos quedan pendientes.

### PUB-051 — Observabilidad segura

- [x] Registrar contadores estructurados y redactados de conexiones/sesiones, frames enviados/recibidos, eventos descartados, revisiones, resyncs, conflictos, mutaciones aplicadas y cancelaciones de streams de IA; se exponen en el estado del host sin payloads sensibles.
- [x] Completar métricas de latencia, bytes, errores y cancelaciones, con persistencia/telemetría operativa. El estado del host expone bytes de WebSocket, errores de mutación, cancelaciones de streams de IA, marca de tiempo del último cambio y latencia de mutaciones con p95 aproximado; se persisten hasta 128 muestras agregadas sin contenido sensible. Falta únicamente la latencia extremo a extremo de la prueba LAN.
- [x] Correlacionar estado y diagnósticos con `publicationEpoch`, `operationId` y `actorId` corto; el runtime conserva solo los últimos identificadores sanitizados y nunca registra password, API key, contenido completo, prompt ni ruta absoluta.
- [x] Añadir un indicador en la UI del host para publicación activa, conexiones WebSocket, sesiones autenticadas, última revisión/cursor confirmado y momento del último cambio.
- [x] Definir alertas o mensajes accionables para publicación saturada, filesystem lento, cliente desconectado y recuperación incompleta; Configuraciones muestra capacidad/latencia/recuperación y la barra de la URL muestra estados offline/terminales.

### PUB-052 — Actualizar documentación

- [x] Actualizar `README.md` para describir colaboración multiusuario, capacidad, reconexión, conflictos y límites de publicación.
- [x] Actualizar `README-TECH.md` con el protocolo, fuente de verdad, flujo host/remoto, metadata compartida y política de revisiones.
- [x] Actualizar `AGENTS-DOC.md` con la nueva frontera WebSocket y la prohibición de volver a SSE para colaboración.
- [x] Documentar comandos de desarrollo, fixtures, prueba E2E, medición de latencia y validaciones Windows/Android en `README-TECH.md`; la ejecución física queda pendiente y se reporta abajo.

El probe reproducible quedó disponible como `npm run test:publication:e2e` y requiere Node 24+; admite N clientes, mutación real, conflicto concurrente, reconexión con replay, convergencia, bytes, resyncs y percentiles de propagación del evento WebSocket. Como la API WebSocket nativa de Node no permite fijar la cookie de sesión, el probe implementa su handshake RFC 6455 sobre `net`/`tls` y envía explícitamente `Cookie` y `Origin`, sin agregar una dependencia al runtime de Notia. Con `--status` consulta las métricas agregadas autenticadas del host antes y después de la prueba. No reemplaza la medición de render en navegador ni la prueba física LAN.

## Orden recomendado de implementación

```text
PUB-001 / PUB-002 / PUB-003
          |
          v
PUB-010 / PUB-011 / PUB-012
          |
          +--> PUB-013 / PUB-014
          |
          +--> PUB-020 / PUB-021 / PUB-022
                          |
                          v
                 PUB-030 / PUB-031 / PUB-032 / PUB-033
                          |
                          v
                 PUB-040 / PUB-041 / PUB-042 / PUB-043
                          |
                          v
                 PUB-050 / PUB-051 / PUB-052
```

## Criterios de aceptación finales

- [ ] Host + N clientes autorizados pueden permanecer conectados simultáneamente durante toda una sesión sin expulsiones masivas ni crecimiento no acotado de memoria/threads.
- [ ] Una mutación confirmada desde Notia aparece en todos los navegadores autorizados y una mutación confirmada desde cualquier navegador aparece en Notia y en todos los demás navegadores dentro del objetivo de latencia medido.
- [ ] Todos los clientes convergen al mismo snapshot y `revision`; un evento duplicado, atrasado o perdido no permite aplicar estado viejo.
- [ ] Dos personas que editan simultáneamente no pierden cambios en silencio: la operación se combina con una regla documentada o termina en un conflicto recuperable.
- [ ] Comentarios, subtareas, movimientos, archivado, edición completa, grupos y operaciones IA siguen la misma autoridad y política de eventos que las acciones básicas.
- [ ] Reconectar después de una caída recupera eventos pendientes mediante cursor WebSocket o descarga un snapshot completo; no exige refrescar manualmente ni repite una mutación ya aplicada.
- [ ] Revocar un dispositivo cierra sus streams activos y no interrumpe a otros; detener o reconfigurar la publicación deja a todos en un estado terminal claro.
- [ ] La autorización sigue limitada a los tableros publicados y no filtra rutas locales, secretos, memoria global ni contenido no autorizado.
- [ ] La suite unitaria, integración, E2E y carga cubre los casos anteriores; la validación física Windows/Android y el firewall quedan reportados por separado si el entorno no los permite.

## Validación de entrega

Ejecutar desde la raíz:

```bash
npm run lint
npm test
npm run build
```

Para Rust:

```bash
cd src-tauri
cargo fmt --all -- --check
cargo check --all-targets
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
```

Para la publicación en Windows, agregar una prueba manual con firewall de red privada, certificado aceptado, host, N clientes, reconexión y revocación. Si se modifica la experiencia publicada para Android/WebView, ejecutar además `npm run build:android:debug` y validar en tableta física orientación, touch, teclado virtual, background/foreground y rendimiento.

## Corrección de sincronización consecutiva (2026-09-10)

- [x] Evitar que un render urgente restaure el snapshot anterior mientras React tiene una transición pendiente.
- [x] Reconciliar por snapshot completo los eventos de publicación en escritorio y navegador, sin descartar eventos del watcher mediante una ventana temporal arbitraria.
- [x] Unificar lectura acotada y envío en el propietario de cada WebSocket: el lector ya no compite con un hilo de envío por el mismo mutex.
- [x] Interpretar correctamente el resultado remoto de begin/end (`{ok, changed}`); el cursor corresponde al ACK, no a ese resultado.
- [x] Acumular notificaciones del watcher durante un batch remoto para no avanzar la revisión entre sus escrituras.
- [x] Pruebas TypeScript de batches consecutivos, reconexión/reanudación, orden mínimo, preservación ante error de lectura, drenaje continuo y liberación después de fallo parcial; suite completa: 103 archivos, 527 pruebas. Lint, `tsc -b`, `npm run build`, `cargo fmt --all -- --check` y `cargo check --all-targets` aprobados.
- [!] Clippy con `-D warnings` sigue bloqueado por advertencias y lints fuera de esta corrección (módulos mobile, Bluetooth, voz y otros).
- [ ] Ejecutar la nueva prueba Rust `idle_websocket_receives_consecutive_host_and_remote_batch_changes`: compila, pero el loader Windows falla con `STATUS_ENTRYPOINT_NOT_FOUND`. Cubre 12 notificaciones alternadas de host y batches remotos sobre un socket TCP real sin mensajes del cliente que despierten al lector.
- [ ] Confirmar en escritorio + al menos dos navegadores movimientos y ediciones alternados repetidamente, sin recargar, junto con convergencia visual y ausencia de una tormenta de requests. Pendiente también la validación física Android; las pruebas unitarias no certifican este escenario.

## Resultado de validación de la iteración anterior

- [x] `npm run lint`.
- [x] `npm test -- --run --maxWorkers=1 --no-file-parallelism`: 100 archivos y 508 pruebas.
- [x] `npm run build`.
- [x] `cargo fmt --all -- --check`.
- [x] `cargo check --all-targets` y `cargo check --target x86_64-pc-windows-msvc --all-targets`.
- [x] `cargo test --all-targets --no-run`: los binarios de tests compilan.
- [x] `node --check scripts/task-manager-publication-e2e.mjs` y `npm run test:publication:e2e -- --help`; el probe usa un cliente RFC 6455 sobre `net`/`tls` para enviar cookie y Origin desde Node.
- [x] `git diff --check`.
- [x] Tests focalizados del cliente WebSocket y runtime de publicación; incluyen tres clientes simultáneos, convergencia de revisiones, cursor, backoff, handshake estancado, reconexión con el mismo `operationId`, cierre con resultado `unknown`, background, gaps de secuencia, conflictos, aliases seguros, preservación del `operationId` cuando el ACK llega antes del evento, preservación de settings compartidos en esa misma carrera y el orden de reconciliación de un lote local parcial antes de liberar la barrera. También hay tests de rebase de frontmatter, comentarios concurrentes, orden seguro, journal de recuperación y telemetría persistida acotada. Rust prueba batches host, DTOs tipados, containment físico, creación atómica, cursores, fan-out exacto, backpressure, capacidad WebSocket, revocación selectiva, resync, eventos terminales, rate limit, rechazo de payloads sobredimensionados, mutaciones fallidas sin avance de cursor y propagación de cancelación del callback de IA.
- [!] `cargo test --all-targets` compila, pero el ejecutable no inicia en este entorno por `STATUS_ENTRYPOINT_NOT_FOUND` del loader de DLL.
- [!] `cargo clippy --all-targets --all-features -- -D warnings` queda bloqueado por advertencias preexistentes no relacionadas en Android, voz, backup y otros módulos; se reporta sin modificar ese alcance.
- [!] `npm run build:android:debug` compila Rust para `aarch64-linux-android`, pero no llega a empaquetar el APK porque Windows deniega el symlink de `libnotia_lib.so` hacia `gen/android/app/src/main/jniLibs/arm64-v8a`; requiere habilitar Developer Mode o el privilegio `SeCreateSymbolicLinkPrivilege`. No hay dispositivos ADB conectados, por lo que la validación táctil/física continúa pendiente.
- [ ] Prueba E2E multiusuario, carga LAN, firewall, Windows físico y validación táctil Android.
