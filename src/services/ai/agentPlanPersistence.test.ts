import { beforeEach, describe, expect, it } from 'vitest'
import { cancelPendingAgentPlanSteps, clearAgentPlan, loadAgentExecutionPlan, loadAgentPlan, loadAgentPlanSnapshot, resumeBlockedAgentPlan, retryFailedAgentPlan, saveAgentPlan, saveAgentPlanSnapshot } from './agentPlanPersistence'

describe('agentPlanPersistence', () => {
  const values = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => { values.clear() },
  }

  beforeEach(() => {
    values.clear()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } })
  })

  it('round-trips only bounded plan metadata', () => {
    saveAgentPlan('library-1', [{ id: 'step-1', label: '  Leer documento  ', status: 'pending' }])
    expect(loadAgentPlan('library-1')).toEqual([{ id: 'step-1', label: 'Leer documento', status: 'pending' }])
  })

  it('prefers the detailed snapshot when rehydrating a saved execution plan', () => {
    saveAgentPlan('library-1', [{
      id: 'apply',
      label: 'Aplicar cambio',
      status: 'pending',
      description: 'Aplicar solo el hunk aprobado',
      dependsOn: ['read'],
      plannedToolName: 'apply_document_patch',
      risk: 'medium',
      canRetry: true,
      operationId: 'operation-1',
      resultSummary: null,
    }])
    expect(loadAgentExecutionPlan('library-1')).toMatchObject([{
      id: 'apply',
      dependsOn: ['read'],
      plannedToolName: 'apply_document_patch',
      risk: 'medium',
      operationId: 'operation-1',
    }])
  })

  it('clears a plan when it has no remaining steps', () => {
    saveAgentPlan('library-1', [{ id: 'step-1', label: 'Paso', status: 'completed' }])
    clearAgentPlan('library-1')
    expect(loadAgentPlan('library-1')).toEqual([])
  })

  it('persists resumable general-plan metadata without private context', () => {
    saveAgentPlanSnapshot('library-1', {
      id: 'plan-1',
      title: 'Actualizar notas',
      status: 'paused',
      requiresApproval: true,
      approved: true,
      steps: [{
        id: 'read',
        label: 'Leer',
        description: 'Leer contexto',
        affectedPaths: ['Notas/proyecto.md', 'Tareas/proyecto.md'],
        dependsOn: [],
        status: 'completed',
        plannedToolName: 'read_library_documents',
        risk: 'low',
        canRetry: true,
        operationId: 'op-1',
        resultSummary: 'Leido',
        error: null,
      }],
    })

    expect(loadAgentPlanSnapshot('library-1')).toMatchObject({
      id: 'plan-1',
      status: 'paused',
      steps: [{ id: 'read', status: 'completed', operationId: 'op-1', affectedPaths: ['Notas/proyecto.md', 'Tareas/proyecto.md'] }],
    })
  })

  it('rehydrates the visible execution plan from a general-plan snapshot', () => {
    saveAgentPlanSnapshot('library-1', {
      id: 'plan-1',
      title: 'Actualizar notas',
      status: 'paused',
      requiresApproval: false,
      approved: true,
      steps: [{
        id: 'read',
        label: 'Leer',
        description: 'Leer contexto',
        dependsOn: [],
        status: 'in-progress',
        plannedToolName: 'read_library_documents',
        risk: 'low',
        canRetry: true,
        operationId: 'op-1',
        resultSummary: null,
        error: null,
      }],
    })

    expect(loadAgentExecutionPlan('library-1')).toMatchObject([
      { id: 'read', status: 'in-progress', plannedToolName: 'read_library_documents', operationId: 'op-1' },
    ])
  })

  it('retries one failed step and reopens only its blocked dependents', () => {
    const result = retryFailedAgentPlan([
      { id: 'read', label: 'Leer', status: 'completed' },
      { id: 'apply', label: 'Aplicar', status: 'failed', canRetry: true, dependsOn: ['read'], operationId: 'old-operation' },
      { id: 'verify', label: 'Verificar', status: 'blocked', dependsOn: ['apply'], operationId: 'blocked-operation' },
      { id: 'other', label: 'Otro', status: 'blocked', dependsOn: ['unrelated'] },
    ])
    expect(result?.stepId).toBe('apply')
    expect(result?.steps.map((step) => [step.id, step.status])).toEqual([
      ['read', 'completed'],
      ['apply', 'pending'],
      ['verify', 'pending'],
      ['other', 'blocked'],
    ])
    expect(result?.steps.find((step) => step.id === 'apply')?.operationId).toBeNull()
  })

  it('does not retry a non-retryable failure and cancels only unfinished steps', () => {
    const steps = [
      { id: 'failed', label: 'Falló', status: 'failed' as const, canRetry: false },
      { id: 'pending', label: 'Pendiente', status: 'pending' as const },
      { id: 'done', label: 'Listo', status: 'completed' as const },
    ]
    expect(retryFailedAgentPlan(steps)).toBeNull()
    expect(cancelPendingAgentPlanSteps(steps)).toMatchObject([
      { id: 'failed', status: 'failed' },
      { id: 'pending', status: 'cancelled', resultSummary: 'Cancelado por el usuario.' },
      { id: 'done', status: 'completed' },
    ])
  })

  it('resumes only the blocked step and its blocked dependents', () => {
    const result = resumeBlockedAgentPlan([
      { id: 'read', label: 'Leer', status: 'completed' },
      { id: 'confirm', label: 'Confirmar', status: 'blocked', dependsOn: ['read'], operationId: 'old-confirmation' },
      { id: 'apply', label: 'Aplicar', status: 'blocked', dependsOn: ['confirm'], operationId: 'old-apply' },
      { id: 'other', label: 'Otro', status: 'blocked', dependsOn: ['unrelated'] },
    ])
    expect(result?.stepId).toBe('confirm')
    expect(result?.steps.map((step) => [step.id, step.status])).toEqual([
      ['read', 'completed'],
      ['confirm', 'pending'],
      ['apply', 'pending'],
      ['other', 'blocked'],
    ])
    expect(result?.steps.find((step) => step.id === 'confirm')?.operationId).toBeNull()
  })
})
