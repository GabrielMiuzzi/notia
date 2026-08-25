import type { NotiaLibrary } from '../../types/notia'
import type { AiNativeToolCall, AiNativeToolDefinition } from '../ai/aiRuntime'
import { DEFAULT_AGENT_PROMPT, loadAgentPrompt } from '../ai/agentPromptRuntime'
import {
  loadInlineFileAttachments,
  loadLibraryFileOptions,
  type ChatLibraryFileOption,
} from './chatAttachmentRuntime'
import type { TaskManagerAgentMutation } from '../../modules/task-manager/services/taskManagerAgentMutationService'
import type { TaskPriority, TaskState } from '../../modules/task-manager/types/taskManagerTypes'

export type ChatAgentScope = 'task-manager' | 'graph' | 'document' | 'library'
export type TaskExecutionStepStatus = 'pending' | 'in-progress' | 'completed' | 'blocked'
export interface TaskExecutionStep { id: string; label: string; status: TaskExecutionStepStatus }

export interface ChatAgentRuntimeOptions {
  scope: ChatAgentScope
  library: NotiaLibrary
  scopePaths: string[]
  activeDocumentPath?: string | null
  explicitlySelectedPaths?: string[]
  promptFileName?: string
  taskManagerScopeKey?: string | null
  requestClarification: (question: string, signal: AbortSignal, choices?: string[]) => Promise<string>
  requestConfirmation: (question: string, signal: AbortSignal) => Promise<boolean>
  onExecutionPlanChange?: (steps: TaskExecutionStep[]) => void
  requestExecutionPlanApproval?: (
    steps: TaskExecutionStep[],
    signal: AbortSignal,
  ) => Promise<{ approved: boolean; suggestion?: string }>
}

export interface AgentDocument {
  id: string
  option: ChatLibraryFileOption
}

interface AgentSearchFragment {
  documentId: string
  title: string
  path: string
  content: string
  score: number
}

interface TaskContextMatch {
  ticketId: string
  title: string
  path: string
  fragments: string[]
}

interface RequiredTicketSection {
  title: string
  path: string
}

interface LoadedAgentDocument {
  document: AgentDocument
  content: string
  name: string
  path: string
}

const MAX_RAG_FILES = 160
const MAX_RAG_RESULTS = 8
const MAX_DIRECT_FILES = 6
const MAX_DIRECT_CHARS = 30_000
const MAX_EXHAUSTIVE_TASK_CHARS = 160_000
const CHUNK_CHARS = 1_200
const TASK_MUTATION_TOOL_NAMES = new Set([
  'create_task_ticket',
  'replace_task_content',
  'add_task_comment',
  'add_task_subtask',
  'move_task_group',
  'change_task_state',
  'change_task_priority',
  'create_task_group',
  'delete_task_group',
])
const TASK_STATES = new Set<TaskState>(['Pendiente', 'Cancelada', 'En progreso', 'Finalizada', 'Bloqueada'])
const TASK_PRIORITIES = new Set<TaskPriority>(['Baja', 'Media', 'Alta', 'Urgente'])

function isTaskState(value: unknown): value is TaskState {
  return typeof value === 'string' && TASK_STATES.has(value as TaskState)
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && TASK_PRIORITIES.has(value as TaskPriority)
}

export function extractTaskChildTitles(content: string): string[] {
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/)?.[1] ?? ''
  const childsValue = frontmatter.match(/^childs:\s*(.*)$/mi)?.[1] ?? ''
  return [...childsValue.matchAll(/\[\[([^\]]+)\]\]/g)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
}

function taskBoardPath(relativePath: string): string {
  const normalizedPath = relativePath.replace(/\\/g, '/')
  const subtaskMarkerIndex = normalizedPath.toLowerCase().indexOf('/subtasks/')
  const taskPath = subtaskMarkerIndex >= 0
    ? normalizedPath.slice(0, subtaskMarkerIndex)
    : normalizedPath.slice(0, normalizedPath.lastIndexOf('/'))
  return taskPath.toLowerCase()
}

function taskTitle(value: string): string {
  return normalizeAgentSearchText(value.replace(/\.(md|markdown)$/i, ''))
}

function resolveTaskManagerBoard(scopeKey: string | null | undefined): string | null {
  const prefix = 'task-manager:panel:'
  if (!scopeKey?.startsWith(prefix)) {
    return null
  }
  const board = scopeKey.slice(prefix.length).trim()
  return board && !board.startsWith('__') ? board : null
}

function mutationTextPreview(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized || '(vacio)'
}

export function resolveTaskChildDocuments(
  parent: AgentDocument,
  content: string,
  documents: AgentDocument[],
): AgentDocument[] {
  const childTitles = new Set(extractTaskChildTitles(content).map(taskTitle))
  if (childTitles.size === 0) {
    return []
  }

  const parentBoardPath = taskBoardPath(parent.option.relativePath)
  return documents.filter((candidate) => (
    candidate.id !== parent.id
    && taskBoardPath(candidate.option.relativePath) === parentBoardPath
    && candidate.option.relativePath.replace(/\\/g, '/').toLowerCase().includes('/subtasks/')
    && childTitles.has(taskTitle(candidate.option.name))
  ))
}

export function normalizeAgentSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function stringArray(value: unknown, max = 12): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, max)
    : []
}

export function scoreAgentText(query: string, text: string): number {
  const normalizedQuery = normalizeAgentSearchText(query)
  const normalizedText = normalizeAgentSearchText(text)
  if (!normalizedQuery || !normalizedText) {
    return 0
  }
  let score = normalizedText.includes(normalizedQuery) ? 120 : 0
  for (const token of new Set(normalizedQuery.split(' ').filter((item) => item.length >= 3))) {
    if (normalizedText.includes(token)) {
      score += 12
    }
  }
  return score
}

