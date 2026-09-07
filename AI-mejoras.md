# Propuesta de mejoras de IA para Notia

**Fecha:** 2026-09-06
**Estado de implementación:** el vertical slice de documento activo ya cuenta con movimiento de bloques, diff con anchors, aplicación selectiva por hunk, verificación y persistencia mínima de planes. El bridge Android versionado también está incorporado y emite streaming incremental; queda validar Gradle/permisos y dispositivo físico.
**Objetivo:** que Notia se comporte como un agente contextual útil, natural y confiable, capaz de entender la superficie donde está el usuario, editar contenido con precisión, pedir aclaraciones cuando existe ambigüedad y completar tareas de varios pasos con control visible.

La referencia de experiencia es un agente de código tipo OpenCode, adaptado al dominio de Notia: biblioteca de documentos, Markdown, tareas, finanzas, reuniones y archivos multimodales. La IA debe poder actuar, pero nunca convertir una interpretación incierta en una mutación irreversible.

## 1. Resultado de producto buscado

El usuario debería poder escribir desde el panel contextual:

> “Mejorame esta parte para que sea más clara y agregá un ejemplo.”

Y obtener este flujo:

1. Notia sabe qué documento, selección y bloque están activos.
2. La IA lee únicamente el contexto necesario.
3. Si “esta parte” es inequívoca, prepara una edición.
4. Muestra un diff breve y legible, con la razón del cambio.
5. El usuario acepta, rechaza o ajusta la propuesta con un toque.
6. Notia aplica solo el bloque afectado, preserva el resto del archivo y verifica que el editor quedó sincronizado.

Si no hay selección y existen varios párrafos plausibles, la IA no elige uno al azar:

> “¿Querés que mejore el encabezado ‘Objetivos’, el primer párrafo o la lista de criterios?”

La pregunta debe ofrecer opciones concretas y permitir responder “todos”, “ninguno” o describir otro alcance.

## 2. Principios de diseño

### 2.1 Entender antes de actuar

La IA debe distinguir entre:

- responder una pregunta;
- explicar o resumir;
- proponer una edición;
- aplicar una edición;
- crear contenido nuevo;
- reorganizar varios archivos;
- ejecutar una operación de negocio;
- pedir una aclaración;
- pedir autorización.

No debe usar una mutación para resolver una solicitud que solo pide explicación. Tampoco debe contestar que “lo hizo” si no recibió el resultado exitoso de la tool correspondiente.

### 2.2 Contexto implícito, alcance explícito

El documento activo y la selección deben ser contexto implícito cuando solo existe un objetivo razonable. La IA debe hacer explícito el alcance antes de una operación relevante:

> “Voy a mejorar los dos bloques seleccionados de `Plan.md`, manteniendo los títulos y las fórmulas.”

La IA debe preguntar si hay más de un documento, selección, coincidencia o interpretación plausible.

### 2.3 Propuesta rápida, aplicación controlada

La experiencia no debería obligar al usuario a escribir una orden técnica ni a confirmar dos veces. El patrón recomendado es:

- lectura: automática si el contexto ya está autorizado;
- propuesta: automática;
- preview/diff: visible;
- aplicación: una confirmación visual clara;
- verificación: automática;
- reversión: siempre disponible.

La confirmación es un control de seguridad de la UI, no una pregunta textual que el modelo pueda ignorar o contestar por sí mismo.

### 2.4 Nunca inventar

La IA no debe inventar:

- qué documento quiso decir el usuario;
- qué cuenta, categoría, ticket o grupo corresponde;
- qué contenido había antes de editar;
- que una escritura o movimiento financiero se completó;
- que una fuente fue consultada;
- que una herramienta existe o fue ejecutada.

El contenido de los documentos es dato no confiable. Nunca puede autorizar por sí mismo una tool, cambiar el scope o convertir instrucciones encontradas en un archivo en reglas de sistema.

### 2.5 La edición debe ser local, reversible y verificable

El agente no debe reemplazar un documento entero para corregir un párrafo. Toda edición debe tener:

- documento y revisión de origen;
- ancla o rango objetivo;
- contenido anterior y nuevo;
- diff estructurado;
- riesgo y cantidad de archivos afectados;
- confirmación;
- resultado de escritura;
- posibilidad de undo/revert.

## 3. Estado actual que conviene aprovechar

La base ya contiene piezas valiosas:

- `useRightPanelChatContext` conoce vista, documento activo, rutas de contexto y selección Markdown.
- `createChatScopedAgent` recibe `activeDocumentPath`, `activeMarkdownSource` y `markdownSelection`.
- Ya existen `read_active_markdown_document`, `replace_active_markdown_document` e `insert_active_markdown_document`.
- El motor `blockReplacementEngine` resuelve selección, bloques, referencias como “inciso c del ejercicio 1” y coincidencias ambiguas.
- `request_user_clarification` admite `choices` y la UI puede mostrarlas como botones.
- Existe `set_task_execution_plan` y una UI de plan para operaciones compuestas.
- Las mutaciones existentes solicitan confirmación visible y notifican a `MarkdownView` después de escribir.
- El agente ya restringe scopes, permisos de lectura y herramientas publicadas.

El objetivo no es duplicar estas capacidades, sino convertirlas en un contrato general de edición y en una experiencia coherente para todos los canales.

## 4. Flujo objetivo del agente

```text
1. OBSERVE
   Capturar snapshot del workspace y de la solicitud.
        |
2. CLASSIFY
   Responder | leer | editar | crear | ejecutar | aclarar.
        |
3. RESOLVE TARGET
   Resolver documento, selección, bloque, archivo, ticket o entidad.
        |
        +--> ambiguo/faltante --> ASK_CLARIFICATION --> retomar con la respuesta
        |
4. INSPECT
   Leer la mínima evidencia necesaria y validar la revisión actual.
        |
5. PLAN
   Para una acción simple, preparar una operación; para varias, mostrar pasos.
        |
6. PREVIEW
   Mostrar diff, archivos afectados, riesgos y supuestos explícitos.
        |
7. CONFIRM
   Confirmación visible según el nivel de riesgo.
        |
8. APPLY
   Aplicación atómica, idempotente y protegida contra cambios concurrentes.
        |
9. VERIFY
   Releer o validar el resultado y actualizar el editor/índice.
        |
10. REPORT
    Explicar qué cambió, qué no pudo hacerse y cuál es el siguiente paso.
```

