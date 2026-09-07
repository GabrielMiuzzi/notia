# Notia IA — plan de implementación

Este backlog convierte [`AI.md`](AI.md) y [`AI-mejoras.md`](AI-mejoras.md) en tareas de implementación.

## Objetivo

Construir un agente contextual que entienda la vista actual, consulte únicamente la evidencia necesaria, pida aclaraciones ante ambigüedad, proponga cambios mediante diff, aplique operaciones seguras y verifique el resultado. La experiencia objetivo es la de un agente de código tipo OpenCode, adaptado a documentos, tareas, reuniones y finanzas.

## Reglas no negociables

- Toda conversación pasa por `src/services/chat/notiaChatRuntime.ts` y `runNativeToolAgent`.
- Desktop accede a Ollama únicamente mediante comandos/eventos Tauri. La excepción del cliente publicado es su servidor HTTP autorizado, no un acceso directo a Ollama.
- Android debe usar un bridge nativo versionado para health, modelos, tools y streaming.
- Una búsqueda web nunca puede enviar API keys, tokens, contraseñas, datos personales, memoria, reglas, rutas, IDs, contenido de documentos o información financiera del usuario.
- Las ediciones se basan en patch/anchor y revisión, nunca en reemplazar silenciosamente un documento completo.
- Aclaración y confirmación son estados diferentes: aclarar define la operación; confirmar autoriza la mutación.
- El contenido de documentos, adjuntos y resultados web es dato no confiable; nunca puede autorizar una tool ni cambiar el scope.
- No agregar un shell genérico ni ejecución arbitraria de código como tool por defecto.
- Preservar los cambios locales preexistentes del repositorio y mantener el parche de cada fase enfocado.

## Estados del backlog

- `[ ]` pendiente.
- `[x]` existente/verificado en la auditoría.
- `[~]` iniciado o parcialmente disponible; requiere completar el contrato.
- `[!]` bloqueado por una dependencia externa o validación de plataforma.

## Dependencias generales

```text
P0 Contratos y decisiones
        |
        +--> P1 Transporte nativo y Android
        +--> P2 Memoria y políticas de persistencia
        +--> P3 Snapshot/contexto
                  |
                  +--> P4 Patch, diff, apply y undo
                              |
                              +--> P5 Aclaraciones y planes reanudables
                                          |
                                          +--> P6 Tools y capacidades avanzadas
                                                      |
                                                      +--> P7 UX natural, web search y hardening
```

## Estado inicial verificado

- [x] Existe la fachada común `notiaChatRuntime.ts`.
- [x] Chat principal, Meeting, Telegram y Task Manager publicado la consumen.
- [x] Existe `createChatScopedAgent` con scopes de documentos, Graph, Task Manager, Finance y publicación.
- [x] Existen tools de lectura/búsqueda, aclaración, selección Markdown, inserción y reemplazo de bloques.
- [x] Existe `blockReplacementEngine` con resolución de bloques y detección de targets ambiguos.
- [x] Existe `set_agent_execution_plan` como planificador general con compatibilidad para `set_task_execution_plan`; el runtime aplica la aprobación, las dependencias y la barrera de mutaciones por scope.
- [x] Existe un stream desktop nativo para la respuesta final y un servicio Rust de Ollama.
- [x] Existen pruebas de parser, continuación del agente, scopes, fachada común y publicación.
- [x] La confirmación visual, el preview/apply basado en revisión y el undo de operaciones están conectados al runtime común; los hunks aplicables pueden seleccionarse individualmente.
- [x] La aclaración tiene UI y choices, se persiste con contexto mínimo y puede reanudarse después de reabrir el panel cuando la revisión sigue vigente.
- [x] El contexto activo y la selección llegan mediante un `WorkspaceAiSnapshot` con revisión, estado dirty y capabilities; las superficies efímeras construyen su snapshot sin persistirlo.
- [~] El catálogo financiero y de Task Manager es amplio, pero no existe un contrato uniforme de resultados para todas las tools.

## Vertical slice prioritario

Este flujo debe quedar funcionando antes de ampliar el catálogo:

> En un documento Markdown, el usuario selecciona un bloque y dice: “Mejorame esta parte para que sea más clara y agregá un ejemplo”.

Resultado esperado:

1. Capturar documento, selección y revisión actual.
2. Clasificar la intención como edición.
3. Leer la evidencia necesaria.
4. Generar preview con diff y explicación.
5. Mostrar `Aplicar`, `Rechazar`, `Editar propuesta` y `Cancelar`.
6. Aplicar solo los hunks aceptados.
7. Detectar conflicto si el editor cambió.
8. Releer, sincronizar editor/índice y ofrecer undo.

## P0 — Contratos y decisiones de arquitectura

### P0.1 Contratos comunes

- [x] `AI-001` Definir `WorkspaceAiSnapshot` con vista activa, documento, tipo, ruta, revisión, estado dirty, selección, pestañas, scope y capabilities. Dependencias: ninguna. Objetivo: `src/types/ai/` o límite equivalente.
- [x] `AI-002` Definir `AgentTurnState` como unión discriminada: `idle`, `observing`, `clarification_required`, `planning`, `preview_ready`, `awaiting_confirmation`, `applying`, `verifying`, `completed`, `cancelled`, `failed`.
- [x] `AI-003` Definir `ClarificationRequest` reanudable con ID, campo, motivo, choices, texto libre, operación pendiente y expiración.
- [x] `AI-004` Definir `MutationPreview` con operationId, documentos, revisión, hunks, resumen, supuestos, riesgos y acciones permitidas.
- [x] `AI-005` Definir `ToolResult<T>` común con `ok`, `changed`, `data`, revisión, preview, códigos estructurados, conflicto, cancelación y retryable.
- [x] `AI-006` Definir `AgentPlanStep` con dependencias, estado, tool prevista, riesgo, resultado y posibilidad de reintento.
- [x] `AI-007` Definir `WebSearchRequest`, `WebSearchResult` y contrato de sanitización sin incluir campos de contexto privado.
- [x] `AI-008` Revisar que los contratos TypeScript y DTOs Rust usen nombres estables, camelCase donde corresponda y `unknown` validado en los límites. La frontera TypeScript/Rust usa DTOs camelCase, validación en los adapters y fixtures Rust para desktop/Android; los comandos nativos no reciben `unknown` sin reducción en sus límites.

### P0.2 Decisiones que deben quedar documentadas

- [x] `AI-009` Elegir `.agent/memory/memory.md` como única fuente de memoria o definir una migración distinta; no mantener dos fuentes activas.
- [x] `AI-010` Definir si el toggle de memoria es por chat, biblioteca o sesión y cómo afecta lectura, extracción, escritura y reorganización.
- [x] `AI-011` Definir Meeting efímero como `ephemeral-no-memory` por defecto: no cargar ni persistir memoria global.
- [x] `AI-012` Definir la política de autoaplicación de ediciones de bajo riesgo y excluir siempre borrado, finanzas, multiarchivo y operaciones masivas. La preferencia es opt-in por biblioteca y solo acepta previews `low`.
- [x] `AI-013` Definir si la confirmación de una edición permite todos los hunks o hunks individuales. El usuario puede aplicar todo o seleccionar hunks cuando el contrato lo permite; las mutaciones indivisibles conservan confirmación completa.
- [x] `AI-014` Definir política de historial en Telegram y Task Manager publicado, incluyendo reanudación de aclaraciones. Telegram conserva historial acotado y requests interrumpidas; el publicado es efímero y Meeting no usa memoria global.
- [x] `AI-015` Definir el contrato oficial de Ollama Web Search, credencial, límites y endpoint detrás de un adapter; no acoplar el dominio a una respuesta externa.
- [x] `AI-016` Crear una nota técnica con las decisiones y actualizar `README-TECH.md` al finalizar cada fase contractual.

### P0.3 Regla de prioridad de intención

- [x] `AI-017` Definir clasificación de intención: responder, explicar, buscar, leer, proponer edición, aplicar edición, crear, organizar, ejecutar, aclarar y cancelar.
- [x] `AI-018` Definir umbrales para resolver implícitamente el documento activo y para exigir aclaración.
- [x] `AI-019` Prohibir que la clasificación de intención pueda ejecutar una mutación; solo selecciona el flujo siguiente.
- [x] `AI-020` Agregar tests puros para solicitudes inequívocas, ambiguas y contradictorias.

## P1 — Transporte nativo y correcciones de plataforma

### P1.1 Desktop sin acceso directo desde WebView

- [x] `AI-021` Mover listado de modelos `/api/tags` a un comando Tauri tipado.
- [x] `AI-022` Mover detección de visión `/api/show` a un comando Tauri tipado.
- [x] `AI-023` Mover health check y resolución de modelo por defecto al servicio Rust.
- [x] `AI-024` Eliminar de `aiRuntime.ts` los fetch directos y fallbacks frontend a Ollama.
- [x] `AI-025` Mantener `run_desktop_ai_tool_chat` como transporte de cada ronda del agente y `run_desktop_ai_chat_streaming` como transporte final cuando corresponda.
- [x] `AI-026` Validar URL, esquema, credenciales, timeout, tamaño de respuesta y errores en `commands/ai.rs`/`ai_service.rs`.
- [x] `AI-027` Crear fake adapter de transporte para probar que las rutas desktop no llaman `fetch` a Ollama. El test de continuación usa `invoke` como adapter fake y verifica que el fetch global no se invoque.
- [~] `AI-028` Verificar que API keys no aparezcan en logs, eventos, Redux, URLs, diagnósticos ni errores de usuario. La configuración portable redacciona la key y ahora Redux/localStorage también conservan solo preferencias sin credencial; el valor vive únicamente en memoria de sesión hasta llegar al adapter nativo. Falta un almacén nativo seguro persistente entre reinicios y completar el barrido automatizado de errores.

### P1.2 Android bridge completo

- [x] `AI-029` Incorporar y versionar `AiBridgePlugin.kt` o reemplazarlo por el adapter Android aprobado.
- [x] `AI-030` Documentar y testear el registro del plugin desde `mobile_ai_bridge.rs`.
- [x] `AI-031` Definir DTO Android para health, lista de modelos, chat completo, tool chat y eventos streaming.
- [~] `AI-032` Implementar `Delta`, `Thinking`, `Done` y `Error` reales en `chatStreaming`. El plugin ahora consume NDJSON de Ollama y emite eventos `stream` con deltas/thinking/done/error; queda validar Gradle y permisos de eventos en Android.
- [x] `AI-033` Implementar un comando Android nativo para las rondas del agente con tools, sin `fetch` desde `runNativeToolAgent`.
- [~] `AI-034` Igualar cancelación, timeout, backpressure y cierre de listeners con desktop. La cancelación ahora invoca `cancelStreaming`, desconecta la conexión HTTP nativa y el timeout existente aborta el runtime; queda validar backpressure y la ruta en un dispositivo.
- [x] `AI-035` Corregir el cleanup del listener `abort` y la carrera entre `listen` y finalización en `invokeAndroidAiChatStreaming`. El cleanup retira el listener abort, desregistra listeners nativos y cubre la finalización antes de resolver `listen`.
- [x] `AI-036` Añadir pruebas de contrato Android con plugin fake: health, modelo, delta, thinking, done, error, cancelación y timeout. El fake ejecutable cubre el contrato en Vitest; la validación Gradle/dispositivo permanece en las tareas de plataforma.
- [!] `AI-037` Ejecutar `npm run build:android:debug` y resolver bloqueos de empaquetado del entorno. El build llega a Cargo Android y queda bloqueado por symlinks de Windows sin Developer Mode.
- [!] `AI-038` Probar en tableta Android física: inicio, cancelación, background/foreground, orientación y teclado virtual. No hay dispositivo físico disponible en este entorno.

