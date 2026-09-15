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

  it('converts model-generated HTML lists into Telegram bullets', () => {
    const formatted = formatTelegramMessage([
      'Temas principales:',
      '<ul>',
      '<li><b>Pagos:</b> Las tarjetas Mastercard y Amex están caídas.</li>',
      '<li><b>Payment Engine:</b> Error 500 en desembolsos.</li>',
      '</ul>',
    ].join('\n'))

    expect(formatted).toContain('• <b>Pagos:</b> Las tarjetas Mastercard y Amex están caídas.')
    expect(formatted).toContain('• <b>Payment Engine:</b> Error 500 en desembolsos.')
    expect(formatted).toContain('caídas.\n• <b>Payment Engine:</b>')
    expect(formatted).not.toMatch(/<\/?(?:ul|li)>/)
  })

  it('does not rewrite HTML-looking tags inside fenced code', () => {
    expect(formatTelegramMessage('```html\n<ul><li>ejemplo</li></ul>\n```'))
      .toBe('<pre>&lt;ul&gt;&lt;li&gt;ejemplo&lt;/li&gt;&lt;/ul&gt;\n</pre>')
  })
})