### 4.1 Máquina de estados recomendada

Modelar el turno como una unión discriminada, no como varios booleanos:

```ts
type AgentTurnState =
  | { type: 'idle' }
  | { type: 'observing'; requestId: string }
  | { type: 'clarification_required'; question: ClarificationRequest }
  | { type: 'planning'; steps: AgentPlanStep[] }
  | { type: 'preview_ready'; preview: MutationPreview }
  | { type: 'awaiting_confirmation'; preview: MutationPreview }
  | { type: 'applying'; operationId: string }
  | { type: 'verifying'; operationId: string }
  | { type: 'completed'; result: AgentTurnResult }
  | { type: 'cancelled'; reason: string }
  | { type: 'failed'; error: AgentError }
```

Esto permite reanudar después de una aclaración, cancelar sin ejecutar la mutación y evitar que una respuesta tardía escriba sobre una vista que cambió.

## 5. Snapshot contextual del workspace

Crear un contrato único que viaje a `createChatScopedAgent` y al historial de diagnóstico:

```ts
interface WorkspaceAiSnapshot {
  workspaceView: 'documents' | 'graph' | 'task-manager' | 'meeting' | 'finance' | 'calendar' | 'chat'
  activeDocument?: {
    id: string
    path: string
    name: string
    viewKind: 'markdown' | 'text' | 'image' | 'pdf'
    revision: string
    isDirty: boolean
  }
  selection?: {
    documentPath: string
    selectedText: string
    blocks: MarkdownSelectionBlock[]
    from: number
    to: number
  }
  openDocumentPaths: string[]
  activeTaskBoard?: string
  activeFinanceMonth?: string
  meetingTranscriptState?: 'idle' | 'recording' | 'completed'
  capabilities: {
    canReadActiveDocument: boolean
    canEditActiveDocument: boolean
    canCreateFiles: boolean
    canUseVision: boolean
    canRunDomainMutations: boolean
  }
}
```

Reglas:

- El snapshot debe capturar la revisión del editor, no solo la del archivo en disco.
- Un documento sucio debe enviarse desde el buffer del editor o bloquear la escritura hasta sincronizarlo.
- Si cambia el documento activo, la selección o la revisión mientras el agente trabaja, el resultado queda obsoleto y debe recalcularse.
- El modelo recibe un resumen compacto; el contenido completo se obtiene mediante tools.
- El snapshot no debe incluir API keys, secretos, documentos no autorizados ni todo el árbol de la biblioteca por defecto.

## 6. Tools: catálogo actual, mejoras y faltantes

### 6.1 Tools actuales que deben conservarse y evolucionar

| Tool actual | Mejora propuesta |
|---|---|
| `read_active_markdown_document` | Devolver outline, revisión, bloques y rangos; aceptar `range`, `heading`, `blockIds` o una referencia semántica para no cargar siempre todo. |
| `replace_active_markdown_document` | Convertirla en una operación basada en patch/anchor; devolver diff, hash anterior, hash nuevo y conflicto si el documento cambió. |
| `insert_active_markdown_document` | Aceptar ancla estable, posición y formato; mostrar preview con contexto antes/después. |
| `request_user_clarification` | Persistir la solicitud como estado reanudable, incluir motivo, campo faltante, opciones y respuesta libre. |
| `search_library_documents` | Buscar por nombre, título, tags, frontmatter, ruta y tipo, con ranking y motivo de coincidencia. |
| `search_library_context` | Devolver citas, rutas, rangos y score de recuperación para que la IA pueda fundamentar la respuesta. |
| `read_library_documents` | Exigir IDs/rangos autorizados, entregar contenido con delimitadores de fuente y evitar duplicados de contexto. |
| `create_library_note`, `replace_library_document`, `delete_library_document` | Unificar sus resultados con el contrato de mutación y exigir revisión/preview para operaciones destructivas. |
| `set_task_execution_plan` | Mostrar dependencias, riesgos, herramientas previstas y estado por paso; permitir editar el plan antes de aprobarlo. |

### 6.2 Tools nuevas de contexto y navegación

| Tool propuesta | Propósito |
|---|---|
| `get_workspace_context` | Devuelve el snapshot resumido: vista, documento activo, selección, pestañas, scope y capacidades. |
| `get_active_document_outline` | Devuelve encabezados, índices de bloques, tablas, listas, fórmulas, enlaces y rangos. |
| `read_active_document_range` | Lee solo un rango, bloque, heading, línea o fragmento cercano al cursor. |
| `find_document_references` | Busca referencias entrantes/salientes, wikilinks, tags y documentos relacionados. |
| `get_document_metadata` | Consulta frontmatter, fecha, tamaño, tags, backlinks, estado de edición y revisión. |
| `search_library_exact` | Busca una frase, identificador, título o expresión con resultados exactos y sus rangos. |
| `compare_documents` | Compara dos documentos o revisiones y devuelve diferencias estructuradas. |
| `get_recent_ai_operations` | Recupera las últimas propuestas, aplicaciones, rechazos y reversiones del agente. |

### 6.2.1 Búsqueda web mediante Ollama Web Search

La IA debe poder buscar en internet cuando el usuario lo pide explícitamente o cuando necesita información actualizada que no puede resolver con el contexto local. Esta capacidad debe entrar por un adapter de búsqueda web de Ollama, no por un `fetch` arbitrario generado por el modelo.

Tool propuesta:

```ts
interface WebSearchRequest {
  query: string
  purpose: 'answer-current-question' | 'verify-fact' | 'research-topic' | 'find-source'
  freshness?: 'any' | 'day' | 'week' | 'month' | 'year'
  domains?: string[]
  maxResults?: number
}

interface WebSearchResult {
  ok: true
  sanitizedQuery: string
  sources: Array<{
    title: string
    url: string
    snippet: string
    publishedAt?: string
  }>
  searchedAt: string
} | {
  ok: false
  code: 'blocked-sensitive-data' | 'invalid-query' | 'provider-unavailable' | 'rate-limited'
  message: string
  requiresClarification?: boolean
}
```

#### Regla absoluta de privacidad

