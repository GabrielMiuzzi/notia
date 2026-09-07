import type { AgentMultimodalStage, AgentPlanStepStatus, AgentProgressEvent, AgentProgressPhase } from '../../types/ai/agentContracts'

export const TELEGRAM_PROGRESS_MIN_INTERVAL_MS = 2_000

export interface TelegramProgressState {
  requestId: string | null
  lastEventTimestamp: number | null
  phase: AgentProgressPhase
  round: number | null
  toolLabel: string | null
  reasoningSummary: string | null
  multimodalStage: AgentMultimodalStage | null
  queuePosition: number | null
  plan: TelegramProgressPlan | null
  activePlanStepId: string | null
}

interface TelegramProgressPlan {
  steps: Array<{ id: string; status: AgentPlanStepStatus; label: string }>
}

export interface TelegramProgressPreferences {
  progressMode?: 'minimal' | 'standard' | 'detailed' | 'off'
  showPlan?: boolean
  showReasoningSummary?: boolean
}

const TOOL_LABELS: Record<string, string> = {
  read_active_markdown_document: 'leyendo el documento activo',
  replace_active_markdown_document: 'preparando una mejora del documento',
  insert_active_markdown_document: 'preparando una inserción en el documento',
  move_document_block: 'reordenando un bloque del documento',
  verify_operation: 'verificando el cambio aplicado',
  apply_document_patch: 'aplicando la mejora propuesta',
  replace_document_selection: 'preparando una mejora de la selección',
  replace_document_block: 'preparando una mejora de un bloque',
  delete_document_block: 'preparando la eliminación solicitada',
  update_document_frontmatter: 'actualizando los metadatos del documento',
  create_document_from_template: 'preparando una nota nueva',
  search_library_documents: 'buscando en la biblioteca',
  search_library_context: 'consultando el contexto de la biblioteca',
  read_library_documents: 'leyendo documentos autorizados',
  read_all_task_tickets: 'leyendo las tareas',
  get_task_board_summary: 'resumiendo el tablero autorizado',
  duplicate_task: 'duplicando el ticket autorizado',
  archive_task: 'archivando el ticket autorizado',
  restore_task: 'restaurando el ticket autorizado',
  search_task_tickets: 'buscando tareas',
  search_task_context: 'consultando el contexto de tareas',
  get_finance_dashboard: 'consultando el resumen financiero',
  get_finance_dollar_quotes: 'consultando cotizaciones',
  get_finance_inflation_indices: 'consultando índices económicos',
  get_finance_historical_dollar_quotes: 'consultando el historial de cotizaciones',
  request_user_clarification: 'preparando una pregunta para vos',
  set_task_execution_plan: 'organizando el plan de trabajo',
  set_agent_execution_plan: 'organizando el plan de trabajo',
  get_workspace_context: 'revisando el contexto autorizado',
  compare_documents: 'comparando documentos autorizados',
  link_ticket_document: 'vinculando el ticket con el documento',
  extract_document_facts: 'extrayendo datos explícitos del documento',
  update_document_tags: 'actualizando los tags del documento',
  materialize_document_facts: 'preparando una nota con la extraccion',
  update_document_wikilink: 'actualizando un wikilink autorizado',
  get_active_document_outline: 'ubicando la secciÃ³n del documento',
  read_active_document_range: 'leyendo la parte necesaria del documento',
  request_file_read_permission: 'solicitando permiso para leer un archivo',
}

const PHASE_LABELS: Record<AgentProgressPhase, string> = {
  preparing: 'Preparando la solicitud',
  planning: 'Organizando los pasos',
  reading: 'Leyendo la información necesaria',
  searching: 'Buscando información pública',
  responding: 'Redactando la respuesta',
  executing: 'Ejecutando la operación autorizada',
  'waiting-clarification': 'Necesito una aclaración',
  'waiting-confirmation': 'Espero tu confirmación',
  verifying: 'Verificando el resultado',
  completed: 'Listo',
  cancelled: 'Operación cancelada',
  failed: 'No pude completar la operación',
}

export function createTelegramProgressState(queuePosition: number | null = null): TelegramProgressState {
  return { requestId: null, lastEventTimestamp: null, phase: 'preparing', round: null, toolLabel: null, reasoningSummary: 'Estoy entendiendo el pedido.', multimodalStage: null, queuePosition, plan: null, activePlanStepId: null }
}

