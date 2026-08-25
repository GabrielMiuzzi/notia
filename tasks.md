# Chats laterales de Task Manager y Graph View con herramientas y RAG

## Objetivo

Convertir los chats de IA del panel derecho de Task Manager, Graph View y archivos abiertos en agentes de lectura capaces de elegir y ejecutar herramientas sobre sus respectivos corpus dentro del vault activo.

El comportamiento esperado para la primera versión es:

- Task Manager no adjunta ningún ticket completo de antemano. El chat sólo conoce que su scope es Task Manager y dispone de herramientas sobre ese corpus.
- Ante preguntas generales o de listado sobre tareas, usar primero RAG y entregar al modelo sólo los fragmentos relevantes.
- Si el usuario pide detalles, contenido completo o profundizar en uno o varios tickets, resolverlos y leer únicamente esos archivos como contexto directo.
- En Graph View, si el usuario selecciona explícitamente uno o varios archivos, leer esos archivos como contexto directo.
- En Graph View, si el usuario menciona uno o varios archivos por título sin seleccionarlos, buscarlos con herramientas y leer todos los resultados inequívocos como contexto directo.
- En Graph View, si no hay selección explícita ni títulos identificables, usar RAG sobre los archivos admitidos de toda la biblioteca.
- Cuando el chat está asociado a un archivo abierto, ese archivo es el único contexto inicialmente autorizado. Antes de leer otro archivo, el agente debe localizarlo y pedir permiso explícito al usuario.
- Mantener el alcance de las herramientas limitado a lectura. Esta versión no crea, modifica, mueve ni elimina tickets.
- Funcionar con el mismo contrato observable en Windows y Android, incluido SAF.

## Decisiones de alcance v1

- El corpus incluye todos los archivos que `isTaskMarkdownFile` reconoce dentro de Task Manager en el vault activo, no sólo el tablero visible. Deben incluirse tareas, subtareas, completadas y canceladas; deben excluirse índices, logs de Pomodoro y archivos ajenos al módulo.
- El corpus de Graph View incluye los documentos Markdown admitidos por el índice de biblioteca y visibles para el grafo/búsqueda. Debe excluir `.notia/`, historiales de chat, índices técnicos, archivos binarios y cualquier ruta no destinada a contexto de usuario.
- El título canónico de un ticket es `TaskItem.title` (frontmatter `tarea`) y el nombre del archivo funciona como alias.
- Para Graph View, el título canónico es el título extraído del documento cuando exista; el nombre sin extensión y la ruta lógica funcionan como alias.
- RAG v1 será local y lexical, sin agregar dependencias ni requerir un servicio externo de embeddings. Debe recuperar y rankear fragmentos por título, metadatos y cuerpo. La API interna debe permitir sustituir el ranker por embeddings más adelante sin cambiar el chat ni las herramientas.
- La aplicación controla el ciclo de herramientas y valida sus argumentos. No se confía en rutas inventadas por el modelo ni se permite que el modelo lea archivos arbitrarios.
- Ollama tool calling nativo mediante `/api/chat` es un requisito de esta funcionalidad. Las definiciones de las herramientas autorizadas se envían en cada turno y el runtime procesa `message.tool_calls` y mensajes con rol `tool`.
- Enviar nuevamente las herramientas del scope en cada llamada del loop, incluidas las continuaciones posteriores a resultados y aclaraciones, para que el modelo conozca en todo momento las capacidades vigentes.
- Antes de iniciar un turno agente, comprobar que el modelo seleccionado admite tools mediante capacidades reportadas o una prueba controlada. Si no las admite, bloquear el modo agente con un error accionable y permitir elegir un modelo compatible; no simular llamadas mediante JSON libre.
- El agente puede solicitar información faltante al usuario durante una ejecución, pausar el ciclo y reanudarlo con la respuesta, como un agente CLI interactivo.
- La sesión del panel derecho conserva su alcance de Task Manager, pero el contexto se resuelve por turno. No se adjuntan de entrada todos los contenidos completos.
- La selección visible de Graph View tiene precedencia sobre la detección de títulos y sobre RAG. Quitar toda la selección devuelve el siguiente turno al modo agente/RAG.
- En el scope de archivo abierto, buscar títulos/rutas en el catálogo está permitido para poder identificar candidatos, pero recuperar fragmentos o contenido de otro archivo requiere consentimiento previo.
- Los permisos de lectura son específicos para los `documentId` mostrados y para la consulta pendiente. No se convierten silenciosamente en permiso global ni sobreviven a un cambio de biblioteca.

## Contrato funcional

### Consultas y detalle de tickets

Ejemplos:

- `¿Cuál es el estado de Migrar autenticación?`
- `Compará Migrar autenticación, Corregir búsqueda y Preparar release.`
- `Leé los tickets "Migrar autenticación" y "Preparar release".`

Flujo esperado cuando se nombra un ticket:

