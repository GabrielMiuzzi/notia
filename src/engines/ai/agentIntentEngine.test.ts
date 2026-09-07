import { describe, expect, it } from 'vitest'
import { buildAgentIntentGuidance, classifyAgentIntent } from './agentIntentEngine'

describe('agentIntentEngine', () => {
  it('classifies a selected-document improvement without authorizing it', () => {
    const result = classifyAgentIntent('Mejorame esta parte y agregá un ejemplo', {
      hasActiveDocument: true,
      hasSelection: true,
    })
    expect(result.intent).toBe('propose-edit')
    expect(result.requiresClarification).toBe(false)
    expect(buildAgentIntentGuidance(result)).toContain('preview')
  })

  it('requires clarification when an edit has no resolvable target', () => {
    const result = classifyAgentIntent('Mejorá la introducción')
    expect(result.intent).toBe('propose-edit')
    expect(result.requiresClarification).toBe(true)
  })

  it('detects compound requests for planning', () => {
    const result = classifyAgentIntent('Buscá fuentes públicas y después actualizá dos documentos')
    expect(result.isCompound).toBe(true)
    expect(buildAgentIntentGuidance(result)).toContain('plan general')
  })

  it('does not confuse a question with a mutation', () => {
    expect(classifyAgentIntent('¿Qué significa este concepto?').intent).toBe('answer')
    expect(classifyAgentIntent('Cancelá la operación').intent).toBe('cancel')
  })
  it('keeps short follow-ups attached to the existing conversation', () => {
    const result = classifyAgentIntent('Hacelo mas corto y aplicalo tambien abajo', {
      hasActiveDocument: true,
      hasConversationHistory: true,
    })
    expect(result.intent).toBe('continue')
    expect(result.requiresClarification).toBe(false)
    expect(buildAgentIntentGuidance(result)).toContain('objetivo')
  })

  it('does not guess which operation should be undone', () => {
    expect(classifyAgentIntent('Volve atras', { hasLastAppliedOperation: true }).intent).toBe('undo')
    expect(classifyAgentIntent('Volve atras').requiresClarification).toBe(true)
  })
})
