import { describe, expect, it } from 'vitest'
import { buildTelegramFinanceSourceReference, buildTelegramImageRoundMessage, enqueueTelegramAgentRequest, isTelegramFinanceRequest, parseTelegramConfirmationDecision, resolveTelegramAgentScope, resolveTelegramChoiceReply, TELEGRAM_AI_TOOL_CALL_TIMEOUT_MS, TELEGRAM_CONFIRMATION_TIMEOUT_MS, TELEGRAM_IMAGE_AI_MAX_ROUNDS, TELEGRAM_IMAGE_PROGRESS_INTERVAL_MS, TELEGRAM_PENDING_REQUEST_LIMIT } from './useTelegramAgentBridge'

describe('Telegram finance scope', () => {
  it('detects financial requests', () => {
    expect(isTelegramFinanceRequest('¿Cuál es mi saldo en ARS?')).toBe(true)
    expect(isTelegramFinanceRequest('Registrar un aporte de ahorro')).toBe(true)
    expect(isTelegramFinanceRequest('gaste 5000$ en nafta')).toBe(true)
    expect(isTelegramFinanceRequest('Gasté 4000$ en nafta')).toBe(true)
    expect(isTelegramFinanceRequest('Cargue $5000 de nafta, anotalo en mis finanzas')).toBe(true)
    expect(isTelegramFinanceRequest('Digital, crea una nueva categoria llamada transporte.')).toBe(true)
  })

  it('keeps general library requests outside finance scope', () => {
    expect(isTelegramFinanceRequest('Abrí la nota del proyecto')).toBe(false)
    expect(resolveTelegramAgentScope('Digital', 'finance')).toBe('finance')
    expect(resolveTelegramAgentScope('Crea una nota sobre este gasto', 'finance')).toBe('library')
  })

  it('accepts explicit confirmations, cancellations and leaves ambiguous replies unresolved', () => {
    expect(parseTelegramConfirmationDecision('Sí, confirmo')).toBe(true)
    expect(parseTelegramConfirmationDecision('cancelar')).toBe(false)
    expect(parseTelegramConfirmationDecision('quizás mañana')).toBeNull()
    expect(TELEGRAM_CONFIRMATION_TIMEOUT_MS).toBe(120_000)
    expect(TELEGRAM_AI_TOOL_CALL_TIMEOUT_MS).toBe(90_000)
    expect(TELEGRAM_IMAGE_AI_MAX_ROUNDS).toBe(12)
    expect(TELEGRAM_IMAGE_PROGRESS_INTERVAL_MS).toBe(12_000)
  })

  it('provides concise progress between image-agent rounds', () => {
    expect(buildTelegramImageRoundMessage(1)).toBeNull()
    expect(buildTelegramImageRoundMessage(2)).toContain('datos financieros')
    expect(buildTelegramImageRoundMessage(3)).toContain('preparando el registro')
    expect(buildTelegramImageRoundMessage(5)).toContain('documento')
    expect(buildTelegramImageRoundMessage(5)).toContain('paso 3')
  })

  it('resolves typed numeric answers using the choice list sent to Telegram', () => {
    const choices = ['Digital (ARS)', 'Efectivo (ARS)']
    expect(resolveTelegramChoiceReply('2', choices)).toBe('Efectivo (ARS)')
    expect(resolveTelegramChoiceReply('1.', choices)).toBe('Digital (ARS)')
    expect(resolveTelegramChoiceReply('Transporte', choices)).toBe('Transporte')
    expect(resolveTelegramChoiceReply('3', choices)).toBe('3')
  })

  it('queues several Telegram tickets in arrival order without accepting an unbounded batch', () => {
    const queue: string[] = []
    expect(enqueueTelegramAgentRequest(queue, 'ticket-1')).toBe(0)
    expect(enqueueTelegramAgentRequest(queue, 'ticket-2')).toBe(1)
    for (let index = queue.length; index < TELEGRAM_PENDING_REQUEST_LIMIT; index += 1) {
      expect(enqueueTelegramAgentRequest(queue, `ticket-${index + 1}`)).toBe(index)
    }
    expect(queue).toEqual(Array.from({ length: TELEGRAM_PENDING_REQUEST_LIMIT }, (_, index) => `ticket-${index + 1}`))
    expect(enqueueTelegramAgentRequest(queue, 'ticket-extra')).toBeNull()
  })

  it('keeps the original Telegram reference available across the account clarification', () => {
    expect(buildTelegramFinanceSourceReference('AgACAgQAAxkBAAIB')).toBe('telegram:telegram-AgACAgQAAxkBAAIB.jpg')
  })
})
