import { describe, expect, it } from 'vitest'
import { blockDependentAgentPlanSteps, buildAutomaticPlanGuidance, canStartAgentPlanStep, cancelAgentPlan, createAgentPlan, getNextAgentPlanStep, inferAgentComplexitySignal, retryAgentPlanStep, shouldCreateAgentPlan, summarizeAgentPlan, transitionAgentPlanStep } from './agentPlanEngine'

describe('agentPlanEngine', () => {
  it('creates a plan with safe bounded metadata and dependencies', () => {
    const plan = createAgentPlan('plan-1', 'Editar documentos', [
      { id: 'read', label: 'Leer', plannedToolName: 'read_library_documents' },
      { id: 'apply', label: 'Aplicar', dependsOn: ['read'], risk: 'medium' },
    ])
    expect(plan.status).toBe('awaiting-approval')
    expect(getNextAgentPlanStep(plan)?.id).toBe('read')
    expect(canStartAgentPlanStep(plan, 'apply')).toBe(false)
  })

  it('transitions steps only through explicit results and blocks dependents', () => {
    const plan = createAgentPlan('plan-1', 'Editar', [
      { id: 'read', label: 'Leer' },
      { id: 'apply', label: 'Aplicar', dependsOn: ['read'] },
    ])
    const approved = { ...plan, approved: true, status: 'in-progress' as const }
    const failed = transitionAgentPlanStep(approved, 'read', 'failed', 'No se pudo leer')
    const blocked = blockDependentAgentPlanSteps(failed, 'read')
    expect(blocked.steps[1]?.status).toBe('blocked')
    expect(summarizeAgentPlan(blocked)).toContain('bloqueado')
  })

  it('detects compound work without creating a plan for a simple action', () => {
    expect(shouldCreateAgentPlan({ mutationCount: 1 })).toBe(false)
    expect(shouldCreateAgentPlan({ mutationCount: 2 })).toBe(true)
    expect(shouldCreateAgentPlan({ requiresWebSearchAndMutation: true })).toBe(true)
  })

  it('detects compound natural-language requests locally', () => {
    const signal = inferAgentComplexitySignal('Busca fuentes públicas y actualiza dos documentos con las citas.')
    expect(signal.requiresWebSearchAndMutation).toBe(true)
    expect(signal.documentCount).toBe(2)
    expect(buildAutomaticPlanGuidance('Busca fuentes públicas y actualiza dos documentos con las citas.')).toContain('set_agent_execution_plan')
    expect(buildAutomaticPlanGuidance('Explicame este párrafo.')).toBeNull()
  })

  it('marks transitive dependents as blocked after a failure', () => {
    const plan = createAgentPlan('plan-1', 'Cambios', [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', dependsOn: ['a'] },
      { id: 'c', label: 'C', dependsOn: ['b'] },
    ], false)
    const failed = transitionAgentPlanStep(plan, 'a', 'failed', 'Falló A')
    const blocked = blockDependentAgentPlanSteps(failed, 'a')
    expect(blocked.steps.find((step) => step.id === 'b')?.status).toBe('blocked')
    expect(blocked.steps.find((step) => step.id === 'c')?.status).toBe('blocked')
  })

  it('supports isolated retry and cancellation', () => {
    const plan = createAgentPlan('plan-1', 'Cambios', [
      { id: 'a', label: 'A', canRetry: true },
      { id: 'b', label: 'B', canRetry: false },
    ], false)
    const failed = transitionAgentPlanStep(plan, 'a', 'failed', 'Falló A')
    expect(retryAgentPlanStep(failed, 'a').steps.find((step) => step.id === 'a')?.status).toBe('pending')
    expect(retryAgentPlanStep(failed, 'b')).toEqual(failed)
    const cancelled = cancelAgentPlan(plan)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.steps.every((step) => step.status === 'cancelled')).toBe(true)
  })

  it('rejects dependency cycles as a failed plan', () => {
    const plan = createAgentPlan('plan-1', 'Cíclico', [
      { id: 'a', label: 'A', dependsOn: ['b'] },
      { id: 'b', label: 'B', dependsOn: ['a'] },
    ])
    expect(plan.status).toBe('failed')
    expect(plan.steps.every((step) => step.status === 'blocked')).toBe(true)
  })
})
