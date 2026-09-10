import { describe, expect, it } from 'vitest'
import { appendPomodoroLogEntry, readPomodoroLogEntries } from './pomodoroLogEngine'

const entry = (task: string) => ({
  timestampMs: 0,
  type: 'Trabajo',
  durationChoice: '25 minutos',
  task,
  durationMinutes: 25,
  deviationHours: 0,
  finalized: true,
})

describe('pomodoroLogEngine', () => {
  it('preserves independent appends in order', () => {
    const first = appendPomodoroLogEntry('', entry('uno'))
    const second = appendPomodoroLogEntry(first, entry('dos'))
    const entries = readPomodoroLogEntries(second)

    expect(entries).toHaveLength(2)
    expect(entries.map((item) => item.task)).toEqual(['uno', 'dos'])
  })

  it('sanitizes pipe characters before broadcasting the shared log source', () => {
    const content = appendPomodoroLogEntry('', entry('ticket | privado'))

    expect(content).toContain('| ticket / privado |')
    expect(content).not.toContain('| ticket | privado |')
  })
})