1. Detectar que la consulta contiene uno o varios títulos candidatos.
2. Ejecutar `search_task_tickets` para resolver cada candidato contra el catálogo permitido.
3. Resolver primero coincidencia exacta normalizada sobre `title`; después alias de archivo; finalmente coincidencia parcial/fuzzy con score mínimo explícito.
4. Si la pregunta puede resolverse con título y metadatos o fragmentos relevantes, ejecutar `search_task_context` acotado a los tickets resueltos.
5. Sólo si el usuario pide detalle, contenido completo, análisis profundo o continuar más allá de los fragmentos recuperados, ejecutar una llamada agrupada a `read_task_tickets` con los identificadores internos resueltos.
6. Entregar al modelo únicamente los fragmentos o Markdown necesarios, sujeto al presupuesto global de contexto.
7. Mostrar en la respuesta qué tickets fueron consultados y cuáles se leyeron completos.

No se debe elegir silenciosamente cuando haya empate o baja confianza. El agente debe informar las coincidencias posibles y pedir al usuario que aclare el título. Si algunos títulos se resuelven y otros no, puede responder sobre los resueltos, pero debe identificar claramente los faltantes.

La aclaración debe realizarse mediante la herramienta `request_user_clarification`, no como una respuesta final que cierre la ejecución. El turno queda en estado `awaiting-user`, sin I/O ni recursos abiertos, y continúa cuando el usuario responde o se cancela.

### Consulta general

Ejemplos:

- `¿Qué tareas urgentes están bloqueadas?`
- `Resumí el trabajo pendiente de esta semana.`
- `¿En qué deberíamos enfocarnos primero?`

Flujo esperado:

1. Ejecutar `search_task_context` con la pregunta del usuario y filtros opcionales inferidos de forma segura (tablero, estado o prioridad).
2. Buscar únicamente dentro del corpus de Task Manager del vault activo.
3. Recuperar los mejores fragmentos con su ticket, ruta lógica, metadatos y score.
4. Deduplicar fragmentos del mismo ticket y respetar top-k, tamaño máximo por fragmento y presupuesto total.
5. Construir el contexto RAG con referencias estables al ticket de origen.
6. Responder basándose en los resultados recuperados e indicar cuando no haya evidencia suficiente.
7. Si el usuario pide ampliar un resultado o el RAG indica que falta contexto esencial, resolver los `ticketId` de las fuentes y usar `read_task_tickets` sólo para esos tickets.

### Consultas mixtas y seguimiento

- Si una pregunta menciona tickets y además pide una comparación global, se permite combinar lectura directa de los tickets nombrados con RAG para el resto de la pregunta.
- Los pronombres de seguimiento (`ese ticket`, `los anteriores`) pueden resolverse desde los resultados de herramientas del historial reciente, nunca desde una ruta generada libremente por el modelo.
- Cada turno recalcula la recuperación para evitar usar contenido obsoleto después de editar, mover o eliminar tickets o documentos.

### Graph View

Ejemplos:

- Con `Arquitectura.md` seleccionado: `Resumí este documento.`
- Sin selección: `Compará Arquitectura y Decisiones técnicas.`
- Sin selección ni título: `¿Qué documentos hablan de sincronización en Android?`

Orden de resolución por turno:

1. Si existen archivos seleccionados explícitamente en Graph View, ejecutar su lectura directa y no ampliar el corpus mediante RAG salvo que el usuario lo pida expresamente.
2. Si no hay selección, detectar uno o varios títulos candidatos y ejecutar `search_library_documents`.
3. Leer con `read_library_documents` todas las coincidencias inequívocas; informar títulos faltantes o ambiguos con las mismas reglas usadas para tickets.
4. Si no hay selección ni títulos concretos, ejecutar `search_library_context` y responder usando los fragmentos recuperados.
5. Mostrar las fuentes utilizadas y permitir abrir o seleccionar cada archivo desde el resultado cuando la UI existente lo soporte.

Las herramientas de Graph View deben buscar por título, nombre de archivo, ruta lógica y contenido indexado. La autorización final de lectura siempre se realiza con un identificador del catálogo, nunca con una ruta producida por el modelo.

### Chat asociado a un archivo abierto

Ejemplos:

- Con `Arquitectura.md` abierto: `Resumí este archivo.` → usar únicamente el archivo activo.
- Con `Arquitectura.md` abierto: `¿Qué dice Decisiones técnicas sobre Android?` → localizar el candidato, pedir permiso y leerlo sólo si el usuario acepta.
- Con `Arquitectura.md` abierto: `Comparalo con Seguridad y Privacidad.` → pedir en una única interacción permiso para ambos archivos resueltos.

Flujo esperado:

