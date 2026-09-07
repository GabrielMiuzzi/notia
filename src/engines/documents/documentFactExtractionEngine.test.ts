import { describe, expect, it } from 'vitest'
import { extractDocumentFacts } from './documentFactExtractionEngine'

describe('documentFactExtractionEngine', () => {
  it('returns explicit candidates with source lines and categories', () => {
    const facts = extractDocumentFacts([
      '- [ ] Preparar release',
      'Fecha: 2026-09-07',
      'Decisión: usar el bridge nativo.',
      'Responsable: Ana',
      'Riesgo: falta validar Android.',
    ].join('\n'))
    expect(facts).toEqual(expect.arrayContaining([
      { category: 'tasks', text: '- [ ] Preparar release', line: 1, confidence: 'candidate' },
      { category: 'dates', text: 'Fecha: 2026-09-07', line: 2, confidence: 'candidate' },
      { category: 'decisions', text: 'Decisión: usar el bridge nativo.', line: 3, confidence: 'candidate' },
      { category: 'people', text: 'Responsable: Ana', line: 4, confidence: 'candidate' },
      { category: 'risks', text: 'Riesgo: falta validar Android.', line: 5, confidence: 'candidate' },
    ]))
  })

  it('does not invent categories and respects the bounded result', () => {
    const facts = extractDocumentFacts('- [ ] Uno\n- [ ] Dos\n- [ ] Tres', ['tasks'], 2)
    expect(facts).toHaveLength(2)
    expect(facts.every((fact) => fact.category === 'tasks')).toBe(true)
  })
})
