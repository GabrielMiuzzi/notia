export type AgentIntent =
  | 'answer'
  | 'explain'
  | 'search'
  | 'read'
  | 'propose-edit'
  | 'apply-edit'
  | 'create'
  | 'organize'
  | 'execute'
  | 'clarify'
  | 'cancel'
  | 'continue'
  | 'undo'

export interface AgentIntentContext {
  hasActiveDocument?: boolean
  hasSelection?: boolean
  hasConversationHistory?: boolean
  hasLastAppliedOperation?: boolean
}

export interface AgentIntentAnalysis {
  intent: AgentIntent
  confidence: 'low' | 'medium' | 'high'
  requiresClarification: boolean
  isCompound: boolean
  reasons: readonly string[]
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
const editPatterns = [/\b(mejora|mejorame|corrige|corrigeme|reescribe|reemplaza|modifica|edita|ajusta|acorta|resume|traduce|formatea|agrega|anade|añade|inserta|elimina|borra)\b/]
const createPatterns = [/\b(crea|crear|nuevo|genera|generar|escribi|escribe|redacta)\b/]
const organizePatterns = [/\b(organiza|orden(a|ar)|clasifica|etiqueta|mueve|renombra|agrupa)\b/]
const searchPatterns = [/\b(busca|buscar|investiga|investigar|internet|web|fuentes|actualizado|actualizada|hoy|reciente)\b/]
const readPatterns = [/\b(lee|leer|revisa|revisar|encuentra|encontra|localiza|compara|analiza|resume|resumir|lista|cuenta)\b/]
const executePatterns = [/\b(registra|registrar|carga|cargar|actualiza|actualizar|cambia|cambiar|mueve|mover|elimina|eliminar)\b/]
const compoundPatterns = [
  /\b(primero|despues|después|luego|finalmente|a continuacion|a continuación)\b/,
  /\b(y|ademas|además)\b[\s\S]*\b(que|tambien|también|despues|después|luego)\b/,
  /\b(varios|todas|todos|cada|multiples|múltiples)\b/,
  /\b(documentos|archivos|tickets|tareas)\b[\s\S]*\b(y|ademas|además)\b/,
]

/**
 * Classifies only the next conversational flow. It never authorizes or performs a mutation.
 */
export function classifyAgentIntent(
  prompt: string,
  context: AgentIntentContext = {},
): AgentIntentAnalysis {
  const normalized = normalize(prompt)
  if (!normalized) {
    return { intent: 'clarify', confidence: 'high', requiresClarification: true, isCompound: false, reasons: ['empty-prompt'] }
  }

  if (matchesAny(normalized, cancelPatterns)) {
    return { intent: 'cancel', confidence: 'high', requiresClarification: false, isCompound: false, reasons: ['explicit-cancellation'] }
  }
  if (matchesAny(normalized, undoPatterns)) {
    const requiresClarification = !context.hasLastAppliedOperation
    return {
      intent: 'undo',
      confidence: context.hasLastAppliedOperation ? 'high' : 'medium',
      requiresClarification,
      isCompound: false,
      reasons: requiresClarification ? ['missing-operation-to-undo'] : ['explicit-undo'],
    }
  }
  if (matchesAny(normalized, clarificationPatterns)) {
    return { intent: 'clarify', confidence: 'high', requiresClarification: true, isCompound: false, reasons: ['explicit-clarification'] }
  }

  if (matchesAny(normalized, continuationPatterns)) {
    const requiresClarification = !context.hasConversationHistory && !context.hasActiveDocument
    return {
      intent: 'continue',
      confidence: context.hasConversationHistory || context.hasActiveDocument ? 'high' : 'medium',
      requiresClarification,
      isCompound: false,
      reasons: requiresClarification ? ['continuation-context-not-resolved'] : ['continuation-request'],
    }
  }

  const isApply = matchesAny(normalized, applyPatterns)
  const isEdit = matchesAny(normalized, editPatterns)
  const isSearch = matchesAny(normalized, searchPatterns)
  const isRead = matchesAny(normalized, readPatterns)
  const isCreate = matchesAny(normalized, createPatterns)
  const isOrganize = matchesAny(normalized, organizePatterns)
  const isExecute = matchesAny(normalized, executePatterns)
  const isCompound = matchesAny(normalized, compoundPatterns)
    || [isApply, isEdit, isSearch, isCreate, isOrganize, isExecute].filter(Boolean).length >= 2

  if (isApply && isEdit) {
    return {
      intent: 'apply-edit',
      confidence: context.hasActiveDocument ? 'high' : 'medium',
      requiresClarification: !context.hasActiveDocument,
      isCompound,
      reasons: context.hasActiveDocument ? ['explicit-apply', 'edit-request'] : ['missing-active-document'],
    }
  }
  if (isEdit) {
    const requiresClarification = !context.hasActiveDocument && !context.hasSelection
    return {
      intent: 'propose-edit',
      confidence: context.hasSelection ? 'high' : context.hasActiveDocument ? 'medium' : 'low',
      requiresClarification,
      isCompound,
      reasons: requiresClarification ? ['edit-target-not-resolved'] : ['edit-request'],
    }
  }
  if (isSearch) return { intent: 'search', confidence: 'high', requiresClarification: false, isCompound, reasons: ['search-request'] }
  if (isOrganize) return { intent: 'organize', confidence: 'high', requiresClarification: false, isCompound, reasons: ['organization-request'] }
  if (isCreate) return { intent: 'create', confidence: 'medium', requiresClarification: false, isCompound, reasons: ['creation-request'] }
  if (isExecute) return { intent: 'execute', confidence: 'medium', requiresClarification: false, isCompound, reasons: ['mutation-request'] }
  if (isRead) return { intent: 'read', confidence: 'high', requiresClarification: false, isCompound, reasons: ['reading-request'] }
  return { intent: 'answer', confidence: 'medium', requiresClarification: false, isCompound: false, reasons: ['general-question'] }
}

export function buildAgentIntentGuidance(analysis: AgentIntentAnalysis): string {
  const guidance = [`Clasificación preliminar (no autoriza acciones): ${analysis.intent}.`]
  if (analysis.requiresClarification) {
    guidance.push('El objetivo o destino no está suficientemente determinado: usa request_user_clarification antes de leer o mutar.')
  }
  if (analysis.isCompound) {
    guidance.push('El pedido parece compuesto: crea un plan general antes de la primera mutación y continúa paso a paso después de su aprobación.')
  }
  if (analysis.intent === 'propose-edit' || analysis.intent === 'apply-edit') {
    guidance.push('Para editar un documento, lee el contexto activo, prepara un preview con diff y aplica solo después de la confirmación correspondiente.')
  }
  if (analysis.intent === 'continue') {
    guidance.push('Reutiliza el objetivo, documento y restricciones de la instrucciÃ³n previa; no inventes un destino. Si "eso" o "el resto" admite mÃ¡s de una interpretaciÃ³n, pregunta antes de mutar.')
  }
  if (analysis.intent === 'undo') {
    guidance.push('Usa undo_ai_operation solo con el operationId real del Ãºltimo cambio autorizado; si no existe o hay mÃ¡s de un cambio posible, pide que indique cuÃ¡l.')
  }
  return guidance.join('\n')
}