1. Crear el scope `document-agent` con el `documentId` activo como única fuente autorizada inicialmente.
2. Responder sobre el archivo activo usando su contenido directo y sin buscar otros documentos salvo que la consulta lo requiera.
3. Si el usuario menciona otro archivo, ejecutar `search_library_documents` únicamente sobre metadatos para resolver título y ambigüedades; esta búsqueda no autoriza leer contenido.
4. Mostrar nombre, ruta lógica y motivo de cada lectura solicitada mediante `request_file_read_permission`.
5. Si el usuario acepta, registrar el permiso para los IDs exactos y continuar la misma ejecución con `read_library_documents` o RAG acotado a esos documentos.
6. Si rechaza, continuar sólo con el archivo activo, explicar la limitación y no volver a pedir el mismo permiso durante ese turno.
7. Si la consulta requeriría buscar contenido de toda la biblioteca, pedir primero permiso indicando claramente el alcance. No ejecutar RAG global desde un archivo abierto de manera implícita.

La autorización del archivo activo se actualiza al cambiar de pestaña. Un archivo autorizado anteriormente no debe heredarse automáticamente por la nueva pestaña.

## Herramientas v1

Definir contratos TypeScript explícitos y validar sus entradas en runtime.

### `search_task_tickets`

Entrada:

```ts
interface SearchTaskTicketsInput {
  titles: string[]
  limitPerTitle?: number
}
```

Salida:

```ts
interface TaskTicketMatch {
  ticketId: string
  title: string
  fileName: string
  logicalPath: string
  board: string
  state: TaskState
  score: number
  matchKind: 'exact-title' | 'exact-file' | 'partial' | 'fuzzy'
}
```

### `read_task_tickets`

Entrada: una lista no vacía y acotada de `ticketId` producidos por el catálogo actual. No acepta rutas.

Salida por ticket: identificador, título, ruta lógica, metadatos normalizados, contenido Markdown y, si corresponde, un error categorizado (`not-found`, `stale`, `too-large`, `read-failed`).

Antes de leer, volver a comprobar que la ruta resuelta pertenece al vault activo y sigue siendo un archivo válido de Task Manager. Aplicar límites por archivo, cantidad de archivos y caracteres totales.

### `search_task_context`

Entrada:

```ts
interface SearchTaskContextInput {
  query: string
  filters?: {
    boards?: string[]
    states?: TaskState[]
    priorities?: TaskPriority[]
  }
  topK?: number
}
```

Salida: fragmentos rankeados con `ticketId`, título, ruta lógica, rango o índice de fragmento, texto, metadatos y score. No devolver contenido fuera del corpus autorizado.

### Herramientas de Graph View

Definir contratos equivalentes, pero separados, para evitar mezclar permisos y tipos de dominio:

- `search_library_documents`: recibe uno o varios títulos y devuelve coincidencias rankeadas con `documentId`, título, nombre, ruta lógica, tipo y clase de coincidencia.
- `read_library_documents`: recibe exclusivamente `documentId` emitidos por el catálogo actual y devuelve el contenido completo sujeto a límites.
- `search_library_context`: recibe la consulta, filtros opcionales de tipo/carpeta y `topK`; devuelve fragmentos RAG con fuente y score.

La selección explícita debe transformarse internamente a `documentId` validados antes de llamar a `read_library_documents`; no debe constituir una vía alternativa que omita las comprobaciones de alcance.

### `request_user_clarification`

Herramienta común disponible en Task Manager y Graph View cuando el agente no puede continuar de forma segura sin una decisión del usuario.

```ts
interface RequestUserClarificationInput {
  question: string
  options?: Array<{
    id: string
    label: string
    description?: string
  }>
  allowFreeText: boolean
  reason: 'ambiguous-match' | 'missing-information' | 'scope-choice' | 'confirmation'
}
```

Reglas:

- Usarla sólo cuando la respuesta cambie materialmente la búsqueda o evite elegir de forma arbitraria; no preguntar por datos que las herramientas puedan descubrir.
- Permitir una pregunta breve por vez. Las opciones son opcionales, mutuamente excluyentes y deben usar IDs opacos generados por la aplicación cuando representen archivos.
- Nunca incluir rutas absolutas, contenido privado completo ni argumentos internos en la pregunta.
- Al ejecutarse, persistir un estado mínimo y serializable del turno (`runId`, scope, historial de mensajes/tool calls, pregunta y opciones), establecer `awaiting-user` y liberar listeners, streams y operaciones de filesystem.
- La siguiente respuesta del usuario se agrega como resultado de la herramienta con rol `tool`; después se reanuda el mismo loop nativo con las herramientas del scope original.
- Permitir cancelar la ejecución mientras espera. Al cambiar de vault, biblioteca o scope, invalidar la aclaración pendiente y pedir iniciar una consulta nueva.
- Aplicar un máximo de aclaraciones por turno para impedir ciclos infinitos.

### `request_file_read_permission`

Herramienta interactiva exclusiva de `document-agent`. Pausa el loop antes de cualquier lectura fuera del archivo activo.

