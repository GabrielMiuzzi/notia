import type { NotiaLibrary } from '../../types/notia'
import type { FinanceSalaryReceipt } from '../../modules/finance/types/financeTypes'
import type { AiNativeToolCall, AiNativeToolDefinition } from '../ai/aiRuntime'
import { appendAgentRule, DEFAULT_AGENT_PROMPT, isInternalAgentCorrection, isLikelyPersonalMemory, loadAgentMemories, loadAgentPrompt, loadAgentRules, resolveAgentRulesContent, DEFAULT_AGENT_RULES, writeAgentMemories } from '../ai/agentPromptRuntime'
import {
  loadInlineFileAttachments,
  loadLibraryFileOptions,
  type ChatLibraryFileOption,
} from './chatAttachmentRuntime'
import type { TaskManagerAgentMutation } from '../../modules/task-manager/services/taskManagerAgentMutationService'
import type { TaskPriority, TaskState } from '../../modules/task-manager/types/taskManagerTypes'

export type ChatAgentScope = 'task-manager' | 'graph' | 'document' | 'library' | 'finance'
export type ChatAgentResponseFormat = 'telegram-html'
export type TaskExecutionStepStatus = 'pending' | 'in-progress' | 'completed' | 'blocked'
export interface TaskExecutionStep { id: string; label: string; status: TaskExecutionStepStatus }

export interface ChatAgentRuntimeOptions {
  scope: ChatAgentScope
  library: NotiaLibrary
  aiPreferences: import('../preferences/aiSettingsStorage').AiPreferences
  scopePaths: string[]
  activeDocumentPath?: string | null
  explicitlySelectedPaths?: string[]
  promptFileName?: string
  taskManagerScopeKey?: string | null
  publishedScope?: boolean
  responseFormat?: ChatAgentResponseFormat
  actorUserId?: number
  financeSourceReference?: string | null
  onFinancePurchaseSaved?: (sourceReference: string) => void
  onFinanceSalarySaved?: (sourceReference: string, salary?: FinanceSalaryReceipt) => void
  onFinanceCreditCardStatementSaved?: (sourceReference: string) => void
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
const PUBLISHED_TASK_MANAGER_TOOL_NAMES = new Set([
  'search_library_documents',
  'search_library_context',
  'read_library_documents',
  'request_user_clarification',
  'read_all_task_tickets',
  'search_task_tickets',
  'search_task_context',
  'read_task_tickets',
  'get_task_manager_options',
  'set_task_execution_plan',
  'create_library_note',
  'replace_library_document',
  'delete_library_document',
  'request_file_read_permission',
  ...TASK_MUTATION_TOOL_NAMES,
])
export const CHAT_AGENT_MAX_ROUNDS = 64
export const CHAT_AGENT_SINGLE_CALL_TOOL_NAMES = [
  'set_task_execution_plan',
  'create_task_ticket',
  'replace_task_content',
  'add_task_comment',
  'add_task_subtask',
  'move_task_group',
  'change_task_state',
  'change_task_priority',
  'create_task_group',
  'delete_task_group',
  'create_library_note',
  'replace_library_document',
  'delete_library_document',
  'create_finance_category',
  'create_finance_purchase',
  'create_finance_salary',
  'create_finance_credit_card_statement',
] as const

const FINANCE_TOOL_NAMES = new Set([
  'request_user_clarification',
  'get_finance_dashboard',
  'create_finance_transaction',
  'create_finance_savings_movement',
  'create_finance_savings_exchange',
  'list_finance_accounts',
  'list_finance_categories',
  'list_finance_movements',
  'update_finance_transaction_status',
  'search_finance_categories',
  'create_finance_category',
  'create_finance_purchase',
  'create_finance_salary',
  'create_finance_credit_card_statement',
  'list_finance_credit_card_statements',
  'list_finance_salaries',
  'list_finance_purchases',
])

/** Accepts canonical, numeric and common ARS/USD locale forms from tool-calling models. */
export function normalizeFinanceDecimal(value: unknown, maxFractionDigits = 2): string | null {
  if (maxFractionDigits < 0 || maxFractionDigits > 8) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    const numericText = String(value)
    const match = /^(\d+)(?:\.(\d+))?$/.exec(numericText)
    if (!match || (match[2]?.length ?? 0) > maxFractionDigits) return null
    const fraction = (match[2] ?? '').replace(/0+$/, '')
    return fraction ? `${match[1]}.${fraction}` : match[1] ?? null
  }
  const rawValue = typeof value === 'string' ? value.trim() : ''
  if (!rawValue) return null

  const compact = rawValue
    .replace(/(?:ARS|USD|US\$|\$)/gi, '')
    .replace(/\s+/g, '')
  if (!compact || compact.startsWith('-') || /[^\d.,]/.test(compact)) return null

  const commaIndex = compact.lastIndexOf(',')
  const dotIndex = compact.lastIndexOf('.')
  const lastSeparatorIndex = Math.max(commaIndex, dotIndex)
  let integerPart = compact
  let fractionPart = ''
  if (lastSeparatorIndex >= 0) {
    const trailingDigits = compact.length - lastSeparatorIndex - 1
    const separator = compact[lastSeparatorIndex]
    const separatorCount = [...compact].filter((character) => character === separator).length
    const hasDifferentSeparator = commaIndex >= 0 && dotIndex >= 0
    const isDecimalSeparator = trailingDigits > 0
      && trailingDigits <= maxFractionDigits
      && (hasDifferentSeparator || separatorCount === 1)
    if (isDecimalSeparator) {
      integerPart = compact.slice(0, lastSeparatorIndex)
      fractionPart = compact.slice(lastSeparatorIndex + 1)
    }
  }

  integerPart = integerPart.replace(/[.,]/g, '').replace(/^0+(?=\d)/, '')
  if (!/^\d+$/.test(integerPart) || (fractionPart && !/^\d+$/.test(fractionPart))) return null
  const normalizedFraction = fractionPart.replace(/0+$/, '')
  return normalizedFraction ? `${integerPart}.${normalizedFraction}` : integerPart
}

