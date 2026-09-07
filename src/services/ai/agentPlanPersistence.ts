import type { TaskExecutionStep } from '../chat/chatScopedAgentRuntime'
import type { AgentPlan, AgentPlanRisk, AgentPlanStepStatus } from '../../types/ai/agentContracts'

interface PersistedAgentPlan {
  version: 1
  savedAt: number
  steps: Array<{ id: string; label: string; status: TaskExecutionStep['status'] }>
}

const TERMINAL_PLAN_STATUSES = new Set<TaskExecutionStep['status']>(['completed', 'skipped', 'cancelled'])
const VALID_PLAN_STATUSES = new Set<TaskExecutionStep['status']>([
  'pending', 'in-progress', 'completed', 'blocked', 'failed', 'skipped', 'cancelled',
])

const STORAGE_PREFIX = 'notia:ai-agent-plan:v1:'
const SNAPSHOT_STORAGE_PREFIX = 'notia:ai-agent-plan-snapshot:v1:'

function storageKey(libraryId: string): string {
  return `${STORAGE_PREFIX}${libraryId}`
}

function snapshotStorageKey(libraryId: string): string {
  return `${SNAPSHOT_STORAGE_PREFIX}${libraryId}`
}

interface PersistedAgentPlanSnapshot {
  version: 1
  savedAt: number
  plan: Omit<AgentPlan, 'steps'> & {
    steps: Array<Pick<AgentPlan['steps'][number], 'id' | 'label' | 'description' | 'dependsOn' | 'status' | 'plannedToolName' | 'risk' | 'canRetry' | 'operationId' | 'resultSummary'> & { affectedPaths?: readonly string[] }>
  }
}

export function saveAgentPlan(libraryId: string, steps: readonly TaskExecutionStep[]): void {
  if (!libraryId) return
  if (steps.length === 0 || steps.every((step) => TERMINAL_PLAN_STATUSES.has(step.status))) {
    window.localStorage.removeItem(storageKey(libraryId))
    window.localStorage.removeItem(snapshotStorageKey(libraryId))
    return
  }
  const value: PersistedAgentPlan = {
    version: 1,
    savedAt: Date.now(),
    steps: steps.slice(0, 20).map((step) => ({
      id: step.id.slice(0, 80),
      label: step.label.trim().slice(0, 240),
      status: step.status,
    })),
  }
  window.localStorage.setItem(storageKey(libraryId), JSON.stringify(value))
  const hasFailedStep = steps.some((step) => step.status === 'failed' || step.status === 'blocked')
  const hasActiveStep = steps.some((step) => step.status === 'pending' || step.status === 'in-progress')
  saveAgentPlanSnapshot(libraryId, {
    id: `legacy-${libraryId}`,
    title: 'Plan de ejecución del agente',
    status: hasFailedStep ? 'paused' : hasActiveStep ? 'in-progress' : 'completed',
    requiresApproval: false,
    approved: true,
    steps: steps.map((step) => ({
      id: step.id,
      label: step.label,
      description: step.description ?? '',
      affectedPaths: step.affectedPaths ?? [],
      dependsOn: step.dependsOn ?? [],
      status: step.status,
      plannedToolName: step.plannedToolName ?? null,
      risk: step.risk ?? 'low',
      canRetry: step.canRetry !== false,
      operationId: step.operationId ?? null,
      resultSummary: step.resultSummary ?? null,
      error: null,
    })),
  })
}

export function loadAgentPlan(libraryId: string): TaskExecutionStep[] {
  if (!libraryId) return []
  const raw = window.localStorage.getItem(storageKey(libraryId))
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as Partial<PersistedAgentPlan>
    if (value.version !== 1 || !Array.isArray(value.steps)) return []
    return value.steps
      .filter((step): step is PersistedAgentPlan['steps'][number] => Boolean(step)
        && typeof step.id === 'string'
        && typeof step.label === 'string'
        && typeof step.status === 'string'
        && VALID_PLAN_STATUSES.has(step.status as TaskExecutionStep['status']))
      .map((step) => ({ id: step.id, label: step.label, status: step.status }))
  } catch {
    return []
  }
}

function collectDependentStepIds(steps: readonly TaskExecutionStep[], rootId: string): Set<string> {
  const dependentIds = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const step of steps) {
      if (dependentIds.has(step.id)) continue
      if (step.dependsOn?.some((dependency) => dependentIds.has(dependency))) {
        dependentIds.add(step.id)
        changed = true
      }
    }
  }
  return dependentIds
}

/**
 * Reopens only the first retryable failed step and its blocked dependents.
 * Completed steps are deliberately left untouched so a retry cannot replay
 * successful mutations.
 */
export function retryFailedAgentPlan(steps: readonly TaskExecutionStep[]): {
  stepId: string
  steps: TaskExecutionStep[]
} | null {
  const failedStep = steps.find((step) => step.status === 'failed' && step.canRetry !== false)
  if (!failedStep) return null
  const affectedIds = collectDependentStepIds(steps, failedStep.id)
  return {
    stepId: failedStep.id,
    steps: steps.map((step) => {
      if (step.id === failedStep.id) {
        return { ...step, status: 'pending', operationId: null, resultSummary: null }
      }
      if (affectedIds.has(step.id) && step.status === 'blocked') {
        return { ...step, status: 'pending', operationId: null, resultSummary: null }
      }
      return { ...step }
    }),
  }
}

/**
 * Explicitly resumes a plan paused at confirmation/clarification. Only the
 * first blocked step and blocked dependents are reopened; completed work is
 * never replayed and failures keep their dedicated retry flow.
 */
