import type {
  AgentPlan,
  AgentPlanRisk,
  AgentPlanStep,
  AgentPlanStepStatus,
  ToolError,
} from '../../types/ai/agentContracts'

export interface AgentPlanStepInput {
  id?: string
  label: string
  description?: string
  affectedPaths?: readonly string[]
  dependsOn?: readonly string[]
  plannedToolName?: string | null
  risk?: AgentPlanRisk
  canRetry?: boolean
}

function boundedText(value: string | undefined, max: number): string {
  return (value ?? '').trim().slice(0, max)
}

function uniqueIds(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export interface AgentComplexitySignal {
  mutationCount?: number
  documentCount?: number
  requiresWebSearchAndMutation?: boolean
  requiresExtractionAndTaskCreation?: boolean
  requiresRenameAndLinkUpdate?: boolean
  hasDependencies?: boolean
}

const ACTION_WORD_PATTERN = /\b(?:agrega|agregar|aplica|aplicar|archiva|archivar|cambia|cambiar|corrige|corregir|crea|crear|elimina|eliminar|extrae|extraer|inserta|insertar|mueve|mover|registra|registrar|renombra|renombrar|reemplaza|reemplazar|restaura|restaurar|resume|resumir|actualiza|actualizar|mejora|mejorar|busca|buscar)\b/giu

/**
 * Conservative local preflight. It never chooses a tool or mutates anything;
 * it only tells the common runtime when the model must expose a plan first.
 */
export function inferAgentComplexitySignal(prompt: string): AgentComplexitySignal {
  const normalized = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
  const mutationCount = [...normalized.matchAll(ACTION_WORD_PATTERN)].length
  const documentCount = /\b(?:dos|tres|varios|varias|todos|todas|documentos|archivos|notas)\b/.test(normalized) ? 2 : 0
  const hasSearch = /\b(?:busca|buscar|internet|web|fuentes|investiga|investigar)\b/.test(normalized)
  const hasMutation = /\b(?:crea|crear|actualiza|actualizar|cambia|cambiar|agrega|agregar|inserta|insertar|aplica|aplicar|renombra|renombrar|elimina|eliminar|registra|registrar)\b/.test(normalized)
  return {
    mutationCount,
    documentCount,
    requiresWebSearchAndMutation: hasSearch && hasMutation,
    requiresExtractionAndTaskCreation: /\b(?:extrae|extraer|saca|obtene|obtener)\b/.test(normalized)
      && /\b(?:tarea|tareas|ticket|tickets|todo|to-do)\b/.test(normalized),
    requiresRenameAndLinkUpdate: /\b(?:renombra|renombrar|cambia el nombre)\b/.test(normalized)
      && /\b(?:link|links|enlace|enlaces|wikilink|referencia|referencias)\b/.test(normalized),
    hasDependencies: /\b(?:despues|luego|primero|cuando termines|depende|dependencia|a continuacion)\b/.test(normalized),
  }
}

export function buildAutomaticPlanGuidance(prompt: string): string | null {
  if (!shouldCreateAgentPlan(inferAgentComplexitySignal(prompt))) return null
  return [
    'Preflight determinista de Notia: este pedido combina acciones o dependencias que pueden producir mas de una mutacion.',
    'Antes de cualquier herramienta de escritura, crea un unico set_agent_execution_plan con un paso concreto por mutacion y sus dependencias.',
    'No ejecutes ninguna mutacion hasta obtener la aprobacion explicita del plan. Despues continua desde el primer paso pendiente y verifica cada resultado.',
  ].join(' ')
}

/** Deterministic preflight used to avoid asking the model to decide whether a TO-DO is needed. */
export function shouldCreateAgentPlan(signal: AgentComplexitySignal): boolean {
  return (signal.mutationCount ?? 0) >= 2
    || (signal.documentCount ?? 0) >= 2
    || signal.requiresWebSearchAndMutation === true
    || signal.requiresExtractionAndTaskCreation === true
    || signal.requiresRenameAndLinkUpdate === true
    || signal.hasDependencies === true
}

function hasCycle(steps: readonly Pick<AgentPlanStep, 'id' | 'dependsOn'>[]): boolean {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    const step = steps.find((candidate) => candidate.id === id)
    if (step && step.dependsOn.some(visit)) return true
    visiting.delete(id)
    visited.add(id)
    return false
  }
  return steps.some((step) => visit(step.id))
}