### P1.3 Publicación

- [x] `AI-039` Mantener el servidor publicado como adapter separado y no mezclarlo con el transporte directo de Ollama.
- [x] `AI-040` Verificar que bootstrap nunca entregue URL real, API key, memoria, prompt privado ni rutas fuera del scope publicado.
- [x] `AI-041` Añadir prueba de autorización por ruta para cada tool de documento y Task Manager.
- [x] `AI-042` Cubrir stream publicado, reconexión, cancelación y cierre del navegador. La suite cubre NDJSON, reconexión única antes del primer evento, cancelación y liberación del reader; el cierre real del navegador queda validado por el cleanup del adapter.

## P2 — Memoria y políticas de persistencia

### P2.1 Consolidación de memoria

- [x] `AI-043` Migrar memorias útiles de `.notia/chat/LongTermMemory.md` a `.agent/memory/memory.md` con versión, backup y recuperación. La migración es idempotente, conserva `LongTermMemory.legacy.v1.backup.md` y expone recuperación explícita.
- [x] `AI-044` Definir lectura tolerante de la versión migrada y registrar solo métricas seguras de migración. El lector tolera encabezados/comentarios y la migración no registra contenido ni rutas privadas.
- [x] `AI-045` Retirar o marcar como legacy `loadLongTermMemories`, `appendLongTermMemories` y `clearLongTermMemories` sobre `LongTermMemory.md`. Las funciones quedan como wrappers deprecated hacia `.agent/memory/memory.md`.
- [x] `AI-046` Hacer que `createChatScopedAgent` reciba una política explícita de lectura de memoria.
- [x] `AI-047` Hacer que la extracción y reorganización respeten la misma política de persistencia.
- [x] `AI-048` Cambiar la UI de “Borrar memoria” para borrar la fuente realmente cargada por el agente.
- [x] `AI-049` Definir límites de memoria cargada, escrita y reorganizada con pruebas de truncamiento y deduplicación.
- [x] `AI-050` Añadir tests: toggle desactivado no carga ni persiste memoria; toggle activado carga y persiste; borrar vacía la fuente efectiva.

### P2.2 Superficies efímeras

- [x] `AI-051` Implementar `persistencePolicy` en `createChatScopedAgent`/`runNotiaChatReply`.
- [x] `AI-052` Configurar Meeting como `ephemeral-no-memory` por defecto.
- [x] `AI-053` Decidir y documentar si Meeting puede ejecutar mutaciones de biblioteca; si sí, mostrarlas como operaciones persistentes separadas.
- [x] `AI-054` Evitar que un chat publicado lea/escriba memoria global.
- [x] `AI-055` Hacer explícito el comportamiento de Telegram: historial acotado, memoria global configurable y mutaciones financieras con su política propia.
- [x] `AI-056` Cubrir unmount, background y reanudación sin escribir después de cerrar una superficie efímera. Chat, Meeting y Telegram cancelan/interrumpen streams al desmontar o pasar a background; `useChatSubmitMessage.test.ts` verifica que una respuesta tardía no persiste mensajes, título ni memoria después del desmontaje.

## P3 — Snapshot y contexto del workspace

- [x] `AI-057` Crear un servicio/adaptador que construya `WorkspaceAiSnapshot` desde `useRightPanelChatContext`, `MarkdownView`, Task Manager, Meeting y Finance. `useWorkspaceAiSnapshot` cubre el chat principal/panel lateral y scopes de documentos, biblioteca, Task Manager y Finance; Meeting construye un snapshot efímero explícito.
- [x] `AI-058` Capturar la fuente actual del editor, incluyendo cambios dirty no guardados.
- [x] `AI-059` Generar una revisión/hash estable del buffer usado para la propuesta.
- [x] `AI-060` Incluir tipo de vista, ruta normalizada, documento activo, selección, cursor, tabs, scope y capabilities. El cursor todavía se representa mediante la selección/rango disponible.
- [x] `AI-061` Invalidar snapshot cuando cambie documento activo, selección, contenido, scope, biblioteca o permiso. El hook reconstruye el snapshot a partir de esas dependencias; el permiso dinámico queda limitado por el scope actual.
- [x] `AI-062` No incluir el árbol completo ni documentos no autorizados en el prompt inicial.
- [x] `AI-063` Crear `get_workspace_context` y `get_active_document_outline`. El runtime comun expone contexto estructural sin contenido no autorizado y un outline acotado del Markdown activo.
- [x] `AI-064` Crear `read_active_document_range` para heading, bloque, rango o ventana cercana al cursor, con limites y error de ambiguedad.
- [x] `AI-065` Mejorar `search_library_documents` con título, nombre, ruta, tags, frontmatter y tipo. Puntúa esos metadatos sin devolver cuerpo, limita la lectura de metadata y cubre filtros de tags/tipo con corpus aislado.
- [x] `AI-066` Mejorar `search_library_context` para devolver citas, rutas, rangos y score. Cada fragmento ahora incluye línea inicial/final y offsets de caracteres además de ruta y score.
- [x] `AI-067` Crear `search_library_exact`, `find_document_references` y `get_document_metadata`.
- [x] `AI-068` Añadir límites de tamaño, cantidad de archivos, chunks y duplicación de contexto. El runtime publica `AI_CONTEXT_BUDGET` y todos sus límites principales (memoria, contexto, archivos y metadata) se consumen desde ese contrato común; la calibración final por hardware queda en `AI-182`.
- [x] `AI-069` Añadir pruebas de contexto: documento activo dirty, selección vacía, varios candidatos, cambio de vista y archivo no autorizado. El fixture del runtime cubre dirty, selección, tabs metadata-only y autorización; los engines cubren outline, rango, cursor y ambigüedad.

## P4 — Pipeline de edición, diff, aplicación y undo

### P4.1 Motor de patch

- [x] `AI-070` Diseñar `MutationPreview` para uno o varios documentos y hunks.
- [x] `AI-071` Extender `blockReplacementEngine` para devolver anchors estables, rangos, texto original y texto nuevo. El preview devuelve rango, anchor y texto original/nuevo.
- [x] `AI-072` Implementar `propose_document_edit` sin efectos de escritura.
- [x] `AI-073` Implementar `apply_document_edit` contra revisión exacta.
- [x] `AI-074` Implementar `apply_document_patch` multi-hunk con abort transaccional si falla un anchor.
- [x] `AI-075` Mantener aliases compatibles para `replace_active_markdown_document` e `insert_active_markdown_document`.
- [x] `AI-076` Implementar `replace_document_selection`, `replace_document_block`, `delete_document_block` y `move_document_block`.
- [x] `AI-077` Implementar `update_document_frontmatter` sin reconstruir el cuerpo Markdown.
- [x] `AI-078` Implementar `create_document_from_template` con validación de ruta relativa.
- [x] `AI-079` Implementar `rename_document_and_update_links` con preview de referencias afectadas.
- [x] `AI-080` Implementar `apply_multi_document_patch` con journal de operación.

### P4.2 Seguridad de escritura

- [x] `AI-081` Rechazar patch si documento, selección o revisión cambió desde el preview. El preview y el apply comparan la revisión del buffer antes de escribir.
- [x] `AI-082` Preservar frontmatter, fórmulas, Mermaid, links, tablas, bloques no afectados y encoding. El motor preserva frontmatter y bloques no afectados, valida delimitadores y tiene regresión combinada sobre una edición dentro del cuerpo.
- [~] `AI-083` Usar escritura atómica en desktop y adapter equivalente en Android/SAF. Desktop usa temporal + rename atómico; el adapter Android/SAF mantiene la frontera nativa y queda pendiente su verificación en dispositivo.
- [x] `AI-084` Sincronizar `MarkdownView`, buffer dirty, pestaña activa, archivo en disco e índice después de escribir.
- [x] `AI-085` Evitar que una respuesta tardía escriba sobre otra operación o documento activo.
- [x] `AI-086` Implementar `undo_ai_operation` y `restore_document_revision` con comprobación de cambios posteriores. El primer corte ofrece undo por `operationId` con journal local en memoria.
- [x] `AI-087` Mostrar error estructurado de conflicto con revisión esperada/actual, sin reemplazo automático.
- [x] `AI-088` Hacer idempotentes las operaciones mediante `operationId` y journal para previews y ediciones Markdown activas.

### P4.3 Validación del contenido

- [x] `AI-089` Implementar `validate_markdown_document` con validación de frontmatter, fences, fórmulas y enlaces estructuralmente desbalanceados.
- [x] `AI-090` Implementar `validate_document_edit` para headings, links, fórmulas, tablas y formato solicitado. La validación cubre preservación de frontmatter, delimitadores, saltos semánticos de headings, enlaces y consistencia de tablas.
- [x] `AI-091` Implementar `verify_operation` y `reindex_changed_documents` fuera del hilo de UI. `verify_operation` comprueba revisión/Markdown y `reindex_changed_documents` invalida y programa la actualización del índice autorizado.
- [x] `AI-092` Definir comportamiento cuando el contenido nuevo agrega información no presente en la fuente.

## P5 — Aclaraciones, confirmaciones y planes

### P5.1 Aclaración reanudable

- [~] `AI-093` Separar el resolver en memoria de la operación persistible `ClarificationRequest`. El metadata persistible ya está separado; la rehidratación del resolver vivo requiere una operación durable.
- [x] `AI-094` Guardar operación pendiente, contexto mínimo no sensible, scope, target y revisión.
- [x] `AI-095` Reanudar por choice, texto libre, “todos”, “ninguno” o cancelación.
- [x] `AI-096` Invalidar la aclaración si cambió la revisión, documento, permisos o scope.
- [x] `AI-097` Mostrar el motivo de la pregunta y alternativas concretas con fragmentos/rutas seguros.
- [x] `AI-098` Evitar preguntas redundantes cuando el snapshot resuelve una única opción.
- [~] `AI-099` Cubrir reanudación tras cerrar/reabrir panel, background Android, Telegram retry y refresh publicado. Telegram ahora aborta el runtime al desmontar/cambiar de canal, persiste únicamente el sobre de recuperación y solo reencola mediante `/reanudar`; los adjuntos pueden reconstruirse, mientras que una solicitud de texto que cruzó un reinicio exige reenviarse porque su prompt no se persiste; quedan background Android, retry automático seguro y refresh publicado.

