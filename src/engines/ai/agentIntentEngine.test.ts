import { describe, expect, it } from 'vitest'
import { buildAgentIntentGuidance, classifyAgentIntent, isLocalFinanceRequest } from './agentIntentEngine'

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

  it('routes loaded salary data to local finance instead of public web search', () => {
    expect(isLocalFinanceRequest('¿Cuáles fueron mis últimos sueldos?')).toBe(true)
    expect(isLocalFinanceRequest('Mis últimos sueldos de los cargados en el módulo de finanzas')).toBe(true)
    expect(isLocalFinanceRequest('Dame las últimas noticias financieras de Argentina')).toBe(false)
    expect(isLocalFinanceRequest('No quiero que busques en la web; decime los sueldos cargados')).toBe(true)
  })

  it('distinguishes analysis and comparison without granting authorization', () => {
    expect(classifyAgentIntent('Analizá la evolución de estos datos').intent).toBe('analysis')
    expect(classifyAgentIntent('Compará enero contra febrero').intent).toBe('comparison')
    expect(classifyAgentIntent('Registrá este gasto').intent).toBe('mutation')
    expect(classifyAgentIntent('Registrá este gasto').flags.authorizesAction).toBe(false)
  })

  it('marks a salary versus inflation request as compound analysis', () => {
    const result = classifyAgentIntent('¿Le estoy ganando a la inflación con mis salarios?')
    expect(result.isCompound).toBe(true)
    expect(result.intent).toBe('analysis')
  })

  it('marks a rent and savings affordability question as compound analysis', () => {
    const result = classifyAgentIntent('¿Es factible alquilar pagando 1.000.000 y ahorrar además 1000 dólares por mes con mi sueldo?')
    expect(result.isCompound).toBe(true)
    expect(result.intent).toBe('analysis')
    expect(result.reasons).toContain('budget-feasibility-analysis')
  })

  it('marks a safe conversational reference and only reuses verified result flags', () => {
    const result = classifyAgentIntent('¿Y eso?', {
      hasConversationHistory: true,
      lastResult: { hasVerifiedEvidence: true, canReuse: true, canContinue: true, isTerminal: true, kind: 'read' },
    })

    expect(result.referencesConversation).toBe(true)
    expect(result.flags).toMatchObject({ hasVerifiedEvidence: true, canReusePreviousResult: true, canContinue: true, authorizesAction: false })
    expect(buildAgentIntentGuidance(result)).toContain('resultados verificables')
  })

  it('keeps a local comparison out of public-search routing', () => {
    expect(isLocalFinanceRequest('Compará mis últimos sueldos con los salarios cargados')).toBe(true)
    expect(isLocalFinanceRequest('actual')).toBe(false)
  })
})
