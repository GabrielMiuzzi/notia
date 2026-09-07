import { describe, expect, it } from 'vitest'
import { compareDocumentLines } from './documentComparisonEngine'

describe('documentComparisonEngine', () => {
  it('returns bounded line evidence and possible contradictions with both citations', () => {
    const result = compareDocumentLines(
      [
        '---',
        'estado: Pendiente',
        '---',
        '',
        'Estado: Pendiente',
        'Una explicación que no tiene equivalente.',
      ].join('\n'),
      [
        '---',
        'estado: Completado',
        '---',
        '',
        'Estado: En progreso',
      ].join('\n'),
    )

    expect(result.lines.some((line) => line.kind === 'removed')).toBe(true)
    expect(result.contradictions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'estado',
        leftValue: 'pendiente',
        rightValue: 'completado',
        leftLine: 2,
        rightLine: 2,
        confidence: 'possible',
      }),
      expect.objectContaining({
        key: 'estado',
        leftValue: 'pendiente',
        rightValue: 'en progreso',
        leftLine: 5,
        rightLine: 5,
        confidence: 'possible',
      }),
    ]))
  })

  it('does not call a generic changed paragraph a contradiction', () => {
    const result = compareDocumentLines(
      'La reunión será el martes.\nSe revisará el presupuesto.',
      'La reunión será el miércoles.\nSe revisará el contrato.',
    )

    expect(result.contradictions).toEqual([])
  })
})