### P5.2 Confirmación y riesgo

- [x] `AI-100` Implementar niveles bajo/medio/alto/crítico en el preview. El riesgo crítico activa confirmación reforzada y se conserva en el plan y el preview.
- [x] `AI-101` No pedir confirmación textual adicional si la tool ya mostró confirmación visual.
- [x] `AI-102` Permitir aceptar/rechazar por hunk y por lote cuando la operación lo soporte. El runtime y el panel muestran hunks de `apply_document_edit`/`apply_document_patch`, permiten seleccionar y aplican solo los elegidos; las mutaciones indivisibles requieren selección completa.
- [x] `AI-103` Exigir confirmación reforzada para borrar, renombrar con links, multiarchivo, masivo y finanzas. El runtime exige una segunda aceptación explícita para borrados, renombrados críticos, vínculos/mutaciones multiarchivo, lotes de Task Manager y todas las mutaciones financieras, también desde Telegram. Las confirmaciones financieras ocurren antes de persistir para no dejar movimientos pendientes al rechazar.
- [x] `AI-104` Añadir preferencia de autoaplicar solo para bajo riesgo, por biblioteca y revocable.

### P5.3 TO-DO general y ejecución multi-step

- [~] `AI-105` Separar `AgentPlan` general de `TaskExecutionStep`; el plan general ya tiene contrato/engine y el runtime conserva compatibilidad con Task Manager; falta llevar todos los scopes a la persistencia general.
- [x] `AI-105.1` Crear `create_agent_plan`/`update_agent_plan` o extender `set_task_execution_plan` para que esté disponible en todos los scopes autorizados, con filtrado explícito para Finance y `publishedScope`. El catálogo común expone `create_agent_plan`/`update_agent_plan`, los filtra fuera de Finance y `publishedScope`, y los ejecuta mediante el mismo contrato persistible de `AgentPlan`/`TaskExecutionStep`.
- [x] `AI-105.2` Detectar automáticamente complejidad: dos o más mutaciones, varios archivos, investigación web + escritura, extracción + creación de tareas, renombrado + actualización de links o cualquier flujo con dependencias.
- [x] `AI-105.3` No crear TO-DO para una acción simple e inequívoca; crear y mostrarlo automáticamente cuando la tarea sea compuesta, sin exigir que el usuario conozca el nombre de la tool.
- [x] `AI-105.4` Modelar cada paso con ID, objetivo, dependencias, archivos/entidades, tool prevista, riesgo, precondiciones y resultado esperado.
- [x] `AI-105.5` Mostrar el TO-DO como estado visible del chat antes de la primera mutación, con pasos `pending`, `in_progress`, `completed`, `blocked`, `failed`, `skipped` y `cancelled`. Chat, Meeting y Telegram muestran estados seguros; el editor permite revisar los pasos antes de aprobar.
- [x] `AI-105.6` Hacer que el runtime ejecute automáticamente el siguiente paso pendiente después de un resultado exitoso; crear el plan no puede ser el final de la respuesta. La continuación del runtime retoma las tools y cada mutación debe declarar el siguiente `planStepId`.
- [~] `AI-105.7` Marcar un paso como completado únicamente desde el resultado real de su tool y verificación, nunca por una afirmación del modelo. Las mutaciones dependen del resultado real y ya existe `verify_operation`; falta exigir verificación uniforme a todos los catálogos.
- [x] `AI-105.8` Pasar `planStepId` y `operationId` a cada mutación, incluyendo documentos, links, frontmatter, web-to-note y Task Manager. El catálogo común añade ambos campos a todas las tools planificables y el runtime garantiza una correlación opaca en cada resultado, incluso cuando la implementación concreta no la genera.
- [~] `AI-105.9` Pausar el plan únicamente por aclaración, confirmación, permiso, conflicto, error o cancelación; al resolverlo debe continuar desde el paso pendiente, no reiniciar todo. La reanudación explícita ahora reabre solo el primer paso bloqueado y sus dependientes bloqueados, limpia sus operationId y conserva los pasos completados; falta cobertura equivalente en Telegram/background.
- [x] `AI-105.10` Permitir editar/revisar el plan antes de aprobarlo y mostrar archivos, riesgos, herramientas, cambios previstos y dependencias. El editor normaliza los pasos editados antes de devolverlos al runtime común.
- [x] `AI-105.11` Permitir replanificar si una lectura descubre nueva información, pero exigir aprobación si cambia el alcance, agrega archivos o aumenta el riesgo. Cada nueva propuesta reemplaza el plan en memoria y vuelve a pasar por aprobación explícita.
- [x] `AI-105.12` Detener pasos dependientes cuando uno falla y mostrar el estado parcial exacto; permitir reintentar solo el paso fallido cuando sea seguro.
- [x] `AI-105.13` Implementar cancelación del plan que detenga nuevas tools y deje intactos los pasos no iniciados.
- [~] `AI-105.14` Persistir el estado mínimo necesario para reanudar después de cerrar/reabrir el panel, background Android o reconexión del canal, sin persistir contexto sensible innecesario. El chat persiste metadata acotada del TO-DO, rehidrata un snapshot general de `AgentPlan` y, ante un pedido explícito como "continuá", retoma desde el primer paso pendiente sin guardar argumentos privados. Telegram aborta y conserva solo el sobre opaco, el `progressMessageId` y estados del TO-DO para `/reanudar`; los pedidos de texto que cruzaron un reinicio se deben reenviar, mientras los adjuntos pueden reconstruirse; faltan background Android, retry automático seguro y refresh publicado.
- [x] `AI-105.15` Hacer el TO-DO efímero en Meeting y Task Manager publicado cuando corresponda, sin convertir su visualización en persistencia de memoria global.
- [x] `AI-105.16` Mantener compatibilidad con `set_task_execution_plan` para Task Manager mientras todos los planes pasan por el motor general.
- [x] `AI-106` Implementar la UI de edición/revisión del plan antes de aprobarlo, incluyendo archivos, riesgos, dependencias y herramientas previstas. La vista permite editar descripción, archivos o entidades afectadas, tool, riesgo y dependencias.
- [~] `AI-107` Implementar persistencia/reanudación del estado por paso y reintento aislado del paso fallido. El chat persistente ya lo conecta y puede reabrir un paso bloqueado sin repetir completados; Telegram conserva metadata acotada, no persiste prompts y requiere `/reanudar` (o reenviar el texto tras reinicio); background conserva recuperación explícita pendiente.
- [x] `AI-108` Implementar rollback por lote cuando sea posible o declarar con precisión el estado parcial no reversible.
- [x] `AI-109` Impedir duplicados en reintentos mediante idempotency keys y consulta del journal de operación.
- [x] `AI-110` Añadir tests de plan simple sin TO-DO, plan compuesto, aprobación, rechazo, aclaración intermedia, confirmación, cancelación, replanificación, fallo parcial, reanudación y finalización verificada. Engine, persistencia, catálogo y seis escenarios compuestos del runtime están cubiertos sin servicios reales.

#### Flujos que deben probarse con el plan general

- [x] `AI-110.1` Documento: leer sección → generar preview → pedir confirmación → aplicar patch → validar → verificar. Cubierto por escenario del runtime nativo con transporte fake.
- [x] `AI-110.2` Investigación web: formular query pública → buscar → comparar fuentes → preparar nota con citas → pedir confirmación → crear/actualizar documento → verificar. Cubierto por escenario del runtime nativo y sanitización del adapter.
- [x] `AI-110.3` Biblioteca: localizar varios documentos → pedir permisos si corresponde → extraer información → proponer cambios multiarchivo → aplicar por journal → reindexar. Cubierto por escenario del runtime nativo con autorización explícita.
- [x] `AI-110.4` Task Manager: buscar tickets → pedir aclaración si hay varios → proponer cambios → aprobar plan → ejecutar cada mutación en orden → verificar. Cubierto por escenario del runtime nativo.
- [x] `AI-110.5` Conversación con aclaración: conservar el plan y la solicitud original, incorporar la respuesta y continuar desde el paso bloqueado. Cubierto por escenario de continuación con plan pendiente.
- [x] `AI-110.6` Conversación con conflicto: detener el plan, generar nuevo diff y pedir aprobación antes de continuar. Cubierto por escenario de conflicto/replanificación.

## P6 — Herramientas y capacidades de dominio

### P6.1 Herramientas generales de biblioteca

- [x] `AI-111` Registrar en catálogo `get_workspace_context`, outline, rango, exact search, metadata y referencias.
- [x] `AI-112` Registrar las tools de preview/apply/undo y documentar qué scopes pueden usarlas. El catálogo las expone para documento; Finance y published las filtran.
- [x] `AI-113` Registrar validación Markdown, verificación e indexación. Las tres tools están en el catálogo común y respetan scope y autorización.
- [x] `AI-114` Actualizar `CHAT_AGENT_SINGLE_CALL_TOOL_NAMES` solo cuando la tool sea realmente idempotente y tenga contrato de una sola operación. El plan y las mutaciones se ejecutan como llamadas independientes.
- [x] `AI-115` Filtrar tools nuevas de forma explícita para Finance y `publishedScope`.

### P6.2 Task Manager

- [x] `AI-116` Implementar `update_task_fields` con actualización parcial de título, detalle, estado, prioridad, grupo, fechas, estimación y tags.
- [x] `AI-117` Implementar dependencias de tareas.
- [x] `AI-118` Implementar checklist de tareas.
- [x] `AI-119` Implementar duplicar, archivar y restaurar ticket.
- [x] `AI-120` Agregar filtros de búsqueda por estado, prioridad, fecha, tablero, tag y texto. La búsqueda de tickets filtra estado, prioridad, fecha, tablero autorizado, grupo, tags y texto de metadata; si se omite el tablero conserva el board activo del scope.
- [x] `AI-121` Implementar resumen y plan de cambios de tablero.
- [x] `AI-122` Implementar `bulk_update_tasks` con preview por ticket y excepciones.
- [x] `AI-123` Implementar vínculo bidireccional entre ticket y documento.
- [x] `AI-124` Cubrir scope publicado para cada tool y evitar cruce de tableros.

### P6.3 Productividad documental

- [x] `AI-125` Implementar presets `clarity`, `grammar`, `tone`, `shorten`, `expand`, `technical`, `format`, `translate` y `custom`.
- [x] `AI-126` Implementar inserción de resumen, outline, FAQ, tabla, checklist y TOC mediante patch.
- [x] `AI-127` Implementar extracción de tareas, fechas, decisiones, personas y riesgos hacia destinos explícitos.
- [x] `AI-128` Implementar detección de contradicciones y comparación entre documentos con citas. `compare_documents` devuelve diff acotado y contradicciones posibles de afirmaciones etiquetadas/frontmatter con línea en ambos documentos; las diferencias genéricas no se presentan como contradicciones.
- [x] `AI-129` Implementar actualización de tags, backlinks y wikilinks con preview.
- [x] `AI-130` Implementar corrección de LaTeX y propuesta de Mermaid sin alterar silenciosamente el documento.
- [x] `AI-131` Implementar plantillas y títulos/nombres de archivo coherentes.

