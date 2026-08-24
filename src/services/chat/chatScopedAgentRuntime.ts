import type { NotiaLibrary } from '../../types/notia'
import type { AiNativeToolCall, AiNativeToolDefinition } from '../ai/aiRuntime'
import { DEFAULT_AGENT_PROMPT, loadAgentPrompt } from '../ai/agentPromptRuntime'
import {
  loadInlineFileAttachments,
  loadLibraryFileOptions,
  type ChatLibraryFileOption,
} from './chatAttachmentRuntime'

export type ChatAgentScope = 'task-manager' | 'graph' | 'document'

export interface ChatAgentRuntimeOptions {
  scope: ChatAgentScope
  library: NotiaLibrary
  scopePaths: string[]
  activeDocumentPath?: string | null
  explicitlySelectedPaths?: string[]
  promptFileName?: string
  requestClarification: (question: string, signal: AbortSignal) => Promise<string>
  requestConfirmation: (question: string) => Promise<boolean>
}

interface AgentDocument {
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

const MAX_RAG_FILES = 160
const MAX_RAG_RESULTS = 8
const MAX_DIRECT_FILES = 6
const MAX_DIRECT_CHARS = 30_000
const MAX_EXHAUSTIVE_TASK_CHARS = 160_000
const CHUNK_CHARS = 1_200

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
        description: 'Pregunta al usuario cuando una decision o coincidencia ambigua impide continuar con seguridad.',
        parameters: {
          type: 'object',
          required: ['question'],
          properties: { question: { type: 'string' } },
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

export function buildChatAgentSystemPrompt(
  scope: ChatAgentScope,
  defaultPrompt = DEFAULT_AGENT_PROMPT,
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
      'Si piden el detalle de tickets encontrados, incluidos seguimientos como "esas tareas", llama read_task_tickets con todos sus ticketId unicos antes de responder. La respuesta debe tener una seccion separada por cada ruta leida; no combines varios archivos en una sola seccion.',
      'Usa read_task_tickets solo si el usuario pide mas detalles, contenido completo o si los fragmentos no alcanzan.',
    )
  } else if (scope === 'graph') {
    base.push(
      'Estas en Graph View. Los archivos seleccionados ya estan autorizados como contexto directo.',
      'Sin seleccion, busca titulos, rutas o carpetas nombradas; si no se nombra ninguno usa search_library_context.',
      'Una carpeta nombrada representa los documentos cuya ruta esta dentro de esa carpeta. Usa sus coincidencias para responder y lee los documentos cuando sus fragmentos no alcancen.',
    )
  } else {
    base.push(
      'Estas en el chat de un archivo abierto. Solo el archivo activo esta autorizado inicialmente.',
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
  const readableOptions = allOptions.filter((item) => /\.(md|markdown|txt|inkdoc)$/i.test(item.name))
  const candidates = options.scope === 'document'
    ? readableOptions
    : readableOptions.filter((item) => normalizedScopePaths.has(item.path.replace(/\\/g, '/')))
  const documents: AgentDocument[] = candidates.map((option, index) => ({ id: `doc-${index + 1}`, option }))
  const byId = new Map(documents.map((document) => [document.id, document]))
  const authorized = new Set<string>()
  let requiredTicketSections: RequiredTicketSection[] = []
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

  const executeTool = async (call: AiNativeToolCall, signal: AbortSignal): Promise<unknown> => {
    if (signal.aborted) {
      throw new Error('Se cancelo la ejecucion del agente.')
    }
    const { name, arguments: args } = call.function
    if (name === 'request_user_clarification') {
      const question = typeof args.question === 'string' ? args.question.trim() : ''
      if (!question) {
        return { ok: false, error: 'missing-question' }
      }
      const answer = await options.requestClarification(question, signal)
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
      )
      if (accepted) {
        selected.forEach((document) => authorized.add(document.id))
      }
      return { ok: true, accepted, grantedDocumentIds: accepted ? selected.map((item) => item.id) : [] }
    }

    const isSearch = name === 'search_task_tickets' || name === 'search_library_documents'
    if (isSearch) {
      const titles = stringArray(args.titles)
      return {
        matches: titles.map((title) => ({
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
        })),
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
      const files = await loadInlineFileAttachments(options.library, selected.map((item) => item.option.path), candidates)
      if (options.scope === 'task-manager') {
        requiredTicketSections = selected.map((document) => ({
          title: document.option.name,
          path: document.option.relativePath,
        }))
      }
      let consumed = 0
      return {
        documents: files.flatMap((file) => {
          const remaining = MAX_DIRECT_CHARS - consumed
          if (remaining <= 0) {
            return []
          }
          const content = file.content.slice(0, remaining)
          consumed += content.length
          return [{ title: file.name, path: file.path, content }]
        }),
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
    systemPrompt: buildChatAgentSystemPrompt(options.scope, defaultPrompt),
    tools: buildChatAgentTools(options.scope),
    executeTool,
    validateFinalAnswer: (answer) => options.scope === 'task-manager'
      ? buildTicketSectionCorrection(answer, requiredTicketSections)
      : null,
  }
}