```ts
interface RequestFileReadPermissionInput {
  reason: string
  documents: Array<{
    documentId: string
    label: string
    logicalPath: string
  }>
  access: 'full-content' | 'rag-fragments'
}
```

- La aplicación reconstruye labels y rutas desde los IDs validados; no confía en los valores mostrables generados por el modelo.
- La respuesta produce `grantedDocumentIds` y `deniedDocumentIds`. Sólo los primeros se incorporan al conjunto autorizado de la ejecución.
- Para RAG global, la UI debe describir el corpus solicitado y ofrecer aceptar o rechazar; no presentar una lista enorme de archivos.
- El permiso debe quedar visible en el hilo y ser revocable cancelando el turno. No equivale a autorización para modificar archivos.

## Rutinas de comportamiento del prompt

Construir el system prompt por composición: reglas base seguras + rutina del scope + herramientas realmente disponibles. No dispersar estas instrucciones como strings ad hoc en componentes.

### Rutina `task-agent`

- Informar al modelo que está en Task Manager y que ningún contenido completo fue adjuntado automáticamente.
- Para preguntas temáticas generales (`mis tareas`, prioridades, vencimientos, bloqueos), llamar primero a `search_task_context`.
- Para pedidos exhaustivos (`todos los tickets`, inventario, conteo, resumen completo o comparación global), llamar a `read_all_task_tickets`; no presentar resultados RAG parciales como si fueran el total.
- No llamar a `read_task_tickets` para listar o contar si los metadatos/fragmentos RAG alcanzan.
- Ante `dame más detalles`, `profundizá`, `leé el ticket` o evidencia RAG insuficiente, leer sólo los tickets fuente necesarios.
- Mantener diferenciados hechos recuperados, inferencias y ausencia de evidencia; citar títulos consultados.
- El scope Task Manager autoriza la lectura de tickets válidos mediante herramientas, por lo que no pide permiso archivo por archivo; sí debe pedir aclaración ante ambigüedad o una decisión material.

### Rutina `graph-agent`

- Priorizar archivos seleccionados como contexto directo.
- Sin selección, buscar títulos nombrados; sin títulos, usar RAG sobre el corpus permitido.
- No ampliar una selección explícita salvo petición del usuario y mostrar siempre las fuentes utilizadas.

### Rutina `document-agent`

- Tratar el archivo activo como único contexto autorizado de inicio.
- No afirmar que conoce otro archivo por recuerdos del modelo o por su nombre en el índice.
- Puede buscar metadatos para resolver qué archivo pidió el usuario, pero debe ejecutar `request_file_read_permission` antes de recuperar fragmentos o contenido.
- Agrupar en una sola solicitud todos los archivos inequívocos necesarios y explicar brevemente para qué se leerán.
- Respetar una negativa y responder con el contexto disponible, sin degradar silenciosamente a RAG global.
- Preguntar mediante herramientas interactivas cuando falte permiso, exista ambigüedad o la intención cambie el alcance.

## Diseño técnico propuesto

Mantener el flujo:

`ChatWorkspaceView -> useChatSubmitMessage -> scoped agent runtime -> tools -> servicios de dominio/filesystem -> Ollama`

Responsabilidades:

- `modules/task-manager/engines/`: normalización de títulos, matching, chunking, scoring, deduplicación y selección dentro del presupuesto. Todo debe ser puro y testeable.
- `modules/task-manager/services/`: catálogo de tickets, lectura validada, índice RAG, caché acotada e invalidación.
- `services/libraries/`: catálogo documental y RAG de Graph View, reutilizando y extendiendo `librarySearchGraphIndex` sin exponer su caché a la UI.
- `services/ai/`: transporte Ollama, composición de prompts por scope y ciclo genérico de tool calls; no debe conocer detalles de filesystem de Task Manager, Graph View o documentos.
- `components/notia/views/chat/`: coordinación del turno, streaming, cancelación y presentación de actividad/errores; no lee archivos directamente.
- `components/notia/hooks/useRightPanelChatContext.ts`: selecciona `task-agent`, `graph-agent`, `document-agent` o contexto estático y aplica contexto, permisos y precedencias sin confundir `index` con RAG.

No reutilizar `ChatFileContextMode = 'index'` como si ya fuera RAG. Actualmente ese modo sólo envía nombres y rutas desde `buildFileContextSection`. Separar conceptos mediante un contrato de estrategia, por ejemplo `static-direct | static-reference | task-agent | graph-agent | document-agent`, y mantener compatibilidad con chats existentes.

## Plan de implementación

### 1. Caracterizar y proteger el comportamiento actual