## P7 — Búsqueda web con privacidad absoluta

### P7.1 Adapter y transporte

- [x] `AI-132` Implementar `searchWeb` como servicio/adapter separado del runtime conversacional.
- [x] `AI-133` Añadir comando Tauri desktop tipado, por ejemplo `run_desktop_ai_web_search`.
- [x] `AI-134` Añadir método equivalente al bridge Android. `AiBridgePlugin.kt` expone `webSearch` y Rust lo registra mediante el bridge versionado.
- [~] `AI-135` Mantener credencial del proveedor fuera de prompt, Redux, localStorage, URL, evento y log. Redux/localStorage ya quedan redacted y el transport resolver la conserva solo en memoria de sesión antes de entregarla al adapter nativo; falta integrar un almacén seguro nativo para conservarla entre reinicios sin volverla accesible al WebView.
- [x] `AI-136` Definir timeout, rate limit, máximo de resultados, máximo de caracteres y dominios permitidos.
- [x] `AI-137` No pasar al adapter historial, memoria, snapshot, contenido de archivos ni argumentos de otras tools.

### P7.2 Sanitización determinista

- [x] `AI-138` Implementar `sanitizeWebSearchQuery` antes de cualquier llamada externa.
- [x] `AI-139` Detectar API keys, tokens, JWT, passwords, cookies, certificados y claves privadas.
- [~] `AI-140` Detectar emails, teléfonos, nombres, domicilios, ubicaciones, IDs, rutas y entidades de la biblioteca. Cubre PII evidente, rutas y redes privadas; la detección heurística de nombres/entidades requiere un corpus local sin enviarlo al adapter.
- [~] `AI-141` Detectar información financiera, médica, laboral, legal, familiar y de calendario. Cubre marcadores explícitos sensibles; falta ampliar el corpus lingüístico.
- [~] `AI-142` Detectar contenido privado aunque venga como URL encoding, JSON, header, Markdown o texto pegado. Cubre headers, URLs con credenciales, rutas, controles y patrones directos; falta fuzzing exhaustivo.
- [x] `AI-143` Bloquear si la query conserva datos sensibles o queda vacía después de redactar.
- [x] `AI-144` No guardar ni mostrar la query original bloqueada; registrar solo código, propósito y hash seguro de la query sanitizada.
- [x] `AI-145` No permitir que el consentimiento del usuario desactive este filtro.
- [~] `AI-146` Cubrir falsos negativos y falsos positivos con corpus de pruebas de seguridad. La suite cubre secretos, PII, tarjetas, rutas, redes privadas, credenciales embebidas, headers, datos laborales/legales/calendario, varias capas de URL encoding y la sanitización de resultados; sigue pendiente fuzzing sostenido de mantenimiento.

### P7.3 Uso natural y resultados

- [x] `AI-147` Buscar automáticamente solo ante solicitud explícita o necesidad de información cambiante. El runtime clasifica pedidos explícitos y señales de información cambiante como guía determinista para evaluar `search_web`; la sanitización sigue siendo la barrera final y no se construye ninguna query automáticamente.
- [x] `AI-148` Para documentos privados, separar análisis local de búsqueda pública y nunca copiar fragmentos del documento a la query.
- [x] `AI-149` Devolver título, URL, snippet, fecha, fuente y nivel de verificación. Cada resultado declara `verification: unverified` y `verificationScore: 0` cuando Ollama no entrega evidencia independiente; la coincidencia entre fuentes continúa siendo una señal heurística separada.
- [x] `AI-150` Sanitizar resultados para separar contenido web de instrucciones/prompt injection. Se eliminan etiquetas HTML y patrones de instrucciones de títulos/snippets, y el prompt los trata como contenido no confiable.
- [x] `AI-151` Impedir que una página cambie scope, agregue reglas, solicite secretos o ejecute mutaciones.
- [x] `AI-152` Mostrar actividad “Buscando fuentes públicas…” y la query sanitizada solo si es seguro.
- [x] `AI-153` Responder con citas y distinguir hechos, inferencias y conocimiento previo.
- [x] `AI-154` Manejar provider unavailable, rate limit y resultados contradictorios sin afirmar certeza falsa. Hay errores tipados, fallback seguro y una señal heurística `insufficient`/`consistent`/`mixed`; el agente conserva la incertidumbre y no afirma verificación fuerte.
- [~] `AI-155` Añadir pruebas de redacción de secretos, contenido privado, prompt injection, URLs inseguras y reintento sin query original. Hay tests iniciales de redacción y dominios; falta integración y corpus completo.

## P8 — Experiencia conversacional y UI

### P8.1 Respuesta natural

- [x] `AI-156` Crear estados de actividad humanos: observando, buscando, leyendo, preparando diff, esperando elección, aplicando y verificando.
- [x] `AI-157` Evitar exponer nombres internos de tools salvo en diagnóstico.
- [x] `AI-158` Evitar thinking crudo como sustituto de evidencia o resultado.
- [x] `AI-159` Responder con resumen breve de qué cambió, qué no pudo hacerse y cuál es el próximo paso. El prompt común lo exige como cierre verificable y prohíbe afirmar mutaciones sin éxito real de una tool.
- [x] `AI-160` Mantener continuidad para “más corto”, “aplicalo abajo”, “hacé lo mismo” y “volvé atrás”. El clasificador distingue follow-ups y undo; el composer reutiliza el último `operationId` solo para un pedido explícito y el agente pregunta si el contexto no alcanza.
- [x] `AI-161` Implementar referencia a la operación/bloque real, no solo al texto del último mensaje.

### P8.2 Diff y aclaración desktop

- [x] `AI-162` Crear panel de diff con original/nuevo por hunk. El panel de confirmación del chat muestra original/nuevo y selección por hunk para el flujo preview/apply; en interacción coarse se presenta como bottom sheet.
- [x] `AI-163` Mostrar ruta, sección, cantidad de archivos, supuestos, riesgos y contenido intacto. El panel muestra resumen, documentos, líneas/hunks, supuestos, riesgos y explicita que el contenido fuera de los hunks se conserva; la revisión manual visual general queda en `AI-216`.
- [x] `AI-164` Añadir botones `Aplicar`, `Aplicar todo`, `Rechazar`, `Editar propuesta`, `Deshacer` y `Cancelar`. Editar propuesta cancela de forma segura para permitir un nuevo pedido y Deshacer usa el journal de la última operación aplicada.
- [x] `AI-165` Mostrar choices de aclaración como botones accesibles y permitir texto libre.
- [x] `AI-166` Restaurar foco en el editor/panel después de aplicar o rechazar. El hilo de chat es enfocable y recupera foco después de resolver una confirmación.
- [~] `AI-167` Anunciar estados de carga, error, espera y finalización a lectores de pantalla. El hilo, thinking y estados de interacción ya usan `aria-live`/`role=status`; falta una auditoría completa de todas las superficies.

### P8.3 Android, touch y Telegram

- [x] `AI-168` Crear bottom sheet de diff con hunks desplazables en Android. El preview táctil usa un sheet inferior semántico, handle visual y scroll interno.
- [~] `AI-169` Mantener objetivos táctiles de al menos 48x48 px y soporte de botón Atrás sin aplicar. Los controles del sheet cumplen 48 px; falta verificar el evento Atrás en una app Android instalada.
- [!] `AI-170` Probar selección, referencia por heading y edición sin mouse/teclado. Bloqueada para validación manual táctil/Android.
- [x] `AI-171` Permitir aclaraciones y confirmaciones por botones en Telegram.
- [x] `AI-172` Mantener el mismo caso de uso de dominio para mouse, teclado, touch y Telegram.
- [!] `AI-173` Cubrir orientación, split-screen, teclado virtual, suspensión y reanudación. Bloqueada para validación manual en Android.

### P8.4 Feedback progresivo y pensamientos resumidos en Telegram