export function buildAgentSearchText(
  option: Pick<ChatLibraryFileOption, 'name' | 'relativePath'>,
  content = '',
): string {
  return `${option.relativePath} ${option.name} ${content}`
}

export function selectDiverseAgentFragments(
  fragments: AgentSearchFragment[],
  limit = MAX_RAG_RESULTS,
): AgentSearchFragment[] {
  const ranked = [...fragments].sort((left, right) => right.score - left.score)
  const selected: AgentSearchFragment[] = []
  const selectedPaths = new Set<string>()

  for (const fragment of ranked) {
    if (!selectedPaths.has(fragment.path)) {
      selected.push(fragment)
      selectedPaths.add(fragment.path)
    }
    if (selected.length >= limit) {
      return selected
    }
  }

  for (const fragment of ranked) {
    if (!selected.includes(fragment)) {
      selected.push(fragment)
    }
    if (selected.length >= limit) {
      break
    }
  }

  return selected
}

export function groupTaskContextMatches(fragments: AgentSearchFragment[]): TaskContextMatch[] {
  const matchesByPath = new Map<string, TaskContextMatch>()

  for (const fragment of fragments) {
    const current = matchesByPath.get(fragment.path)
    if (current) {
      current.fragments.push(fragment.content)
      continue
    }
    matchesByPath.set(fragment.path, {
      ticketId: fragment.documentId,
      title: fragment.title,
      path: fragment.path,
      fragments: [fragment.content],
    })
  }

  return [...matchesByPath.values()]
}