- [ ] Agregar pruebas de caracterización para `TaskManagerChatContext`, `resolveRightPanelPreferredContextMode`, creación/selección de la sesión lateral y envío actual de archivos.
- [ ] Documentar el contrato persistido de `selectedContextMode`, `selectedContextFiles` y `contextScopeKey` antes de modificarlo.
- [ ] Agregar pruebas de caracterización para la selección explícita, el contexto efímero y el cambio entre selección directa e índice en Graph View.
- [ ] Confirmar que el cambio no altera el chat principal ni las políticas de contexto de documentos abiertos.
- [ ] Caracterizar qué contenido recibe hoy el chat al estar en un archivo y cómo cambia su sesión al alternar pestañas.

### 2. Crear el catálogo seguro de tickets

- [ ] Reemplazar `TaskManagerChatContext.filePaths` por un contexto mínimo que identifique el vault y el alcance del agente, sin cargar contenido.
- [ ] Construir descriptores desde el snapshot existente (`documents` y `tasks`) reutilizando `isTaskMarkdownFile` y el parser de frontmatter.
- [ ] Asignar un `ticketId` estable durante la vida del catálogo y mantener la ruta como detalle interno.
- [ ] Normalizar títulos de forma determinista: Unicode, mayúsculas/minúsculas, espacios, extensión y puntuación; conservar el original para mostrarlo.
- [ ] Indexar título canónico, nombre de archivo, tablero, estado, prioridad y relaciones padre/subtarea.
- [ ] Invalidar o reconstruir el catálogo cuando cambie el vault o el árbol de Task Manager.

### 3. Implementar resolución de uno o varios títulos

- [ ] Crear el engine puro de matching con prioridad exacta > alias exacto > parcial > fuzzy.
- [ ] Definir umbrales y margen mínimo entre primer y segundo resultado para considerar una coincidencia inequívoca.
- [ ] Resolver cada título de manera independiente y conservar el orden solicitado por el usuario.
- [ ] Deduplicar títulos que apuntan al mismo ticket.
- [ ] Cubrir títulos con comas, comillas, acentos, mayúsculas, nombres parcialmente iguales y tableros distintos.
- [ ] Nunca usar substring matching para autorizar una ruta; el engine devuelve IDs existentes y el servicio vuelve a validarlos.

### 4. Implementar el RAG local de Task Manager

- [ ] Reutilizar las ideas de caché e invalidación de `librarySearchGraphIndex`, pero crear una API acotada a tickets en vez de filtrar resultados después de una búsqueda global.
- [ ] Separar frontmatter y cuerpo; generar fragmentos solapados con límites definidos y sin cortar de forma innecesaria encabezados/listas.
- [ ] Enriquecer cada fragmento con título, tablero, estado, prioridad, fechas y relación padre/subtarea.
- [ ] Rankear coincidencias normalizadas de términos/frases, dando más peso al título y metadatos relevantes que al cuerpo.
- [ ] Aplicar filtros antes del ranking, top-k después del ranking y diversidad por ticket para evitar que un archivo monopolice el contexto.
- [ ] Definir límites iniciales medibles para tablet Android: tamaño máximo de corpus en memoria, caracteres por fragmento, top-k y tiempo objetivo de búsqueda.
- [ ] Construir el índice de forma incremental o por lotes, permitir cancelación y evitar bloquear el render.
- [ ] Invalidar únicamente tickets afectados cuando se crean, guardan, renombran, mueven o eliminan; hacer full refresh al cambiar de vault.
- [ ] No persistir contenido privado fuera del vault; si se agrega persistencia del índice en el futuro, debe ser versionada y recuperable.

### 4b. Extender el catálogo y RAG de Graph View

- [ ] Definir en un único engine la regla de qué tipos y carpetas pertenecen al corpus documental permitido.
- [ ] Extender `librarySearchGraphIndex` para devolver resultados rankeados y fragmentos con contenido, no sólo una lista de rutas que contienen la consulta.
- [ ] Extraer títulos canónicos y aliases sin duplicar la lógica de Graph View existente.
- [ ] Crear IDs internos estables para documentos y revalidarlos contra la biblioteca activa antes de leer.
- [ ] Reutilizar chunking, presupuesto, diversidad, cancelación e invalidación del RAG común donde sean agnósticos al dominio.
- [ ] Mantener metadatos específicos separados: tickets conservan estado/prioridad/tablero; documentos conservan tipo/carpeta/título.
- [ ] Verificar que cambios del filesystem, guardado del editor y refresh Android invaliden los fragmentos afectados.
- [ ] Evitar indexar `linkCache.md`, archivos bajo `.notia/`, chats y otros artefactos técnicos como fuentes del agente.

### 5. Crear el runtime de herramientas/agente