- [x] `AI-218` Definir un contrato tipado `AgentProgressEvent` común, separado de `onThinkingDelta`, para informar recepción, fase, plan, pasos, tools, aclaraciones, confirmaciones, búsqueda web, verificación, finalización, cancelación y error.
- [x] `AI-219` Emitir eventos de progreso desde `notiaChatRuntime`/`aiRuntime` con `requestId`, `operationId`, `planStepId` opcional, fase, estado, timestamp y resumen seguro. Telegram reutiliza el requestId persistido al reanudar; el contenido privado nunca forma parte del evento.
- [x] `AI-220` Crear un catálogo de etiquetas humanas para tools y fases; no exponer nombres internos, argumentos, rutas, identificadores, nombres privados ni payloads. El catálogo cubre también `search_web` con etiqueta segura.
- [x] `AI-221` Prohibir en Telegram el envío de `onThinkingDelta` crudo, chain-of-thought tokenizado, prompts de sistema, instrucciones ocultas, argumentos completos de tools y fragmentos privados del contexto.
- [x] `AI-222` Generar los “pensamientos” visibles como resúmenes breves del enfoque o de la decisión tomada, derivados de transiciones y resultados tipados del runtime, sin una segunda llamada al modelo.
- [x] `AI-223` Hacer que `sendTelegramMessage` devuelva el `messageId` sin romper consumidores existentes y documentar el contrato de respuesta.
- [x] `AI-224` Implementar `editTelegramMessage` en TypeScript, Tauri y Rust, con validación de chat, `messageId`, formato, tamaño y contenido permitido.
- [x] `AI-225` Crear `telegramProgressRuntime` para agregar eventos, renderizar HTML seguro, deduplicar actualizaciones y editar un único mensaje de estado por request.
- [x] `AI-226` Mostrar progreso también en requests de texto; conservar estados específicos para audio, imagen, PDF, archivos adjuntos, contexto local, tools, búsqueda web y aplicación/verificación.
- [x] `AI-227` Informar posición de cola y estado de la request activa sin revelar datos de otras requests, chats o usuarios.
- [x] `AI-228` Renderizar el TO-DO general del agente en Telegram con estado por paso (`pending`, `in_progress`, `blocked`, `completed`, `failed`, `cancelled`) y actualización del paso actualmente ejecutado. El mensaje editable muestra solo número y estado; nunca etiquetas, rutas ni IDs internos.
- [x] `AI-229` Mantener los mensajes de aclaración y confirmación fuera del mensaje editable de progreso para conservar botones, opciones y respuestas pendientes.
- [x] `AI-230` Añadir preferencias `progressMode` (`minimal`, `standard`, `detailed`, `off`), `showPlan`, `showReasoningSummary` y `editProgressMessage`, con defaults seguros y uso en Telegram.
- [x] `AI-231` Aplicar rate limit y debounce al feedback (por ejemplo, una edición cada 2–4 segundos), agrupar eventos y enviar inmediatamente solo cambios críticos como espera de confirmación, error o cancelación.
- [x] `AI-232` Asociar cada evento a su request/operación/paso y descartar eventos obsoletos o de requests finalizadas para evitar carreras y mensajes fuera de orden. El requestId validado se conserva durante la reanudación y el agregador filtra timestamps obsoletos.
- [x] `AI-233` Persistir el `progressMessageId` junto al estado mínimo de una request activa para poder continuar la edición tras una reanudación controlada.
- [x] `AI-234` Definir recuperación después de reinicio o pérdida de conectividad: informar estado desconocido/reanudado y nunca repetir una mutación solo para reconstruir feedback.
- [x] `AI-235` Implementar fallback cuando falle una edición: limitar reintentos, crear un nuevo mensaje solo si corresponde, evitar loops y mantener un único estado final accionable.
- [~] `AI-236` Definir una máquina de fases visible: recibido/cola, transcripción o extracción, construcción de contexto, planificación, lectura/búsqueda, resumen de enfoque, ejecución, espera de aclaración/confirmación, aplicación, verificación y finalización. Ya están implementadas las fases generales, búsqueda web, estados de espera/verificación y eventos de plan; Telegram ahora muestra resúmenes operativos seguros en modo detallado y etapas tipadas de transcripción, extracción, análisis de imagen y construcción de contexto; faltan eventos equivalentes para cada superficie multimodal.
- [x] `AI-237` En búsqueda web, mostrar únicamente un tema público previamente sanitizado; nunca mostrar la query original si contiene secretos, PII, nombres privados, contenido del documento o historial sensible.
- [x] `AI-238` Separar el estado final del mensaje de progreso de la respuesta final, incluyendo resultado seguro, acción pendiente, error recuperable o sugerencia concreta para continuar.
- [x] `AI-239` Añadir tests unitarios del agregador: orden de fases, deduplicación, rate limit, render seguro, etiquetas de tools, estados de plan, eventos obsoletos y filtrado de datos sensibles.
- [~] `AI-240` Añadir tests de integración con Telegram mockeado para edición, fallback, límite de tamaño, HTML inválido, rate limit, confirmaciones, aclaraciones y botones. El adapter nativo ya valida IDs, texto vacío y parse mode antes de red; el hook cubre edición de un único mensaje de progreso, respuesta final separada y persistencia del presupuesto de reintento; siguen pendientes fallback/límite/HTML/rate limit contra un mock de Bot API y E2E real.
- [x] `AI-241` Cubrir el flujo completo en texto, audio, imagen, PDF, plan multi-step, tool error, búsqueda web, cancelación, reanudación, cola y request concurrente. La integración mockeada del bridge cubre cada recorrido sin Bot API real.
- [x] `AI-242` Verificar que tests, fixtures y logs no contengan API keys, tokens, PII, argumentos financieros, rutas privadas, contenido de archivos ni pensamiento crudo del modelo.

## P9 — Seguridad, memoria y observabilidad

- [x] `AI-174` Revisar el límite de autorización de cada nueva tool por scope y por ruta.
- [x] `AI-175` Añadir defensa contra prompt injection en documentos, PDF, imágenes, audio y web.
- [x] `AI-176` Redactar secretos y datos personales en logs, diagnósticos y métricas.
- [x] `AI-177` Crear historial local de operaciones AI con fecha, documento, resumen, estado y enlace al diff, sin contenido privado innecesario. La UI filtra por documento, permite abrir el diff de journals vivos y conserva un mensaje seguro cuando la sesión ya no tiene el contenido reversible.
- [x] `AI-178` Registrar solo scope, tool, cantidad, tiempos, resultado, cancelación, conflicto y modelo; nunca prompt completo ni API key.
- [~] `AI-179` Implementar límites de concurrencia, timeout, backpressure y cancelación por vista. El runtime limita rondas y tiempo, los streams cancelan reader/listeners y cada superficie evita ejecuciones concurrentes; falta consolidar un coordinador único y probar backpressure en Android.
- [~] `AI-180` Pausar/cancelar streams, memoria y reindexación cuando la app pase a background. Chat y Meeting abortan respuestas activas; Telegram conserva la request como interrumpida y evita continuar automáticamente; el rebuild del cache de enlaces ahora se difiere hasta que la app vuelve a estar visible; falta pausar explícitamente otras tareas de indexación y validar Android.
- [~] `AI-181` Medir tiempo de snapshot, retrieval, preview, apply, verify, memoria y bundle. El baseline y el runtime registran chat y cada tool con metadata redacted; faltan memoria/bundle y una campaña con corpus grande.
- [~] `AI-182` Definir presupuesto de memoria/contexto para tableta Android de gama media. Existen límites de contexto, archivos, chunks y respuesta; falta medirlos en hardware de referencia y fijar umbrales de producto.

## P10 — Pruebas

### P10.1 Tests unitarios y de engine

- [x] `AI-183` Probar resolución de targets por selección, heading, etiqueta, frase y occurrence.
- [x] `AI-184` Probar target inexistente, ambiguo, revisión obsoleta y selección de otro documento.
- [x] `AI-185` Probar preservación de frontmatter, fórmulas, links, tablas, Mermaid y bloques no afectados.
- [x] `AI-186` Probar patch multi-hunk, atomicidad, idempotencia y rollback.
- [x] `AI-187` Probar sanitizer web con secretos, PII, rutas, texto codificado y queries públicas.
- [x] `AI-188` Probar parser de resultados web, citas, fechas, límites y prompt injection.
- [x] `AI-189` Probar unión discriminada de estados y transiciones imposibles.

### P10.2 Tests de runtime y consumidores

- [x] `AI-190` Mantener una prueba por superficie que demuestre el paso por `notiaChatRuntime`. Hay cobertura del chat principal, Meeting efímero, Telegram y Task Manager publicado; Finance queda restringido por el mismo contrato de scope.
- [x] `AI-191` Probar chat principal con edición seleccionada, aclaración y aplicación. El vertical slice documental cubre selección, preview, confirmación, aplicación y escritura nativa; el hook principal conserva el paso por la fachada común.
- [x] `AI-192` Probar chat de documento sin selección y target ambiguo. La regresión del runtime rechaza ambos casos sin escribir y exige una referencia explícita.
- [x] `AI-193` Probar Meeting efímero sin memoria ni escritura inesperada. `meetingEphemeralChatRuntime.test.ts` demuestra el paso por `runNotiaChatReply`, `ephemeral-no-memory`, `readOnly` y el contexto de transcripción.
- [x] `AI-194` Probar Telegram con aclaración, reintento, imagen, memoria y cancelación. `useTelegramAgentBridge.integration.test.ts` también cubre audio, PDF, plan, cola, concurrencia y reanudación explícita.
- [x] `AI-195` Probar Task Manager publicado sin acceso a memoria ni rutas privadas. La prueba del runtime exige `publishedScope`, `published-no-memory` y limita `scopePaths`; el catálogo excluye memoria, búsqueda web y planes generales no autorizados.
- [x] `AI-196` Probar Finance sin exposición de documentos ni tools no financieras. El contrato del scope cubre exclusivamente tools financieras, excluye memoria, notas, tickets, `search_web` y `verify_operation`, y exige confirmación reforzada.
- [x] `AI-197` Probar búsqueda web desde cada canal sin filtración de contexto privado. Los scopes autorizados pasan por el contrato común y Finance/Task Manager publicado la excluyen explícitamente; la suite verifica que no viaja contenido privado al proveedor.

### P10.3 Contratos nativos y plataforma

- [~] `AI-198` Crear tests de DTO TypeScript/Rust para cada comando AI. Se agregaron fixtures Rust de chat, tools, búsqueda web y eventos Android con camelCase y correlación, además de pruebas TypeScript del bridge Android y búsqueda web; todavía faltan fixtures exhaustivos generados como espejo para cada comando.
- [x] `AI-199` Crear fake desktop adapter que falle si se usa fetch directo. La prueba de continuación mockea el adapter Tauri y afirma que no se usa `fetch`.
- [x] `AI-200` Crear fake Android bridge para deltas, thinking, done, error, cancelación y timeout. El contrato ejecutable está cubierto por Vitest; la prueba real en dispositivo queda en `AI-208`.
- [x] `AI-201` Ejecutar `npm test` y conservar regresiones específicas del módulo.
- [!] `AI-202` Ejecutar `cargo test --all-targets` para el servicio/bridge aplicable. El binario de tests Windows no inicia por `STATUS_ENTRYPOINT_NOT_FOUND`/`0xc0000139`; no hubo fallos de aserciones.
- [x] `AI-203` Ejecutar `cargo fmt --all -- --check`.
- [~] `AI-204` Ejecutar `cargo clippy --all-targets --all-features -- -D warnings` y separar deuda previa. Ejecutado: falla por 52 diagnósticos de la librería y 54 al compilar tests, todos fuera del vertical slice de IA.
- [x] `AI-205` Ejecutar `npm run lint` y distinguir deuda previa de regresiones introducidas. ESLint global pasa sin errores ni warnings después de corregir las regresiones detectadas en Mermaid, speech y hooks.
- [x] `AI-206` Ejecutar `npm run build`.
- [!] `AI-207` Ejecutar `npm run build:android:debug` con Developer Mode si el entorno lo exige. Cargo Android compila, pero el CLI se detiene al crear symlinks sin Developer Mode.
- [!] `AI-208` Realizar prueba manual en tableta Android física de gama media. No hay dispositivo físico disponible en este entorno.

## P11 — Documentación y limpieza

- [x] `AI-209` Actualizar `README-TECH.md` para reflejar runtime común, tools, patch, estados y transporte real.
- [x] `AI-210` Actualizar documentación de URL/default y explicar local frente a Ollama Cloud.
- [x] `AI-211` Documentar memoria única, toggle, borrado y políticas efímeras.
- [x] `AI-212` Documentar el contrato Android real y eliminar referencias a plugins no versionados.
- [x] `AI-213` Documentar búsqueda web, sanitización, credenciales, límites, citas y bloqueo absoluto de datos privados.
- [x] `AI-214` Retirar la promesa de modo charla si la UI no lo expone o implementar la superficie antes de documentarla.
- [x] `AI-215` Actualizar diagramas, secuencias, tabla de comandos y ejemplos de payloads.
- [!] `AI-216` Revisar diff completo, eliminar código muerto, aliases temporales y logs de depuración. Requiere revisión visual humana del diff completo.
- [x] `AI-217` Añadir guía de soporte para conflicto de revisión, provider unavailable, aclaraciones pendientes y rollback.

## Criterios de aceptación del MVP