export function resumeBlockedAgentPlan(steps: readonly TaskExecutionStep[]): {
  stepId: string
  steps: TaskExecutionStep[]
} | null {
  const blockedStep = steps.find((step) => step.status === 'blocked')
  if (!blockedStep) return null
  const affectedIds = collectDependentStepIds(steps, blockedStep.id)
  return {
    stepId: blockedStep.id,
    steps: steps.map((step) => {
      if (!affectedIds.has(step.id) || (step.status !== 'blocked' && step.id !== blockedStep.id)) {
        return { ...step }
      }
      return { ...step, status: 'pending', operationId: null, resultSummary: null }
    }),
  }
}

/** Cancels only work that has not completed; completed and failed history remains visible. */
export function cancelPendingAgentPlanSteps(steps: readonly TaskExecutionStep[]): TaskExecutionStep[] {
  return steps.map((step) => step.status === 'pending' || step.status === 'in-progress'
    ? { ...step, status: 'cancelled', resultSummary: 'Cancelado por el usuario.' }
    : { ...step })
}

export function loadAgentExecutionPlan(libraryId: string): TaskExecutionStep[] {
  const snapshot = loadAgentPlanSnapshot(libraryId)
  if (!snapshot) return loadAgentPlan(libraryId)
  return snapshot.steps.map((step) => ({
    id: step.id,
    label: step.label,
    status: step.status,
    description: step.description,
    affectedPaths: step.affectedPaths ? [...step.affectedPaths] : [],
    dependsOn: [...step.dependsOn],
    plannedToolName: step.plannedToolName,
    risk: step.risk,
    canRetry: step.canRetry,
    operationId: step.operationId,
    resultSummary: step.resultSummary,
  }))
}

export function clearAgentPlan(libraryId: string): void {
  if (!libraryId) return
  window.localStorage.removeItem(storageKey(libraryId))
  window.localStorage.removeItem(snapshotStorageKey(libraryId))
}

/** Persists only resumable plan metadata; prompts, files and tool arguments never enter storage. */
export function saveAgentPlanSnapshot(libraryId: string, plan: AgentPlan): void {
  if (!libraryId || plan.steps.length === 0) return
  const value: PersistedAgentPlanSnapshot = {
    version: 1,
    savedAt: Date.now(),
    plan: {
      id: plan.id.slice(0, 100),
      title: plan.title.trim().slice(0, 240),
      status: plan.status,
      requiresApproval: plan.requiresApproval,
      approved: plan.approved,
      steps: plan.steps.slice(0, 20).map((step) => ({
        id: step.id.slice(0, 80),
        label: step.label.trim().slice(0, 240),
        description: step.description.trim().slice(0, 500),
        affectedPaths: (step.affectedPaths ?? []).slice(0, 8),
        dependsOn: step.dependsOn.slice(0, 10),
        status: step.status,
        plannedToolName: step.plannedToolName,
        risk: step.risk,
        canRetry: step.canRetry,
        operationId: step.operationId,
        resultSummary: step.resultSummary?.slice(0, 500) ?? null,
      })),
    },
  }
  try {
    window.localStorage.setItem(snapshotStorageKey(libraryId), JSON.stringify(value))
  } catch {
    // The live runtime remains authoritative when storage is unavailable.
  }
}

export function loadAgentPlanSnapshot(libraryId: string): AgentPlan | null {
  if (!libraryId) return null
  try {
    const raw = window.localStorage.getItem(snapshotStorageKey(libraryId))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PersistedAgentPlanSnapshot>
    const plan = value.plan
    if (value.version !== 1 || !plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) return null
    if (typeof plan.id !== 'string' || typeof plan.title !== 'string' || typeof plan.status !== 'string') return null
    const steps = plan.steps.filter((step): step is PersistedAgentPlanSnapshot['plan']['steps'][number] => Boolean(step)
      && typeof step.id === 'string'
      && typeof step.label === 'string'
      && typeof step.description === 'string'
      && Array.isArray(step.dependsOn)
      && typeof step.status === 'string')
      .slice(0, 20)
      .map((step) => ({
        id: step.id,
        label: step.label,
        description: step.description,
        affectedPaths: Array.isArray(step.affectedPaths)
          ? step.affectedPaths.filter((path): path is string => typeof path === 'string').slice(0, 8)
          : [],
        dependsOn: step.dependsOn.filter((id): id is string => typeof id === 'string').slice(0, 10),
        status: step.status as AgentPlanStepStatus,
        plannedToolName: typeof step.plannedToolName === 'string' ? step.plannedToolName : null,
        risk: (step.risk === 'medium' || step.risk === 'high' || step.risk === 'critical' ? step.risk : 'low') as AgentPlanRisk,
        canRetry: step.canRetry !== false,
        operationId: typeof step.operationId === 'string' ? step.operationId : null,
        resultSummary: typeof step.resultSummary === 'string' ? step.resultSummary : null,
        error: null,
      }))
    if (steps.length === 0) return null
    return {
      id: plan.id,
      title: plan.title,
      status: plan.status === 'awaiting-approval' || plan.status === 'in-progress' || plan.status === 'paused'
        || plan.status === 'completed' || plan.status === 'failed' || plan.status === 'cancelled'
        ? plan.status
        : 'draft',
      requiresApproval: plan.requiresApproval === true,
      approved: plan.approved === true,
      steps,
    }
  } catch {
    return null
  }
}
