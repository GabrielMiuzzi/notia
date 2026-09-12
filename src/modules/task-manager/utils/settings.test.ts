import { describe, expect, it } from 'vitest'
import { normalizeTaskManagerSettings } from './settings'

describe('task manager settings', () => {
  it('preserves a board context when settings are normalized', () => {
    const settings = normalizeTaskManagerSettings({
      boards: [
        { name: 'default', color: '#2e6db0', activityHoursPerDay: 24, contexto: '#Laboral' },
      ],
      groups: [],
    })

    expect(settings.boards.find((board) => board.name === 'default')?.contexto).toBe('#Laboral')
  })
})