- [x] Una selección Markdown puede mejorarse con lenguaje natural desde el panel contextual.
- [x] Sin selección, una referencia única como “inciso c del ejercicio 1” se resuelve sin pasos técnicos.
- [x] Un target ambiguo produce una pregunta con alternativas concretas y no modifica nada.
- [x] El usuario ve un diff antes de aplicar y puede aceptar/rechazar la operación.
- [x] Una solicitud simple e inequívoca no muestra un TO-DO innecesario.
- [x] Una solicitud compuesta crea automáticamente un TO-DO visible antes de la primera mutación.
- [x] Después de aprobar el plan, el agente continúa automáticamente con el siguiente paso pendiente.
- [~] Ningún paso aparece completado hasta que su tool y verificación devuelven éxito. El runtime lo exige para el plan común; faltan fixtures de todos los catálogos.
- [x] Una aclaración o confirmación pausa el plan y, al resolverse, lo retoma desde el paso bloqueado.
- [x] Un fallo detiene los pasos dependientes, muestra el estado parcial y permite reintentar solo lo seguro.
- [x] Si aparece nueva información, el agente puede replanificar y vuelve a pedir aprobación cuando cambia el alcance o el riesgo.
- [x] La aplicación preserva frontmatter, fórmulas, links y contenido no afectado.
- [x] Un cambio concurrente produce conflicto y nunca pisa el trabajo del usuario.
- [x] La operación aplicada sincroniza editor, disco e índice y puede revertirse.
- [x] La IA puede continuar con “más corto”, “aplicalo también abajo” y “volvé atrás”. La continuidad contextual, el undo por `operationId` y la aclaración ante ambigüedad están implementados; los escenarios integrados por superficie quedan como cobertura adicional pendiente.
- [x] Meeting efímero no persiste memoria ni otros efectos no autorizados.
- [x] Desktop no usa fetch directo a Ollama.
- [~] Android usa el bridge nativo versionado y entrega streaming real o una limitación explícita. El contrato y fake están cubiertos; falta validación Gradle/dispositivo.
- [x] Una búsqueda web nunca envía secretos, información personal, contenido sensible ni contexto privado.
- [x] Los resultados web tienen citas y no pueden ejecutar instrucciones encontradas en internet.
- [~] Todas las superficies conversacionales siguen usando la fachada común. El runtime es común; faltan pruebas de consumidor para cada superficie.

## Orden recomendado de ejecución

1. `AI-001` a `AI-020`: contratos, decisiones y tests puros.
2. `AI-057` a `AI-069`: snapshot y contexto activo.
3. `AI-070` a `AI-092`: vertical slice de preview/apply/verify/undo.
4. `AI-093` a `AI-110`: aclaraciones, confirmaciones y planes.
5. `AI-021` a `AI-042`: transporte desktop, Android y publicación.
6. `AI-043` a `AI-056`: memoria y persistencia.
7. `AI-111` a `AI-131`: catálogo y capacidades de documentos/Task Manager.
8. `AI-132` a `AI-155`: búsqueda web con privacidad absoluta.
9. `AI-156` a `AI-182`: UX, seguridad, rendimiento y observabilidad.
10. `AI-183` a `AI-217`: cobertura, validaciones y documentación final.
11. `AI-218` a `AI-242`: feedback progresivo, resúmenes seguros y validación específica de Telegram.

## Definición de terminado por tarea

Una tarea no se marca completa hasta que:

- el contrato está implementado y validado en sus límites;
- existe una prueba del comportamiento observable o de la lógica pura;
- se contemplan cancelación, error, conflicto y cleanup cuando aplican;
- se respeta el scope y la política de privacidad;
- existe equivalente táctil si afecta una acción de usuario;
- la documentación relevante está actualizada;
- se ejecutaron las validaciones proporcionales y se registraron pendientes reales.

## Registro de implementacion adicional 2026-09-07

Esta seccion es la fuente de verdad de la continuacion posterior al registro historico:

- `AI-079` y `AI-080`: implementados para renombrado con actualizacion de referencias exactas, preview critico, journal multiarchivo, rollback de la aplicacion y undo con deteccion de conflictos.
- `AI-119`: implementadas las tools `duplicate_task`, `archive_task` y `restore_task`, reutilizando el servicio de Task Manager y su sincronizacion de indices.
- `AI-121`: implementado `get_task_board_summary` con conteos por estado, prioridad y grupo, limite de corpus y rutas autorizadas.
- `AI-122`: implementado `bulk_update_tasks` con validacion de tickets, scope, campos y confirmacion de lote; queda pendiente el preview visual por ticket y rollback fisico.
- `AI-125`: implementados los presets de edicion Markdown y su validacion de instrucciones; falta exponer un selector visual dedicado.
- `AI-135`, `AI-142` y `AI-155`: la salida de resultados web tambien redacciona secretos en snippets/titulos y elimina credenciales, tokens, parametros sensibles y fragmentos de URLs antes de citar o enviar a Telegram.
- `AI-105.12` y `AI-105.13`: engine determinista de bloqueo transitivo, reintento aislado y cancelacion de planes implementado y testeado; falta conectarlo a todas las superficies persistentes.
- `AI-214` a `AI-217`: pendientes de una pasada final de documentacion, limpieza y guia de soporte; no se marcan como terminados sin revisar el diff completo.
- Validacion nueva: `npx tsc -b --pretty false` OK, `npm test` OK (69 archivos, 327 pruebas), build Vite OK, lint focalizado de los archivos modificados OK y `git diff --check` sin errores de whitespace.

## Registro de implementaciÃ³n de la continuaciÃ³n

Este registro complementa los estados histÃ³ricos del backlog y deja constancia de los cambios incorporados en esta fase:

- Registro histÃ³rico superseded: `AI-036` ya tiene fake Android ejecutable en Vitest; solo sigue pendiente su validaciÃ³n Gradle/dispositivo.
- `AI-050` queda parcialmente cubierto: la polÃ­tica de memoria estÃ¡ centralizada y testeada para superficies efÃ­meras; falta un test de integraciÃ³n de filesystem para toggle activado/desactivado.
- `AI-053` queda resuelto: Meeting usa `ephemeral-no-memory`, snapshot propio y `readOnly`.
- `AI-057` queda resuelto para las superficies actuales: el panel comÃºn cubre documentos/Task Manager/Finance y Meeting construye su snapshot efÃ­mero.
- `AI-079` y `AI-080` quedan implementados en el vertical slice de renombrado y referencias, con preview crÃ­tico, rollback del renombrado y journal multiarchivo.
- `AI-100` queda resuelto: los riesgos aceptan `low`, `medium`, `high` y `critical`.
- `AI-105.2`, `AI-105.12` y `AI-105.13` tienen engine determinista para complejidad, bloqueo transitivo, reintento aislado y cancelaciÃ³n; falta conectar todas las seÃ±ales/canales.
- `AI-121` y `AI-122` tienen `get_task_board_summary` y `bulk_update_tasks` con validaciÃ³n de IDs, scope y campos; faltan excepciones visuales y rollback fÃ­sico por ticket.
- `AI-154` ahora incluye una seÃ±al heurÃ­stica de consistencia entre resultados web (`insufficient`, `consistent`, `mixed`) y conserva la incertidumbre.
- Las validaciones de esta fase incluyen `npx tsc -b` y tests focalizados del planificador, renombrado, presets, aclaraciones, web search, scopes y publicaciÃ³n.

## Registro de implementacion adicional 2026-09-07 (continuacion)

Esta seccion reemplaza cualquier estado historico contradictorio para las tareas indicadas:

