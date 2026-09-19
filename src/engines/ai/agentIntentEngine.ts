export type AgentIntent =
  | 'answer'
  | 'explain'
  | 'analysis'
  | 'comparison'
  | 'search'
  | 'read'
  | 'mutation'
  | 'propose-edit'
  | 'apply-edit'
  | 'create'
  | 'organize'
  | 'execute'
  | 'clarify'
  | 'cancel'
  | 'continue'
  | 'undo'

export interface AgentIntentResultFlags {
  /** Evidence from a previous turn can be reused, but never grants permission. */
  hasVerifiedEvidence?: boolean
  canReuse?: boolean
  canContinue?: boolean
  isTerminal?: boolean
  operationId?: string
  kind?: AgentIntent
}

export interface AgentIntentContext {
  hasActiveDocument?: boolean
  hasSelection?: boolean
  hasConversationHistory?: boolean
  hasLastAppliedOperation?: boolean
  previousIntent?: AgentIntent
  lastResult?: AgentIntentResultFlags
}

export interface AgentIntentAnalysis {
  intent: AgentIntent
  confidence: 'low' | 'medium' | 'high'
  requiresClarification: boolean
  isCompound: boolean
  referencesConversation: boolean
  flags: {
    hasVerifiedEvidence: boolean
    canReusePreviousResult: boolean
    canContinue: boolean
    authorizesAction: false
  }
  reasons: readonly string[]
}

const LOCAL_FINANCE_PATTERN = /\b(?:finanzas?|financier[oa]s?|gast(?:o|os|e|aste|amos|ar)|ingres(?:o|os)|saldos?|cuentas?|categor[ií]as?|ahorros?|retiros?|aportes?|transferencias?|movimientos?|sueldos?|salarios?|haberes?|recibos?\s+de\s+sueldo|tickets?|facturas?|boletas?|servicios?|tarjetas?|cuotas?|patrimonio|cotizaciones?|d[oó]lar(?:es)?|inflaci[oó]n|ipc|precios?)\b/i
const PUBLIC_FINANCE_NEWS_PATTERN = /\b(?:noticias?|novedades?|actualidad|paritarias?|fuentes?\s+p[uú]blicas?|en\s+(?:internet|la\s+web)|enlaces?|links?|urls?)\b/i
const NEGATED_PUBLIC_SEARCH_PATTERN = /\b(?:no|nunca)\s+(?:quiero|necesito|hagas?|busques?|consultes?|uses?)\b[\s\S]{0,80}\b(?:web|internet|fuentes?|noticias?|b[uú]squeda)\b/i

/**
 * Identifies local-finance conversation before the generic freshness hint can
 * route words such as "últimos" or "actual" to public web search. It is only
 * a routing hint: authorization and tool execution remain in the agent.
 */