export function createAgentPlan(
  id: string,
  title: string,
  steps: readonly AgentPlanStepInput[],
  requiresApproval = true,
): AgentPlan {
  const stepIds = new Set<string>()
  const normalizedSteps: AgentPlanStep[] = steps.slice(0, 20).map((step, index) => {
    const fallbackId = `step-${index + 1}`
    const candidateId = boundedText(step.id, 80) || fallbackId
    const uniqueId = stepIds.has(candidateId) ? `${candidateId}-${index + 1}` : candidateId
    stepIds.add(uniqueId)
    return {
      id: uniqueId,
      label: boundedText(step.label, 240) || `Paso ${index + 1}`,
      description: boundedText(step.description, 500),
      affectedPaths: (step.affectedPaths ?? []).map((path) => path.trim()).filter(Boolean).slice(0, 8),
      dependsOn: uniqueIds(step.dependsOn ?? []).slice(0, 10),
      status: 'pending',
      plannedToolName: step.plannedToolName ? boundedText(step.plannedToolName, 80) : null,
      risk: step.risk ?? 'low',
      canRetry: step.canRetry !== false,
      operationId: null,
      resultSummary: null,
      error: null,
    }
  })
  const plan: AgentPlan = {
    id: boundedText(id, 100),
    title: boundedText(title, 240) || 'Plan de ejecución',
    status: requiresApproval ? 'awaiting-approval' : 'in-progress',
    requiresApproval,
    approved: !requiresApproval,
    steps: normalizedSteps,
  }
  const knownIds = new Set(normalizedSteps.map((step) => step.id))
  const normalizedWithValidDependencies = normalizedSteps.map((step) => ({
    ...step,
    dependsOn: step.dependsOn.filter((dependency) => dependency !== step.id && knownIds.has(dependency)),
  }))
  if (hasCycle(normalizedWithValidDependencies)) {
    return {
      ...plan,
      status: 'failed',
      steps: normalizedWithValidDependencies.map((step) => ({
        ...step,
        status: 'blocked' as const,
        resultSummary: 'El plan contiene dependencias circulares.',
      })),
    }
  }
  return { ...plan, steps: normalizedWithValidDependencies }
}

export function getNextAgentPlanStep(plan: AgentPlan): AgentPlanStep | null {
  return plan.steps.find((step) => step.status === 'pending' && step.dependsOn.every((dependency) => (
    plan.steps.find((candidate) => candidate.id === dependency)?.status === 'completed'
  ))) ?? null
}

export function canStartAgentPlanStep(plan: AgentPlan, stepId: string): boolean {
  const step = plan.steps.find((candidate) => candidate.id === stepId)
  return Boolean(step && step.status === 'pending' && step.dependsOn.every((dependency) => (
    plan.steps.find((candidate) => candidate.id === dependency)?.status === 'completed'
  )) && (!plan.requiresApproval || plan.approved))
}

export function transitionAgentPlanStep(
  plan: AgentPlan,
  stepId: string,
  status: Extract<AgentPlanStepStatus, 'in-progress' | 'completed' | 'blocked' | 'failed' | 'skipped' | 'cancelled'>,
  resultSummary: string | null = null,
  error: ToolError | null = null,
): AgentPlan {
  const step = plan.steps.find((candidate) => candidate.id === stepId)
  if (!step) return plan
  const nextSteps = plan.steps.map((candidate) => candidate.id === stepId
    ? { ...candidate, status, resultSummary: resultSummary ? boundedText(resultSummary, 500) : null, error }
    : candidate)
  const hasFailedDependency = nextSteps.some((candidate) => candidate.status === 'failed' || candidate.status === 'blocked')
  const hasPending = nextSteps.some((candidate) => candidate.status === 'pending' || candidate.status === 'in-progress')
  const statusForPlan = status === 'cancelled'
    ? 'cancelled'
    : status === 'failed' || status === 'blocked'
      ? 'failed'
      : hasFailedDependency
        ? 'paused'
        : hasPending
          ? 'in-progress'
          : 'completed'
  return { ...plan, status: statusForPlan, steps: nextSteps }
}

export function blockDependentAgentPlanSteps(plan: AgentPlan, failedStepId: string): AgentPlan {
  const blockedIds = new Set<string>([failedStepId])
  let changed = true
  while (changed) {
    changed = false
    for (const step of plan.steps) {
      if (step.status === 'pending' && step.dependsOn.some((dependency) => blockedIds.has(dependency)) && !blockedIds.has(step.id)) {
        blockedIds.add(step.id)
        changed = true
      }
    }
  }
  const blockedSteps = plan.steps.map((step) => blockedIds.has(step.id) && step.id !== failedStepId && step.status === 'pending'
    ? { ...step, status: 'blocked' as const, resultSummary: 'Bloqueado por un paso previo.' }
    : step)
  return { ...plan, status: 'paused', steps: blockedSteps }
}

export function retryAgentPlanStep(plan: AgentPlan, stepId: string): AgentPlan {
  const step = plan.steps.find((candidate) => candidate.id === stepId)
  if (!step || step.status !== 'failed' || !step.canRetry) return plan
  return {
    ...plan,
    status: 'in-progress',
    steps: plan.steps.map((candidate) => candidate.id === stepId
      ? { ...candidate, status: 'pending', error: null, resultSummary: null }
      : candidate),
  }
}

export function cancelAgentPlan(plan: AgentPlan): AgentPlan {
  return {
    ...plan,
    status: 'cancelled',
    steps: plan.steps.map((step) => step.status === 'pending' || step.status === 'in-progress'
      ? { ...step, status: 'cancelled', resultSummary: 'Cancelado por el usuario.' }
      : step),
  }
}

export function summarizeAgentPlan(plan: AgentPlan): string {
  const completed = plan.steps.filter((step) => step.status === 'completed').length
  const blocked = plan.steps.filter((step) => step.status === 'blocked' || step.status === 'failed').length
  return `${completed}/${plan.steps.length} pasos completados${blocked > 0 ? `; ${blocked} bloqueado(s)` : ''}.`
}