- `AI-080`: `apply_multi_document_patch` ya es una tool generica para documentos Markdown autorizados. Lee antes de proponer, arma un preview combinado, controla revision exacta por archivo, acepta hunks parciales, aplica con rollback de escrituras previas y deja journal para `verify_operation`/`undo_ai_operation`.
- `AI-090`: `validateMarkdownDocument` tambien valida saltos semanticos de headings, enlaces Markdown sin cierre y consistencia de columnas en tablas, ademas de fences, frontmatter, formulas y corchetes.
- `AI-119`: las tools de duplicar, archivar y restaurar ticket permanecen implementadas y sincronizan el indice del Task Manager.
- `AI-122`: `bulk_update_tasks` muestra preview por ticket, permite seleccionar excepciones mediante hunks y revierte fisicamente los tickets anteriores si una escritura posterior falla.
- `AI-233`: las requests de Telegram persisten `requestId`, `progressMessageId`, estado minimo y presupuesto de reintentos junto a la cola activa.
- `AI-234`: una request que estaba activa al reiniciar se carga como `interrupted`, se informa como estado desconocido y no se ejecuta automaticamente. Solo `/reanudar` vuelve a ponerla en cola; reconstruir el feedback no repite mutaciones.
- `AI-235`: el fallback de edicion tiene presupuesto persistido de tres intentos y una unica publicacion terminal de emergencia para conservar un estado accionable sin loops.
- `AI-219` y `AI-232`: la correlacion por `requestId` queda preservada durante la recuperacion de Telegram y los mensajes de progreso retoman el `progressMessageId` previo cuando el usuario reanuda explicitamente.
- `AI-105.2` y `AI-105.3`: la deteccion determinista de complejidad ahora participa del runtime comun. Las solicitudes compuestas reciben una instruccion de preflight para crear y aprobar `set_agent_execution_plan` antes de la primera mutacion; las consultas simples no generan TO-DO por esta heuristica.
- `AI-105.4` y `AI-105.6`: el runtime aplica una barrera adicional: si el preflight clasifica el pedido como compuesto, una tool mutante sin plan aprobado se rechaza con `execution-plan-required` y el modelo debe crear/aprobar el plan antes de continuar.
- `AI-084`, `AI-091` y `AI-113`: las escrituras AI invalidan el indice de busqueda/graph y emiten el evento de cambio de biblioteca; se agrego `reindex_changed_documents` para invalidar explicitamente documentos autorizados sin escribir contenido.
- `AI-142`, `AI-146` y `AI-155`: el sanitizador web decodifica hasta tres capas de URL encoding antes de evaluar secretos, credenciales y PII; se agrego regresion para JSON personal doblemente codificado.
- `AI-239`: `telegramProgressRuntime` conserva `requestId` y timestamp del ultimo evento y descarta eventos cruzados o atrasados; se agrego regresion especifica para ambas carreras.
- `AI-176` y `AI-178`: el evento de cambio de biblioteca dejo de registrar `pathHint`; conserva solo si existe y el tamano de la cola, evitando exponer rutas privadas en ese diagnostico.
- `AI-154`: el adaptador web clasifica errores de proveedor como credencial rechazada, rate limit, timeout o proveedor no disponible, y rechaza respuestas con forma invalida sin exponer el detalle remoto.
- `AI-176`, `AI-178` y `AI-242`: `notiaLogger` aplica redaccion centralizada a mensajes, campos sensibles, secretos conocidos, JWT, emails, rutas privadas y estructuras anidadas antes de escribir en consola o enviarlas al comando nativo; se agrego regresion automatizada.
- Validaciones nuevas: `npx tsc -b --pretty false`, tests focalizados de Telegram, runtime de chat, Task Manager y Markdown, y ESLint focalizado sobre los archivos modificados: OK.
- `AI-040`: el bootstrap del Task Manager publicado expone únicamente el alias `published-vault`, mantiene URL/API key fuera del navegador y traduce las rutas solo dentro del backend Rust; las respuestas de filesystem vuelven a sanear las rutas antes de enviarlas.
- `AI-041`: la suite nativa de publicación cubre autorización por ruta para lectura de árbol/Markdown, lectura/escritura de archivos, existencia/directorio, creación y operaciones de entrada, incluyendo rechazo de otro tablero y de rutas fuera del vault.
- `AI-144`: las consultas bloqueadas no se guardan ni se muestran; el resultado devuelve únicamente un código de bloqueo y una instrucción segura para reformular, mientras el logger central evita serializar queries y payloads sensibles.
- `AI-083`: las escrituras desktop ya usan temporal + rename atómico; la publicación conserva esa frontera y no incorpora un atajo de escritura desde el navegador.
- `AI-092`: las reglas del agente exigen distinguir evidencia de contenido generado y pedir aclaración cuando la fuente no alcanza para afirmar un dato; el contenido agregado se aplica mediante preview/confirmación/validación.
- `AI-050`: la política de memoria tiene cobertura para superficies efímeras y la escritura de una lista vacía deja únicamente el marcador versionado, sin conservar entradas anteriores; el toggle de UI sigue gobernando la decisión de carga/persistencia en el runtime.
- `AI-175` y `AI-217`: el prompt común y los resultados de tools delimitan datos no confiables para bloquear prompt injection, y `README-TECH.md` incorpora una guía operativa para conflictos de revisión, fallos del proveedor web, aclaraciones y rollback.
- `AI-157`: el TO-DO visible en el chat ya traduce las tools previstas a etiquetas humanas reutilizando el catálogo seguro de progreso; los nombres internos quedan fuera de la experiencia normal.
- Validación de seguridad publicada: `cargo check --all-targets` OK y prueba Rust de bootstrap sin ruta local ni credencial OK (las pruebas Rust ejecutables siguen condicionadas por `STATUS_ENTRYPOINT_NOT_FOUND` del entorno Windows).
- Validación final de esta continuación: `npm test -- --run` OK (77 archivos, 356 pruebas), `npm run build` OK, `npx tsc -b --pretty false` OK, ESLint focalizado OK y `cargo fmt --all -- --check`/`cargo check --all-targets` OK.
- `cargo test --all-targets` vuelve a compilar los tests, pero el runner Windows no inicia por `0xc0000139 / STATUS_ENTRYPOINT_NOT_FOUND`; no hubo fallos de aserciones observables.
- `AI-095`, `AI-096` y `AI-099`: las aclaraciones persistentes ahora se rehidratan al reabrir el panel solo si coinciden biblioteca, scope, documento y revisión; admiten choices, texto libre y cancelación, y retoman el plan persistido mediante un mensaje de continuación acotado. Una pregunta vencida, obsoleta o sin documento activo todavía en hidratación se descarta de forma segura.
- `AI-214`: resuelto. README y README-TECH ya no prometen un modo llamada inexistente; describen únicamente dictado/ASR, adjuntos de audio y TTS separado del chat conversacional.
- `AI-215`: actualizado el diagrama de AI Chat, el mapa de transporte y los ejemplos de comandos para reflejar `notiaChatRuntime`, tool calling nativo, bridge Android y streaming nativo; se retiraron referencias al fetch directo del WebView como ruta principal.
- Validación de esta iteración: test focalizado de persistencia de aclaraciones (5 pruebas), `npx tsc -b --pretty false` y ESLint focalizado sin errores.
- `AI-176`, `AI-178` y `AI-242`: el almacenamiento local del baseline de performance también pasa por la redacción central; ya no conserva `content`, queries, credenciales, rutas privadas ni mensajes de error crudos, y el log de error solo imprime un resumen seguro.
- `AI-104`: agregada preferencia opt-in por biblioteca para autoaplicar únicamente previews de riesgo `low`; se revoca desde Configuraciones y las operaciones de mayor riesgo conservan confirmación explícita. Las ediciones simples de un único documento clasificadas como low-risk exponen el preview igualmente.
- Cobertura unitaria principal de `AI-183` a `AI-189`: selección/ocurrence y targets ambiguos, preservación estructural Markdown, diff por hunks, journal/rollback, sanitización y parsing de web search, y contratos/estados tipados están cubiertos por los engines y servicios de prueba existentes. Siguen pendientes las integraciones de consumidor y plataforma enumeradas debajo.
- Estado de cierre histórico superseded: la implementación local avanzó en planes, publicación, Android fake, feedback y seguridad. La fuente de verdad vigente es el registro de continuación posterior, que separa trabajo local pendiente de validaciones externas.
- Actualización de cierre: `AI-123`, `AI-126`, `AI-130` y `AI-131` quedan implementados. `AI-128` ya tiene comparación estructurada con citas de líneas y detector conservador de contradicciones posibles para afirmaciones etiquetadas/frontmatter; la interpretación semántica final sigue dependiendo del agente. `AI-129` conserva herramientas genéricas de frontmatter/referencias, pero falta una UX dedicada para tags/backlinks.
- Actualización de planes: el snapshot detallado se prioriza al rehidratar, y el chat conecta reanudación, reintento aislado del primer fallo reintentable y cancelación de pasos no completados. La cobertura agregada valida que no se repitan mutaciones completadas ni se reutilice el `operationId` fallido.
- Actualización de catálogo documental: `compare_documents`, `link_ticket_document` y los presets de edición de productividad quedaron incorporados al runtime común; el vínculo ticket-documento usa preview multiarchivo, revisión exacta, rollback y journal.
- Actualización de extracción y metadatos: `extract_document_facts` devuelve candidatos explícitos con líneas para tareas, fechas, decisiones, personas y riesgos; `materialize_document_facts` los vuelca en un destino explícito nuevo o existente con preview, confirmación, revisión exacta y undo. `update_document_tags` permite add/remove/replace y `update_document_wikilink` agrega o quita enlaces exactos con preview y undo; `find_document_references` cubre la lectura de backlinks. `AI-127` y `AI-129` quedan implementados en el runtime común.
- Actualización de ciclo de vida: el chat cancela el stream activo en `pagehide` y durante el desmontaje del hook; quedan pendientes los presupuestos y suspensión completa de todos los watchers/background Android.
- Actualización de confirmaciones 2026-09-07: `AI-103` queda resuelto en el runtime común. Todas las mutaciones financieras, incluidas Telegram, solicitan confirmación reforzada antes de persistir; se eliminó la variante de catálogo que permitía auto-confirmar por canal y el rechazo ya no deja movimientos `pending` residuales.
- Actualización de recuperación 2026-09-07: Telegram y Meeting reaccionan a `visibilitychange`; Telegram aborta y conserva la request como `interrupted`, mientras el chat/Meeting cancelan el stream. La reanudación sigue siendo explícita y no repite automáticamente una mutación desconocida.
- Actualización de feedback 2026-09-07: el TO-DO de Telegram muestra etiquetas operativas seguras derivadas del catálogo humano, junto al estado de cada paso, sin exponer labels del modelo, IDs ni rutas privadas.
- Validación de esta continuación: tests focalizados de planes, comparación, relaciones, presets y catálogo común OK; `npx tsc -b --pretty false` y ESLint focalizado OK.
## Registro de implementacion adicional 2026-09-07 (planes, publicacion y Android)

Fuente de verdad para la continuacion posterior al registro historico:

- `AI-042`: el stream publicado ahora tiene cobertura de NDJSON (`thinking`, `delta`, `done`, `error`), cancelacion/liberacion del reader y reconexion unica solo antes del primer evento. Nunca hace fallback al backend desktop dentro del scope publicado ni duplica un delta parcial.
- `AI-036` y `AI-200`: se agrego `aiRuntime.androidBridge.test.ts` como fake ejecutable del contrato Android. Cubre health, modelos, thinking, delta, done, error, cancelacion y limpieza de listeners. La ejecucion real de Gradle y dispositivo queda pendiente por dependencia de plataforma.
- `AI-105.10` y `AI-106`: el TO-DO editable permite revisar nombre, descripcion, archivos o entidades afectadas, herramienta, riesgo y dependencias antes de aprobar. El plan editado vuelve al runtime comun, se normaliza y no puede aprobarse con menos de dos pasos.
- `AI-105.11`: si una lectura requiere cambiar el alcance, el modelo debe presentar nuevamente el plan; cada aprobacion continua pasando por la barrera de aprobacion y la normalizacion de dependencias.
- `AI-105.15`: Meeting muestra el plan solo en memoria y el Task Manager publicado lo mantiene acotado a la sesion; ninguna de las dos superficies lo convierte en memoria global.
- `AI-100`: queda implementado el nivel `critical` y su confirmacion reforzada junto a `low`, `medium` y `high`.
- Validacion de esta iteracion: `npx tsc -b --pretty false`; tests focalizados de Android, stream publicado, planes y runtime comun: OK.

Pendientes que no se pueden cerrar honestamente desde este entorno: pruebas de consumidor todavía no implementadas (`AI-190`-`AI-192`, `AI-194`, `AI-197`, `AI-198`), métricas de memoria/corpus y límites finales (`AI-179`-`AI-182`), almacenamiento nativo seguro persistente de credenciales (`AI-028`, `AI-135`; Redux/localStorage ya no las conservan), Gradle/symlinks de Windows y prueba física Android (`AI-037`, `AI-038`, `AI-083`, `AI-169`-`AI-173`, `AI-208`), end-to-end real de Telegram (`AI-240`-`AI-241`) y la pasada manual final del diff (`AI-216`). Las demás tareas locales del vertical slice quedan implementadas y validadas en la suite disponible.

## Validacion mas reciente — 2026-09-07

- `npm test -- --run`: OK — 86 archivos y 420 pruebas.
- `npm run build`: OK.
- `npx tsc -b --pretty false`: OK.
- `cargo fmt --all -- --check`: OK.
- `cargo check --all-targets`: OK, con warnings preexistentes.
- ESLint focalizado de los archivos agregados/modificados del vertical slice: OK.

## Registro de implementacion adicional 2026-09-07 (background, privacidad y multimodalidad)

