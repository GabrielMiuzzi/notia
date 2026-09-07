import { describe, expect, it } from 'vitest'
import { redactDiagnosticData, redactDiagnosticText } from './notiaLogger'

describe('notiaLogger', () => {
  it('redacts secrets, tokens, private paths and emails from diagnostic text', () => {
    const redacted = redactDiagnosticText(
      'apiKey=secret-value Bearer sk-test-secret-value jwt eyJhbGciOiJub25lIn0.abc.def en C:\\Users\\gabmi\\Documents\\nota.md y persona@example.com',
    )

    expect(redacted).not.toContain('sk-test-secret-value')
    expect(redacted).not.toContain('eyJhbGciOiJub25lIn0.abc.def')
    expect(redacted).not.toContain('C:\\Users\\gabmi')
    expect(redacted).not.toContain('persona@example.com')
    expect(redacted).toContain('[secret-redacted]')
    expect(redacted).toContain('[token-redacted]')
    expect(redacted).toContain('[private-path-redacted]')
    expect(redacted).toContain('[email-redacted]')
  })

  it('redacts sensitive nested diagnostic fields before local performance storage', () => {
    const redacted = redactDiagnosticData({
      query: 'información privada',
      nested: { content: 'contenido reservado', path: 'C:\\Users\\gabmi\\Documents\\nota.md' },
      count: 2,
    })
    expect(redacted.query).toBe('[redacted]')
    expect(redacted.nested).toEqual({ content: '[redacted]', path: '[private-path-redacted]' })
    expect(redacted.count).toBe(2)
  })
})
