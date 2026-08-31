import { describe, expect, it } from 'vitest'
import { formatTelegramMessage } from './telegramMessageFormatter'

describe('formatTelegramMessage', () => {
  it('converts common Markdown into Telegram HTML', () => {
    expect(formatTelegramMessage('###Estado\n1. **Pendiente**\n* Detalle: `Loki`'))
      .toBe('<b>Estado</b>\n1. <b>Pendiente</b>\n• Detalle: <code>Loki</code>')
  })

  it('escapes arbitrary HTML while preserving the supported Telegram subset', () => {
    expect(formatTelegramMessage('<script>alert(1)</script> <b>Seguro</b>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt; <b>Seguro</b>')
  })

  it('removes model-added backslashes before supported Telegram tags', () => {
    expect(formatTelegramMessage('Ticket de \\<b>Shami\\</b> por \\<b>$48.000\\</b>'))
      .toBe('Ticket de <b>Shami</b> por <b>$48.000</b>')
  })
})