- [ ] Extender los contratos de mensajes de IA con rol `tool`, `toolName`, `toolCallId` y `toolCalls`, conservando compatibilidad al leer chats anteriores.
- [ ] Definir una unión discriminada para herramientas, argumentos, resultados y errores.
- [ ] Agregar validación runtime de cada llamada y límites de cantidad de iteraciones, llamadas por turno y tamaño acumulado.
- [ ] Implementar las tres herramientas de Task Manager y las tres de Graph View contra sus respectivos catálogos/RAG.
- [ ] Implementar `request_user_clarification` como herramienta común controlada por la aplicación.
- [ ] Implementar `request_file_read_permission` y un conjunto inmutable por paso de `authorizedDocumentIds` dentro del checkpoint del agente.
- [ ] Proveer al modelo únicamente las herramientas autorizadas para el scope activo; el agente de Graph View nunca puede invocar herramientas de tickets y viceversa.
- [ ] Implementar el bucle nativo de Ollama: enviar `tools`, recibir `message.tool_calls`, validar, ejecutar, agregar el mensaje del asistente y los resultados con rol `tool`, y repetir hasta obtener una respuesta final.
- [ ] En streaming, acumular `thinking`, `content` y todos los `tool_calls` antes de ejecutar herramientas y reenviar el mensaje completo en la siguiente petición.
- [ ] Soportar llamadas paralelas sólo para herramientas independientes de lectura; ejecutar de forma secuencial las que dependan de resultados anteriores o soliciten interacción humana.
- [ ] Detectar soporte nativo de tools antes del turno y mostrar un selector/error accionable para modelos incompatibles. No implementar fallback basado en JSON generado como texto.
- [ ] Modelar el estado del agente como `idle | running | executing-tools | awaiting-user | streaming-answer | success | error | cancelled`.
- [ ] Pausar el loop al recibir `request_user_clarification`, persistir el checkpoint mínimo y reanudarlo con la respuesta del usuario como resultado de herramienta.
- [ ] Aplicar la misma pausa/reanudación a permisos de archivo y comprobar autorización inmediatamente antes de cada búsqueda de contenido o lectura.
- [ ] Implementar un compositor de system prompts testeable con rutinas separadas para `task-agent`, `graph-agent` y `document-agent`.
- [ ] Compartir la misma lógica del agente entre transporte desktop y bridge Android.
- [ ] Propagar `AbortSignal` a planificación, búsqueda, lectura y streaming; limpiar listeners y descartar resultados de un turno cancelado.
- [ ] Evitar long-term memory automática para resultados privados de herramientas, salvo una decisión de producto explícita posterior.

### 6. Integrar el agente con el chat lateral

- [ ] Activar `task-agent` sólo cuando `activeWorkspaceView === 'task-manager'` y exista un vault válido.
- [ ] Activar `graph-agent` cuando `activeWorkspaceView === 'graph'`; pasar la selección actual como IDs/rutas candidatas que el servicio debe validar.
- [ ] Activar `document-agent` para un archivo textual abierto y autorizar inicialmente sólo su `documentId`.
- [ ] Aplicar en Graph View la precedencia `selección directa > títulos nombrados > RAG` en cada turno.
- [ ] Dejar de cargar todos los tickets con `loadInlineFileAttachments` antes de cada mensaje.
- [ ] No incluir `TaskManagerChatContext.filePaths` ni contenidos completos en la creación del chat; pasar únicamente scope, vault y capacidades.
- [ ] Dejar de tratar `resolveGraphChatContextMode(false) === 'index'` como RAG: la ausencia de selección debe activar `search_library_context` y adjuntar fragmentos recuperados.
- [ ] Mantener una única acción de envío para teclado, mouse y touch.
- [ ] Conservar la sesión al cambiar de tablero si el alcance sigue siendo todo Task Manager; no remonte el chat sólo por cambiar la pestaña visible.
- [ ] Actualizar el label del compositor para indicar `Agente de Task Manager · contexto bajo demanda` y mostrar los tickets/fuentes utilizados en el turno.
- [ ] En Graph View, distinguir visualmente `N archivos seleccionados`, `Agente de biblioteca · RAG` y las fuentes recuperadas del turno.
- [ ] En archivos, mostrar `Contexto: <archivo activo>` y distinguir archivos adicionales `pendientes de permiso`/`autorizados en este turno`.
- [ ] Mostrar estados accesibles `Buscando tickets`, `Leyendo N tickets` y `Consultando contexto`, con `aria-live` sin anunciar cada token del stream.
- [ ] Renderizar las aclaraciones dentro del hilo con opciones táctiles accesibles, entrada de texto cuando corresponda y acciones `Responder`/`Cancelar`; el compositor normal puede reutilizarse si mantiene claro que responde a una pregunta pendiente.
- [ ] Mientras el agente está en `awaiting-user`, impedir un segundo envío independiente en esa misma sesión o permitir cancelarlo explícitamente antes de comenzar otro.
- [ ] Renderizar permisos con acciones accesibles `Permitir lectura` y `No permitir`, agrupando varios archivos y describiendo `contenido completo` o `fragmentos RAG`.
- [ ] Presentar errores parciales de lectura y ambigüedades sin perder el borrador ni el historial.
- [ ] Mantener botón Cancelar visible y táctil; objetivos de al menos 48x48 CSS px en Android.