const MULTIMODAL_STAGE_LABELS: Record<AgentMultimodalStage, string> = {
  transcribing: 'Transcribiendo el audio recibido.',
  extracting: 'Extrayendo el contenido del archivo.',
  'analyzing-image': 'Analizando la imagen adjunta.',
  'building-context': 'Construyendo el contexto autorizado.',
}

function safeReasoningSummary(phase: AgentProgressPhase): string {
  switch (phase) {
    case 'preparing': return 'Estoy preparando el contexto autorizado.'
    case 'planning': return 'Estoy organizando los pasos necesarios.'
    case 'reading': return 'Estoy leyendo solo la informacion necesaria.'
    case 'searching': return 'Estoy consultando fuentes publicas.'
    case 'responding': return 'Estoy redactando una respuesta clara.'
    case 'executing': return 'Estoy ejecutando la operacion autorizada.'
    case 'waiting-clarification': return 'Necesito una aclaracion antes de continuar.'
    case 'waiting-confirmation': return 'Necesito tu confirmacion antes de aplicar cambios.'
    case 'verifying': return 'Estoy verificando el resultado real.'
    case 'completed': return 'La operacion termino correctamente.'
    case 'cancelled': return 'La operacion fue cancelada.'
    case 'failed': return 'La operacion no pudo completarse.'
  }
}

function safePlanStepLabel(toolName: string | null | undefined): string {
  return toolName ? telegramToolLabel(toolName) : 'completando una tarea autorizada'
}

export function setTelegramProgressQueuePosition(state: TelegramProgressState, queuePosition: number | null): TelegramProgressState {
  return { ...state, queuePosition }
}

export function telegramToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? 'ejecutando una operación autorizada'
}

function isWebSearchTool(toolName: string): boolean {
  const normalizedName = toolName.trim().toLowerCase()
  return normalizedName.includes('web_search')
    || normalizedName.includes('web-search')
    || (normalizedName.includes('web') && normalizedName.includes('search'))
}

export function reduceTelegramProgress(state: TelegramProgressState, event: AgentProgressEvent): TelegramProgressState {
  if (state.requestId && event.requestId && state.requestId !== event.requestId) return state
  if (state.lastEventTimestamp !== null && event.timestamp !== undefined && event.timestamp < state.lastEventTimestamp) return state
  state = {
    ...state,
    requestId: state.requestId ?? event.requestId ?? null,
    lastEventTimestamp: event.timestamp ?? state.lastEventTimestamp,
  }
  switch (event.type) {
    case 'request-received':
      return { ...state, phase: 'preparing', toolLabel: null, reasoningSummary: safeReasoningSummary('preparing'), multimodalStage: null, plan: null, activePlanStepId: null }
    case 'phase-changed':
      return { ...state, phase: event.phase, round: event.round, toolLabel: null, reasoningSummary: safeReasoningSummary(event.phase) }
    case 'round-started':
      return { ...state, round: event.round }
    case 'tool-started':
      return {
        ...state,
        phase: isWebSearchTool(event.toolName) ? 'searching' : state.phase,
        toolLabel: telegramToolLabel(event.toolName),
        reasoningSummary: isWebSearchTool(event.toolName) ? safeReasoningSummary('searching') : state.reasoningSummary,
      }
    case 'tool-completed':
      return { ...state, toolLabel: null, phase: event.ok ? state.phase : 'failed' }
    case 'clarification-required':
      return { ...state, phase: 'waiting-clarification', toolLabel: null, reasoningSummary: safeReasoningSummary('waiting-clarification') }
    case 'confirmation-required':
      return { ...state, phase: 'waiting-confirmation', toolLabel: null, reasoningSummary: safeReasoningSummary('waiting-confirmation') }
    case 'web-search-started':
      return { ...state, phase: 'searching', toolLabel: null, reasoningSummary: safeReasoningSummary('searching') }
    case 'multimodal-stage':
      return { ...state, phase: event.stage === 'building-context' ? 'preparing' : 'reading', toolLabel: null, multimodalStage: event.stage, reasoningSummary: MULTIMODAL_STAGE_LABELS[event.stage] }
    case 'verification-started':
      return { ...state, phase: 'verifying', toolLabel: null, reasoningSummary: safeReasoningSummary('verifying') }
    case 'completed':
      return { ...state, phase: 'completed', round: event.rounds, toolLabel: null, reasoningSummary: safeReasoningSummary('completed') }
    case 'cancelled':
      return { ...state, phase: 'cancelled', toolLabel: null, reasoningSummary: safeReasoningSummary('cancelled') }
    case 'failed':
      return { ...state, phase: 'failed', toolLabel: null, reasoningSummary: safeReasoningSummary('failed') }
    case 'plan-created':
      return {
        ...state,
        phase: 'planning',
        toolLabel: null,
        reasoningSummary: 'Prepare un plan y voy a mostrar sus pasos.',
        plan: {
          steps: event.plan.steps.slice(0, 20).map((step) => ({
            id: step.id,
            status: step.status,
            label: safePlanStepLabel(step.plannedToolName),
          })),
        },
        activePlanStepId: null,
      }
    case 'step-started':
      return {
        ...state,
        phase: 'executing',
        toolLabel: null,
        reasoningSummary: 'Estoy siguiendo el siguiente paso del plan.',
        activePlanStepId: event.planStepId,
        plan: state.plan
          ? {
            steps: state.plan.steps.map((step) => step.id === event.planStepId
              ? { ...step, status: 'in-progress' }
              : step),
          }
          : state.plan,
      }
    case 'step-completed':
      return {
        ...state,
        plan: state.plan
          ? {
            steps: state.plan.steps.map((step) => step.id === event.planStepId
              ? { ...step, status: event.status }
              : step),
          }
          : state.plan,
        activePlanStepId: state.activePlanStepId === event.planStepId ? null : state.activePlanStepId,
      }
  }
}

