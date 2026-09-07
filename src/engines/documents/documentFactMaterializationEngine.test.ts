import { describe, expect, it } from 'vitest'
import { renderDocumentFacts } from './documentFactMaterializationEngine'

describe('documentFactMaterializationEngine', () => {
  it('groups explicit facts and preserves path and line evidence', () => {
    const content = renderDocumentFacts([
      { documentPath: 'Plan.md', fact: { category: 'tasks', text: 'Preparar la demo', line: 4, confidence: 'candidate' } },
      { documentPath: 'Plan.md', fact: { category: 'dates', text: '2026-09-10', line: 8, confidence: 'candidate' } },
    ])

    expect(content).toContain('## Tareas')
    expect(content).toContain('- Preparar la demo — evidencia: `Plan.md:4`')
    expect(content).toContain('## Fechas')
  })

  it('does not invent empty categories', () => {
    const content = renderDocumentFacts([
      { documentPath: 'Riesgos.md', fact: { category: 'risks', text: 'Dependencia externa', line: 2, confidence: 'candidate' } },
    ])

    expect(content).not.toContain('## Personas')
    expect(content).toContain('## Riesgos')
  })

  it('keeps a destination title on one Markdown heading', () => {
    const content = renderDocumentFacts([], 'Titulo\n## instruccion inesperada')
    expect(content.split('\n')[0]).toBe('# Titulo ## instruccion inesperada')
  })
})