Una búsqueda web nunca puede revelar:

- API keys, tokens, contraseñas, cookies, JWT, certificados, claves privadas o secretos de cualquier tipo;
- contenido completo o fragmentos de documentos de la biblioteca, incluido el documento activo;
- nombres, emails, teléfonos, domicilios, ubicaciones precisas o identificadores personales;
- información financiera, médica, laboral, familiar, legal o de calendario del usuario;
- rutas locales, nombres privados de archivos, IDs internos, nombres de cuentas, tickets o proyectos;
- memorias, reglas del agente, historial de chat, adjuntos o prompts internos.

El consentimiento del usuario no debe permitir excepciones a esta regla. Si para responder hay que enviar información personal o sensible, la IA debe explicar que no puede hacerlo y pedir una formulación pública y anonimizada.

#### Flujo seguro obligatorio

```text
Solicitud del usuario
        |
        v
Determinar si hace falta información web actual
        |
        v
Construir una intención pública mínima
        |
        v
Redactor determinista de privacidad
        |
        +--> datos sensibles detectados --> bloquear y pedir reformulación
        |
        v
Validar query, dominios y límites
        |
        v
Adapter nativo Ollama Web Search
        |
        v
Sanitizar resultados y separar contenido web de instrucciones
        |
        v
Responder con citas, fecha y límites de la búsqueda
```

El redactor debe ejecutarse en código confiable antes de llamar al proveedor. No alcanza con poner una instrucción en el prompt: el modelo puede equivocarse y el filtro debe seguir protegiendo los datos aunque el modelo construya una query incorrecta.

#### Construcción de la query

La query debe contener solamente conceptos públicos y necesarios. Ejemplos:

| Solicitud | Query permitida |
|---|---|
| “¿Cuál es la última versión de Rust?” | `última versión estable de Rust` |
| “Compará estas notas privadas con la documentación oficial” | Bloquear el contenido privado; buscar solo la documentación oficial sobre el tema que el usuario haya expresado públicamente. |
| “Buscá información sobre mi cliente Juan Pérez y su deuda” | Bloquear; no enviar nombre ni deuda. Pedir un término público y anonimizado. |
| “¿Qué dice este PDF privado sobre la regulación actual?” | No enviar el PDF ni sus fragmentos; pedir el tema/regulación en términos públicos. |

No se debe pasar el prompt completo al buscador. El adapter recibe únicamente la query ya sanitizada, propósito, frescura y dominios validados. No recibe historial, memoria, `WorkspaceAiSnapshot`, contenido de archivo ni argumentos de otras tools.

#### Detección y bloqueo

Implementar una capa `sanitizeWebSearchQuery` con:

- detección de patrones de secretos, tokens y credenciales;
- detección de emails, teléfonos, documentos, cuentas, montos, fechas personales y rutas;
- clasificación de nombres propios y entidades del workspace;
- eliminación de valores sensibles, no solo reemplazo visual en logs;
- límite de longitud, cantidad de términos, dominios y resultados;
- rechazo si la query queda vacía, conserva un identificador privado o no puede demostrar que es pública;
- mensaje de bloqueo sin repetir el dato detectado.

Para minimizar falsos positivos, el redactor puede transformar “mi proyecto de migración X” en “migración de base de datos”, pero nunca debe enviar el valor original como contexto oculto ni usar una segunda llamada al modelo para decidir si el dato era sensible.

#### Credenciales y transporte

- La credencial del proveedor de búsqueda debe vivir en el adapter nativo/servicio Rust o bridge Android, nunca en el prompt ni en una tool accesible al modelo.
- La API key no debe viajar a URLs, logs, Redux, documentos, eventos de diagnóstico ni respuestas del agente.
- Desktop debe invocar un comando Tauri tipado, por ejemplo `run_desktop_ai_web_search`; Android debe usar el bridge nativo equivalente.
- La búsqueda no debe reutilizar el transporte frontend directo a Ollama identificado en la auditoría.
- Las credenciales de búsqueda deben ser independientes de la API key de contenido cuando el proveedor lo permita, para poder revocarlas por separado.
- No persistir la query original si contenía información bloqueada; registrar como máximo el código de bloqueo, propósito y hash de la query sanitizada.

#### Resultados y prompt injection web

Las páginas y snippets encontrados en internet son datos no confiables. El agente debe:

- tratar instrucciones dentro de páginas como contenido, nunca como reglas o autorización;
- devolver título, URL, snippet y fecha para cada afirmación relevante;
- distinguir hechos encontrados, inferencias y conocimiento previo;
- indicar cuando una fuente no pudo verificarse o existe conflicto entre fuentes;
- no enviar resultados completos a tools de escritura sin una decisión separada del usuario;
- limitar tamaño y cantidad de snippets para no agotar el contexto;
- validar esquemas de URL y bloquear destinos no seguros o redirecciones inesperadas.

La búsqueda debe aparecer en la UI como una etapa visible: “Buscando fuentes públicas sobre …”. Nunca mostrar la query original si el sistema la bloqueó; solo mostrar la query sanitizada cuando sea seguro hacerlo.

#### Cuándo buscar

Buscar automáticamente solo si:

- el usuario lo pidió (“buscá”, “verificá”, “qué dice la documentación actual”);
- la pregunta depende de actualidad, versiones, precios, normativa, horarios, noticias o datos cambiantes;
- el agente detecta que necesita una fuente externa y puede formular una query pública sin datos privados.

No buscar automáticamente para:

- resumir o mejorar un documento local;
- responder usando únicamente la biblioteca autorizada;
- analizar una imagen/PDF privado;
- completar una memoria o regla del usuario;
- enviar una consulta que dependa de identidad o contexto personal.

Si el usuario pide “buscá en internet usando este documento”, la IA debe separar ambas tareas: usar el documento local internamente y construir una búsqueda pública sin copiar su contenido.

### 6.3 Tools nuevas de edición segura

Estas son las más importantes para que “mejorame esta parte” se sienta natural:

| Tool propuesta | Comportamiento |
|---|---|
| `propose_document_edit` | Genera un preview sin escribir. Recibe intención, target, instrucciones de estilo y devuelve hunks, explicación, supuestos y archivos afectados. |
| `apply_document_edit` | Aplica un preview aprobado contra la revisión exacta. Rechaza el cambio si el archivo o el bloque cambió. |
| `apply_document_patch` | Aplica varios hunks con anclas únicas; si una ancla no coincide, detiene toda la operación y solicita revisión. |
| `replace_document_selection` | Reemplaza la selección actual con preservación de formato y cursor. Es el camino rápido para una edición inequívoca. |
| `replace_document_block` | Reemplaza un bloque por heading, índice, etiqueta, frase o rango, con error explícito si hay múltiples candidatos. |
| `delete_document_block` | Elimina un bloque, siempre con diff y confirmación de riesgo medio/alto. |
| `move_document_block` | Mueve un bloque antes/después de otra ancla en el mismo documento. |
| `update_document_frontmatter` | Agrega, cambia o elimina una propiedad sin reconstruir el cuerpo Markdown. |
| `create_document_from_template` | Crea una nota desde plantilla y devuelve preview del path/contenido antes de escribir. |
| `rename_document_and_update_links` | Renombra una nota y actualiza wikilinks de forma transaccional, con lista de referencias afectadas. |
| `apply_multi_document_patch` | Ejecuta cambios coordinados en varios archivos solo después de un plan y preview agregado. |
| `undo_ai_operation` | Revierte una operación identificada, verificando que no haya cambios posteriores incompatibles. |
| `restore_document_revision` | Restaura una revisión seleccionada, siempre como operación explícita y reversible. |

`replace_active_markdown_document` e `insert_active_markdown_document` pueden mantenerse como aliases de compatibilidad, pero el agente nuevo debería preferir el contrato de preview/apply. Así se evita que el modelo construya una mutación final sin que la UI pueda mostrarla antes.

### 6.4 Tools de validación y resultado

| Tool propuesta | Propósito |
|---|---|
| `validate_markdown_document` | Detecta frontmatter inválido, enlaces rotos, bloques sin cerrar, fórmulas inválidas y estructura inconsistente. |
| `validate_document_edit` | Verifica que el diff conserve encabezados, enlaces, fórmulas, tablas y reglas de formato solicitadas. |
| `reindex_changed_documents` | Actualiza búsqueda/RAG/backlinks después de una escritura; debe ejecutarse fuera del hilo visual. |
| `verify_operation` | Relee la revisión resultante y confirma qué cambios llegaron realmente a disco/editor. |
| `summarize_operation` | Devuelve un resumen humano de archivos, hunks, errores parciales y acciones pendientes. |

### 6.5 Tools de Task Manager faltantes o convenientes

El catálogo actual cubre creación, contenido, comentarios, subtareas, grupo, estado y prioridad. Para una experiencia natural conviene agregar:

- `update_task_fields`: cambiar título, descripción, prioridad, estado, grupo, fecha, responsable y tags en una operación validada;
- `list_task_dependencies` y `update_task_dependencies`;
- `create_task_checklist`, `update_task_checklist` y `complete_task_checklist_item`;
- `duplicate_task_ticket`;
- `archive_task_ticket` y `restore_task_ticket` en vez de simular borrados;
- `search_task_tickets` con filtros por estado, prioridad, fecha, tablero, tag y texto;
- `summarize_task_board` y `plan_task_board_changes`;
- `bulk_update_tasks` con preview por ticket y confirmación agrupada;
- `link_task_to_document` y `link_document_to_task`.

Las operaciones masivas deben mostrar cantidad, lista resumida y excepciones antes de confirmar.

### 6.6 Capabilities de contenido que faltan

Sin convertir cada intención en una tool distinta, el agente debería poder usar el mismo mecanismo de lectura y patch para:

- mejorar claridad, gramática, tono, concisión o estructura;
- resumir y reemplazar o insertar el resumen;
- traducir manteniendo Markdown, enlaces y fórmulas;
- convertir notas en checklist, tabla, FAQ, outline o especificación;
- extraer tareas, fechas, personas, decisiones y riesgos hacia Task Manager;
- generar y actualizar índices, TOC, backlinks y tags;
- detectar contradicciones entre documentos;
- comparar versiones y explicar cambios;
- completar documentación a partir de archivos relacionados;
- corregir fórmulas LaTeX y proponer diagramas Mermaid;
- transcribir imágenes/PDF/audio y ubicarlos en el bloque correcto;
- preparar una reunión a partir de notas y actualizarla luego con el transcript;
- transformar una nota en una plantilla reutilizable;
- proponer títulos y nombres de archivo coherentes.

La intención debe quedar en el prompt/plan; la ejecución debe terminar siempre en lectura, preview, patch y verificación.

## 7. Edición de documentos: diseño concreto

### 7.1 Caso “mejorame esta parte”

#### Con selección

1. `get_workspace_context` confirma documento, rango, texto y revisión.
2. La IA clasifica la intención como edición y pide el criterio solo si falta: claridad, tono, extensión, audiencia o idioma.
3. Lee el bloque seleccionado y el contexto inmediato, no el documento entero.
4. Genera `propose_document_edit` con uno o varios hunks.
5. La UI muestra original/nuevo en vista diff y un resumen: “simplifiqué tres frases y agregué un ejemplo”.
6. El usuario acepta o rechaza.
7. `apply_document_edit` valida revisión, escribe de forma atómica y conserva el cursor/selección.
8. `verify_operation` relee el bloque y actualiza el índice/RAG.

#### Sin selección, con una referencia clara

Para “mejorá el inciso c del ejercicio 1”:

1. Resolver la referencia por heading, etiqueta, texto exacto y número de ejercicio.
2. Si hay una única coincidencia, mostrarla en el preview.
3. Si hay varias, usar `request_user_clarification` con rutas y fragmentos.
4. Nunca aplicar por “la primera coincidencia”.

#### Sin selección y sin referencia

Para “mejorá esta nota”:

- si el documento es corto, proponer un plan de edición sobre todo el documento;
- si es largo, preguntar alcance: “¿todo, una sección o solo ortografía?”;
- no asumir que “mejorar” autoriza reescribir el estilo completo.

### 7.2 Tipos de edición

La UI debe ofrecer presets opcionales sin obligar al usuario a conocerlos:

- `clarity`: claridad y orden lógico, sin cambiar el contenido;
- `grammar`: ortografía, puntuación y concordancia;
- `tone`: tono indicado por el usuario;
- `shorten`: reducción con preservación de ideas;
- `expand`: ampliación con marcadores de información faltante;
- `technical`: precisión y terminología;
- `format`: Markdown, tablas, listas, headings y enlaces;
- `translate`: idioma destino y preservación de estructura;
- `custom`: instrucciones libres.

La IA debe declarar cuando agrega contenido no presente en la fuente. Si el usuario pide “mejorar” pero no autoriza inventar ejemplos, puede dejar un marcador o preguntar antes.

### 7.3 Diff humano

El preview debe mostrar:

- nombre y ruta del documento;
- sección/bloque afectado;
- líneas o rango aproximado;
- eliminaciones en rojo y adiciones en verde;
- explicación corta por hunk;
- contenido que se mantendrá intacto;
- advertencias sobre enlaces, fórmulas, tablas o frontmatter;
- botones `Aplicar`, `Aplicar todo`, `Rechazar`, `Editar propuesta` y `Deshacer`.

En móvil, el diff debe ser desplazable por hunk y cada acción debe tener un objetivo táctil de al menos 48 px. No depender del hover ni del botón derecho.

## 8. Aclaraciones y ambigüedad

### 8.1 Cuándo preguntar

Preguntar siempre cuando falte o sea ambiguo:

- target: documento, sección, bloque o selección;
- alcance: uno, varios o todos;
- intención: explicar, proponer o aplicar;
- estilo: tono, audiencia, idioma o extensión;
- datos de negocio: cuenta, categoría, fecha, tablero, grupo, estado o prioridad;
- operación destructiva o masiva;
- permiso para leer archivos no activos;
- conflicto de revisión o cambios concurrentes.

No preguntar por datos que el contexto determina de forma única. La naturalidad no consiste en pedir confirmación de cada verbo, sino en hacer visibles únicamente las decisiones que el sistema no puede resolver de forma segura.

### 8.2 Formato de la aclaración

```ts
interface ClarificationRequest {
  id: string
  question: string
  reason: string
  field: string
  choices?: Array<{
    id: string
    label: string
    detail?: string
    path?: string
  }>
  allowFreeText: boolean
  operationDraftId: string
  expiresAt?: string
}
```

La UI debe mostrar la pregunta como un estado pendiente, no como texto perdido en el historial. El usuario puede contestar con un botón, texto o “cancelar”.

### 8.3 Reanudación

La operación pendiente debe sobrevivir:

- un nuevo mensaje de aclaración;
- minimizar y reabrir el panel;
- cambio de foco de ventana;
- suspensión/reanudación Android;
- una reconexión de Telegram;
- un refresh del navegador publicado, si la política de ese canal lo permite.

La respuesta debe validar que el contexto y la revisión sigan vigentes. Si cambiaron, mostrar de nuevo el preview en vez de aplicar automáticamente.

## 9. Planes y operaciones de varios pasos

Para tareas como:

> “Ordená esta nota, creá tareas para lo pendiente y enlazá cada una con el documento.”

La IA debe presentar:

1. qué archivos leerá;
2. qué cambios propone por archivo;
3. qué tickets creará o modificará;
4. qué enlaces agregará;
5. qué pasos dependen de otros;
6. qué operaciones son reversibles;
7. qué información falta.

Cada paso debe tener un ID estable, estado y resultado. Si falla el paso 3, el agente no debe fingir que los enlaces del paso 5 existen. Debe permitir reintentar solo el paso fallido o revertir el lote completo cuando sea posible.

### 9.1 Política de confirmación por riesgo

| Riesgo | Ejemplos | Política |
|---|---|---|
| Bajo | lectura, búsqueda, resumen sin escritura, validación | Automático. |
| Medio | reemplazo de selección, inserción en documento activo, cambio de frontmatter | Preview y una confirmación; preferencia opcional para autoaplicar ediciones de bajo riesgo. |
| Alto | borrar, renombrar con enlaces, varios archivos, cambios masivos, finanzas | Plan + diff + confirmación explícita por lote. |
| Crítico | pérdida potencial, restaurar revisión, borrar biblioteca, operaciones financieras sensibles | Confirmación reforzada, detalle completo y posibilidad de cancelar. |

La preferencia de autoaplicar debe ser explícita, por biblioteca y revocable. Nunca debe aplicarse a borrados, finanzas, cambios masivos o archivos que el usuario no tenía abiertos.

## 10. Contrato uniforme de tools

Todas las tools deben devolver resultados tipados y no strings ambiguos:

```ts
type ToolResult<T> =
  | {
      ok: true
      changed: boolean
      data: T
      operationId?: string
      revisionBefore?: string
      revisionAfter?: string
      preview?: MutationPreview
    }
  | {
      ok: false
      error: string
      code: string
      requiresClarification?: ClarificationRequest
      requiresConfirmation?: MutationPreview
      retryable?: boolean
      conflict?: { expectedRevision: string; actualRevision: string }
    }
```

Una tool de mutación nunca debe devolver `ok: true` antes de que la escritura y la sincronización hayan terminado. Una tool de preview no escribe y nunca debe reportar `changed: true`.

### 10.1 Idempotencia y concurrencia

Cada operación debe incluir:

- `operationId` único;
- `documentRevision` o hash de origen;
- anclas estables;
- timeout y cancelación;
- registro de si fue aplicada, rechazada o revertida.

Si una escritura concurrente cambia el archivo, devolver `conflict` y pedir al usuario que revise un nuevo diff. No reintentar a ciegas sobre el contenido nuevo.

### 10.2 Atomicidad

Para un archivo, usar escritura atómica. Para varios archivos, crear un journal de operación con estado por archivo. Si la plataforma no puede garantizar rollback completo, declarar qué parte se aplicó antes de continuar.

## 11. Experiencia conversacional

### 11.1 Respuestas naturales

Las respuestas finales deberían ser cortas y orientadas a la acción:

```text
Encontré el bloque “Objetivos” y preparé una versión más clara.

Cambios: dividí dos oraciones largas y agregué un ejemplo sin modificar el significado.
Revisá el diff y elegí Aplicar o Rechazar.
```

Evitar:

- enumerar internals de tools al usuario;
- repetir el prompt completo;
- mostrar thinking crudo como si fuera una explicación confiable;
- decir “voy a…” durante varios turnos sin progreso;
- responder con una promesa de escritura sin resultado de la tool.

### 11.2 Actividad visible

Mostrar una línea de estado humana y estable:

- “Revisando el documento activo…”
- “Buscando el inciso c del ejercicio 1…”
- “Preparando una propuesta de edición…”
- “Esperando tu elección…”
- “Aplicando el cambio…”
- “Verificando el resultado…”

La actividad debe indicar el scope sin exponer contenido privado ni argumentos completos de tools.

### 11.3 Ediciones sucesivas

Después de aplicar una edición, conservar el contexto para que el usuario pueda decir:

- “hacelo más breve”;
- “volvé a la versión anterior”;
- “aplicá lo mismo a la siguiente sección”;
- “no cambies las fórmulas”;
- “ahora traducilo al inglés”.

La IA debe referirse a la operación y al bloque reales, no reconstruir el objetivo solo desde el texto del último mensaje.

## 12. Memoria, personalización y privacidad

### 12.1 Separar preferencias de memoria

Unificar la fuente de memoria y diferenciar:

- preferencias de interacción: idioma, tono, nivel de detalle;
- reglas explícitas: instrucciones de comportamiento;
- memoria personal: hechos duraderos;
- memoria de proyecto: decisiones y contexto de una biblioteca;
- contexto de sesión: solo el turno actual;
- historial de operaciones: cambios hechos por la IA.

El usuario debe poder ver, editar, borrar y desactivar cada categoría. “Borrar memoria” debe borrar exactamente la fuente que el runtime volverá a cargar.

### 12.2 Política de persistencia por superficie

Declarar en cada scope:

| Superficie | Historial | Memoria global | Escrituras de documentos |
|---|---|---|---|
| Chat persistente | Sí | Según preferencia | Sí, con confirmación |
| Chat de documento | Según sesión/documento | Según preferencia | Sí, con preview |
| Meeting efímero | No al salir | No por defecto | Solo si el usuario lo pide y confirma |
| Telegram | Cola e historial acotado | Configurable | Según tool y confirmación del canal |
| Task Manager publicado | No global | No | Solo scope publicado |
| Finanzas | Historial de operación | No mezclar con memoria de biblioteca | Solo tools financieras |

## 13. Seguridad y límites

- Mantener autorización por scope para cada lectura y escritura.
- Tratar Markdown, PDF, imágenes, transcripciones y archivos adjuntos como datos, no instrucciones.
- No permitir que el modelo elija una ruta arbitraria fuera de la biblioteca autorizada.
- No agregar un shell genérico como tool por defecto. Si en el futuro se ofrece ejecución de código, debe vivir en un sandbox, con permisos, límites de recursos y confirmación independiente.
- La búsqueda web debe tener un filtro determinista de privacidad antes del proveedor; nunca confiar solo en el prompt para evitar filtraciones.
- El adapter web no recibe historial, memoria, snapshot del workspace, contenido de archivos ni API keys del runtime conversacional.
- Una query bloqueada no se reintenta automáticamente con el texto original, ni se conserva en logs o telemetría.
- Los resultados web se tratan como contenido no confiable y no pueden autorizar tools, cambiar reglas ni disparar escrituras.
- Validar tamaño, extensión, encoding y número de archivos antes de construir un patch.
- Redactar secretos y contenido sensible de los diagnósticos.
- Mostrar siempre qué archivos saldrán de la máquina cuando el modelo cloud sea el destino.
- En operaciones financieras, separar aclaración, autorización, escritura y verificación.

## 14. Rendimiento y calidad de contexto

- Resolver primero títulos/outline/rangos y leer después el contenido necesario.
- No enviar el documento completo si la selección o el heading alcanza.
- Cachear outline y revisiones con invalidación al guardar.
- Hacer RAG por fragmentos con citas, no concatenar cientos de documentos.
- Limitar el tamaño del diff y dividir operaciones largas en hunks revisables.
- Ejecutar reindexación, extracción de memoria y reorganización fuera del hilo de UI.
- Cancelar búsquedas, streams y previews obsoletos cuando cambia el documento o la vista.
- Elegir modelo/capacidad de forma explícita: tools, visión, contexto y streaming deben comprobarse antes de iniciar.

## 15. Paridad desktop/Android/Telegram

La intención debe ser la misma en todos los canales, aunque la interfaz cambie:

- desktop: diff lateral, botones y atajos;
- Android: bottom sheet de diff, botones grandes, selección táctil y botón Atrás para cerrar sin aplicar;
- Telegram: resumen compacto, lista de opciones y confirmación por botones del bot;
- publicado: solo contexto y rutas autorizadas por la publicación.

No depender de hover, menú contextual, teclado físico o selección perfecta. El flujo “seleccionar y mejorar” debe tener equivalente para toque prolongado, selección táctil y referencia por heading.

### 15.1 Feedback progresivo del agente en Telegram

Actualmente Telegram envía algunos mensajes de progreso solo para solicitudes con imagen y por ronda del agente. Las consultas de texto no tienen un progreso general, y el callback de thinking del runtime no está conectado al bridge de Telegram. La mejora debe informar el avance sin llenar el chat de mensajes ni exponer razonamiento interno.

#### Eventos de progreso seguros

Agregar al runtime común un callback tipado, separado de `onThinkingDelta`:

```ts
type AgentProgressEvent =
  | { type: 'request_received'; requestId: string }
  | { type: 'phase_changed'; phase: AgentPhase; label: string }
  | { type: 'plan_created'; plan: SafePlanSummary }
  | { type: 'step_started'; stepId: string; label: string; index: number; total: number }
  | { type: 'tool_started'; toolName: string; safeLabel: string }
  | { type: 'tool_completed'; toolName: string; safeLabel: string; changed: boolean }
  | { type: 'clarification_required'; question: string; choiceCount: number }
  | { type: 'confirmation_required'; safeSummary: string }
  | { type: 'web_search_started'; publicTopic: string }
  | { type: 'verification_started'; safeLabel: string }
  | { type: 'completed'; safeSummary: string }
  | { type: 'failed'; phase: AgentPhase; safeMessage: string }
```