export function sumFinanceAmounts(values: readonly string[]): string | null {
  let totalCents = 0n
  for (const value of values) {
    const normalized = normalizeFinanceDecimal(value)
    if (!normalized) return null
    const [whole = '0', fraction = ''] = normalized.split('.')
    totalCents += BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  }
  const whole = totalCents / 100n
  const fraction = String(totalCents % 100n).padStart(2, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

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

export function buildChatAgentTools(
  scope: ChatAgentScope,
  autoConfirmFinanceMutations = false,
  publishedScope = false,
): AiNativeToolDefinition[] {
  const tools: AiNativeToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'add_agent_rule',
        description: 'Guarda solo una instruccion imperativa y explicita sobre tu comportamiento futuro. Nunca guarda identidad, gustos, empleo, proyectos ni otros hechos personales.',
        parameters: { type: 'object', required: ['rule'], properties: { rule: { type: 'string' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'add_agent_memory',
        description: 'Guarda sin confirmacion un hecho duradero sobre el usuario: identidad, preferencias, empleo, proyectos o contexto personal.',
        parameters: { type: 'object', required: ['memory'], properties: { memory: { type: 'string' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_library_documents',
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
        name: 'search_library_context',
        description: 'Recupera fragmentos relevantes mediante RAG local. Usala para preguntas generales antes de leer archivos completos.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: { query: { type: 'string' }, documentIds: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_library_documents',
        description: 'Lee el contenido completo de elementos previamente identificados. Usala solo cuando se pidan detalles.',
        parameters: {
          type: 'object',
          required: ['documentIds'],
          properties: { documentIds: { type: 'array', items: { type: 'string' } } },
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
  if (scope === 'finance') {
    tools.push(
      {
        type: 'function', function: {
          name: 'get_finance_dashboard',
          description: 'Consulta el resumen de un mes: cuentas y saldos por moneda, categorias y movimientos. Usala antes de responder saldos o totales; los totales excluyen transferencias.',
          parameters: { type: 'object', required: ['month'], properties: { month: { type: 'string', description: 'Mes YYYY-MM.' } } },
        },
      },
      {
        type: 'function', function: {
          name: 'create_finance_savings_exchange',
          description: 'Registra una compra de moneda para ahorro en una única operación: guarda la salida como gasto desde la cuenta de pago y acredita la moneda comprada en la reserva. Usala cuando el usuario indique ambos importes y monedas, por ejemplo comprar USD con ARS para una reserva. Antes consulta get_finance_dashboard para resolver reserva y cuenta por nombre; no pidas IDs al usuario.',
          parameters: { type: 'object', required: ['reserve', 'sourceAccount', 'sourceAmount', 'sourceCurrency', 'savingsAmount', 'savingsCurrency'], properties: {
            reserve: { type: 'string', description: 'Nombre o ID de la reserva de ahorro existente.' }, sourceAccount: { type: 'string', description: 'Nombre o ID de la cuenta de pago de donde sale el dinero.' }, sourceAmount: { type: 'string', description: 'Importe exacto que sale de la cuenta de pago.' }, sourceCurrency: { type: 'string', enum: ['ARS', 'USD'], description: 'Moneda que sale de la cuenta.' }, savingsAmount: { type: 'string', description: 'Importe exacto que se acredita en la reserva.' }, savingsCurrency: { type: 'string', enum: ['ARS', 'USD'], description: 'Moneda que se acredita en la reserva; debe diferir de la moneda de salida.' }, effectiveDate: { type: 'string', description: 'Fecha YYYY-MM-DD; si se dijo este mes sin día, usa hoy.' }, description: { type: 'string', description: 'Descripción breve de la compra para ahorro.' }, confidence: { type: 'number', description: 'Entre 0 y 1; Telegram confirma automáticamente cuando los datos son claros.' }, sourceReference: { type: 'string', description: 'Referencia opaca de Telegram si existe.' }, rawSource: { type: 'string', description: 'Texto original del usuario si existe.' },
          } },
        },
      },
      {
        type: 'function', function: {
          name: 'create_finance_transaction',
          description: autoConfirmFinanceMutations
            ? 'Crea y confirma inmediatamente un ingreso, gasto, transferencia o ajuste de Telegram usando IDs obtenidos de las herramientas financieras. Usala solo cuando importe, moneda, fecha, cuenta, categoría y descripción sean inequívocos. Nunca pidas confirmación: el usuario revisará y editará luego en Finanzas.'
            : 'Crea un ingreso, gasto, transferencia o ajuste usando IDs obtenidos de las herramientas financieras. Llamala solo cuando importe, moneda, fecha, cuenta y descripcion sean inequivocos. Con confianza menor a 0.95 crea un borrador pendiente y solicita la confirmacion visible; con 0.95 o mas queda confirmado. Nunca pidas una confirmacion en texto ni digas que se registro sin llamar esta herramienta y recibir ok:true.',
          parameters: { type: 'object', required: ['transactionType', 'amount', 'currency', 'effectiveDate', 'accountId', 'description'], properties: {
            transactionType: { type: 'string', enum: ['income', 'expense', 'transfer', 'adjustment'], description: 'expense descuenta, income acredita, transfer mueve entre cuentas y adjustment corrige un saldo sin clasificarlo como ingreso o gasto.' }, amount: { type: 'string', description: 'Importe decimal exacto como texto, sin simbolo de moneda ni separador de miles.' }, currency: { type: 'string', enum: ['ARS', 'USD'], description: 'Moneda de la cuenta elegida; nunca conviertas monedas.' }, effectiveDate: { type: 'string', description: 'Fecha efectiva exacta en formato YYYY-MM-DD.' }, accountId: { type: 'string', description: 'ID opaco de una cuenta activa obtenido con list_finance_accounts.' }, destinationAccountId: { type: 'string', description: 'ID opaco obligatorio para transfer; es la cuenta que recibe el importe.' }, categoryId: { type: 'string', description: 'ID opaco de una categoria existente o creada y confirmada mediante create_finance_category.' }, description: { type: 'string', description: 'Descripcion breve del hecho, por ejemplo Nafta.' }, confidence: { type: 'number', description: 'Entre 0 y 1. Usa 0.95 solo si todos los campos fueron expresados sin ambiguedad; si no, usa menos de 0.95.' }, sourceReference: { type: 'string', description: 'Referencia opaca al audio o archivo original, si existe.' }, rawSource: { type: 'string', description: 'Transcripción original, si existe.' },
          } },
        },
      },
      {
        type: 'function', function: {
          name: 'create_finance_savings_movement',
          description: 'Crea un movimiento de una reserva de ahorro vinculada a una cuenta real. Usala solo con IDs existentes. Los aportes y retiros son movimientos internos, no ingresos ni gastos; un retiro exige motivo. Solicita confirmacion visible salvo confianza alta.',
          parameters: { type: 'object', required: ['reserveId', 'accountId', 'movementType', 'amount', 'currency', 'effectiveDate'], properties: {
            reserveId: { type: 'string', description: 'ID opaco de una reserva existente.' }, accountId: { type: 'string', description: 'ID opaco de la cuenta real vinculada.' }, movementType: { type: 'string', enum: ['contribution', 'withdrawal', 'return', 'loss', 'adjustment'], description: 'contribution aporta, withdrawal retira, return registra rendimiento, loss una perdida y adjustment una correccion.' }, amount: { type: 'string', description: 'Importe decimal exacto como texto.' }, currency: { type: 'string', enum: ['ARS', 'USD'], description: 'Moneda de la reserva y cuenta, sin conversion.' }, effectiveDate: { type: 'string', description: 'Fecha efectiva en formato YYYY-MM-DD.' }, description: { type: 'string', description: 'Descripcion breve del movimiento.' }, reason: { type: 'string', description: 'Motivo obligatorio cuando movementType es withdrawal.' }, confidence: { type: 'number', description: 'Entre 0 y 1; solo 0.95 o mas permite confirmacion automatica.' },
          } },
        },
      },
      {
        type: 'function', function: {
          name: 'list_finance_accounts',
          description: 'Lista las cuentas activas, sus IDs opacos, monedas y saldos actuales. Usala antes de crear un movimiento si el usuario no indico una cuenta inequivoca; muestra las alternativas y solicita una eleccion.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function', function: {
          name: 'list_finance_categories',
          description: 'Lista las categorias activas con sus IDs opacos y tipo. Usala para explorar categorias existentes; no crea categorias.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function', function: {
          name: 'list_finance_movements',
          description: 'Lista los movimientos de un mes, incluidos pendientes, confirmados, corregidos y descartados. Usala para localizar el ID antes de corregir, confirmar o descartar.',
          parameters: { type: 'object', required: ['month'], properties: { month: { type: 'string', description: 'Mes YYYY-MM.' } } },
        },
      },
      {
        type: 'function', function: {
          name: 'update_finance_transaction_status',
          description: 'Confirma, corrige o descarta un movimiento existente por ID. Primero obtene el ID con list_finance_movements. Toda modificacion solicita confirmacion visible y nunca modifica saldos directamente.',
          parameters: { type: 'object', required: ['transactionId', 'status'], properties: { transactionId: { type: 'string', description: 'ID opaco de un movimiento devuelto por list_finance_movements.' }, status: { type: 'string', enum: ['confirmed', 'corrected', 'discarded'], description: 'confirmed acepta el borrador, corrected guarda los campos corregidos, discarded lo descarta.' }, amount: { type: 'string', description: 'Nuevo importe decimal exacto, solo para una correccion.' }, effectiveDate: { type: 'string', description: 'Nueva fecha YYYY-MM-DD, solo para una correccion.' }, accountId: { type: 'string', description: 'Nuevo ID opaco de cuenta, solo para una correccion.' }, categoryId: { type: 'string', description: 'Nuevo ID opaco de categoria existente, solo para una correccion.' }, description: { type: 'string', description: 'Nueva descripcion, solo para una correccion.' } } },
        },
      },
      {
        type: 'function', function: {
          name: 'search_finance_categories',
          description: autoConfirmFinanceMutations
            ? 'Busca categorías existentes por nombre y tipo y devuelve coincidencias con IDs. Si no hay una compatible, crea una nueva con create_finance_category y continúa la carga automáticamente; no pidas confirmación.'
            : 'Busca categorias existentes por nombre y tipo y devuelve coincidencias con IDs. Si devuelve cero o varias coincidencias, solicita aclaracion. Si no hay coincidencias, podes proponer una categoria nueva y crearla solo mediante create_finance_category con confirmacion visible.',
          parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, kind: { type: 'string', enum: ['income', 'expense'] } } },
        },
      },
      {
        type: 'function', function: {
          name: 'create_finance_category',
          description: autoConfirmFinanceMutations
            ? 'Crea automáticamente una categoría financiera para una carga de Telegram cuando una búsqueda previa no encontró una compatible. Si ya existe una categoría activa con el mismo nombre y tipo, devuelve la existente sin duplicarla.'
            : 'Crea una categoria financiera cuando no existe una adecuada. Solo usala despues de buscar categorias y con un nombre propuesto de forma explicita; solicita confirmacion visible antes de persistir. Si ya existe una categoria activa con el mismo nombre y tipo, devuelve la existente sin duplicarla.',
          parameters: { type: 'object', required: ['name', 'kind'], properties: {
            name: { type: 'string', description: 'Nombre breve de categoria, entre 1 y 80 caracteres, por ejemplo Transporte.' },
            kind: { type: 'string', enum: ['income', 'expense'], description: 'expense para gastos e income para ingresos.' },
            description: { type: 'string', description: 'Descripcion opcional de la categoria, hasta 500 caracteres.' },
          } },
        },
      },
      {
        type: 'function', function: {
          name: 'create_finance_purchase',
          description: autoConfirmFinanceMutations
            ? 'Guarda y confirma automáticamente un ticket de Telegram extraído de una imagen: crea la compra, sus líneas, observaciones históricas de precio y gasto asociado. Antes busca una categoría compatible y créala si no existe. Solo pregunta si la cuenta de pago no se puede inferir razonablemente.'
            : 'Guarda un ticket de compra extraido de una imagen: crea la compra, sus lineas, observaciones historicas de precio y el gasto asociado. Usala solamente si la imagen es un ticket legible y cada importe fue extraido; primero pide la cuenta si falta. Muestra confirmacion visible antes de persistir.',
          parameters: { type: 'object', required: ['accountId', ...(autoConfirmFinanceMutations ? ['categoryId'] : []), 'merchantName', 'observedAt', 'currency', 'subtotalAmount', 'discountAmount', 'taxAmount', 'totalAmount', 'items'], properties: {
            accountId: { type: 'string', description: 'ID o nombre exacto de la cuenta real que pago el ticket.' }, categoryId: { type: 'string', description: 'ID o nombre de una categoría de gasto existente o recién creada; se aplica a las líneas del ticket.' }, merchantName: { type: 'string', description: 'Comercio leido del ticket.' }, observedAt: { type: 'string', description: 'Fecha y hora ISO; usa la fecha actual solo si el ticket no la muestra.' }, currency: { type: 'string', enum: ['ARS', 'USD'] }, subtotalAmount: { type: 'string', description: 'Subtotal exacto como texto. Si no está impreso, usa la suma de lineTotal, incluyendo cualquier línea de ajuste de redondeo.' }, discountAmount: { type: 'string', description: 'Descuentos exactos como texto; usa 0 si no aparecen.' }, taxAmount: { type: 'string', description: 'Impuestos exactos como texto; usa 0 si no aparecen.' }, totalAmount: { type: 'string', description: 'Total final exacto impreso en el ticket.' }, items: { type: 'array', minItems: 1, maxItems: 100, description: 'Una línea por producto o ajuste legible del ticket. Incluye los ajustes de redondeo impresos como líneas independientes. No inventes líneas ni importes.', items: { type: 'object', required: ['originalDescription', 'quantity', 'unitPrice', 'discountAmount', 'lineTotal'], properties: { originalDescription: { type: 'string', description: 'Descripcion literal del producto o ajuste en el ticket.' }, normalizedDescription: { type: 'string', description: 'Nombre limpio opcional, sin marca de precio.' }, quantity: { type: 'string', description: 'Cantidad exacta en formato decimal, por ejemplo 2 o 0.5.' }, unitPrice: { type: 'string', description: 'Precio unitario exacto antes de descuento.' }, discountAmount: { type: 'string', description: 'Descuento de la linea, o 0.' }, lineTotal: { type: 'string', description: 'Importe final exacto de la linea.' } } } }, rawExtraction: { type: 'string', description: 'Resumen estructurado de lo que se leyo de la imagen para auditoria.' },
          } },
        },
      },
      {
        type: 'function', function: {
          name: 'create_finance_salary',
          description: autoConfirmFinanceMutations
            ? 'Guarda y confirma automáticamente un recibo de sueldo recibido por Telegram: persiste el recibo, sus conceptos y el ingreso por el neto en la cuenta elegida. En un PDF firmado, el neto impreso es autoritativo aunque no coincida con bruto menos descuentos por adelantos, ajustes u otros conceptos de liquidación. No usa categorías. Solo pregunta si la cuenta de cobro no puede inferirse razonablemente.'
            : 'Guarda un recibo de sueldo extraído de una imagen, sus conceptos y el ingreso por el neto. Usala solo cuando período, fecha de cobro, empleador, bruto, descuentos, neto, moneda y cuenta estén definidos; solicita confirmación visible antes de persistir.',
          parameters: { type: 'object', required: ['accountId', 'period', 'paymentDate', 'employer', 'grossAmount', 'deductionsTotal', 'netAmount', 'currency', 'concepts', ...(autoConfirmFinanceMutations ? ['signedDocument'] : [])], properties: {
            accountId: { type: 'string', description: 'ID o nombre exacto de la cuenta real que recibió el sueldo.' },
            period: { type: 'string', description: 'Período liquidado en formato YYYY-MM.' },
            paymentDate: { type: 'string', description: 'Fecha efectiva de cobro en formato YYYY-MM-DD. No uses la fecha de carga si el recibo muestra otra.' },
            employer: { type: 'string', description: 'Razón social o nombre del empleador leído del recibo.' },
            grossAmount: { type: 'string', description: 'Total bruto exacto como texto.' },
            deductionsTotal: { type: 'string', description: 'Total de descuentos exacto como texto.' },
            netAmount: { type: 'string', description: 'Neto cobrado exacto como texto; este importe crea el ingreso.' },
            currency: { type: 'string', enum: ['ARS', 'USD'] },
            signedDocument: { type: 'boolean', description: 'true únicamente si la fuente es PDF y el recibo indica una firma digital, electrónica o manuscrita; false si no hay evidencia de firma.' },
            concepts: { type: 'array', maxItems: 200, description: 'Conceptos legibles del recibo, sin inventar. earning para haberes y deduction para descuentos.', items: { type: 'object', required: ['name', 'conceptType', 'amount'], properties: { name: { type: 'string' }, conceptType: { type: 'string', enum: ['earning', 'deduction'] }, amount: { type: 'string', description: 'Importe exacto y positivo del concepto.' } } } },
            rawExtraction: { type: 'string', description: 'Resumen estructurado de los campos leídos para auditoría.' },
            sourceReference: { type: 'string', description: 'Referencia opaca a la imagen original; Telegram la aporta automáticamente.' },
          } },
        },
      },
      {
        type: 'function', function: {
          name: 'create_finance_credit_card_statement',
          description: autoConfirmFinanceMutations
            ? 'Guarda y confirma automáticamente un resumen de tarjeta de crédito recibido por Telegram. Registra cada consumo, cargo, interés e impuesto como gasto en la cuenta de tarjeta; pagos y créditos quedan conciliados sin crear otro gasto. El total a pagar nunca se registra como gasto adicional.'
            : 'Guarda un resumen de tarjeta, sus líneas y los movimientos de consumos/cargos en la cuenta de tarjeta. El total a pagar del resumen no es otro gasto y el pago posterior debe registrarse como transferencia. Solicita confirmación visible antes de persistir.',
          parameters: { type: 'object', required: ['accountId', 'issuer', 'period', 'closingDate', 'dueDate', 'currency', 'previousBalance', 'paymentsAmount', 'creditsAmount', 'purchasesAmount', 'feesAmount', 'interestAmount', 'taxesAmount', 'totalDue', 'items'], properties: {
            accountId: { type: 'string', description: 'ID o nombre exacto de una cuenta activa de tipo credit_card que corresponde al resumen; no es la cuenta bancaria desde la que se pagará.' },
            issuer: { type: 'string', description: 'Banco o emisor leído del resumen.' },
            cardLastFour: { type: 'string', description: 'Últimos cuatro dígitos si están visibles; nunca inventarlos.' },
            period: { type: 'string', description: 'Período del resumen en formato YYYY-MM.' },
            closingDate: { type: 'string', description: 'Fecha de cierre YYYY-MM-DD.' },
            dueDate: { type: 'string', description: 'Fecha de vencimiento YYYY-MM-DD.' },
            currency: { type: 'string', enum: ['ARS', 'USD'], description: 'Moneda de este bloque. Si el resumen tiene ARS y USD, genera una llamada independiente por cada moneda, con sus propios totales y líneas.' },
            previousBalance: { type: 'string' }, paymentsAmount: { type: 'string' }, creditsAmount: { type: 'string' }, purchasesAmount: { type: 'string' }, feesAmount: { type: 'string' }, interestAmount: { type: 'string' }, taxesAmount: { type: 'string' }, totalDue: { type: 'string' }, minimumPayment: { type: 'string' },
            items: { type: 'array', minItems: 1, maxItems: 300, description: 'Todas las líneas legibles. Incluye totales agregados impresos como una línea cuando no exista su desglose. Usa importes positivos.', items: { type: 'object', required: ['purchaseDate', 'description', 'amount', 'itemType'], properties: { purchaseDate: { type: 'string', description: 'Fecha YYYY-MM-DD.' }, description: { type: 'string' }, amount: { type: 'string' }, itemType: { type: 'string', enum: ['purchase', 'fee', 'interest', 'tax', 'payment', 'credit'] }, installmentNumber: { type: 'integer' }, installmentCount: { type: 'integer' } } } },
            rawExtraction: { type: 'string' }, sourceReference: { type: 'string' },
          } },
        },
      },
      {
        type: 'function', function: {
          name: 'list_finance_salaries',
          description: 'Consulta recibos de sueldo y su evolucion historica. Es solo lectura: no crea ni modifica sueldos.',
          parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
        },
      },
      {
        type: 'function', function: {
          name: 'list_finance_credit_card_statements',
          description: 'Consulta resúmenes de tarjeta importados, sus fechas, totales y líneas. Es solo lectura.',
          parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
        },
      },
      {
        type: 'function', function: {
          name: 'list_finance_purchases',
          description: 'Consulta compras confirmadas y pendientes por fecha, incluidos tickets y lineas cuando existan. Es solo lectura: no extrae ni modifica archivos.',
          parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
        },
      },
    )
  }
  {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'search_task_tickets',
          description: 'Busca uno o varios tickets de Task Manager por titulo. No lee su contenido.',
          parameters: { type: 'object', required: ['titles'], properties: { titles: { type: 'array', items: { type: 'string' } } } },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_task_context',
          description: 'Recupera fragmentos relevantes de tickets mediante RAG local.',
          parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, ticketIds: { type: 'array', items: { type: 'string' } } } },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_task_tickets',
          description: 'Lee tickets completos previamente identificados, incluyendo sus subtareas.',
          parameters: { type: 'object', required: ['ticketIds'], properties: { ticketIds: { type: 'array', items: { type: 'string' } } } },
        },
      },
    )
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
        description: 'Devuelve el tablero solicitado o activo y sus grupos, estados y prioridades validos. Consultala antes de preguntar o mutar si algun valor no esta definido con precision; nunca inventes opciones.',
        parameters: { type: 'object', properties: { board: { type: 'string' } } },
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
        board: { type: 'string', description: 'Tablero de destino; obligatorio cuando no hay un tablero activo.' },
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
        board: { type: 'string', description: 'Tablero de destino; obligatorio cuando no hay un tablero activo.' },
        name: { type: 'string' }, color: { type: 'string', description: 'Color hexadecimal exacto con formato #RRGGBB.' },
      }),
      taskMutationTool('delete_task_group', 'Elimina un grupo del tablero activo solo despues de pedir confirmacion. La operacion sera rechazada si tiene cualquier ticket asignado.', ['name'], {
        board: { type: 'string', description: 'Tablero de destino; obligatorio cuando no hay un tablero activo.' }, name: { type: 'string' },
      }),
    )
  }
  {
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
  {
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
  if (publishedScope) {
    return tools.filter((tool) => PUBLISHED_TASK_MANAGER_TOOL_NAMES.has(tool.function.name))
  }
  return scope === 'finance'
    ? tools.filter((tool) => FINANCE_TOOL_NAMES.has(tool.function.name))
    : tools
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
  responseFormat?: ChatAgentResponseFormat,
  rules = resolveAgentRulesContent(DEFAULT_AGENT_RULES, responseFormat),
): string {
  const base = [
    defaultPrompt.trim() || DEFAULT_AGENT_PROMPT,
    'El contexto activo limita los archivos inicialmente autorizados, pero no cambia las capacidades. Si falta un tablero, archivo, opcion o permiso, usa las herramientas de consulta o request_user_clarification en lugar de inventarlo.',
    rules,
  ]
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
  } else if (scope === 'finance') {
    const autoConfirmTelegramFinance = responseFormat === 'telegram-html'
    base.push(
      'Estas en Finanzas. Usa exclusivamente las herramientas financieras; no uses SQL ni modifiques saldos directamente.',
      'No recibiste documentos de la biblioteca como contexto. Consulta solamente los datos mínimos necesarios mediante herramientas tipadas.',
      `La fecha actual para registrar operaciones sin fecha indicada es ${new Date().toISOString().slice(0, 10)}. Usa esa fecha solo cuando el usuario no indique otra.`,
      'Antes de registrar cualquier movimiento lista las cuentas. Si el usuario no indicó una cuenta inequívoca, llama request_user_clarification y espera; esto es obligatorio también en Telegram.',
      autoConfirmTelegramFinance
        ? 'Para cargas financieras de Telegram esta política específica reemplaza la confirmación general: en gastos y tickets busca una categoría compatible y créala automáticamente si no existe; recibos de sueldo y resúmenes de tarjeta no requieren buscar categorías. No propongas ni pidas confirmación. Cuando cuenta, importes y fecha sean suficientemente claros, registra y confirma la operación de inmediato para que el usuario pueda revisarla y editarla luego en Finanzas.'
        : 'Busca categorías existentes. Si no hay ninguna adecuada, podes proponer una nueva relacionada con el hecho y crearla solo con create_finance_category, que exige confirmación individual visible. Ante varias coincidencias solicita aclaración.',
      'Cuando el usuario compre una moneda para acreditarla en una reserva de ahorro, usa create_finance_savings_exchange. Resuelve reserva y cuenta por nombre con get_finance_dashboard; nunca pidas IDs internos. Esta operación guarda la salida en la moneda de origen y el aporte en la moneda de la reserva de forma atómica.',
      autoConfirmTelegramFinance
        ? 'Si recibes una imagen, clasifícala primero como ticket de compra, recibo de sueldo, resumen de tarjeta de crédito u otro documento. Para un ticket usa create_finance_purchase. Para un recibo de sueldo usa create_finance_salary. Para un resumen extrae emisor, tarjeta, período, cierre, vencimiento, moneda, saldos y todas las líneas; resuelve una cuenta de tipo credit_card y usa create_finance_credit_card_statement. En un resumen registra consumos/cargos, nunca el total a pagar como gasto adicional y nunca inventes la cuenta bancaria del pago. Guarda automáticamente: no finalices con un resumen y responde solo después de recibir ok:true.'
        : 'Si recibes una imagen, clasifícala como ticket de compra, recibo de sueldo, resumen de tarjeta de crédito u otro documento. Orden obligatorio: usa create_finance_purchase para tickets, create_finance_salary para recibos y create_finance_credit_card_statement para resúmenes después de resolver la cuenta de tarjeta. El total del resumen no es otro gasto y el pago posterior es una transferencia separada. No afirmes que se guardó sin ejecutar la herramienta correspondiente.',
      autoConfirmTelegramFinance
        ? 'La única aclaración permitida antes de guardar es una cuenta que no pueda inferirse de modo razonable: cuenta de pago para tickets, de cobro para sueldos o cuenta credit_card para resúmenes. Una vez resuelta, continúa automáticamente.'
        : 'Una aclaración no confirma una mutación. Las operaciones ambiguas quedan pendientes y cada confirmación es individual.',
      autoConfirmTelegramFinance
        ? 'Nunca anuncies una carga como realizada sin ejecutar la herramienta correspondiente y recibir ok:true. Al completar un ticket informa cuenta, categoría, fecha e importe; un recibo informa cuenta, período, fecha de cobro y neto; un resumen informa tarjeta, período, vencimiento, total y cantidad de movimientos creados o conciliados.'
        : 'Nunca anuncies un resumen para pedir una confirmacion en texto ni afirmes que un movimiento fue registrado sin ejecutar create_finance_transaction. Cuando todos los datos esten completos, llama esa herramienta: ella solicita la confirmacion real y solo entonces persiste el movimiento.',
      'ARS y USD son libros separados: nunca conviertas ni sumes monedas.',
    )
  } else if (scope === 'library') {
    base.push(
      'Estas conectado a la biblioteca activa desde Telegram. Puedes buscar y leer cualquier documento de esta biblioteca.',
      'Puedes crear, reemplazar o eliminar documentos, pero cada escritura requiere una confirmacion individual y concreta.',
      'Si el usuario pide agregar un comentario a un ticket de Task Manager, usa add_task_comment. Nunca uses replace_library_document para simular un comentario.',
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

export function validateFinanceFinalAnswer(
  answer: string,
  mutationExecuted: boolean,
  clarificationRequested = false,
  ticketPurchaseRequired = false,
  purchaseExecuted = false,
  salaryExecuted = false,
  creditCardStatementExecuted = false,
): string | null {
  const reportsDetectedTicket = /\bticket\s+(?:de\s+compra\s+)?detectado\b/i.test(answer)
  const reportsDetectedSalary = /\b(?:recibo\s+de\s+sueldo|liquidaci[oó]n\s+de\s+haberes)\s+(?:detectad[oa]|identificad[oa])\b/i.test(answer)
  const reportsDetectedCardStatement = /\bresumen\s+de\s+tarjeta(?:\s+de\s+cr[eé]dito)?\s+(?:detectad[oa]|identificad[oa])\b/i.test(answer)
  if (ticketPurchaseRequired && reportsDetectedTicket && !purchaseExecuted) {
    return 'Detectaste un ticket recibido por Telegram, pero aún no fue persistido. No finalices con un resumen: usa create_finance_purchase con la cuenta, categoría, comercio, fecha, total, líneas y sourceReference disponibles. Espera ok:true antes de responder que el ticket quedó registrado.'
  }
  if (ticketPurchaseRequired && reportsDetectedSalary && !salaryExecuted) {
    return 'Detectaste un recibo de sueldo recibido por Telegram, pero aún no fue persistido. Usa create_finance_salary con cuenta, período, fecha de cobro, empleador, bruto, descuentos, neto, moneda, conceptos y sourceReference. Espera ok:true antes de responder que quedó registrado.'
  }
  if (ticketPurchaseRequired && reportsDetectedCardStatement && !creditCardStatementExecuted) {
    return 'Detectaste un resumen de tarjeta recibido por Telegram, pero aún no fue persistido. Usa create_finance_credit_card_statement con la cuenta credit_card, período, fechas, moneda, saldos, totales, líneas y sourceReference. Espera ok:true antes de responder que quedó registrado.'
  }
  if (mutationExecuted) return null
  const claimsPersistedOperation = /\b(?:he\s+)?(?:registr(?:é|e|ado)|guard(?:é|e|ado)|carg(?:ué|ue|ado)|anot(?:é|e|ado))\b|\blisto\b[^\n]*(?:gasto|ingreso|movimiento)/i.test(answer)
  const promisesFutureMutation = /\b(?:ahora\s+)?(?:voy|vamos|procederé|procedere)\s+a\s+(?:registrar|guardar|cargar|anotar|crear)\b/i.test(answer)
  const asksForMissingFinanceField = /(?:\b(?:que|qué|cual|cuál)\s+(?:cuenta|categor[ií]a|fecha|moneda)\b|[¿?][\s\S]{0,160}\b(?:cuenta|categor[ií]a|fecha|moneda)\b|\b(?:cuenta|categor[ií]a|fecha|moneda)\b[\s\S]{0,160}[?])/i.test(answer)
  return claimsPersistedOperation || promisesFutureMutation
    ? 'No afirmes ni prometas que el movimiento fue registrado o que lo registrarás: ninguna mutación financiera se ejecutó. Si falta la cuenta o categoría, usa request_user_clarification. Si todos los datos están completos, llama create_finance_transaction y espera su resultado antes de responder.'
    : asksForMissingFinanceField && !clarificationRequested
      ? 'No hagas la pregunta financiera como texto final. Llama request_user_clarification con la cuenta, categoría, fecha o moneda que falta y espera su respuesta dentro de esta misma operación; así se conserva la referencia del ticket y no se inicia otra conversación.'
    : null
}

interface FinanceToolResult {
  ok?: unknown
  changed?: unknown
  duplicate?: unknown
  error?: unknown
  code?: unknown
  message?: unknown
  purchase?: unknown
  salary?: unknown
  statement?: unknown
  matchedExistingTransactions?: unknown
  createdTransactions?: unknown
  accountName?: unknown
  categoryName?: unknown
}

function financeToolResult(value: unknown): FinanceToolResult | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as FinanceToolResult : null
}

function formatFinanceAmount(value: unknown): string {
  const normalized = normalizeFinanceDecimal(value)
  if (!normalized) return typeof value === 'string' ? value : ''
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(normalized))
}

export function resolveFinanceToolResultAnswer(call: AiNativeToolCall, result: unknown): string | null {
  if (call.function.name === 'create_finance_credit_card_statement') {
    const resolved = financeToolResult(result)
    if (!resolved) return 'No pude registrar el resumen de tarjeta porque la herramienta financiera devolvió una respuesta inválida.'
    const args = call.function.arguments
    if (resolved.ok === true && resolved.duplicate === true) return 'Este resumen de tarjeta ya estaba registrado. No lo cargué nuevamente.'
    if (resolved.ok === true && resolved.changed === true) {
      const issuer = typeof args.issuer === 'string' ? args.issuer.trim() : 'el emisor detectado'
      const total = formatFinanceAmount(args.totalDue)
      const currency = args.currency === 'ARS' || args.currency === 'USD' ? args.currency : ''
      const account = typeof resolved.accountName === 'string' ? resolved.accountName.trim() : typeof args.accountId === 'string' ? args.accountId.trim() : ''
      const period = typeof args.period === 'string' ? args.period.trim() : ''
      const dueDate = typeof args.dueDate === 'string' ? args.dueDate.slice(0, 10) : ''
      return [
        `Listo. Registré el resumen de tarjeta de ${issuer}.`,
        account ? `Tarjeta: ${account}` : '', period ? `Período: ${period}` : '',
        dueDate ? `Vencimiento: ${dueDate}` : '', total ? `Total a pagar: $ ${total}${currency ? ` ${currency}` : ''}` : '',
        `Movimientos creados: ${typeof resolved.createdTransactions === 'number' ? resolved.createdTransactions : 0}`,
        `Consumos ya existentes conciliados: ${typeof resolved.matchedExistingTransactions === 'number' ? resolved.matchedExistingTransactions : 0}`,
      ].filter(Boolean).join('\n')
    }
    if (resolved.error === 'finance-credit-card-statement-save-failed') {
      const message = typeof resolved.message === 'string' ? resolved.message.trim() : ''
      return resolved.code === 'validation' && message
        ? `No pude registrar el resumen porque sus importes o campos no son coherentes: ${message}`
        : 'No pude guardar el resumen de tarjeta por un error de almacenamiento. El detalle técnico quedó registrado en la terminal.'
    }
    return null
  }
  if (call.function.name === 'create_finance_salary') {
    const resolved = financeToolResult(result)
    if (!resolved) return 'No pude registrar el recibo de sueldo porque la herramienta financiera devolvió una respuesta inválida.'
    const args = call.function.arguments
    if (resolved.ok === true && resolved.duplicate === true) {
      return 'Este recibo de sueldo ya estaba registrado. No lo cargué nuevamente.'
    }
    if (resolved.ok === true && resolved.changed === true) {
      const employer = typeof args.employer === 'string' ? args.employer.trim() : 'el empleador detectado'
      const net = formatFinanceAmount(args.netAmount)
      const currency = args.currency === 'ARS' || args.currency === 'USD' ? args.currency : ''
      const account = typeof resolved.accountName === 'string'
        ? resolved.accountName.trim()
        : typeof args.accountId === 'string' ? args.accountId.trim() : ''
      const period = typeof args.period === 'string' ? args.period.trim() : ''
      const date = typeof args.paymentDate === 'string' ? args.paymentDate.slice(0, 10) : ''
      const conceptCount = Array.isArray(args.concepts) ? args.concepts.length : 0
      return [
        `Listo. Registré el recibo de sueldo de ${employer}.`,
        period ? `Período: ${period}` : '',
        net ? `Neto: $ ${net}${currency ? ` ${currency}` : ''}` : '',
        account ? `Cuenta: ${account}` : '',
        date ? `Fecha de cobro: ${date}` : '',
        `Conceptos: ${conceptCount}`,
      ].filter(Boolean).join('\n')
    }
    if (resolved.error === 'finance-salary-save-failed') {
      const message = typeof resolved.message === 'string' ? resolved.message.trim() : ''
      return resolved.code === 'validation' && message
        ? `No pude registrar el recibo de sueldo porque sus importes o campos no son coherentes: ${message}`
        : 'No pude guardar el recibo de sueldo por un error de almacenamiento. El detalle técnico quedó registrado en la terminal.'
    }
    return null
  }
  if (call.function.name !== 'create_finance_purchase') return null
  const resolved = financeToolResult(result)
  if (!resolved) return 'No pude registrar el ticket porque la herramienta financiera devolvió una respuesta inválida.'
  const args = call.function.arguments
  if (resolved.ok === true && resolved.duplicate === true) {
    return 'Este ticket ya estaba registrado. No lo cargué nuevamente.'
  }
  if (resolved.ok === true && resolved.changed === true) {
    const merchant = typeof args.merchantName === 'string' ? args.merchantName.trim() : 'el comercio detectado'
    const amount = formatFinanceAmount(args.totalAmount)
    const currency = args.currency === 'ARS' || args.currency === 'USD' ? args.currency : ''
    const account = typeof resolved.accountName === 'string'
      ? resolved.accountName.trim()
      : typeof args.accountId === 'string' ? args.accountId.trim() : ''
    const category = typeof resolved.categoryName === 'string'
      ? resolved.categoryName.trim()
      : typeof args.categoryId === 'string' ? args.categoryId.trim() : ''
    const date = typeof args.observedAt === 'string' ? args.observedAt.slice(0, 10) : ''
    const itemCount = Array.isArray(args.items) ? args.items.length : 0
    return [
      `Listo. Registré el ticket de ${merchant}.`,
      amount ? `Importe: $ ${amount}${currency ? ` ${currency}` : ''}` : '',
      account ? `Cuenta: ${account}` : '',
      category ? `Categoría: ${category}` : '',
      date ? `Fecha: ${date}` : '',
      itemCount > 0 ? `Productos: ${itemCount}` : '',
    ].filter(Boolean).join('\n')
  }
  if (resolved.error === 'finance-purchase-save-failed') {
    const message = typeof resolved.message === 'string' ? resolved.message.trim() : ''
    const validationFailure = resolved.code === 'validation'
    return validationFailure && message
      ? `No pude registrar el ticket porque los importes no son coherentes: ${message}`
      : 'No pude guardar el ticket por un error de almacenamiento. El detalle técnico quedó registrado en la terminal.'
  }
  return null
}

export async function createChatScopedAgent(options: ChatAgentRuntimeOptions): Promise<{
  systemPrompt: string
  tools: AiNativeToolDefinition[]
  executeTool: (call: AiNativeToolCall, signal: AbortSignal) => Promise<unknown>
  resolveToolResultAnswer: (call: AiNativeToolCall, result: unknown) => string | null
  validateFinalAnswer: (answer: string) => string | null
}> {
  const defaultPrompt = options.publishedScope
    ? DEFAULT_AGENT_PROMPT
    : await loadAgentPrompt(options.library, options.promptFileName ?? 'default.md')
  const rules = options.publishedScope
    ? resolveAgentRulesContent(DEFAULT_AGENT_RULES, options.responseFormat)
    : await loadAgentRules(options.library, options.responseFormat)
  const agentMemories = options.publishedScope ? [] : await loadAgentMemories(options.library)
  const normalizedLibraryPath = options.library.path.replace(/\\/g, '/').replace(/\/+$/, '')
  const allOptions: ChatLibraryFileOption[] = options.publishedScope
    ? options.scopePaths.map((pathValue) => {
      const normalizedPath = pathValue.replace(/\\/g, '/')
      return {
        path: pathValue,
        name: normalizedPath.split('/').pop() ?? normalizedPath,
        relativePath: normalizedPath.startsWith(`${normalizedLibraryPath}/`)
          ? normalizedPath.slice(normalizedLibraryPath.length + 1)
          : normalizedPath,
      }
    })
    : await loadLibraryFileOptions(options.library)
  const normalizedScopePaths = new Set(options.scopePaths.map((path) => path.replace(/\\/g, '/')))
  const readableOptions = allOptions.filter((item) => /\.(md|markdown|txt)$/i.test(item.name))
  const candidates = options.scope === 'finance'
    ? []
    : options.scope === 'document' || (options.scope === 'library' && normalizedScopePaths.size === 0)
    ? readableOptions
    : readableOptions.filter((item) => normalizedScopePaths.has(item.path.replace(/\\/g, '/')))
  const documents: AgentDocument[] = candidates.map((option, index) => ({ id: `doc-${index + 1}`, option }))
  const taskDocuments = documents.filter((document) => {
    const path = document.option.relativePath.replace(/\\/g, '/').toLowerCase()
    return path.startsWith('task-mannager/') || path.startsWith('task-manager/')
  })
  const byId = new Map(documents.map((document) => [document.id, document]))
  const authorized = new Set<string>()
  let requiredTicketSections: RequiredTicketSection[] = []
  let pendingAmbiguousTickets: Array<{ ticketId: string; title: string; path: string }> = []
  let executionPlan: TaskExecutionStep[] = []
  let executionPlanApproved = false
  let financeMutationExecuted = false
  let financePurchaseExecuted = false
  let financeSalaryExecuted = false
  let financeCreditCardStatementExecuted = false
  let financeClarificationRequested = false
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
    if (options.publishedScope && !PUBLISHED_TASK_MANAGER_TOOL_NAMES.has(name)) {
      return { ok: false, error: 'published-task-manager-scope-required' }
    }
    if (name === 'add_agent_rule') {
      const rule = typeof args.rule === 'string' ? args.rule.trim() : ''
      if (isInternalAgentCorrection(rule)) {
        return { ok: false, error: 'internal-validator-instruction' }
      }
      if (!rule || rule.length > 2_000 || isLikelyPersonalMemory(rule)) {
        return { ok: false, error: 'personal-facts-belong-in-agent-memory', useTool: 'add_agent_memory' }
      }
      const result = await appendAgentRule(options.library, rule)
      const { scheduleAgentKnowledgeOrganization } = await import('./chatLongTermMemorySync')
      scheduleAgentKnowledgeOrganization(options.library, options.aiPreferences)
      return { ok: true, changed: result.added, duplicate: !result.added }
    }
    if (name === 'add_agent_memory') {
      const memory = typeof args.memory === 'string' ? args.memory.trim() : ''
      if (!memory || memory.length > 2_000) return { ok: false, error: 'invalid-agent-memory' }
      const current = await loadAgentMemories(options.library)
      await writeAgentMemories(options.library, [...current, memory])
      const { scheduleAgentKnowledgeOrganization } = await import('./chatLongTermMemorySync')
      scheduleAgentKnowledgeOrganization(options.library, options.aiPreferences)
      return { ok: true, changed: !current.some((item) => item.toLowerCase() === memory.toLowerCase()) }
    }
    if (name === 'get_finance_dashboard') {
      if (options.scope !== 'finance') return { ok: false, error: 'finance-scope-required' }
      const month = typeof args.month === 'string' && /^\d{4}-\d{2}$/.test(args.month) ? args.month : new Date().toISOString().slice(0, 7)
      const { getFinanceDashboard } = await import('../../modules/finance/services/financeService')
      return getFinanceDashboard(options.library, month)
    }
    if (name === 'list_finance_accounts' || name === 'list_finance_categories' || name === 'list_finance_movements') {
      if (options.scope !== 'finance') return { ok: false, error: 'finance-scope-required' }
      const month = typeof args.month === 'string' && /^\d{4}-\d{2}$/.test(args.month) ? args.month : new Date().toISOString().slice(0, 7)
      const { getFinanceDashboard } = await import('../../modules/finance/services/financeService')
      const dashboard = await getFinanceDashboard(options.library, month)
      if (name === 'list_finance_accounts') return { accounts: dashboard.accounts.filter((account) => account.active) }
      if (name === 'list_finance_categories') return { categories: dashboard.categories.filter((category) => category.active) }
      return { month, movements: dashboard.transactions }
    }
    if (name === 'search_finance_categories') {
      if (options.scope !== 'finance') return { ok: false, error: 'finance-scope-required' }
      const query = typeof args.query === 'string' ? args.query.trim().toLocaleLowerCase('es') : ''
      const kind = args.kind === 'income' || args.kind === 'expense' ? args.kind : null
      if (!query) return { ok: false, error: 'category-query-required' }
      const { getFinanceDashboard } = await import('../../modules/finance/services/financeService')
      const dashboard = await getFinanceDashboard(options.library, new Date().toISOString().slice(0, 7))
      const matches = dashboard.categories.filter((category) => category.active && (!kind || category.kind === kind) && category.name.toLocaleLowerCase('es').includes(query))
      return { matches, exact: matches.length === 1 && matches[0]?.name.toLocaleLowerCase('es') === query, categoryCreationAllowed: matches.length === 0 }
    }
    if (name === 'create_finance_category') {
      if (options.scope !== 'finance') return { ok: false, error: 'finance-scope-required' }
      const name = typeof args.name === 'string' ? args.name.trim().replace(/\s+/g, ' ') : ''
      const kind = args.kind === 'income' || args.kind === 'expense' ? args.kind : null
      const description = typeof args.description === 'string' ? args.description.trim() : ''
      if (!name || name.length > 80 || !kind || description.length > 500) {
        return { ok: false, error: 'invalid-finance-category', requiresClarification: true }
      }
      const { getFinanceDashboard, saveFinanceCategory } = await import('../../modules/finance/services/financeService')
      const dashboard = await getFinanceDashboard(options.library, new Date().toISOString().slice(0, 7))
      const existing = dashboard.categories.find((category) => category.active && category.kind === kind && category.name.localeCompare(name, 'es', { sensitivity: 'accent' }) === 0)
      if (existing) return { ok: true, changed: false, category: existing, duplicate: true }
      const accepted = options.responseFormat === 'telegram-html'
        ? true
        : await options.requestConfirmation(`Crear la categoria ${name} para ${kind === 'expense' ? 'gastos' : 'ingresos'}.`, signal)
      if (!accepted) return { ok: true, changed: false, declined: true }
      const category: import('../../modules/finance/types/financeTypes').FinanceCategory = {
        id: crypto.randomUUID(), name, kind, active: true, parentId: null, description: description || null,
      }
      return { ok: true, changed: true, category: await saveFinanceCategory(options.library, category) }
    }
    if (name === 'create_finance_purchase') {
      if (options.scope !== 'finance') return { ok: false, error: 'finance-scope-required' }
      const accountValue = typeof args.accountId === 'string' ? args.accountId.trim() : ''
      const categoryValue = typeof args.categoryId === 'string' ? args.categoryId.trim() : ''
      const merchantName = typeof args.merchantName === 'string' ? args.merchantName.trim() : ''
      const currency = args.currency === 'ARS' || args.currency === 'USD' ? args.currency : null
      const observedAt = typeof args.observedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(args.observedAt)
        ? args.observedAt.trim()
        : `${new Date().toISOString().slice(0, 10)}T12:00:00Z`
      const discountAmount = normalizeFinanceDecimal(args.discountAmount) ?? '0'
      const taxAmount = normalizeFinanceDecimal(args.taxAmount) ?? '0'
      const totalAmount = normalizeFinanceDecimal(args.totalAmount)
      const rawItems = Array.isArray(args.items) ? args.items.slice(0, 100) : []
      const items = rawItems.flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return []
        const item = value as Record<string, unknown>
        const originalDescription = typeof item.originalDescription === 'string' ? item.originalDescription.trim() : ''
        const quantity = normalizeFinanceDecimal(item.quantity, 6)
        const unitPrice = normalizeFinanceDecimal(item.unitPrice)
        const itemDiscountAmount = normalizeFinanceDecimal(item.discountAmount) ?? '0'
        const lineTotal = normalizeFinanceDecimal(item.lineTotal)
        if (!originalDescription || !quantity || !unitPrice || !lineTotal) return []
        return [{ id: crypto.randomUUID(), originalDescription, normalizedDescription: typeof item.normalizedDescription === 'string' ? item.normalizedDescription.trim() || null : null, quantity, unitPrice, discountAmount: itemDiscountAmount, lineTotal, categoryId: null }]
      })
      const subtotalAmount = sumFinanceAmounts(items.map((item) => item.lineTotal))
      if (!accountValue || !merchantName || !currency || !subtotalAmount || !totalAmount || rawItems.length === 0 || items.length !== rawItems.length) {
        const invalidFields = [
          !accountValue ? 'accountId' : null,
          !merchantName ? 'merchantName' : null,
          !currency ? 'currency' : null,
          !subtotalAmount ? 'subtotalAmount' : null,
          !totalAmount ? 'totalAmount' : null,
          rawItems.length === 0 ? 'items' : null,
          items.length !== rawItems.length ? 'itemAmounts' : null,
        ].filter((field): field is string => Boolean(field))
        return { ok: false, error: 'invalid-finance-purchase', invalidFields, instruction: `Corrige solamente estos campos y reintenta: ${invalidFields.join(', ')}.` }
      }
      const { getFinanceDashboard, saveFinancePurchase } = await import('../../modules/finance/services/financeService')
      const dashboard = await getFinanceDashboard(options.library, observedAt.slice(0, 7))
      const normalizedAccount = accountValue.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es')
      const account = dashboard.accounts.find((candidate) => candidate.active && (candidate.id === accountValue || candidate.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es') === normalizedAccount))
      if (!account || account.currency !== currency) return { ok: false, error: 'finance-purchase-account-invalid', invalidFields: ['accountId'], instruction: 'Usa el ID exacto de una cuenta listada con la misma moneda del ticket.' }
      const normalizedCategory = categoryValue.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es')
      const category = dashboard.categories.find((candidate) => candidate.active && candidate.kind === 'expense' && (candidate.id === categoryValue || candidate.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es') === normalizedCategory))
      if (!category && options.responseFormat === 'telegram-html') return { ok: false, error: 'finance-purchase-category-invalid', invalidFields: ['categoryId'], instruction: 'Usa el ID exacto devuelto por search_finance_categories o create_finance_category.' }
      const reference = typeof args.sourceReference === 'string' && args.sourceReference.trim() ? args.sourceReference.trim() : options.financeSourceReference ?? null
      if (!reference) return { ok: false, error: 'finance-purchase-source-required' }
      const autoConfirm = options.responseFormat === 'telegram-html'
      const purchase: import('../../modules/finance/types/financeTypes').FinancePurchaseRecord = { id: crypto.randomUUID(), accountId: account.id, categoryId: category?.id ?? null, merchantName, observedAt, currency: currency as import('../../modules/finance/types/financeTypes').FinanceCurrency, subtotalAmount, discountAmount, taxAmount, totalAmount, status: autoConfirm ? 'confirmed' : 'pending', sourceReference: reference, rawExtraction: typeof args.rawExtraction === 'string' ? args.rawExtraction.slice(0, 20_000) : null, items: items.map((item) => ({ ...item, categoryId: category?.id ?? null })) }
      const accepted = autoConfirm || await options.requestConfirmation(`Guardar ticket de ${merchantName}: ${items.length} producto(s), total ${totalAmount} ${currency}, en ${account.name}.`, signal)
      if (!accepted) return { ok: true, changed: false, declined: true }
      let saved: import('../../modules/finance/types/financeTypes').FinanceSavedPurchase
      try {
        saved = await saveFinancePurchase(options.library, { ...purchase, status: 'confirmed' })
      } catch (error) {
        const message = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : error instanceof Error ? error.message : typeof error === 'string' ? error : 'No se pudo guardar el ticket.'
        const normalizedMessage = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
        const externalCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
          ? error.code
          : null
        const code = /duplic|ya existe|ya fue registrado|registrado anteriormente/.test(normalizedMessage)
          ? 'conflict'
          : /requiere|inval|debe|diferencia|no coincide|suma de lineas|importe/.test(normalizedMessage)
            ? 'validation'
            : externalCode ?? 'storage'
        const storageStep = /finance_purchase\.([a-z_]+)/i.exec(message)?.[1]
        const storageReason = /foreign key constraint failed/i.test(message)
          ? 'foreign-key'
          : /unique constraint failed/i.test(message)
            ? 'unique-constraint'
            : /not null constraint failed/i.test(message) ? 'not-null-constraint' : 'storage'
        const diagnosticReason = code === 'validation'
          ? 'purchase-validation'
          : code === 'conflict'
            ? 'purchase-conflict'
            : `${storageStep ?? 'unknown'}-${storageReason}`
        if (code === 'conflict' && /ticket.*registrado|duplic/i.test(message)) {
          financeMutationExecuted = true
          financePurchaseExecuted = true
          options.onFinancePurchaseSaved?.(reference)
          return { ok: true, changed: false, duplicate: true, message }
        }
        return { ok: false, error: 'finance-purchase-save-failed', code, message, diagnosticReason, instruction: 'Informa el error si no es corregible; no afirmes que el ticket fue guardado.' }
      }
      financeMutationExecuted = true
      financePurchaseExecuted = true
      options.onFinancePurchaseSaved?.(reference)
      return {
        ok: true,
        changed: true,
        purchase: saved.purchase,
        validation: saved.validation,
        accountName: account.name,
        categoryName: category?.name ?? null,
      }
    }
    if (name === 'create_finance_salary') {
      if (options.scope !== 'finance') return { ok: false, error: 'finance-scope-required' }
      const accountValue = typeof args.accountId === 'string' ? args.accountId.trim() : ''
      const period = typeof args.period === 'string' && /^\d{4}-\d{2}$/.test(args.period.trim()) ? args.period.trim() : ''
      const paymentDate = typeof args.paymentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.paymentDate.trim()) ? args.paymentDate.trim() : ''
      const employer = typeof args.employer === 'string' ? args.employer.trim().replace(/\s+/g, ' ') : ''
      const grossAmount = normalizeFinanceDecimal(args.grossAmount)
      const deductionsTotal = normalizeFinanceDecimal(args.deductionsTotal)
      const netAmount = normalizeFinanceDecimal(args.netAmount)
      const currency = args.currency === 'ARS' || args.currency === 'USD' ? args.currency : null
      const rawConcepts = Array.isArray(args.concepts) ? args.concepts.slice(0, 200) : []
      const concepts: Array<{ id: string; name: string; conceptType: 'earning' | 'deduction'; amount: string }> = rawConcepts.flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return []
        const concept = value as Record<string, unknown>
        const name = typeof concept.name === 'string' ? concept.name.trim().replace(/\s+/g, ' ') : ''
        const conceptType = concept.conceptType === 'earning' || concept.conceptType === 'deduction' ? concept.conceptType : null
        const amount = normalizeFinanceDecimal(concept.amount)
        if (!name || !conceptType || !amount) return []
        return [{ id: crypto.randomUUID(), name, conceptType, amount }]
      })
      if (!accountValue || !period || !paymentDate || !employer || employer.length > 200 || !grossAmount || !deductionsTotal || !netAmount || !currency || concepts.length !== rawConcepts.length) {
        const invalidFields = [
          !accountValue ? 'accountId' : null,
          !period ? 'period' : null,
          !paymentDate ? 'paymentDate' : null,
          !employer || employer.length > 200 ? 'employer' : null,
          !grossAmount ? 'grossAmount' : null,
          !deductionsTotal ? 'deductionsTotal' : null,
          !netAmount ? 'netAmount' : null,
          !currency ? 'currency' : null,
          concepts.length !== rawConcepts.length ? 'concepts' : null,
        ].filter((field): field is string => Boolean(field))
        return { ok: false, error: 'invalid-finance-salary', invalidFields, instruction: `Corrige solamente estos campos y reintenta: ${invalidFields.join(', ')}.` }
      }
      const { getFinanceDashboard, saveVerifiedFinanceSalary } = await import('../../modules/finance/services/financeService')
      const dashboard = await getFinanceDashboard(options.library, paymentDate.slice(0, 7))
      const normalizedAccount = accountValue.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es')
      const account = dashboard.accounts.find((candidate) => candidate.active && (candidate.id === accountValue || candidate.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es') === normalizedAccount))
      if (!account || account.currency !== currency) return { ok: false, error: 'finance-salary-account-invalid', invalidFields: ['accountId'], instruction: 'Usa el ID exacto de una cuenta listada con la misma moneda del recibo.' }
      const reference = typeof args.sourceReference === 'string' && args.sourceReference.trim() ? args.sourceReference.trim() : options.financeSourceReference ?? null
      if (!reference) return { ok: false, error: 'finance-salary-source-required' }
      const signedDocument = args.signedDocument === true
      if (signedDocument && !reference.toLocaleLowerCase('es').endsWith('.pdf')) {
        return { ok: false, error: 'finance-salary-signed-pdf-required', invalidFields: ['signedDocument'], instruction: 'Usa signedDocument=true solamente cuando la evidencia original sea un PDF firmado.' }
      }
      const salary: import('../../modules/finance/types/financeTypes').FinanceSalaryReceipt = {
        id: crypto.randomUUID(), period, paymentDate, employer, grossAmount, deductionsTotal, netAmount,
        currency, accountId: account.id, status: 'confirmed', signedDocument, sourceReference: reference,
        rawExtraction: typeof args.rawExtraction === 'string' ? args.rawExtraction.slice(0, 20_000) : null,
        concepts,
      }
      const autoConfirm = options.responseFormat === 'telegram-html'
      const accepted = autoConfirm || await options.requestConfirmation(`Guardar recibo de sueldo de ${employer}, período ${period}, neto ${netAmount} ${currency}, en ${account.name}.`, signal)
      if (!accepted) return { ok: true, changed: false, declined: true }
      try {
        const saved = await saveVerifiedFinanceSalary(options.library, salary)
        financeMutationExecuted = true
        financeSalaryExecuted = true
        options.onFinanceSalarySaved?.(reference, saved)
        return { ok: true, changed: true, salary: saved, accountName: account.name }
      } catch (error) {
        const message = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : error instanceof Error ? error.message : typeof error === 'string' ? error : 'No se pudo guardar el recibo de sueldo.'
        const normalizedMessage = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
        const externalCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null
        const code = /duplic|ya existe|ya fue registrado|registrado anteriormente/.test(normalizedMessage)
          ? 'conflict'
          : /requiere|inval|debe|diferencia|no coincide|importe|neto|bruto|descuento|moneda|cuenta/.test(normalizedMessage)
            ? 'validation'
            : externalCode ?? 'storage'
        if (code === 'conflict') {
          financeMutationExecuted = true
          financeSalaryExecuted = true
          options.onFinanceSalarySaved?.(reference)
          return { ok: true, changed: false, duplicate: true, message }
        }
        return { ok: false, error: 'finance-salary-save-failed', code, message, diagnosticReason: code === 'validation' ? 'salary-validation' : 'salary-storage', instruction: 'Informa el error si no es corregible; no afirmes que el recibo fue guardado.' }
      }
    }
    if (name === 'create_finance_credit_card_statement') {
      if (options.scope !== 'finance') return { ok: false, error: 'finance-scope-required' }
      const accountValue = typeof args.accountId === 'string' ? args.accountId.trim() : ''
      const issuer = typeof args.issuer === 'string' ? args.issuer.trim().replace(/\s+/g, ' ') : ''
      const cardLastFour = typeof args.cardLastFour === 'string' && /^\d{4}$/.test(args.cardLastFour.trim()) ? args.cardLastFour.trim() : null
      const period = typeof args.period === 'string' && /^\d{4}-\d{2}$/.test(args.period.trim()) ? args.period.trim() : ''
      const closingDate = typeof args.closingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.closingDate.trim()) ? args.closingDate.trim() : ''
      const dueDate = typeof args.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.dueDate.trim()) ? args.dueDate.trim() : ''
      const currency = args.currency === 'ARS' || args.currency === 'USD' ? args.currency : null
      const amountFields = {
        previousBalance: normalizeFinanceDecimal(args.previousBalance),
        paymentsAmount: normalizeFinanceDecimal(args.paymentsAmount),
        creditsAmount: normalizeFinanceDecimal(args.creditsAmount),
        purchasesAmount: normalizeFinanceDecimal(args.purchasesAmount),
        feesAmount: normalizeFinanceDecimal(args.feesAmount),
        interestAmount: normalizeFinanceDecimal(args.interestAmount),
        taxesAmount: normalizeFinanceDecimal(args.taxesAmount),
        totalDue: normalizeFinanceDecimal(args.totalDue),
      }
      const minimumPayment = args.minimumPayment === null || args.minimumPayment === undefined || args.minimumPayment === ''
        ? null
        : normalizeFinanceDecimal(args.minimumPayment)
      const rawItems = Array.isArray(args.items) ? args.items.slice(0, 500) : []
      let items: import('../../modules/finance/types/financeTypes').FinanceCreditCardStatementItem[] = rawItems.flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return []
        const item = value as Record<string, unknown>
        const purchaseDate = typeof item.purchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.purchaseDate.trim()) ? item.purchaseDate.trim() : ''
        const description = typeof item.description === 'string' ? item.description.trim().replace(/\s+/g, ' ') : ''
        const amount = normalizeFinanceDecimal(item.amount)
        const itemCurrency = item.currency === 'ARS' || item.currency === 'USD' ? item.currency : currency
        const itemType = ['purchase', 'fee', 'interest', 'tax', 'payment', 'credit'].includes(String(item.itemType))
          ? item.itemType as import('../../modules/finance/types/financeTypes').FinanceCreditCardStatementItemType
          : null
        const installmentNumber = typeof item.installmentNumber === 'number' && Number.isInteger(item.installmentNumber) ? item.installmentNumber : null
        const installmentCount = typeof item.installmentCount === 'number' && Number.isInteger(item.installmentCount) ? item.installmentCount : null
        if (!purchaseDate || !description || !amount || !itemCurrency || !itemType || !currency || itemCurrency !== currency) return []
        return [{ id: crypto.randomUUID(), purchaseDate, description, amount, currency: itemCurrency!, itemType, installmentNumber, installmentCount, transactionId: null }]
      })
      const aggregateFields: Array<[keyof typeof amountFields, import('../../modules/finance/types/financeTypes').FinanceCreditCardStatementItemType, string]> = [
        ['paymentsAmount', 'payment', 'Pagos informados sin desglose'],
        ['creditsAmount', 'credit', 'Créditos informados sin desglose'],
        ['purchasesAmount', 'purchase', 'Consumos informados sin desglose'],
        ['feesAmount', 'fee', 'Cargos informados sin desglose'],
        ['interestAmount', 'interest', 'Intereses informados sin desglose'],
        ['taxesAmount', 'tax', 'Impuestos informados sin desglose'],
      ]
      const parsedItemCount = items.length
      for (const [field, itemType, description] of aggregateFields) {
        const expected = amountFields[field]
        if (!expected || expected === '0' || items.some((item) => item.itemType === itemType)) continue
        items = [...items, {
          id: crypto.randomUUID(), purchaseDate: closingDate, description, amount: expected,
          currency: currency!, itemType, installmentNumber: null, installmentCount: null, transactionId: null,
        }]
      }
      const invalidFields = [
        !accountValue ? 'accountId' : null,
        !issuer || issuer.length > 200 ? 'issuer' : null,
        !period ? 'period' : null,
        !closingDate ? 'closingDate' : null,
        !dueDate ? 'dueDate' : null,
        !currency ? 'currency' : null,
        ...Object.entries(amountFields).filter(([, value]) => !value).map(([field]) => field),
        args.minimumPayment !== null && args.minimumPayment !== undefined && args.minimumPayment !== '' && !minimumPayment ? 'minimumPayment' : null,
        rawItems.length === 0 || parsedItemCount === 0 ? 'items' : null,
      ].filter((field): field is string => Boolean(field))
      if (invalidFields.length > 0) {
        return { ok: false, error: 'invalid-finance-credit-card-statement', invalidFields, instruction: `Corrige solamente estos campos y reintenta: ${invalidFields.join(', ')}.` }
      }
      const { getFinanceDashboard, saveFinanceCreditCardStatement } = await import('../../modules/finance/services/financeService')
      const dashboard = await getFinanceDashboard(options.library, period)
      const normalizeEntityName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es')
      const account = dashboard.accounts.find((candidate) => candidate.active && (candidate.id === accountValue || normalizeEntityName(candidate.name) === normalizeEntityName(accountValue)))
      if (!account || account.accountType !== 'credit_card') {
        return { ok: false, error: 'finance-credit-card-account-invalid', invalidFields: ['accountId'], instruction: 'Usa el ID exacto de una cuenta activa de tipo credit_card; la tarjeta puede tener líneas ARS y USD.' }
      }
      const reference = typeof args.sourceReference === 'string' && args.sourceReference.trim() ? args.sourceReference.trim() : options.financeSourceReference ?? null
      if (!reference) return { ok: false, error: 'finance-credit-card-statement-source-required' }
      const statement: import('../../modules/finance/types/financeTypes').FinanceCreditCardStatement = {
        id: crypto.randomUUID(), accountId: account.id, issuer, cardLastFour, period, closingDate, dueDate, currency: currency!,
        previousBalance: amountFields.previousBalance!, paymentsAmount: amountFields.paymentsAmount!, creditsAmount: amountFields.creditsAmount!,
        purchasesAmount: amountFields.purchasesAmount!, feesAmount: amountFields.feesAmount!, interestAmount: amountFields.interestAmount!,
        taxesAmount: amountFields.taxesAmount!, totalDue: amountFields.totalDue!, minimumPayment, status: 'confirmed', sourceReference: reference,
        rawExtraction: typeof args.rawExtraction === 'string' ? args.rawExtraction.slice(0, 20_000) : null, items,
      }
      const autoConfirm = options.responseFormat === 'telegram-html'
      const accepted = autoConfirm || await options.requestConfirmation(`Guardar resumen de ${issuer}, período ${period}, total ${statement.totalDue} ${currency}, en ${account.name}.`, signal)
      if (!accepted) return { ok: true, changed: false, declined: true }
      try {
        const saved = await saveFinanceCreditCardStatement(options.library, statement)
        financeMutationExecuted = true
        financeCreditCardStatementExecuted = true
        options.onFinanceCreditCardStatementSaved?.(reference)
        return { ok: true, changed: true, statement: saved.statement, matchedExistingTransactions: saved.matchedExistingTransactions, createdTransactions: saved.createdTransactions, accountName: account.name }
      } catch (error) {
        const message = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : error instanceof Error ? error.message : typeof error === 'string' ? error : 'No se pudo guardar el resumen de tarjeta.'
        const normalizedMessage = normalizeEntityName(message)
        const externalCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null
        const code = /duplic|ya existe|registrado anteriormente/.test(normalizedMessage)
          ? 'conflict'
          : /requiere|inval|debe|diferencia|no coincide|suma de lineas|importe|saldo|moneda|cuenta|tarjeta/.test(normalizedMessage)
            ? 'validation'
            : externalCode ?? 'storage'
        if (code === 'conflict') {
          financeMutationExecuted = true
          financeCreditCardStatementExecuted = true
          options.onFinanceCreditCardStatementSaved?.(reference)
          return { ok: true, changed: false, duplicate: true, message }
        }
        return { ok: false, error: 'finance-credit-card-statement-save-failed', code, message, diagnosticReason: code === 'validation' ? 'credit-card-statement-validation' : 'credit-card-statement-storage', instruction: 'Informa el error si no es corregible; no afirmes que el resumen fue guardado.' }
      }
    }
    if (name === 'update_finance_transaction_status') {
      if (options.scope !== 'finance') return { ok: false, error: 'finance-scope-required' }
      const transactionId = typeof args.transactionId === 'string' ? args.transactionId.trim() : ''
      const status = typeof args.status === 'string' && ['confirmed', 'corrected', 'discarded'].includes(args.status) ? args.status : ''
      if (!transactionId || !status) return { ok: false, error: 'invalid-finance-status-update' }
      const { getFinanceDashboard, saveFinanceTransaction } = await import('../../modules/finance/services/financeService')
      const month = typeof args.effectiveDate === 'string' && /^\d{4}-\d{2}/.test(args.effectiveDate) ? args.effectiveDate.slice(0, 7) : new Date().toISOString().slice(0, 7)
      const dashboard = await getFinanceDashboard(options.library, month)
      const current = dashboard.transactions.find((transaction) => transaction.id === transactionId)
      if (!current) return { ok: false, error: 'finance-transaction-not-found' }
      const updated = { ...current, status: status as import('../../modules/finance/types/financeTypes').FinanceTransactionStatus, amount: typeof args.amount === 'string' ? args.amount : current.amount, effectiveDate: typeof args.effectiveDate === 'string' ? args.effectiveDate : current.effectiveDate, accountId: typeof args.accountId === 'string' ? args.accountId : current.accountId, categoryId: typeof args.categoryId === 'string' ? args.categoryId : current.categoryId, description: typeof args.description === 'string' ? args.description : current.description }
      const accepted = await options.requestConfirmation(`${status === 'discarded' ? 'Descartar' : 'Guardar'} el movimiento ${transactionId}.`, signal)
      if (!accepted) return { ok: true, changed: false, declined: true }
      return { ok: true, changed: true, transaction: await saveFinanceTransaction(options.library, updated) }
    }
    if (name === 'list_finance_salaries' || name === 'list_finance_purchases' || name === 'list_finance_credit_card_statements') {
      if (options.scope !== 'finance') return { ok: false, error: 'finance-scope-required' }
      const filters = { from: typeof args.from === 'string' ? args.from : undefined, to: typeof args.to === 'string' ? args.to : undefined }
      const service = await import('../../modules/finance/services/financeService')
      if (name === 'list_finance_salaries') return { salaries: await service.listFinanceSalaries(options.library, filters) }
      if (name === 'list_finance_credit_card_statements') return { statements: await service.listFinanceCreditCardStatements(options.library, filters) }
      return { purchases: await service.listFinancePurchases(options.library, filters) }
    }
    if (name === 'create_finance_transaction') {
      if (options.scope !== 'finance') return { ok: false, error: 'finance-scope-required' }
      const amount = typeof args.amount === 'string' ? args.amount.trim() : ''
      const transactionType = typeof args.transactionType === 'string' ? args.transactionType : ''
      const requestedCurrency = args.currency === 'ARS' || args.currency === 'USD' ? args.currency : null
      const effectiveDate = typeof args.effectiveDate === 'string' && args.effectiveDate.trim()
        ? args.effectiveDate.trim()
        : new Date().toISOString().slice(0, 10)
      const requestedAccountId = typeof args.accountId === 'string' ? args.accountId.trim() : ''
      const requestedDestinationAccountId = typeof args.destinationAccountId === 'string' ? args.destinationAccountId.trim() : ''
      const requestedCategoryId = typeof args.categoryId === 'string' ? args.categoryId.trim() : ''
      const description = typeof args.description === 'string' ? args.description.trim() : ''
      if (!/^-?\d+(\.\d+)?$/.test(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !requestedAccountId || !description || !['income', 'expense', 'transfer', 'adjustment'].includes(transactionType)) {
        return { ok: false, error: 'invalid-finance-transaction', requiresClarification: true }
      }
      const { getFinanceDashboard, saveFinanceTransaction } = await import('../../modules/finance/services/financeService')
      const dashboard = await getFinanceDashboard(options.library, effectiveDate.slice(0, 7))
      const normalizeEntityName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es')
      const account = dashboard.accounts.find((candidate) => candidate.active && (candidate.id === requestedAccountId || normalizeEntityName(candidate.name) === normalizeEntityName(requestedAccountId)))
      if (!account) return { ok: false, error: 'finance-account-not-found', requiresClarification: true }
      const currency = requestedCurrency ?? account.currency
      if (currency !== account.currency) return { ok: false, error: 'finance-account-currency-mismatch', requiresClarification: true }
      const destinationAccount = requestedDestinationAccountId
        ? dashboard.accounts.find((candidate) => candidate.active && (candidate.id === requestedDestinationAccountId || normalizeEntityName(candidate.name) === normalizeEntityName(requestedDestinationAccountId)))
        : null
      if ((transactionType === 'transfer' && !destinationAccount) || (destinationAccount && destinationAccount.currency !== currency)) {
        return { ok: false, error: 'invalid-finance-transfer-account', requiresClarification: true }
      }
      const category = requestedCategoryId
        ? dashboard.categories.find((candidate) => candidate.active && (candidate.id === requestedCategoryId || normalizeEntityName(candidate.name) === normalizeEntityName(requestedCategoryId)))
        : null
      if (requestedCategoryId && !category) return { ok: false, error: 'finance-category-not-found', requiresClarification: true }
      if (transactionType === 'expense' && !category && options.responseFormat === 'telegram-html') return { ok: false, error: 'finance-expense-category-required', requiresClarification: true }
      if (category && (transactionType === 'income' || transactionType === 'expense') && category.kind !== transactionType) {
        return { ok: false, error: 'finance-category-kind-mismatch', requiresClarification: true }
      }
      const confidence = typeof args.confidence === 'number' ? args.confidence : 0
      const status = options.responseFormat === 'telegram-html' || confidence >= 0.95 ? 'confirmed' : 'pending'
      const transaction: import('../../modules/finance/types/financeTypes').FinanceTransaction = { id: crypto.randomUUID(), transactionType: transactionType as import('../../modules/finance/types/financeTypes').FinanceTransactionType, amount, currency, effectiveDate, accountId: account.id, destinationAccountId: destinationAccount?.id ?? null, categoryId: category?.id ?? null, description, source: options.responseFormat === 'telegram-html' ? 'telegram' : 'chat', status: status as import('../../modules/finance/types/financeTypes').FinanceTransactionStatus, actorUserId: options.actorUserId, sourceReference: typeof args.sourceReference === 'string' ? args.sourceReference : null, rawSource: typeof args.rawSource === 'string' ? args.rawSource : null }
      const saved = await saveFinanceTransaction(options.library, transaction)
      financeMutationExecuted = true
      if (status === 'confirmed') return { ok: true, changed: true, autoConfirmed: true, transaction: saved }
      const accepted = await options.requestConfirmation(`Confirmar ${transactionType === 'expense' ? 'gasto' : 'movimiento'} de ${amount} ${currency}: ${description || 'sin descripción'}.`, signal)
      if (!accepted) return { ok: true, changed: false, declined: true, transaction: saved }
      const confirmed = await saveFinanceTransaction(options.library, { ...transaction, status: 'confirmed' })
      financeMutationExecuted = true
      return { ok: true, changed: true, transaction: confirmed }
    }
    if (name === 'create_finance_savings_exchange') {
      if (options.scope !== 'finance') return { ok: false, error: 'finance-scope-required' }
      const reserveReference = typeof args.reserve === 'string' ? args.reserve.trim() : ''
      const sourceAccountReference = typeof args.sourceAccount === 'string' ? args.sourceAccount.trim() : ''
      const sourceAmount = normalizeFinanceDecimal(args.sourceAmount)
      const savingsAmount = normalizeFinanceDecimal(args.savingsAmount)
      const sourceCurrency = args.sourceCurrency === 'ARS' || args.sourceCurrency === 'USD' ? args.sourceCurrency : null
      const savingsCurrency = args.savingsCurrency === 'ARS' || args.savingsCurrency === 'USD' ? args.savingsCurrency : null
      const effectiveDate = typeof args.effectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.effectiveDate.trim()) ? args.effectiveDate.trim() : new Date().toISOString().slice(0, 10)
      const description = typeof args.description === 'string' && args.description.trim() ? args.description.trim() : 'Compra de moneda para ahorro'
      if (!reserveReference || !sourceAccountReference || !sourceAmount || !savingsAmount || !sourceCurrency || !savingsCurrency || sourceCurrency === savingsCurrency) return { ok: false, error: 'invalid-finance-savings-exchange', requiresClarification: true }
      const { getFinanceDashboard, saveFinanceSavingsExchange } = await import('../../modules/finance/services/financeService')
      const dashboard = await getFinanceDashboard(options.library, effectiveDate.slice(0, 7))
      const normalizeEntityName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es')
      const reserveMatches = dashboard.savings.filter((candidate) => candidate.active && (candidate.id === reserveReference || normalizeEntityName(candidate.name) === normalizeEntityName(reserveReference)))
      const accountMatches = dashboard.accounts.filter((candidate) => candidate.active && (candidate.id === sourceAccountReference || normalizeEntityName(candidate.name) === normalizeEntityName(sourceAccountReference)))
      if (reserveMatches.length !== 1) return { ok: false, error: reserveMatches.length === 0 ? 'finance-savings-reserve-not-found' : 'finance-savings-reserve-ambiguous', requiresClarification: true }
      if (accountMatches.length !== 1) return { ok: false, error: accountMatches.length === 0 ? 'finance-account-not-found' : 'finance-account-ambiguous', requiresClarification: true }
      const reserve = reserveMatches[0]
      const sourceAccount = accountMatches[0]
      if (reserve.currency !== savingsCurrency || sourceAccount.currency !== sourceCurrency) return { ok: false, error: 'finance-savings-exchange-currency-mismatch', requiresClarification: true }
      const confidence = typeof args.confidence === 'number' ? args.confidence : 0
      if (options.responseFormat !== 'telegram-html' && confidence < 0.95) {
        const accepted = await options.requestConfirmation(`Confirmar compra de ${savingsAmount} ${savingsCurrency} para ${reserve.name} con ${sourceAmount} ${sourceCurrency} desde ${sourceAccount.name}.`, signal)
        if (!accepted) return { ok: true, changed: false, declined: true }
      }
      const saved = await saveFinanceSavingsExchange(options.library, {
        id: crypto.randomUUID(), reserveId: reserve.id, sourceAccountId: sourceAccount.id, sourceAmount, sourceCurrency, savingsAmount, savingsCurrency, effectiveDate, description, actorUserId: options.actorUserId, sourceReference: typeof args.sourceReference === 'string' ? args.sourceReference : null, rawSource: typeof args.rawSource === 'string' ? args.rawSource : null,
      })
      financeMutationExecuted = true
      return { ok: true, changed: true, autoConfirmed: options.responseFormat === 'telegram-html' || confidence >= 0.95, reserve: reserve.name, sourceAccount: sourceAccount.name, movement: saved.movement, transaction: saved.transaction }
    }
    if (name === 'create_finance_savings_movement') {
      if (options.scope !== 'finance') return { ok: false, error: 'finance-scope-required' }
      const reserveId = typeof args.reserveId === 'string' ? args.reserveId.trim() : ''
      const accountId = typeof args.accountId === 'string' ? args.accountId.trim() : ''
      const movementType = typeof args.movementType === 'string' ? args.movementType : ''
      const amount = typeof args.amount === 'string' ? args.amount.trim() : ''
      const currency = args.currency === 'ARS' || args.currency === 'USD' ? args.currency : null
      const effectiveDate = typeof args.effectiveDate === 'string' ? args.effectiveDate.trim() : ''
      const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
      if (!reserveId || !accountId || !currency || !/^-?\d+(\.\d+)?$/.test(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !['contribution', 'withdrawal', 'return', 'loss', 'adjustment'].includes(movementType) || (movementType === 'withdrawal' && !reason)) return { ok: false, error: 'invalid-finance-savings-movement', requiresClarification: true }
      const { getFinanceDashboard, saveFinanceSavingsMovement } = await import('../../modules/finance/services/financeService')
      const dashboard = await getFinanceDashboard(options.library, effectiveDate.slice(0, 7))
      const normalizeEntityName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es')
      const reserveMatches = dashboard.savings.filter((candidate) => candidate.active && (candidate.id === reserveId || normalizeEntityName(candidate.name) === normalizeEntityName(reserveId)))
      const accountMatches = dashboard.accounts.filter((candidate) => candidate.active && (candidate.id === accountId || normalizeEntityName(candidate.name) === normalizeEntityName(accountId)))
      if (reserveMatches.length !== 1 || accountMatches.length !== 1) return { ok: false, error: reserveMatches.length !== 1 ? 'finance-savings-reserve-not-found-or-ambiguous' : 'finance-account-not-found-or-ambiguous', requiresClarification: true }
      const reserve = reserveMatches[0]
      const account = accountMatches[0]
      if (reserve.currency !== currency || account.currency !== currency) return { ok: false, error: 'finance-savings-movement-currency-mismatch', requiresClarification: true }
      const movement: import('../../modules/finance/types/financeTypes').FinanceSavingsMovement = { id: crypto.randomUUID(), reserveId: reserve.id, accountId: account.id, movementType: movementType as import('../../modules/finance/types/financeTypes').FinanceSavingsMovementType, amount, currency, effectiveDate, description: typeof args.description === 'string' ? args.description.trim() : movementType, reason: reason || null, source: 'chat', status: 'pending', actorUserId: options.actorUserId }
      const saved = await saveFinanceSavingsMovement(options.library, movement)
      financeMutationExecuted = true
      const confidence = typeof args.confidence === 'number' ? args.confidence : 0
      if (confidence < 0.95) {
        const accepted = await options.requestConfirmation(`Confirmar ${movementType === 'withdrawal' ? 'retiro' : 'movimiento'} de ahorro de ${amount} ${currency}.`, signal)
        if (!accepted) return { ok: true, changed: false, declined: true, movement: saved }
      }
      const confirmed = await saveFinanceSavingsMovement(options.library, { ...movement, status: 'confirmed' })
      financeMutationExecuted = true
      return { ok: true, changed: true, movement: confirmed, autoConfirmed: confidence >= 0.95 }
    }
    if (name === 'set_task_execution_plan') {
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
      if (options.scope === 'finance') financeClarificationRequested = true
      const question = typeof args.question === 'string' ? args.question.trim() : ''
      const choices = stringArray(args.choices, 8)
      if (!question) {
        return { ok: false, error: 'missing-question' }
      }
      if (pendingAmbiguousTickets.length > 1) {
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
    if (name === 'request_file_read_permission') {
      const selected = resolveIds(args.documentIds)
      if (selected.length === 0) {
        return { ok: false, error: 'unknown-documents' }
      }
      const reason = typeof args.reason === 'string' ? args.reason.trim() : 'Responder la consulta'
      if (options.scope !== 'document') {
        selected.forEach((document) => authorized.add(document.id))
        return { ok: true, accepted: true, alreadyAuthorized: true, grantedDocumentIds: selected.map((item) => item.id) }
      }
      const accepted = await options.requestConfirmation(
        `La IA solicita leer ${selected.map((item) => item.option.relativePath).join(', ')}. Motivo: ${reason}`,
        signal,
      )
      if (accepted) {
        selected.forEach((document) => authorized.add(document.id))
      }
      return { ok: true, accepted, grantedDocumentIds: accepted ? selected.map((item) => item.id) : [] }
    }

    if (['create_library_note', 'replace_library_document', 'delete_library_document'].includes(name)) {
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
        if (!authorized.has(document.id)) {
          return { ok: false, error: 'permission-required', documentIds: [document.id] }
        }
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

    if (name === 'get_task_manager_options') {
      const { getTaskManagerAgentOptions } = await import(
        '../../modules/task-manager/services/taskManagerAgentMutationService'
      )
      return getTaskManagerAgentOptions(
        options.library.path,
        resolveTaskManagerBoard(options.taskManagerScopeKey)
          ?? (typeof args.board === 'string' ? args.board.trim() || null : null),
      )
    }

    if (TASK_MUTATION_TOOL_NAMES.has(name)) {
      const ticketId = typeof args.ticketId === 'string' ? args.ticketId.trim() : ''
      const selectedDocument = ticketId
        ? taskDocuments.find((document) => document.id === ticketId)
        : undefined
      const board = resolveTaskManagerBoard(options.taskManagerScopeKey)
        ?? (typeof args.board === 'string' ? args.board.trim() || null : null)
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
        if (!authorized.has(selectedDocument.id)) {
          return { ok: false, error: 'permission-required', documentIds: [selectedDocument.id] }
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
      const searchedDocuments = name === 'search_task_tickets' ? taskDocuments : documents
      const titles = stringArray(args.titles)
      const matches = titles.map((title) => ({
          requestedTitle: title,
          candidates: searchedDocuments
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
              [name === 'search_task_tickets' ? 'ticketId' : 'documentId']: document.id,
              title: document.option.name,
              logicalPath: document.option.relativePath,
              score,
            })),
        }))
      if (name === 'search_task_tickets') {
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
      const isTaskRead = name === 'read_task_tickets'
      const requestedIds = stringArray(isTaskRead ? args.ticketIds : args.documentIds)
      const availableDocuments = isTaskRead ? taskDocuments : documents
      const selected = requestedIds
        .map((id) => availableDocuments.find((document) => document.id === id))
        .filter((document): document is AgentDocument => Boolean(document))
        .slice(0, MAX_DIRECT_FILES)
      if (selected.length === 0 || selected.length !== Math.min(requestedIds.length, MAX_DIRECT_FILES)) {
        return { ok: false, error: 'unknown-documents' }
      }
      const permission = requireAuthorized(selected)
      if (!permission.ok) {
        return { ok: false, error: 'permission-required', documentIds: permission.missing.map((item) => item.id) }
      }
      const loadedDocuments = isTaskRead
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
      if (isTaskRead) {
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

    if (name === 'read_all_task_tickets') {
      const files = await loadInlineFileAttachments(
        options.library,
        taskDocuments.map((document) => document.option.path),
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
        totalTickets: taskDocuments.length,
        returnedTickets: tickets.length,
        truncated,
        tickets,
      }
    }

    const isRag = name === 'search_task_context' || name === 'search_library_context'
    if (isRag) {
      const isTaskRag = name === 'search_task_context'
      const availableDocuments = isTaskRag ? taskDocuments : documents
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) {
        return { ok: false, error: 'missing-query' }
      }
      const rawRequestedIds = isTaskRag ? args.ticketIds : args.documentIds
      const requested = stringArray(rawRequestedIds)
        .map((id) => availableDocuments.find((document) => document.id === id))
        .filter((document): document is AgentDocument => Boolean(document))
      if (Array.isArray(rawRequestedIds) && stringArray(rawRequestedIds).length !== requested.length) {
        return { ok: false, error: 'unknown-documents' }
      }
      const selected = (requested.length > 0 ? requested : availableDocuments).slice(0, MAX_RAG_FILES)
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
      if (isTaskRag) {
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
    systemPrompt: buildChatAgentSystemPrompt(
      options.scope,
      defaultPrompt,
      options.activeDocumentPath,
      options.responseFormat,
      agentMemories.length > 0
        ? `${rules}\n\nMemorias persistentes del usuario:\n${agentMemories.map((memory) => `- ${memory}`).join('\n')}`
        : options.publishedScope
          ? `${rules}\n\nEsta sesion se ejecuta desde una publicacion de Task Manager. El limite de seguridad es estricto: solo podes consultar o modificar tickets y archivos pertenecientes a los tableros publicados. No menciones, busques, solicites permiso ni intentes acceder a ninguna otra parte de la biblioteca Notia. La sesion es efimera y no puede leer ni guardar reglas o memorias globales.`
          : rules,
    ),
    tools: buildChatAgentTools(options.scope, options.responseFormat === 'telegram-html', options.publishedScope),
    executeTool,
    resolveToolResultAnswer: options.scope === 'finance' ? resolveFinanceToolResultAnswer : () => null,
    validateFinalAnswer: (answer) => options.scope === 'task-manager'
      ? buildTicketSectionCorrection(answer, requiredTicketSections)
      : options.scope === 'finance'
        ? validateFinanceFinalAnswer(
          answer,
          financeMutationExecuted,
          financeClarificationRequested,
          options.responseFormat === 'telegram-html' && Boolean(options.financeSourceReference),
          financePurchaseExecuted,
          financeSalaryExecuted,
          financeCreditCardStatementExecuted,
        )
        : null,
  }
}
