import { describe, expect, it } from 'vitest'
import { parseTelegramConfirmationDecision } from './useTelegramAgentBridge'

describe('parseTelegramConfirmationDecision', () => {
  it.each(['Sí', 'Si, confirmo', 'confirmo', 'Confirmar', 'acepto'])(
    'accepts an affirmative confirmation: %s',
    (value) => expect(parseTelegramConfirmationDecision(value)).toBe(true),
  )

  it.each(['No', 'cancelo', 'No confirmo', 'Cancelar', 'rechazo'])(
    'accepts a negative confirmation: %s',
    (value) => expect(parseTelegramConfirmationDecision(value)).toBe(false),
  )

  it('does not consume unrelated messages', () => {
    expect(parseTelegramConfirmationDecision('¿Qué cambió?')).toBeNull()
  })
})