const PLAN_STEP_LABELS: Record<AgentPlanStepStatus, string> = {
  pending: 'pendiente',
  'in-progress': 'en curso',
  blocked: 'bloqueado',
  completed: 'completado',
  failed: 'fallido',
  skipped: 'omitido',
  cancelled: 'cancelado',
}

function planStepIcon(status: AgentPlanStepStatus): string {
  if (status === 'completed') return '✓'
  if (status === 'in-progress') return '…'
  if (status === 'blocked' || status === 'failed' || status === 'cancelled') return '×'
  return '○'
}

export function buildTelegramProgressMessage(
  state: TelegramProgressState,
  preferences: TelegramProgressPreferences = {},
): string {
  const progressMode = preferences.progressMode ?? 'standard'
  if (progressMode === 'off') return ''
  const lines = [`<b>${PHASE_LABELS[state.phase]}</b>`]
  if (progressMode !== 'minimal' && state.toolLabel) lines.push(`• ${state.toolLabel}`)
  if (preferences.showPlan !== false && progressMode !== 'minimal' && state.plan) {
    lines.push(`<b>TO-DO (${state.plan.steps.length} pasos)</b>`)
    state.plan.steps.forEach((step, index) => {
      lines.push(`â€¢ ${planStepIcon(step.status)} Paso ${index + 1}: ${PLAN_STEP_LABELS[step.status]} — ${step.label}`)
    })
  }
  if (state.queuePosition !== null && state.phase === 'preparing') {
    lines.push(`• Posición en cola: ${state.queuePosition}`)
  }
  if (progressMode === 'detailed' && preferences.showReasoningSummary !== false && state.round !== null) {
    lines.push(`• Ronda ${state.round}`)
  }
  if (progressMode === 'detailed' && preferences.showReasoningSummary !== false && state.multimodalStage) {
    lines.push(`- ${MULTIMODAL_STAGE_LABELS[state.multimodalStage]}`)
  }
  if (progressMode === 'detailed' && preferences.showReasoningSummary !== false && state.reasoningSummary) {
    lines.push(`- ${state.reasoningSummary}`)
  }
  return lines.join('\n')
}

export function isCriticalTelegramProgressEvent(event: AgentProgressEvent): boolean {
  return event.type === 'clarification-required'
    || event.type === 'confirmation-required'
    || event.type === 'completed'
    || event.type === 'cancelled'
    || event.type === 'failed'
}

export function shouldPublishTelegramProgress(
  lastPublishedAt: number | null,
  now: number,
  critical: boolean,
  intervalMs = TELEGRAM_PROGRESS_MIN_INTERVAL_MS,
): boolean {
  if (critical || lastPublishedAt === null) return true
  if (!Number.isFinite(now) || !Number.isFinite(lastPublishedAt) || now < lastPublishedAt) return true
  return now - lastPublishedAt >= intervalMs
}