export function buildTicketSectionCorrection(
  answer: string,
  tickets: RequiredTicketSection[],
): string | null {
  const answerLines = answer.split(/\r?\n/).map((line) => line.trim())
  const numberedTicketHeadings = answerLines.filter((line) => (
    /^#{1,6}\s+\d+[.)]?\s*\S/.test(line)
    || /^\d+[.)]\s*\S/.test(line)
  ))
  const declaredCountMatch = answer.match(/\b(\d{1,2})\s+(?:tareas?|tickets?)\b/i)
  const declaredCount = declaredCountMatch ? Number.parseInt(declaredCountMatch[1], 10) : 0

  if (declaredCount >= 2 && numberedTicketHeadings.length < declaredCount) {
    return [
      `La respuesta afirma que hay ${declaredCount} tickets, pero solo contiene ${numberedTicketHeadings.length} encabezados numerados independientes. No debe mostrarse asi.`,
      `Reescribila con exactamente ${declaredCount} secciones usando el formato "## 1. Titulo del ticket", "## 2. Titulo del ticket", etc.`,
      'Obtene cada titulo y sus campos del resultado de las herramientas. No agrupes varios estados, prioridades, roles o detalles debajo del primer encabezado.',
    ].join('\n')
  }

  if (tickets.length < 2) {
    return null
  }

  const structuredLines = answerLines
    .map((line) => line.trim())
    .filter((line) => /^(?:#{1,6}\s+(?:\d+[.)]\s+)?|\d+[.)]\s+(?:\*{1,2})?)/.test(line))
    .map(normalizeAgentSearchText)
  const missing = tickets.filter((ticket) => {
    const normalizedTitle = normalizeAgentSearchText(ticket.title.replace(/\.(md|markdown|txt)$/i, ''))
    return !structuredLines.some((line) => line.includes(normalizedTitle))
  })

  if (missing.length === 0) {
    return null
  }

  return [
    'La respuesta anterior no separo todos los tickets recuperados y no debe mostrarse.',
    `Debes reescribirla con exactamente ${tickets.length} secciones independientes, una por cada archivo.`,
    'Usa exactamente un encabezado Markdown de nivel 2 por ticket con este formato:',
    ...tickets.map((ticket, index) => `## ${index + 1}. ${ticket.title}`),
    'La ruta puede aparecer dentro de la seccion, pero una viñeta Path no cuenta como encabezado.',
    'No coloques Estado, Prioridad, Rol ni Detalle de un ticket debajo del encabezado de otro.',
  ].join('\n')
}

export function buildChatAgentTools(scope: ChatAgentScope): AiNativeToolDefinition[] {
  const searchName = scope === 'task-manager' ? 'search_task_tickets' : 'search_library_documents'
  const readName = scope === 'task-manager' ? 'read_task_tickets' : 'read_library_documents'
  const ragName = scope === 'task-manager' ? 'search_task_context' : 'search_library_context'
  const idField = scope === 'task-manager' ? 'ticketIds' : 'documentIds'
  const tools: AiNativeToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: searchName,
        description: 'Busca uno o varios elementos por titulo o nombre. No lee su contenido.',
        parameters: {
          type: 'object',
          required: ['titles'],
          properties: { titles: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: ragName,
        description: 'Recupera fragmentos relevantes mediante RAG local. Usala para preguntas generales antes de leer archivos completos.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: { query: { type: 'string' }, [idField]: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: readName,
        description: 'Lee el contenido completo de elementos previamente identificados. Usala solo cuando se pidan detalles.',
        parameters: {
          type: 'object',
          required: [idField],
          properties: { [idField]: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'request_user_clarification',
        description: 'Pausa y pregunta al usuario ante cualquier dato faltante, definicion imprecisa o coincidencia ambigua. Nunca completes supuestos. Aclarar no autoriza mutaciones.',
        parameters: {
          type: 'object',
          required: ['question'],
          properties: {
            question: { type: 'string' },
            choices: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  ]
  if (scope === 'task-manager') {
    tools.splice(2, 0, {
      type: 'function',
      function: {
        name: 'read_all_task_tickets',
        description: 'Enumera y lee todos los tickets del Task Manager. Debes usarla para inventarios, conteos, resúmenes o comparaciones que pidan todos los tickets, todo el tablero, cada persona o una visión completa.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    })
    tools.push({
      type: 'function',
      function: {
        name: 'get_task_manager_options',
        description: 'Devuelve el tablero activo y los grupos, estados y prioridades validos. Consultala antes de preguntar o mutar si algun valor no esta definido con precision; nunca inventes opciones.',
        parameters: { type: 'object', properties: {} },
      },
    })
    tools.push({
      type: 'function',
      function: {
        name: 'set_task_execution_plan',
        description: 'Crea el TO-DO visible antes de una solicitud compuesta con dos o mas escrituras. Cada paso corresponde a una mutacion concreta.',
        parameters: {
          type: 'object', required: ['steps'], properties: {
            steps: { type: 'array', minItems: 2, maxItems: 20, items: { type: 'string' } },
          },
        },
      },
    })
    tools.push(
      taskMutationTool('create_task_ticket', 'Crea un ticket solo con definiciones completas y despues de pedir confirmacion individual. Si falta o es ambiguo cualquier campo, usa request_user_clarification primero.', ['title', 'content', 'group', 'state', 'priority'], {
        title: { type: 'string' }, content: { type: 'string' }, group: { type: 'string' },
        state: { type: 'string', enum: ['Pendiente', 'Cancelada', 'En progreso', 'Finalizada', 'Bloqueada'] },
        priority: { type: 'string', enum: ['Baja', 'Media', 'Alta', 'Urgente'] },
      }),
      taskMutationTool('replace_task_content', 'Reemplaza el cuerpo Markdown de un ticket, preservando sus metadatos, solo despues de aclarar el contenido exacto y pedir confirmacion individual.', ['ticketId', 'content'], {
        ticketId: { type: 'string' }, content: { type: 'string' },
      }),
      taskMutationTool('add_task_comment', 'Agrega un comentario fechado solo despues de aclarar el texto exacto y pedir confirmacion individual.', ['ticketId', 'comment'], {
        ticketId: { type: 'string' }, comment: { type: 'string' },
      }),
      taskMutationTool('add_task_subtask', 'Crea una subtarea vinculada solo despues de aclarar padre, titulo, contenido y prioridad, y pedir confirmacion individual.', ['ticketId', 'title', 'content', 'priority'], {
        ticketId: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' },
        priority: { type: 'string', enum: ['Baja', 'Media', 'Alta', 'Urgente'] },
      }),
      taskMutationTool('move_task_group', 'Mueve un ticket a un grupo validado solo despues de resolver cualquier ambiguedad y pedir confirmacion individual.', ['ticketId', 'group'], {
        ticketId: { type: 'string' }, group: { type: 'string' },
      }),
      taskMutationTool('change_task_state', 'Cambia el estado solo despues de identificar un unico ticket, validar el estado y pedir confirmacion individual.', ['ticketId', 'state'], {
        ticketId: { type: 'string' },
        state: { type: 'string', enum: ['Pendiente', 'Cancelada', 'En progreso', 'Finalizada', 'Bloqueada'] },
      }),
      taskMutationTool('change_task_priority', 'Cambia la prioridad solo despues de identificar un unico ticket, validar la prioridad y pedir confirmacion individual.', ['ticketId', 'priority'], {
        ticketId: { type: 'string' }, priority: { type: 'string', enum: ['Baja', 'Media', 'Alta', 'Urgente'] },
      }),
      taskMutationTool('create_task_group', 'Crea un grupo en el tablero activo solo despues de definir exactamente nombre y color y pedir confirmacion individual.', ['name', 'color'], {
        name: { type: 'string' }, color: { type: 'string', description: 'Color hexadecimal exacto con formato #RRGGBB.' },
      }),
      taskMutationTool('delete_task_group', 'Elimina un grupo del tablero activo solo despues de pedir confirmacion. La operacion sera rechazada si tiene cualquier ticket asignado.', ['name'], {
        name: { type: 'string' },
      }),
    )
  }
  if (scope === 'library') {
    tools.push(
      taskMutationTool('create_library_note', 'Crea una nota Markdown dentro de la biblioteca solo tras confirmacion individual.', ['relativePath', 'content'], {
        relativePath: { type: 'string', description: 'Ruta relativa terminada en .md.' }, content: { type: 'string' },
      }),
      taskMutationTool('replace_library_document', 'Reemplaza por completo un documento identificado solo tras confirmacion individual.', ['documentId', 'content'], {
        documentId: { type: 'string' }, content: { type: 'string' },
      }),
      taskMutationTool('delete_library_document', 'Elimina un documento identificado solo tras confirmacion individual.', ['documentId'], {
        documentId: { type: 'string' },
      }),
    )
  }
  if (scope === 'document') {
    tools.push({
      type: 'function',
      function: {
        name: 'request_file_read_permission',
        description: 'Solicita permiso antes de leer cualquier archivo diferente del archivo activo.',
        parameters: {
          type: 'object',
          required: ['documentIds', 'reason'],
          properties: {
            documentIds: { type: 'array', items: { type: 'string' } },
            reason: { type: 'string' },
          },
        },
      },
    })
  }
  return tools
}

function taskMutationTool(
  name: string,
  description: string,
  required: string[],
  properties: Record<string, unknown>,
): AiNativeToolDefinition {
  return { type: 'function', function: { name, description, parameters: {
    type: 'object', required, properties: {
      ...properties,
      planStepId: { type: 'string', description: 'ID del paso del TO-DO activo que completa esta mutacion.' },
    },
  } } }
}

export function buildChatAgentSystemPrompt(
  scope: ChatAgentScope,
  defaultPrompt = DEFAULT_AGENT_PROMPT,
  activeDocumentPath?: string | null,
): string {
  const base = [defaultPrompt.trim() || DEFAULT_AGENT_PROMPT]
  if (scope === 'task-manager') {
    base.push(
      'Estas en Task Manager. No recibiste todos los tickets como contexto.',
      'Para preguntas tematicas generales sobre tareas usa primero search_task_context.',
      'Si el usuario pide todos los tickets, un inventario, conteo, resumen completo o comparacion global, debes llamar read_all_task_tickets. RAG devuelve solo coincidencias parciales y nunca sirve para afirmar que encontraste todos.',
      'Antes de decir "todos", verifica que el resultado de read_all_task_tickets no este truncado y menciona cualquier truncamiento.',
      'Para resumenes por persona, recorre cada ticket de forma independiente y releva todos los nombres explicitamente asociados a trabajo tanto en metadatos como en titulo, detalle y cuerpo. Construye primero el conjunto completo de personas y despues agrupa las tareas; nunca mantengas el nombre del primer ticket como responsable de los siguientes.',
      'Una tarea puede aparecer bajo mas de una persona si el texto asigna o atribuye trabajo a varias. Distingue personas de equipos y menciones incidentales; si el texto no permite saber si alguien tiene trabajo asignado, indicalo como ambiguo o sin asignar en vez de inventarlo.',
      'Cuando consulten por una persona concreta, busca todas sus apariciones en el corpus del panel y conserva cada archivo coincidente como un ticket distinto. Varias menciones, comentarios o estados dentro del mismo archivo siguen siendo un solo ticket: no afirmes una cantidad de tickets mayor que la cantidad de rutas unicas encontradas.',
      'search_task_context devuelve tickets agrupados con ticketId, path y fragments. Presenta cada path como un ticket separado y nunca mezcles fragmentos de rutas distintas bajo un mismo titulo.',
      'Cuando un ticket tenga subtareas en childs, las herramientas incluyen automaticamente cada subtarea enlazada y su contenido, tambien de forma recursiva. Explica la relacion padre-subtarea y no omitas esas subtareas de una respuesta que incluya al padre.',
      'Puedes crear y modificar tickets con las herramientas de escritura. Antes de cada mutacion debes presentar la operacion concreta y esperar la confirmacion visible del usuario; una confirmacion previa no autoriza operaciones posteriores.',
      'Puedes leer los grupos mediante get_task_manager_options, crear uno con create_task_group y eliminarlo con delete_task_group. Para crear, el nombre y el color hexadecimal deben estar definidos sin inferencias. Para eliminar, verifica el grupo exacto y nunca reasignes, canceles ni muevas tickets: la eliminacion solo puede completarse si no tiene ningun ticket asignado, incluido finalizado o cancelado.',
      'Politica de no invencion: si existe la menor duda sobre el ticket exacto, el alcance, el titulo, el contenido, el comentario, la subtarea, el grupo, el estado o la prioridad, no completes ni elijas valores por tu cuenta. Busca primero; consulta get_task_manager_options cuando corresponda; si la evidencia no determina un unico valor, llama request_user_clarification y espera la respuesta.',
      'No confundas aclaracion con autorizacion. Una respuesta a request_user_clarification define la operacion pero no la aprueba: despues debes invocar la herramienta de mutacion, que mostrara su propia confirmacion visible.',
      'No agrupes varias escrituras bajo una confirmacion. Ejecuta una herramienta por cambio. Si el usuario modifica algun parametro despues de aprobar, solicita una nueva confirmacion con los valores actualizados.',
      'Si la solicitud necesita dos o mas escrituras, antes de la primera mutacion llama set_task_execution_plan con un paso concreto por escritura. El TO-DO se muestra en el chat y requiere aprobacion explicita. Si el usuario sugiere cambios, incorpora su texto y presenta un nuevo plan para aprobar; no mutes mientras tanto. Tras aprobarlo, ejecuta los pasos en orden y pasa su id como planStepId en cada herramienta de mutacion. No marques pasos por tu cuenta ni continues si uno es rechazado o falla.',
      'En Task Manager cada mutacion debe solicitarse sola en su respuesta: nunca agrupes dos escrituras en tool_calls. Un check del TO-DO equivale a una unica mutacion confirmada y aplicada. Las busquedas y lecturas son preparatorias y si pueden agruparse; para varios tickets, llama search_task_tickets una sola vez incluyendo todos sus titulos en titles y reutiliza esos resultados, en vez de buscar cada ticket en rondas separadas o repetir una busqueda ya resuelta.',
      'Antes de mutar un ticket existente, identificalo por search_task_tickets y, si hay mas de una coincidencia razonable, pregunta cual es. No uses el primer resultado por conveniencia.',
      'Cuando encuentres varias opciones, llama request_user_clarification incluyendo cada alternativa concreta en choices, con titulo y ruta y una diferencia breve cuando exista. Esas choices se muestran como botones clickeables dentro del chat. No hagas una pregunta generica ni escribas las opciones solo como texto.',
      'Si el usuario rechaza una confirmacion, no reintentes, no reformules el mismo cambio y no ejecutes acciones alternativas salvo que lo pida expresamente.',
      'Si piden el detalle de tickets encontrados, incluidos seguimientos como "esas tareas", llama read_task_tickets con todos sus ticketId unicos antes de responder. La respuesta debe tener una seccion separada por cada ruta leida; no combines varios archivos en una sola seccion.',
      'Usa read_task_tickets solo si el usuario pide mas detalles, contenido completo o si los fragmentos no alcanzan.',
    )
  } else if (scope === 'graph') {
    base.push(
      'Estas en Graph View. Los archivos seleccionados ya estan autorizados como contexto directo.',
      'Sin seleccion, busca titulos, rutas o carpetas nombradas; si no se nombra ninguno usa search_library_context.',
      'Una carpeta nombrada representa los documentos cuya ruta esta dentro de esa carpeta. Usa sus coincidencias para responder y lee los documentos cuando sus fragmentos no alcancen.',
    )
  } else if (scope === 'library') {
    base.push(
      'Estas conectado a la biblioteca activa desde Telegram. Puedes buscar y leer cualquier documento de esta biblioteca.',
      'Puedes crear, reemplazar o eliminar documentos, pero cada escritura requiere una confirmacion individual y concreta.',
      'Nunca agrupes escrituras ni interpretes una aclaracion como autorizacion. Identifica un documento de forma univoca antes de modificarlo o eliminarlo.',
      'Para consultas sobre personas, tareas o tickets, usa search_library_context con los terminos relevantes y lee solamente los documentos encontrados cuando los fragmentos no alcancen.',
      'Reutiliza los resultados ya obtenidos: no repitas una busqueda ni una lectura con los mismos argumentos. Cuando tengas evidencia suficiente, responde inmediatamente.',
    )
  } else {
    base.push(
      'Estas en el chat de un archivo abierto. Solo el archivo activo esta autorizado inicialmente.',
      activeDocumentPath
        ? `Archivo activo (solo identidad; su contenido no fue incluido): ${activeDocumentPath}`
        : 'No hay una ruta de archivo activo disponible.',
      'Podes buscar otros archivos por metadatos, pero antes de leerlos o recuperar sus fragmentos debes llamar request_file_read_permission.',
      'Respeta una negativa y no uses RAG global sin permiso explicito.',
    )
  }
  return base.join('\n')
}

export async function createChatScopedAgent(options: ChatAgentRuntimeOptions): Promise<{
  systemPrompt: string
  tools: AiNativeToolDefinition[]
  executeTool: (call: AiNativeToolCall, signal: AbortSignal) => Promise<unknown>
  validateFinalAnswer: (answer: string) => string | null
}> {
  const defaultPrompt = await loadAgentPrompt(options.library, options.promptFileName ?? 'default.md')
  const allOptions = await loadLibraryFileOptions(options.library)
  const normalizedScopePaths = new Set(options.scopePaths.map((path) => path.replace(/\\/g, '/')))
  const readableOptions = allOptions.filter((item) => /\.(md|markdown|txt)$/i.test(item.name))
  const candidates = options.scope === 'document'
    ? readableOptions
    : readableOptions.filter((item) => normalizedScopePaths.has(item.path.replace(/\\/g, '/')))
  const documents: AgentDocument[] = candidates.map((option, index) => ({ id: `doc-${index + 1}`, option }))
  const byId = new Map(documents.map((document) => [document.id, document]))
  const authorized = new Set<string>()
  let requiredTicketSections: RequiredTicketSection[] = []
  let pendingAmbiguousTickets: Array<{ ticketId: string; title: string; path: string }> = []
  let executionPlan: TaskExecutionStep[] = []
  let executionPlanApproved = false
  const clarifiedAmbiguousTicketIds = new Set<string>()
  const initiallyAuthorizedPaths = new Set([
    ...(options.explicitlySelectedPaths ?? []),
    ...(options.activeDocumentPath ? [options.activeDocumentPath] : []),
  ].map((path) => path.replace(/\\/g, '/')))
  for (const document of documents) {
    if (options.scope !== 'document' || initiallyAuthorizedPaths.has(document.option.path.replace(/\\/g, '/'))) {
      authorized.add(document.id)
    }
  }

  const resolveIds = (value: unknown): AgentDocument[] => stringArray(value)
    .map((id) => byId.get(id))
    .filter((document): document is AgentDocument => Boolean(document))

  const requireAuthorized = (selected: AgentDocument[]): { ok: true } | { ok: false; missing: AgentDocument[] } => {
    const missing = selected.filter((document) => !authorized.has(document.id))
    return missing.length > 0 ? { ok: false, missing } : { ok: true }
  }

  const loadTaskDocumentsWithSubtasks = async (selected: AgentDocument[]): Promise<LoadedAgentDocument[]> => {
    const pending = [...selected]
    const visited = new Set<string>()
    const loaded: LoadedAgentDocument[] = []

    while (pending.length > 0) {
      const document = pending.shift()
      if (!document || visited.has(document.id)) {
        continue
      }
      visited.add(document.id)
      const [file] = await loadInlineFileAttachments(options.library, [document.option.path], candidates)
      if (!file) {
        continue
      }
      loaded.push({ document, ...file })
      for (const child of resolveTaskChildDocuments(document, file.content, documents)) {
        if (!visited.has(child.id)) {
          pending.push(child)
        }
      }
    }

    return loaded
  }

  const executeTool = async (call: AiNativeToolCall, signal: AbortSignal): Promise<unknown> => {
    if (signal.aborted) {
      throw new Error('Se cancelo la ejecucion del agente.')
    }
    const { name, arguments: args } = call.function
    if (name === 'set_task_execution_plan' && options.scope === 'task-manager') {
      const labels = stringArray(args.steps, 20).map((step) => step.trim()).filter(Boolean)
      if (labels.length < 2) {
        return { ok: false, error: 'compound-plan-requires-at-least-two-steps' }
      }
      executionPlan = labels.map((label, index) => ({ id: `step-${index + 1}`, label, status: 'pending' }))
      executionPlanApproved = false
      options.onExecutionPlanChange?.([...executionPlan])
      const decision = options.requestExecutionPlanApproval
        ? await options.requestExecutionPlanApproval([...executionPlan], signal)
        : { approved: false }
      executionPlanApproved = decision.approved
      if (!decision.approved) {
        return {
          ok: false,
          error: 'plan-revision-requested',
          suggestion: decision.suggestion ?? '',
          instruction: 'Revisa el TO-DO segun la sugerencia y vuelve a llamar set_task_execution_plan.',
        }
      }
      return { ok: true, approved: true, steps: executionPlan }
    }
    if (name === 'request_user_clarification') {
      const question = typeof args.question === 'string' ? args.question.trim() : ''
      const choices = stringArray(args.choices, 8)
      if (!question) {
        return { ok: false, error: 'missing-question' }
      }
      if (options.scope === 'task-manager' && pendingAmbiguousTickets.length > 1) {
        const normalizedOptions = choices.map(normalizeAgentSearchText)
        const omittedOptions = pendingAmbiguousTickets.filter((candidate) => (
          !normalizedOptions.some((option) => (
            option.includes(normalizeAgentSearchText(candidate.title.replace(/\.(md|markdown)$/i, '')))
            || option.includes(normalizeAgentSearchText(candidate.path))
          ))
        ))
        if (choices.length < 2 || omittedOptions.length > 0) {
          return {
            ok: false,
            error: 'clarification-must-list-options',
            candidates: pendingAmbiguousTickets,
          }
        }
      }
      const answer = await options.requestClarification(question, signal, choices)
      pendingAmbiguousTickets.forEach((candidate) => clarifiedAmbiguousTicketIds.add(candidate.ticketId))
      return { ok: true, answer }
    }
    if (name === 'request_file_read_permission' && options.scope === 'document') {
      const selected = resolveIds(args.documentIds)
      if (selected.length === 0) {
        return { ok: false, error: 'unknown-documents' }
      }
      const reason = typeof args.reason === 'string' ? args.reason.trim() : 'Responder la consulta'
      const accepted = await options.requestConfirmation(
        `La IA solicita leer ${selected.map((item) => item.option.relativePath).join(', ')}. Motivo: ${reason}`,
        signal,
      )
      if (accepted) {
        selected.forEach((document) => authorized.add(document.id))
      }
      return { ok: true, accepted, grantedDocumentIds: accepted ? selected.map((item) => item.id) : [] }
    }

    if (options.scope === 'library' && ['create_library_note', 'replace_library_document', 'delete_library_document'].includes(name)) {
      const { createFile, writeTextFile } = await import('../files/filesystemEngine')
      const { performLibraryEntryOperation } = await import('../libraries/libraryRuntime')
      const content = typeof args.content === 'string' ? args.content : ''
      let confirmation = ''
      let execute: () => Promise<{ ok: boolean; error?: string }>
      if (name === 'create_library_note') {
        const relativePath = typeof args.relativePath === 'string' ? args.relativePath.trim().replace(/\\/g, '/') : ''
        if (!relativePath || relativePath.startsWith('/') || relativePath.includes('..') || !relativePath.toLowerCase().endsWith('.md')) {
          return { ok: false, error: 'invalid-relative-markdown-path' }
        }
        const separator = options.library.path.includes('\\') ? '\\' : '/'
        const targetPath = `${options.library.path.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/\//g, separator)}`
        confirmation = `Crear la nota "${relativePath}" con este contenido: ${mutationTextPreview(content)}`
        execute = () => createFile(targetPath, content, { androidDirectoryUri: options.library.androidTreeUri })
      } else {
        const documentId = typeof args.documentId === 'string' ? args.documentId.trim() : ''
        const document = byId.get(documentId)
        if (!document) return { ok: false, error: 'unknown-document' }
        if (name === 'replace_library_document') {
          confirmation = `Reemplazar por completo "${document.option.relativePath}" por: ${mutationTextPreview(content)}`
          execute = () => writeTextFile(document.option.path, content, { androidDirectoryUri: options.library.androidTreeUri })
        } else {
          confirmation = `Eliminar definitivamente "${document.option.relativePath}".`
          execute = () => performLibraryEntryOperation({ action: 'delete', targetPath: document.option.path }, { androidDirectoryUri: options.library.androidTreeUri })
        }
      }
      if (!await options.requestConfirmation(confirmation, signal)) return { ok: true, changed: false, declined: true }
      const result = await execute()
      return result.ok ? { ok: true, changed: true } : { ok: false, error: result.error ?? 'mutation-failed' }
    }

    if (name === 'get_task_manager_options' && options.scope === 'task-manager') {
      const { getTaskManagerAgentOptions } = await import(
        '../../modules/task-manager/services/taskManagerAgentMutationService'
      )
      return getTaskManagerAgentOptions(
        options.library.path,
        resolveTaskManagerBoard(options.taskManagerScopeKey),
      )
    }

    if (TASK_MUTATION_TOOL_NAMES.has(name) && options.scope === 'task-manager') {
      const selectedDocument = typeof args.ticketId === 'string' ? byId.get(args.ticketId.trim()) : undefined
      const board = resolveTaskManagerBoard(options.taskManagerScopeKey)
      let mutation: TaskManagerAgentMutation
      let confirmation: string
      const planStepId = typeof args.planStepId === 'string' ? args.planStepId.trim() : ''
      const activePlanStep = executionPlan.find((step) => step.id === planStepId)
      if (executionPlan.length > 0 && !executionPlanApproved) {
        return { ok: false, error: 'execution-plan-approval-required' }
      }
      if (executionPlan.some((step) => step.status !== 'completed')) {
        const firstPendingStep = executionPlan.find((step) => step.status === 'pending')
        if (!activePlanStep || activePlanStep.status !== 'pending') {
          return { ok: false, error: 'active-plan-step-required', steps: executionPlan }
        }
        if (firstPendingStep?.id !== activePlanStep.id) {
          return { ok: false, error: 'plan-steps-must-run-in-order', expectedStepId: firstPendingStep?.id }
        }
      }

      if (name === 'create_task_group' || name === 'delete_task_group') {
        if (!board) {
          return { ok: false, error: 'active-board-required' }
        }
        const groupName = typeof args.name === 'string' ? args.name.trim() : ''
        if (!groupName) {
          return { ok: false, error: 'incomplete-or-invalid-definition', requiresClarification: true }
        }
        if (name === 'create_task_group') {
          const color = typeof args.color === 'string' ? args.color.trim() : ''
          if (!/^#[0-9a-f]{6}$/i.test(color)) {
            return { ok: false, error: 'incomplete-or-invalid-definition', requiresClarification: true }
          }
          mutation = { kind: 'create-group', board, name: groupName, color }
          confirmation = `Crear el grupo "${groupName}" en el tablero "${board}" con color "${color}".`
        } else {
          mutation = { kind: 'delete-group', board, name: groupName }
          confirmation = `Eliminar el grupo "${groupName}" del tablero "${board}". La operacion se rechazara si tiene tickets asignados.`
        }
      } else if (name === 'create_task_ticket') {
        if (!board) {
          return { ok: false, error: 'active-board-required' }
        }
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        if (
          !title
          || typeof args.content !== 'string'
          || typeof args.group !== 'string'
          || !isTaskState(args.state)
          || !isTaskPriority(args.priority)
        ) {
          return { ok: false, error: 'incomplete-or-invalid-definition', requiresClarification: true }
        }
        const state = args.state
        const priority = args.priority
        mutation = {
          kind: 'create', board, title, state, priority,
          content: typeof args.content === 'string' ? args.content : '',
          group: typeof args.group === 'string' ? args.group : '',
        }
        confirmation = `Crear el ticket "${title}" en el tablero "${board}", grupo "${args.group.trim() || 'Sin grupo'}", estado "${state}" y prioridad "${priority}". Contenido: ${mutationTextPreview(args.content)}`
      } else {
        if (!selectedDocument) {
          return { ok: false, error: 'unknown-ticket' }
        }
        if (
          pendingAmbiguousTickets.some((candidate) => candidate.ticketId === selectedDocument.id)
          && !clarifiedAmbiguousTicketIds.has(selectedDocument.id)
        ) {
          return {
            ok: false,
            error: 'ambiguous-ticket-requires-clarification',
            requiresClarification: true,
            candidates: pendingAmbiguousTickets,
          }
        }
        const taskPath = selectedDocument.option.relativePath
        const ticketName = selectedDocument.option.name
        if (name === 'replace_task_content') {
          const content = typeof args.content === 'string' ? args.content : ''
          if (!content.trim()) {
            return { ok: false, error: 'incomplete-or-invalid-definition', requiresClarification: true }
          }
          mutation = { kind: 'replace-content', taskPath, content }
          confirmation = `Reemplazar el contenido Markdown del ticket "${ticketName}" por: ${mutationTextPreview(content)}`
        } else if (name === 'add_task_comment') {
          const comment = typeof args.comment === 'string' ? args.comment : ''
          if (!comment.trim()) {
            return { ok: false, error: 'incomplete-or-invalid-definition', requiresClarification: true }
          }
          mutation = { kind: 'add-comment', taskPath, comment }
          confirmation = `Agregar al ticket "${ticketName}" el comentario: ${comment}`
        } else if (name === 'add_task_subtask') {
          const title = typeof args.title === 'string' ? args.title.trim() : ''
          mutation = {
            kind: 'add-subtask', taskPath, title,
            content: typeof args.content === 'string' ? args.content : '',
            priority: isTaskPriority(args.priority) ? args.priority : undefined,
          }
          if (!title || typeof args.content !== 'string' || !isTaskPriority(args.priority)) {
            return { ok: false, error: 'incomplete-or-invalid-definition', requiresClarification: true }
          }
          confirmation = `Crear la subtarea "${title}" dentro del ticket "${ticketName}" con prioridad "${args.priority}". Contenido: ${mutationTextPreview(args.content)}`
        } else if (name === 'move_task_group') {
          const group = typeof args.group === 'string' ? args.group.trim() : ''
          mutation = { kind: 'move-group', taskPath, group }
          confirmation = `Mover el ticket "${ticketName}" al grupo "${group || 'Sin grupo'}".`
        } else if (name === 'change_task_state') {
          if (!isTaskState(args.state)) {
            return { ok: false, error: 'invalid-state' }
          }
          mutation = { kind: 'change-state', taskPath, state: args.state }
          confirmation = `Cambiar el estado del ticket "${ticketName}" a "${args.state}".`
        } else {
          if (!isTaskPriority(args.priority)) {
            return { ok: false, error: 'invalid-priority' }
          }
          mutation = { kind: 'change-priority', taskPath, priority: args.priority }
          confirmation = `Cambiar la prioridad del ticket "${ticketName}" a "${args.priority}".`
        }
      }

      if (activePlanStep) {
        activePlanStep.status = 'in-progress'
        options.onExecutionPlanChange?.([...executionPlan])
      }
      const accepted = await options.requestConfirmation(confirmation, signal)
      if (!accepted) {
        if (activePlanStep) {
          activePlanStep.status = 'blocked'
          options.onExecutionPlanChange?.([...executionPlan])
        }
        return { ok: true, changed: false, declined: true }
      }
      const { executeTaskManagerAgentMutation } = await import(
        '../../modules/task-manager/services/taskManagerAgentMutationService'
      )
      try {
        await executeTaskManagerAgentMutation(options.library.path, mutation)
      } catch (error) {
        if (activePlanStep) {
          activePlanStep.status = 'blocked'
          options.onExecutionPlanChange?.([...executionPlan])
        }
        throw error
      }
      if (activePlanStep) {
        activePlanStep.status = 'completed'
        options.onExecutionPlanChange?.([...executionPlan])
      }
      return { ok: true, changed: true }
    }

    const isSearch = name === 'search_task_tickets' || name === 'search_library_documents'
    if (isSearch) {
      const titles = stringArray(args.titles)
      const matches = titles.map((title) => ({
          requestedTitle: title,
          candidates: documents
            .map((document) => ({
              document,
              score: Math.max(
                scoreAgentText(title, document.option.name) * 2,
                scoreAgentText(title, buildAgentSearchText(document.option)),
              ),
            }))
            .filter((entry) => entry.score > 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, 5)
            .map(({ document, score }) => ({
              [options.scope === 'task-manager' ? 'ticketId' : 'documentId']: document.id,
              title: document.option.name,
              logicalPath: document.option.relativePath,
              score,
            })),
        }))
      if (options.scope === 'task-manager') {
        clarifiedAmbiguousTicketIds.clear()
        pendingAmbiguousTickets = matches.flatMap((match) => match.candidates.length > 1
          ? match.candidates.map((candidate) => ({
            ticketId: String(candidate.ticketId),
            title: candidate.title,
            path: candidate.logicalPath,
          }))
          : [])
      }
      return {
        matches,
      }
    }

    const isRead = name === 'read_task_tickets' || name === 'read_library_documents'
    if (isRead) {
      const requestedIds = stringArray(options.scope === 'task-manager' ? args.ticketIds : args.documentIds)
      const selected = resolveIds(requestedIds).slice(0, MAX_DIRECT_FILES)
      if (selected.length === 0 || selected.length !== Math.min(requestedIds.length, MAX_DIRECT_FILES)) {
        return { ok: false, error: 'unknown-documents' }
      }
      const permission = requireAuthorized(selected)
      if (!permission.ok) {
        return { ok: false, error: 'permission-required', documentIds: permission.missing.map((item) => item.id) }
      }
      const loadedDocuments = options.scope === 'task-manager'
        ? await loadTaskDocumentsWithSubtasks(selected)
        : (await loadInlineFileAttachments(options.library, selected.map((item) => item.option.path), candidates))
          .map((file, index) => ({ document: selected[index] as AgentDocument, ...file }))
      let consumed = 0
      const returnedDocuments = loadedDocuments.flatMap((file) => {
        const remaining = MAX_DIRECT_CHARS - consumed
        if (remaining <= 0) {
          return []
        }
        const content = file.content.slice(0, remaining)
        consumed += content.length
        return [{ document: file.document, title: file.name, path: file.path, content }]
      })
      if (options.scope === 'task-manager') {
        requiredTicketSections = returnedDocuments.map(({ document }) => ({
          title: document.option.name,
          path: document.option.relativePath,
        }))
      }
      return {
        documents: returnedDocuments.map((file) => ({
          title: file.title,
          path: file.path,
          content: file.content,
        })),
      }
    }

    if (name === 'read_all_task_tickets' && options.scope === 'task-manager') {
      const files = await loadInlineFileAttachments(
        options.library,
        documents.map((document) => document.option.path),
        candidates,
      )
      let consumed = 0
      let truncated = false
      const tickets = files.flatMap((file) => {
        const remaining = MAX_EXHAUSTIVE_TASK_CHARS - consumed
        if (remaining <= 0) {
          truncated = true
          return []
        }
        const content = file.content.slice(0, remaining)
        consumed += content.length
        if (content.length < file.content.length) {
          truncated = true
        }
        return [{ title: file.name, path: file.path, content }]
      })
      return {
        totalTickets: documents.length,
        returnedTickets: tickets.length,
        truncated,
        tickets,
      }
    }

    const isRag = name === 'search_task_context' || name === 'search_library_context'
    if (isRag) {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) {
        return { ok: false, error: 'missing-query' }
      }
      const rawRequestedIds = options.scope === 'task-manager' ? args.ticketIds : args.documentIds
      const requested = resolveIds(rawRequestedIds)
      if (Array.isArray(rawRequestedIds) && stringArray(rawRequestedIds).length !== requested.length) {
        return { ok: false, error: 'unknown-documents' }
      }
      const selected = (requested.length > 0 ? requested : documents).slice(0, MAX_RAG_FILES)
      const permission = requireAuthorized(selected)
      if (!permission.ok) {
        return { ok: false, error: 'permission-required', documentIds: permission.missing.slice(0, 20).map((item) => item.id) }
      }
      const files = await loadInlineFileAttachments(options.library, selected.map((item) => item.option.path), candidates)
      const chunks = files.flatMap((file, fileIndex) => {
        const results: AgentSearchFragment[] = []
        for (let offset = 0; offset < file.content.length; offset += CHUNK_CHARS) {
          const content = file.content.slice(offset, offset + CHUNK_CHARS)
          const document = selected[fileIndex]
          const searchText = document
            ? buildAgentSearchText(document.option, content)
            : `${file.path} ${file.name} ${content}`
          const score = scoreAgentText(query, searchText)
          if (score > 0) {
            results.push({
              documentId: document?.id ?? `doc-${fileIndex + 1}`,
              title: file.name,
              path: file.path,
              content,
              score,
            })
          }
        }
        return results
      })
      const fragments = selectDiverseAgentFragments(chunks)
      if (options.scope === 'task-manager') {
        const tickets = groupTaskContextMatches(fragments)
        const matchedDocuments = resolveIds(tickets.map((ticket) => ticket.ticketId))
        const expandedDocuments = await loadTaskDocumentsWithSubtasks(matchedDocuments)
        const ticketIds = new Set(tickets.map((ticket) => ticket.ticketId))
        for (const loadedDocument of expandedDocuments) {
          if (!ticketIds.has(loadedDocument.document.id)) {
            tickets.push({
              ticketId: loadedDocument.document.id,
              title: loadedDocument.document.option.name,
              path: loadedDocument.path,
              fragments: [loadedDocument.content.slice(0, CHUNK_CHARS)],
            })
            ticketIds.add(loadedDocument.document.id)
          }
        }
        requiredTicketSections = tickets.map((ticket) => ({ title: ticket.title, path: ticket.path }))
        return { matchingTickets: tickets.length, tickets }
      }
      return {
        fragments: fragments.map(({ documentId, ...fragment }) => ({
          documentId,
          ...fragment,
        })),
      }
    }

    return { ok: false, error: 'unknown-tool' }
  }

  return {
    systemPrompt: buildChatAgentSystemPrompt(options.scope, defaultPrompt, options.activeDocumentPath),
    tools: buildChatAgentTools(options.scope),
    executeTool,
    validateFinalAnswer: (answer) => options.scope === 'task-manager'
      ? buildTicketSectionCorrection(answer, requiredTicketSections)
      : null,
  }
}