Los eventos deben describir actividad observable, no volcar texto del modelo. `safeLabel` y `safeSummary` salen de un catálogo controlado por código; no deben incluir argumentos de tools, contenido de archivos, nombres privados, montos, API keys, rutas sensibles ni prompts.

#### Pensamientos resumidos, no chain-of-thought

La opción de “mostrar pensamientos” debe significar resúmenes de enfoque y decisiones, por ejemplo:

```text
💭 Enfoque: voy a revisar el documento y localizar el bloque solicitado.
💭 Encontré una coincidencia única; preparo una propuesta antes de modificarla.
💭 La edición requiere confirmación antes de guardarse.
```

Nunca enviar:

- `onThinkingDelta` crudo de Ollama;
- razonamiento token a token;
- deliberaciones internas, alternativas descartadas o prompt del sistema;
- argumentos completos de una tool;
- fragmentos privados utilizados para tomar la decisión.

Estos resúmenes deben generarse a partir de transiciones del runtime y resultados tipados, no mediante otra llamada al modelo. Así son deterministas, breves y no crean una segunda superficie de filtración. La preferencia recomendada es `progressMode: 'minimal' | 'standard' | 'detailed' | 'off'`; incluso en `detailed`, el contenido sigue limitado al catálogo seguro.

#### Un mensaje de estado editable

Preferir un único mensaje de estado que se edita durante la operación:

```text
⏳ Procesando tu solicitud

✅ Entendí el pedido
✅ Revisé el contexto autorizado
🔄 Preparando el siguiente paso
⬜ Verificar resultado
```

Agregar al runtime de Telegram:

- hacer que `sendTelegramMessage` pueda devolver `messageId`;
- agregar `editTelegramMessage` mediante Tauri/Rust;
- crear `telegramProgressRuntime` para agrupar eventos, construir HTML seguro y editar el mensaje;
- usar un fallback a mensaje nuevo si editar falla, con rate limit y deduplicación;
- limpiar el estado o transformarlo en “Completado” al finalizar.

No editar mensajes de confirmación o aclaración mientras estén pendientes. Esos mensajes deben conservar sus botones y su identificador de operación.

#### Etapas que Telegram debe comunicar

- solicitud recibida y puesta en cola;
- posición aproximada si hay solicitudes anteriores;
- transcripción de audio;
- descarga de imagen/PDF y extracción de contenido;
- construcción del agente, scope y tools autorizadas;
- TO-DO creado para una tarea compuesta;
- búsqueda local o lectura de evidencia autorizada;
- búsqueda web de fuentes públicas, sin revelar una query insegura;
- pensamiento resumido seguro, solo en modo detallado;
- tool en ejecución, con nombre humano y sin argumentos;
- espera de aclaración, permiso o confirmación;
- aplicación y verificación;
- finalización, cancelación o error con acción sugerida.

#### Planes y tools

Cuando exista un TO-DO, el estado debe mostrarlo y actualizarlo:

```text
📋 Plan de trabajo
✅ 1. Buscar los documentos relevantes
🔄 2. Preparar los cambios
⬜ 3. Esperar tu confirmación
⬜ 4. Aplicar y verificar
```

Cada evento debe llevar `requestId`/`operationId`, para que una respuesta atrasada nunca actualice el progreso de otra solicitud. Las lecturas pueden agruparse; las mutaciones deben informar “esperando confirmación” y luego “aplicando”/“verificando”.

#### Control de ruido y reanudación

- Editar como máximo cada 2–4 segundos, salvo transiciones críticas.
- Enviar inmediatamente solo recepción, aclaración, confirmación, error y finalización.
- No enviar un mensaje por cada token ni por cada delta de thinking.
- Respetar el límite de caracteres de Telegram.
- Mantener un estado separado por solicitud encolada.
- Persistir `progressMessageId` junto al request activo si la operación puede reanudarse.
- Tras reiniciar, informar “Retomando solicitud…” o declarar que no se puede recuperar; nunca repetir una mutación solo para reconstruir feedback.

#### Formato, seguridad y preferencias

- Usar únicamente el subconjunto HTML permitido y escapar todo contenido externo.
- Mapear nombres internos a etiquetas humanas: `read_library_documents` → “Leyendo documentos autorizados”.
- No mostrar paths locales, IDs internos, nombres privados, argumentos financieros ni contenido de archivos.
- Para web search, mostrar solo el tema público sanitizado y nunca una query bloqueada.
- El feedback es informativo y nunca reemplaza la confirmación real de una mutación.
- Incorporar `progressMode`, `showPlan`, `showReasoningSummary` y `editProgressMessage` en la configuración de Telegram.
- `minimal` conserva errores, confirmaciones, aclaraciones y finalización; desactivarlo no desactiva timeouts, auditoría ni protecciones.

El objetivo es que el usuario distinga si Notia está leyendo, buscando, pensando, esperando una decisión, ejecutando o verificando, sin tener que preguntar “¿qué está haciendo?”. La información debe generar confianza sin revelar el razonamiento privado del modelo ni datos que no pertenecen al chat de Telegram.

## 16. Observabilidad y confianza

Registrar de forma segura:

- intención clasificada;
- scope y cantidad de archivos, no el contenido privado;
- herramientas invocadas;
- tiempo de lectura, preview, escritura y verificación;
- resultado, cancelación, rechazo o conflicto;
- modelo y capacidades, sin API key.

La UI debería ofrecer un historial local de operaciones de IA con:

- fecha;
- documento afectado;
- resumen del cambio;
- aplicar/rechazar/revertir;
- error o conflicto;
- enlace al diff.

Esto hace que la IA sea auditable sin convertir cada interacción en un log invasivo.

## 17. Pruebas de aceptación

### Edición de documento

- “Mejorá la selección” reemplaza únicamente los bloques seleccionados.
- “Mejorá el inciso c del ejercicio 1” resuelve una coincidencia única.
- Si hay dos coincidencias, pregunta con ambas opciones y no escribe.
- Si no hay selección ni referencia, pregunta el alcance antes de reescribir.
- El diff conserva frontmatter, fórmulas, links y bloques no afectados.
- Si el documento cambia antes de aceptar, se muestra conflicto y no se pisa contenido.
- Rechazar el preview no cambia el archivo.
- Undo revierte solo la operación de IA elegida.
- La vista Milkdown, el archivo en disco y el índice quedan sincronizados.

