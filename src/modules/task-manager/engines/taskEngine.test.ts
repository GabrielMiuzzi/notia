import { describe, expect, it } from 'vitest'
import { getTasks } from './taskEngine'

describe('taskEngine ordering', () => {
  it('keeps zero as a valid order for a ticket moved before the first item', () => {
    const tasks = getTasks([{
      path: 'task-mannager/default/ticket.md',
      content: [
        '---',
        'tags: [tarea]',
        'tarea: Ticket',
        'tablero: default',
        'equipo: Pendiente',
        'estado: Pendiente',
        'order: 0',
        '---',
        '',
      ].join('\n'),
    }])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.order).toBe(0)
  })
})