- `AI-180`: el scheduler del cache de enlaces conserva la última solicitud y difiere el rebuild mientras `document.visibilityState` no sea visible; al volver al frente aplica el debounce normal y libera el listener.
- `AI-028`/`AI-135`: `libraryConfig`, Redux y localStorage ya no hidratan ni escriben API keys; la credencial activa queda solo en memoria de sesión y se resuelve en la frontera de transporte. Falta el almacén seguro nativo persistente entre reinicios.
- `AI-236`: Telegram emite etapas tipadas y seguras para transcripción, extracción, análisis de imagen y construcción de contexto; el agregador solo muestra textos operativos predefinidos.
- `AI-105.14`/`AI-242`: la persistencia durable de requests de Telegram elimina el prompt antes de serializarlo; tras un reinicio, los adjuntos pueden reanudarse por su referencia y las solicitudes textuales requieren reenvío explícito.
- `AI-149`: los resultados de búsqueda web ahora exponen un `verificationScore` explícito; el adaptador usa `0` mientras la fuente no aporte verificación independiente y no convierte consistencia heurística en certeza.
- `AI-028`/`AI-135`: las preferencias heredadas se redaccionan al cargarse, no solo al guardarse; además el cambio de preferencias despacha una acción Redux sin credencial y la clave queda únicamente en el contenedor de sesión para resolver el transporte.
- `AI-240`: se agregó regresión del adapter mockeado para `sendTelegramMessage`/`editTelegramMessage`, incluyendo `messageId`, chat, formato y payload de botones.
- Validación: `npm test -- --run` OK (86 archivos, 420 pruebas), `npx tsc -b --pretty false` OK, ESLint focalizado OK y `cargo test --all-targets` compila pero el runner Windows continúa bloqueado por `0xc0000139 / STATUS_ENTRYPOINT_NOT_FOUND`.

## Registro de implementacion adicional 2026-09-07 (continuidad, historial y Telegram)

## Estado vigente del backlog — 2026-09-07

- Actualizacion de esta iteracion: la suite de privacidad web y la frontera nativa cubren headers, encoding, rutas privadas, IPs internas, datos laborales/legales/calendario y redaccion de resultados no confiables; Telegram valida entradas invalidas antes de red.

Este registro prevalece sobre los conteos históricos anteriores. Las marcas del checklist original se conservan para no reescribir retrospectivamente la planificación; aquí se refleja el estado comprobado después de la última iteración.

- [x] Consumidores locales: chat principal, Meeting, Telegram y Task Manager publicado pasan por `notiaChatRuntime`; las regresiones de edición documental, aclaración, target ambiguo y búsqueda web están cubiertas.
- [x] Telegram multimodal y feedback: texto, audio, imagen, PDF textual, PDF escaneado, búsqueda web, plan multi-step, aclaración, reintento, cancelación, cola y `/reanudar` tienen cobertura mockeada del hook.
- [x] Ciclo de vida local: el chat principal aborta streams al desmontar o pasar a background y no persiste respuestas tardías; Telegram conserva solo el sobre mínimo interrumpido.
- [x] Calidad local: `npm run lint`, `npm test -- --run`, `npm run build`, TypeScript, `cargo fmt`, `cargo check` y `git diff --check` quedan incluidos en la validación de entrega.
- [~] Seguridad de credenciales (`AI-028`, `AI-135`): Redux, `localStorage`, configuración portable, logs, URLs y eventos no conservan API keys; falta integrar el almacén seguro nativo persistente entre reinicios.
- [~] Planes (`AI-105`, `AI-105.7`, `AI-105.9`, `AI-105.14`, `AI-107`): el plan general, aprobación, dependencias, reintento aislado, cancelación, persistencia mínima y recuperación están implementados; falta exigir verificación uniforme en todos los catálogos y cerrar Android/background/retry/refresh.
- [~] Concurrencia y rendimiento (`AI-179`–`AI-182`): hay límites, cancelación, métricas redactadas y presupuesto tipado; faltan mediciones con corpus grande, bundle/memoria y hardware Android de referencia.
- [~] Seguridad web (`AI-140`–`AI-146`, `AI-155`): secretos, PII directa, rutas, redes privadas, credenciales y encoding están cubiertos; falta mantener un corpus lingüístico amplio y fuzzing sostenido.
- [~] DTO y plataforma (`AI-032`, `AI-034`, `AI-037`, `AI-038`, `AI-083`, `AI-169`, `AI-170`, `AI-173`, `AI-198`, `AI-200`, `AI-207`, `AI-208`): los contratos y fakes están cubiertos; quedan validación Gradle/Developer Mode, Android físico y espejo exhaustivo de DTOs.
- [!] Validación Rust en Windows (`AI-202`, `AI-204`): `cargo check` y formato pasan, pero el runner de tests aborta con `STATUS_ENTRYPOINT_NOT_FOUND`; Clippy sigue bloqueado por 52 diagnósticos de la librería y 54 al compilar tests, todos fuera del vertical slice de IA.
- [~] Integración Telegram (`AI-240`): el hook ya tiene cobertura amplia mockeada, incluidos multimodalidad, plan, búsqueda, recuperación, cola, concurrencia y edición de un mensaje de progreso con presupuesto persistido; siguen pendientes fallback, límite de payload, HTML inválido, rate limit contra Bot API y una corrida E2E real.
- [x] Flujo completo Telegram (`AI-241`): la integración mockeada cubre texto, audio, imagen, PDF, plan multi-step, error de tool, búsqueda web, cancelación, reanudación, cola y request concurrente.
- [!] Revisión manual final (`AI-216`) y validación manual Android (`AI-038`, `AI-170`, `AI-173`, `AI-208`) requieren interacción humana/dispositivo y quedan explícitamente bloqueadas desde este entorno.

## Registro de implementacion adicional 2026-09-07 (consumidores, ciclo de vida y calidad)

- Validacion actual: `npm test -- --run` OK (88 archivos, 451 pruebas), `npm run build` OK, `npx tsc -b --pretty false` OK, `npm run lint` OK sin warnings, `cargo fmt --all -- --check` OK, `cargo check --all-targets` OK y `git diff --check` OK (solo avisos LF/CRLF del checkout).

- `AI-056`: `useChatSubmitMessage` mantiene un guard de montaje, aborta la respuesta al desmontar y descarta una respuesta tardÃ­a antes de persistir mensajes, tÃ­tulos o memoria; `useChatSubmitMessage.test.ts` cubre la regresiÃ³n.
- `AI-190`: el chat principal, Meeting, Telegram y Task Manager publicado tienen pruebas de consumidor que verifican el paso por `notiaChatRuntime`; Finance queda cubierto por el scope financiero que Telegram construye sobre la misma fachada.
- `AI-191`/`AI-192`: el runtime documental tiene pruebas de selecciÃ³n con preview-confirmaciÃ³n-aplicaciÃ³n-escritura, ademÃ¡s de rechazo seguro sin selecciÃ³n y ante target ambiguo.
- `AI-194`: `useTelegramAgentBridge.integration.test.ts` cubre texto, elecciÃ³n de aclaraciÃ³n, imagen, memoria, error seguido de reintento y cancelaciÃ³n durante cleanup.
- `AI-197`: cada scope que expone bÃºsqueda web pasa por el contrato comÃºn y la prueba verifica sanitizaciÃ³n; Finance y Task Manager publicado no exponen `search_web`.
- `AI-205`: `npm run lint` queda en verde, sin errores ni warnings; se corrigieron refs durante render, dependencias de hooks, callbacks sin uso y un catch redundante.
- `AI-240`: ademÃ¡s del adapter y agregador, existe ciclo mockeado del hook de Telegram para respuesta, botones, HTML, multimodalidad, aclaraciÃ³n, error, reintento, cancelaciÃ³n y ediciÃ³n de progreso con presupuesto persistido. Quedan casos especÃ­ficos de fallback y lÃ­mite de tamaÃ±o para cerrar la tarea.

- `AI-160`: el clasificador reconoce continuaciones como “más corto”, “aplicalo también abajo”, “hacé lo mismo” y “volvé atrás”. El chat conserva el contexto de la conversación, reutiliza el último `operationId` únicamente para un undo explícito y deja la aclaración al agente cuando el objetivo no es resoluble.
- `AI-177`: el historial local ahora se muestra filtrado por documento, con fecha, resumen, estado, acción de undo y botón `Ver diff` para journals disponibles en la sesión. Si el contenido reversible ya no está en memoria, la UI informa la limitación sin inventar un diff.
- `AI-221`: las confirmaciones de Telegram ya no transportan preguntas generadas desde previews, argumentos de tools, operation IDs, rutas ni fragmentos privados; el canal recibe una instrucción breve para revisar y decidir.
- `AI-159` y `AI-163`: el prompt común exige un cierre breve de resultado verificable, pendientes y próximo paso; el preview también declara líneas/hunks y que el contenido fuera de ellos permanece intacto.
- Regresiones nuevas: continuidad/undo del clasificador, sanitización de confirmaciones Telegram, historial local y correlación de la fachada común; suite focalizada: 5 archivos y 66 pruebas OK.
- Validación de esta iteración: `npx tsc -b --pretty false` OK y ESLint focalizado de los archivos cambiados OK.
- ESLint focalizado del vertical slice: OK.
- `git diff --check`: OK; solo quedaron advertencias de normalizacion LF/CRLF.
- Regresion nueva: una sesion publicada no puede caer al transporte desktop general si falla su stream.
- Regresion nueva: Telegram conserva el `requestId` persistido en los eventos al reanudar, manteniendo el filtrado contra eventos obsoletos.
- `AI-162`/`AI-168`: el diff táctil ahora es un bottom sheet semántico con hunks desplazables, handle visual y cierre explícito.
- `AI-181`: el runtime mide cada tool con scope, nombre seguro, resultado y estado de cancelación/error; no se registran argumentos ni contenido.
- La validación Rust de `AI-028`/`AI-142` se centralizó para desktop y Android; `cargo check --all-targets` y la regresión de API key pasaron, mientras el runner de tests Windows sigue bloqueado por `STATUS_ENTRYPOINT_NOT_FOUND`.
- `AI-068`: el contrato exportado `AI_CONTEXT_BUDGET` centraliza los limites principales de memoria, contexto, archivos indexados y metadata; la calibracion del producto en hardware Android sigue separada.
- `AI-105.8`: todas las mutaciones planificables del catalogo exponen `planStepId` y `operationId`; el runtime agrega una correlacion opaca al resultado cuando una implementacion de dominio no la devuelve.
- `AI-146`: el corpus de sanitizacion suma URLs con credenciales, tokens codificados, telefono, red privada, ubicacion, headers, rutas, datos laborales/legales/calendario y JSON doblemente codificado; la frontera nativa y la respuesta de resultados tambiÃ©n quedan cubiertas.
- `AI-198`: se agregaron fixtures Rust para payloads desktop/Android de chat, tools, web search y eventos streaming con `requestId`; `cargo check --all-targets` y `cargo fmt --all -- --check` pasan.
- `AI-105.1`: el runtime ahora ofrece `create_agent_plan` y `update_agent_plan` como contrato general. Finance y `publishedScope` los filtran de forma explícita; la ejecución reutiliza aprobación, normalización y persistencia existentes.