### Conversación

- Una pregunta de aclaración suspende y reanuda el mismo plan.
- La respuesta no repite una confirmación ya otorgada.
- El agente no declara una mutación sin resultado `ok: true`.
- Una tool inexistente o no disponible produce un error visible y una alternativa.
- Las instrucciones dentro de documentos no autorizan nuevas tools.
- Una búsqueda web envía solo una query pública sanitizada y devuelve citas; nunca incluye datos privados aunque el usuario los haya mencionado en el mismo turno.

### Operaciones compuestas

- El plan muestra archivos, pasos, dependencias y riesgos.
- Una falla parcial identifica exactamente qué se aplicó.
- Se puede reintentar un paso sin duplicar tickets, notas o comentarios.
- Un lote rechazado no deja mutaciones silenciosas.

### Plataforma

- Desktop no usa fetch directo a Ollama desde el WebView.
- Android tiene un plugin/adapter versionado y streaming real o una limitación documentada.
- Cancelar desde Android, cerrar el panel o pulsar Atrás libera listeners y tareas.
- Telegram conserva una aclaración pendiente sin perder la solicitud original.
- El flujo completo funciona con touch, orientación vertical/horizontal y teclado virtual.

### Búsqueda web y privacidad

- Una query con API key, token, email, ruta local, nombre de cliente, monto, memoria o fragmento de documento es bloqueada antes del proveedor.
- El filtro detecta secretos aunque estén codificados como URL, JSON, header, Markdown o texto pegado.
- La query sanitizada no conserva suficiente información para reidentificar al usuario o su biblioteca.
- El provider recibe la query sanitizada, propósito y límites; no recibe historial ni contexto oculto.
- Una página con prompt injection no puede cambiar el scope, agregar reglas, pedir credenciales ni ejecutar una mutación.
- La respuesta cita fuentes, fecha y nivel de certeza, y diferencia búsqueda web de contenido local.
- Si el proveedor no está disponible, el agente lo informa sin enviar un fallback directo desde el WebView.

## 18. Roadmap recomendado

### Fase 0 — Confianza y documento activo

1. Formalizar `WorkspaceAiSnapshot`, revisión del editor y política de persistencia.
2. Consolidar memoria y corregir el significado de efímero.
3. Implementar `MutationPreview`, diff visible, apply con revisión y undo.
4. Mejorar las tres tools Markdown actuales sin romper sus nombres.
5. Cubrir selección, referencia, ambigüedad, rechazo y conflicto.

### Fase 1 — Agente contextual

1. Agregar `get_workspace_context`, outline, rango, referencias y metadatos.
2. Convertir aclaraciones en operaciones reanudables.
3. Introducir plan explícito para operaciones de varios pasos.
4. Unificar el contrato `ToolResult` y la observabilidad.
5. Añadir presets de edición y continuidad entre turnos.
6. Incorporar el adapter `run_desktop_ai_web_search`/bridge equivalente con `sanitizeWebSearchQuery` y contrato de citas.

### Fase 2 — Biblioteca y productividad

1. Patches multiarchivo y actualización transaccional de wikilinks.
2. Validación Markdown, fórmulas, Mermaid, frontmatter y enlaces.
3. Extracción de tareas/decisiones/fechas a Task Manager.
4. Herramientas de comparación, backlinks, tags, TOC y plantillas.
5. Operaciones masivas con preview por hunk y rollback.

### Fase 3 — Plataforma y multimodalidad

1. Contrato Android nativo único para health, tools y streaming.
2. Igualar diff, aclaraciones y cancelación entre desktop, Android y Telegram.
3. Mejorar PDF, imágenes, audio y reuniones con citas y destino de inserción explícito.
4. Integrar búsqueda web con fuentes, frescura, dominios y bloqueo de privacidad probado.
5. Validación de rendimiento en tableta Android física y bibliotecas grandes.

## 19. Criterio de éxito

La IA estará lista para este objetivo cuando un usuario pueda decir “mejorame esta parte” desde cualquier documento y Notia pueda:

1. identificar correctamente el contexto;
2. pedir una sola aclaración útil si falta información;
3. producir un cambio localizado y entendible;
4. dejar al usuario el control de aplicación;
5. escribir sin perder trabajo concurrente;
6. verificar y revertir el resultado;
7. buscar información pública actualizada sin filtrar ningún dato privado;
8. continuar naturalmente con instrucciones como “más corto”, “aplicalo también abajo” o “volvé atrás”.

La sensación buscada no es la de un chatbot que devuelve texto, sino la de un colaborador que entiende el espacio de trabajo, actúa con cuidado y deja evidencia clara de cada decisión.

## Estado de implementación de las mejoras prioritarias

- La edición contextual desde un documento usa snapshot, selección, preview, revisión exacta, confirmación, validación y undo.
- Las solicitudes compuestas crean un TO-DO general; el usuario puede editar pasos, archivos o entidades afectadas, herramientas, riesgos y dependencias antes de aprobar.
- Meeting mantiene su plan en memoria durante la sesión y Telegram muestra únicamente progreso operativo y resúmenes seguros, nunca pensamiento crudo.
- La búsqueda web usa Ollama Web Search solo mediante el adapter nativo, con sanitización previa y sin enviar contexto privado, claves, tokens ni información personal.
- El stream publicado tiene reconexión acotada antes del primer evento, cancelación y aislamiento frente al transporte desktop.
- El diff táctil se muestra como bottom sheet semántico con scroll de hunks, cierre accesible y controles de al menos 48 px; la prueba de Atrás en Android físico queda externa.
- El baseline de performance mide el tiempo de chat y de cada tool con metadata mínima y redactada, dejando explícitamente pendientes las mediciones de memoria/bundle sobre hardware de referencia.
- La validación de privacidad de Web Search quedó compartida entre desktop y Android; una invocación nativa directa tampoco puede saltarse el bloqueo de secretos, PII, rutas o queries codificadas.
- Quedan como validaciones externas la compilación Gradle/permiso de symlinks, la prueba en tableta Android, los escenarios end-to-end reales de Telegram y la revisión manual final de UX.