### 7. Seguridad, privacidad y robustez

- [ ] Normalizar y validar rutas con las utilidades existentes; confirmar pertenencia al vault antes de todo I/O.
- [ ] En Android, resolver lecturas mediante el `androidTreeUri`/SAF vigente, sin asumir rutas de escritorio.
- [ ] Limitar títulos solicitados, resultados, archivos leídos, tamaño individual, contexto total y tool-call rounds.
- [ ] Tratar contenido Markdown/frontmatter como datos no confiables y delimitarlo frente a prompt injection; las instrucciones encontradas dentro de tickets o documentos nunca autorizan herramientas ni amplían permisos.
- [ ] No registrar contenido, prompts completos, API keys ni resultados de herramientas. Registrar sólo métricas seguras, categorías de error y conteos.
- [ ] Si el índice está obsoleto, revalidar el ticket antes de leer y devolver un error recuperable.
- [ ] Si RAG no recupera evidencia suficiente, responder que no se encontró información en vez de inventar.
- [ ] Aplicar listas de exclusión y comprobaciones de corpus independientes para Task Manager y Graph View; un `documentId` o `ticketId` de otro scope debe rechazarse.
- [ ] Validar nombre, ID, argumentos y schema de cada `tool_call`; devolver un error de herramienta seguro ante llamadas desconocidas sin ejecutar efectos.
- [ ] No mantener handles de filesystem, streams HTTP, listeners ni locks mientras el agente espera una aclaración del usuario.
- [ ] En `document-agent`, comprobar `authorizedDocumentIds` tanto en RAG como en lectura directa; una búsqueda de metadatos no concede acceso al contenido indexado.

### 8. Pruebas

- [ ] Unitarias: normalización, matching exacto/parcial/fuzzy, ambigüedad, múltiples títulos, deduplicación y límites.
- [ ] Unitarias: chunking, ranking, filtros, diversidad, presupuesto de contexto y corpus vacío.
- [ ] Unitarias: validación de argumentos, rechazo de IDs/rutas desconocidos, límite de rondas y cancelación.
- [ ] Unitarias: parsing/acumulación de tool calls nativas simples, paralelas y por streaming; rechazo de herramienta o argumentos inválidos.
- [ ] Unitarias: transiciones hacia/desde `awaiting-user`, límite de aclaraciones, cancelación e invalidación por cambio de scope.
- [ ] Integración: pregunta por un ticket y lectura directa de su Markdown completo.
- [ ] Integración: pregunta por varios títulos y una única lectura agrupada de todos.
- [ ] Integración: consulta sin título y recuperación RAG de fragmentos relevantes, sin adjuntar todo el corpus.
- [ ] Integración: título ambiguo, inexistente, archivo eliminado entre búsqueda y lectura, lectura parcial fallida y ticket demasiado grande.
- [ ] Integración: consulta mixta que combina tickets explícitos con RAG.
- [ ] Graph View: uno y varios archivos seleccionados se leen directamente y tienen precedencia sobre RAG.
- [ ] Graph View: uno y varios títulos nombrados sin selección se resuelven y leen mediante herramientas.
- [ ] Graph View: sin selección ni títulos se recuperan fragmentos RAG relevantes y no se adjunta toda la biblioteca.
- [ ] Graph View: ambigüedad, documento inexistente, archivo excluido, ID de otro scope y cambio de selección durante un turno.
- [ ] Regresión: documentos abiertos y chat principal conservan sus políticas de contexto.
- [ ] React: estados de herramientas, cancelación, error accesible y conservación de borrador desde la perspectiva del usuario.
- [ ] Android: tests/adapters para rutas SAF y resultados equivalentes a desktop.
- [ ] Integración Ollama: mensaje con tool call, resultado con rol `tool`, segunda llamada al modelo y respuesta final.
- [ ] Integración interactiva: título ambiguo, `request_user_clarification`, respuesta del usuario y reanudación de la misma ejecución.
- [ ] Document agent: pregunta sobre archivo activo sin pedir permiso ni acceder a otras fuentes.
- [ ] Document agent: mención de otro archivo, búsqueda sólo por metadatos, permiso aceptado y lectura posterior.
- [ ] Document agent: permiso rechazado, lectura nunca ejecutada y respuesta limitada al contexto autorizado.
- [ ] Document agent: varios archivos agrupados, permiso parcial, RAG global solicitado y cambio de pestaña que invalida permisos.
- [ ] Prompts: snapshots pequeños o aserciones semánticas que verifiquen las rutinas de cada scope y la lista exacta de herramientas expuesta.

### 9. Documentación y observabilidad

