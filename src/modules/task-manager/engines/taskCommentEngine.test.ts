import { describe, expect, it } from 'vitest'
import { appendTaskComment } from './taskCommentEngine'

describe('taskCommentEngine', () => {
  it('appends comments with a stable heading and preserves the Markdown body', () => {
    const timestamp = new Date('2026-09-09T15:04:00.000Z')

    const next = appendTaskComment('# Tarea\n\nTexto original\n', 'Comentario remoto', timestamp)

    expect(next).toContain('# Tarea\n\nTexto original')
    expect(next).toContain('## Comentario - ')
    expect(next).toContain('Comentario remoto\n')
  })

  it('keeps two independent appends instead of replacing the first one', () => {
    const first = appendTaskComment('', 'Primero', new Date('2026-09-09T15:04:00.000Z'))
    const second = appendTaskComment(first, 'Segundo', new Date('2026-09-09T15:05:00.000Z'))

    expect(second.match(/## Comentario - /g)).toHaveLength(2)
    expect(second).toContain('Primero\n')
    expect(second).toContain('Segundo\n')
  })
})