export function isLocalFinanceRequest(prompt: string): boolean {
  const normalized = normalize(prompt)
  if (!LOCAL_FINANCE_PATTERN.test(normalized)) return false
  if (NEGATED_PUBLIC_SEARCH_PATTERN.test(normalized)) return true
  return !PUBLIC_FINANCE_NEWS_PATTERN.test(normalized)
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

const cancelPatterns = [/\b(cancel|cancela|cancelar|detene|detener|para|parar|olvida|olvidalo)\b/]
const undoPatterns = [/\b(undo|deshace|deshacer|deshacelo|volve atras|volver atras|reverti|revertir|revertelo)\b/]
const continuationPatterns = [
  /\b(continua|continuar|continuemos|reanuda|reanudar|retoma|retomar|siguiente paso|segui|seguir)\b/,
  /\b(mas corto|mas breve|resumilo|resumelo|hacelo mas claro|simplificalo)\b/,
  /\b(aplicalo tambien|aplicalo abajo|aplicalo al resto|hace lo mismo|haz lo mismo|lo mismo abajo)\b/,
]
const clarificationPatterns = [/\b(que quiso decir|no entiendo|aclara|aclarame|explica que falta|que necesitas)\b/]
const applyPatterns = [/\b(aplica|aplicalo|aplicar|implementa|implementalo|ejecuta|ejecutalo|guarda|guardalo|hazlo|hacelo)\b/]
const editPatterns = [/\b(mejora|mejorame|corrige|corrigeme|reescribe|reemplaza|modifica|edita|ajusta|acorta|traduce|formatea|agrega|anade|añade|inserta|elimina|borra)\b/]
const createPatterns = [/\b(crea|crear|nuevo|genera|generar|escribi|escribe|redacta)\b/]
const organizePatterns = [/\b(organiza|orden(a|ar)|clasifica|etiqueta|mueve|renombra|agrupa)\b/]
const searchPatterns = [/\b(busca|buscar|investiga|investigar|internet|web|fuentes|actualizado|actualizada|hoy|reciente)\b/]
const analysisPatterns = [/\b(analiza|analizar|analisis|análisis|explica|explicar|evalua|evaluar|resume|resumir|sintetiza|interpreta)\b/]
const comparisonPatterns = [/\b(compara|comparar|comparalos|comparalas|diferencia|diferencias|versus|vs\.?|contra|mejor que|peor que)\b/]
const readPatterns = [/\b(lee|leer|revisa|revisar|encuentra|encontra|localiza|lista|cuenta|muestra)\b/]
const executePatterns = [/\b(registra|registrar|carga|cargar|actualiza|actualizar|cambia|cambiar|mueve|mover|elimina|eliminar)\b/]
const budgetAnalysisPatterns = [
  /\b(?:es|seria|sera|parece|resulta)\s+(?:factible|viable|posible)\b/,
  /\b(?:me\s+alcanza|alcanzaria|podria|puedo)\b[\s\S]{0,80}\b(?:alquil\w*|pagar\w*|ahorr\w*|presupuesto\w*)\b/,
  /\b(?:alquil\w*|presupuesto\w*)\b[\s\S]{0,100}\b(?:sueldo\w*|salario\w*|ingreso\w*|ahorr\w*|dolar\w*|factible|viable|alcanza)\b/,
]
const compoundPatterns = [
  /\b(primero|despues|después|luego|finalmente|a continuacion|a continuación)\b/,
  /\b(y|ademas|además)\b[\s\S]*\b(que|tambien|también|despues|después|luego)\b/,
  /\b(varios|todas|todos|cada|multiples|múltiples)\b/,
  /\b(documentos|archivos|tickets|tareas)\b[\s\S]*\b(y|ademas|además)\b/,
]

const conversationalReferencePatterns = [
  /\b(eso|esa|ese|ello|lo anterior|la respuesta|el resultado|los anteriores|las anteriores|con eso|de eso)\b/,
  /\b(y\s*\?|y ahora|entonces|sobre lo mismo|comparalos|comparalas)\b/,
]

function emptyFlags(): AgentIntentAnalysis['flags'] {
  return {
    hasVerifiedEvidence: false,
    canReusePreviousResult: false,
    canContinue: false,
    authorizesAction: false,
  }
}

function withFlags(
  result: Omit<AgentIntentAnalysis, 'flags' | 'referencesConversation'>,
  context: AgentIntentContext,
  referencesConversation: boolean,
): AgentIntentAnalysis {
  const previousResult = context.lastResult
  return {
    ...result,
    referencesConversation,
    flags: {
      ...emptyFlags(),
      hasVerifiedEvidence: previousResult?.hasVerifiedEvidence === true,
      canReusePreviousResult: referencesConversation && previousResult?.canReuse === true,
      canContinue: referencesConversation && (
        previousResult?.canContinue === true
        || context.hasConversationHistory === true
        || context.hasActiveDocument === true
      ),
      authorizesAction: false,
    },
  }
}

/**
 * Classifies only the next conversational flow. It never authorizes or performs a mutation.
 */
export function classifyAgentIntent(
  prompt: string,
  context: AgentIntentContext = {},
): AgentIntentAnalysis {
  const normalized = normalize(prompt)
  const previousResult = context.lastResult
  const referencesConversation = matchesAny(normalized, conversationalReferencePatterns)
    || (context.hasConversationHistory === true && normalized.split(/\s+/).filter(Boolean).length <= 4)
    || previousResult?.canContinue === true
  if (!normalized) {
    return withFlags({ intent: 'clarify', confidence: 'high', requiresClarification: true, isCompound: false, reasons: ['empty-prompt'] }, context, false)
  }

  if (matchesAny(normalized, cancelPatterns)) {
    return withFlags({ intent: 'cancel', confidence: 'high', requiresClarification: false, isCompound: false, reasons: ['explicit-cancellation'] }, context, referencesConversation)
  }
  if (matchesAny(normalized, undoPatterns)) {
    const requiresClarification = !context.hasLastAppliedOperation
    return withFlags({
      intent: 'undo',
      confidence: context.hasLastAppliedOperation ? 'high' : 'medium',
      requiresClarification,
      isCompound: false,
      reasons: requiresClarification ? ['missing-operation-to-undo'] : ['explicit-undo'],
    }, context, referencesConversation)
  }
  if (matchesAny(normalized, clarificationPatterns)) {
    return withFlags({ intent: 'clarify', confidence: 'high', requiresClarification: true, isCompound: false, reasons: ['explicit-clarification'] }, context, referencesConversation)
  }

  if (matchesAny(normalized, continuationPatterns)) {
    const requiresClarification = !context.hasConversationHistory && !context.hasActiveDocument
    return withFlags({
      intent: 'continue',
      confidence: context.hasConversationHistory || context.hasActiveDocument ? 'high' : 'medium',
      requiresClarification,
      isCompound: false,
      reasons: requiresClarification ? ['continuation-context-not-resolved'] : ['continuation-request'],
    }, context, referencesConversation)
  }

  const isApply = matchesAny(normalized, applyPatterns)
  const isEdit = matchesAny(normalized, editPatterns)
  const isSearch = matchesAny(normalized, searchPatterns)
  const isAnalysis = matchesAny(normalized, analysisPatterns)
  const isComparison = matchesAny(normalized, comparisonPatterns)
  const isRead = matchesAny(normalized, readPatterns)
  const isCreate = matchesAny(normalized, createPatterns)
  const isOrganize = matchesAny(normalized, organizePatterns)
  const isExecute = matchesAny(normalized, executePatterns)
  const isBudgetAnalysis = matchesAny(normalized, budgetAnalysisPatterns)
    && /\b(?:alquil\w*|presupuesto\w*|sueldo\w*|salario\w*|ingreso\w*|ahorr\w*|pagar\w*|dolar\w*)\b/.test(normalized)
  const rawPrompt = prompt.toLocaleLowerCase()
  const isSalaryInflationAnalysis = (
    rawPrompt.includes('sueldo')
    || rawPrompt.includes('salario')
    || rawPrompt.includes('haberes')
    || rawPrompt.includes('recibo de sueldo')
  ) && (rawPrompt.includes('inflaci') || rawPrompt.includes('ipc'))
  const isCompound = matchesAny(normalized, compoundPatterns)
    || isSalaryInflationAnalysis
    || isBudgetAnalysis
    || [isApply, isEdit, isSearch, isAnalysis, isComparison, isCreate, isOrganize, isExecute].filter(Boolean).length >= 2

  if (isApply && isEdit) {
    return withFlags({
      intent: 'apply-edit',
      confidence: context.hasActiveDocument ? 'high' : 'medium',
      requiresClarification: !context.hasActiveDocument,
      isCompound,
      reasons: context.hasActiveDocument ? ['explicit-apply', 'edit-request'] : ['missing-active-document'],
    }, context, referencesConversation)
  }
  if (isEdit) {
    const requiresClarification = !context.hasActiveDocument && !context.hasSelection
    return withFlags({
      intent: 'propose-edit',
      confidence: context.hasSelection ? 'high' : context.hasActiveDocument ? 'medium' : 'low',
      requiresClarification,
      isCompound,
      reasons: requiresClarification ? ['edit-target-not-resolved'] : ['edit-request'],
    }, context, referencesConversation)
  }
  if (isSalaryInflationAnalysis && !isEdit && !isApply && !isCreate && !isOrganize && !isExecute) {
    return withFlags({ intent: 'analysis', confidence: 'high', requiresClarification: false, isCompound, reasons: ['salary-inflation-analysis'] }, context, referencesConversation)
  }
  if (isSearch) return withFlags({ intent: 'search', confidence: 'high', requiresClarification: false, isCompound, reasons: ['search-request'] }, context, referencesConversation)
  if (isComparison && !isEdit && !isApply && !isCreate && !isOrganize && !isExecute) return withFlags({ intent: 'comparison', confidence: 'high', requiresClarification: false, isCompound, reasons: ['comparison-request'] }, context, referencesConversation)
  if ((isAnalysis || isBudgetAnalysis) && !isEdit && !isApply && !isCreate && !isOrganize && !isExecute) {
    return withFlags({
      intent: 'analysis',
      confidence: 'high',
      requiresClarification: false,
      isCompound,
      reasons: [isBudgetAnalysis ? 'budget-feasibility-analysis' : 'analysis-request'],
    }, context, referencesConversation)
  }
  if (isOrganize) return withFlags({ intent: 'organize', confidence: 'high', requiresClarification: false, isCompound, reasons: ['organization-request'] }, context, referencesConversation)
  if (isCreate) return withFlags({ intent: 'create', confidence: 'medium', requiresClarification: false, isCompound, reasons: ['creation-request'] }, context, referencesConversation)
  if (isExecute) return withFlags({ intent: 'mutation', confidence: 'medium', requiresClarification: false, isCompound, reasons: ['mutation-request'] }, context, referencesConversation)
  if (isRead) return withFlags({ intent: 'read', confidence: 'high', requiresClarification: false, isCompound, reasons: ['reading-request'] }, context, referencesConversation)
  return withFlags({ intent: 'answer', confidence: 'medium', requiresClarification: false, isCompound, reasons: ['general-question'] }, context, referencesConversation)
}

export function buildAgentIntentGuidance(analysis: AgentIntentAnalysis): string {
  const guidance = [`Clasificación preliminar (no autoriza acciones): ${analysis.intent}.`]
  if (analysis.requiresClarification) {
    guidance.push('El objetivo o destino no está suficientemente determinado: usa request_user_clarification antes de leer o mutar.')
  }
  if (analysis.isCompound) {
    guidance.push('El pedido parece compuesto: crea un plan general antes de la primera mutación y continúa paso a paso después de su aprobación.')
  }
  if (analysis.referencesConversation) {
    guidance.push('La consulta referencia el contexto conversacional. Reutiliza solo resultados verificables y pertinentes; si faltan datos, lee de nuevo o pide una aclaración material. Esta clasificación no autoriza ninguna acción.')
  }
  if (analysis.intent === 'analysis' || analysis.intent === 'comparison') {
    guidance.push('Distingue los datos leídos de las inferencias y conserva disponibles las lecturas necesarias para completar el análisis.')
  }
  if (analysis.intent === 'propose-edit' || analysis.intent === 'apply-edit') {
    guidance.push('Para editar un documento, lee el contexto activo, prepara un preview con diff y aplica solo después de la confirmación correspondiente.')
  }
  if (analysis.intent === 'continue') {
    guidance.push('Reutiliza el objetivo, documento y restricciones de la instrucción previa; no inventes un destino. Si "eso" o "el resto" admite más de una interpretación, pregunta antes de mutar.')
  }
  if (analysis.intent === 'undo') {
    guidance.push('Usa undo_ai_operation solo con el operationId real del último cambio autorizado; si no existe o hay más de un cambio posible, pide que indique cuál.')
  }
  return guidance.join('\n')
}