- [ ] Actualizar `README.md`: el chat de Task Manager usa lectura directa sólo para tickets nombrados y RAG para consultas generales.
- [ ] Actualizar `README.md`: Graph View usa selección directa, herramientas para títulos nombrados y RAG cuando no hay selección ni archivos concretos.
- [ ] Actualizar `README.md`: en un archivo abierto, cualquier lectura adicional requiere permiso explícito y visible.
- [ ] Actualizar `README-TECH.md` y `AGENTS-DOC.md` con contratos, flujo del agente, límites, invalidación y frontera Ollama/Tauri.
- [ ] Agregar mediciones seguras: latencia de planificación, construcción/búsqueda del índice, lecturas, rondas, fragmentos y caracteres enviados.
- [ ] Documentar limitaciones de RAG lexical y el punto de extensión para embeddings.
- [ ] Documentar que el agente requiere un modelo Ollama con tool calling nativo, cómo se detecta la capacidad y qué hacer si el modelo seleccionado no es compatible.

## Criterios de aceptación

- [ ] Al preguntar por un título exacto se recuperan primero sus metadatos/fragmentos; sólo una petición de detalle lee ese ticket completo.
- [ ] Al pedir detalles de tres títulos inequívocos se leen únicamente esos tres y la respuesta puede compararlos con referencias claras.
- [ ] Un título ambiguo no provoca una lectura arbitraria; el usuario recibe opciones para aclarar.
- [ ] El agente pausa el turno mediante `request_user_clarification`, acepta una respuesta y continúa el mismo ciclo de herramientas hasta completar la consulta.
- [ ] Las herramientas se invocan mediante `tools`/`message.tool_calls` nativos de Ollama; no se interpretan bloques JSON de texto como órdenes ejecutables.
- [ ] Un modelo sin soporte nativo queda bloqueado antes de ejecutar el agente y la UI ofrece seleccionar uno compatible.
- [ ] Una pregunta sin títulos ejecuta RAG sobre todos los tickets válidos del vault y no envía todos sus contenidos al modelo.
- [ ] Al abrir Task Manager, crear el chat o cambiar de tablero no se adjunta el contenido completo de ningún ticket.
- [ ] Una pregunta general de Task Manager usa RAG; una solicitud posterior de más detalle lee completos sólo los tickets fuente necesarios.
- [ ] Tareas, subtareas, completadas y canceladas pueden recuperarse; índices y Pomodoro no forman parte del corpus.
- [ ] Ninguna herramienta puede leer fuera del vault activo ni fuera del corpus de Task Manager.
- [ ] En Graph View, los archivos seleccionados explícitamente se leen como contexto directo.
- [ ] En Graph View, al nombrar dos documentos sin seleccionarlos se buscan y leen ambos si son inequívocos.
- [ ] En Graph View, una consulta sin selección ni títulos ejecuta RAG real sobre el corpus permitido y utiliza fragmentos con fuente.
- [ ] Las herramientas de Graph View no leen artefactos técnicos, chats, binarios ni archivos fuera de la biblioteca activa.
- [ ] En un archivo abierto, el agente puede usar el archivo activo sin preguntar, pero solicita permiso antes de leer o recuperar contenido de cualquier otro archivo.
- [ ] Rechazar el permiso impide efectivamente la lectura; aceptar varios archivos autoriza únicamente los IDs mostrados y sólo para la consulta pendiente.
- [ ] Cada scope recibe una rutina de prompt específica que guía el orden de herramientas y no puede ampliar los permisos impuestos por la aplicación.
- [ ] La cancelación detiene búsqueda, lectura y respuesta sin listeners o Promises huérfanos.
- [ ] La cancelación también elimina de forma segura cualquier aclaración pendiente y su checkpoint.
- [ ] El comportamiento es equivalente en Windows y Android, con errores seguros y accionables.
- [ ] El chat principal y la navegación/selección del grafo no presentan regresiones.
- [ ] Las validaciones aplicables pasan y las pendientes de dispositivo físico quedan documentadas.

## Validación final

Ejecutar desde la raíz:

```bash
npm run lint
npm test
npm run build
```

Si se modifica Rust o la frontera Tauri, ejecutar además desde `src-tauri/`:

```bash
cargo fmt --all -- --check
cargo check --all-targets
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
```

Para Android:

```bash
npm run build:android:debug
```

Queda pendiente una prueba manual en tableta física que cubra panel angosto/ancho, orientación, teclado virtual, cancelación, suspensión/reanudación y rendimiento con un vault grande.

## Fuera de alcance v1

- Crear, editar, mover, completar o eliminar tickets desde la IA.
- Confirmaciones para herramientas con efectos secundarios.
- Búsqueda cruzada entre el corpus de Task Manager y el corpus documental de Graph View dentro del mismo turno.
- Búsqueda fuera del vault/biblioteca activa o dentro de los archivos excluidos de cada corpus.
- Embeddings remotos o una base vectorial nueva.
- Persistir resultados de herramientas como memoria a largo plazo.
