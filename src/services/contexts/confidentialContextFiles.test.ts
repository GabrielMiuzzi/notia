import { describe, expect, it } from 'vitest'
import { ensureConfidentialContext } from './confidentialContextFiles'

describe('confidential context files', () => {
  it('adds the confidential context to Markdown without changing its body', () => {
    const result = ensureConfidentialContext('# Configuracion\n\nContenido')
    expect(result.changed).toBe(true)
    expect(result.content).toContain('contexto: "#Confidencial"')
    expect(result.content).toContain('# Configuracion\n\nContenido')
  })

  it('replaces an existing context while preserving other frontmatter', () => {
    const result = ensureConfidentialContext('---\ntitle: Reglas\ncontexto: "#Personal"\n---\n\nContenido')
    expect(result.content).toContain('title: Reglas')
    expect(result.content).toContain('contexto: "#Confidencial"')
    expect(result.content).not.toContain('#Personal')
  })
})
