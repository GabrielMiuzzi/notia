import { describe, expect, it } from 'vitest'
import { keepNewerLines } from './useMeetingSnapshot'
import type { MeetingLine, MeetingSnapshot } from '../../../../services/meeting/meetingTypes'

const line = (id: string): MeetingLine => ({ id, startMs: 0, endMs: 0, text: id, question: false })
const snapshot = (id: string, lines: MeetingLine[]) => ({ id, lines }) as unknown as MeetingSnapshot

describe('keepNewerLines', () => {
  it('keeps the lines that arrived while an older snapshot was being read', () => {
    const shown = snapshot('meeting-1', [line('line-1'), line('line-2'), line('line-3')])
    const read = snapshot('meeting-1', [line('line-1'), line('line-2')])
    expect(keepNewerLines(shown, read)?.lines.map((item) => item.id)).toEqual(['line-1', 'line-2', 'line-3'])
  })

  it('takes the snapshot as is when nothing is newer or the meeting changed', () => {
    const read = snapshot('meeting-1', [line('line-1')])
    expect(keepNewerLines(snapshot('meeting-1', [line('line-1')]), read)).toBe(read)
    const other = snapshot('meeting-2', [])
    expect(keepNewerLines(snapshot('meeting-1', [line('line-1')]), other)).toBe(other)
    expect(keepNewerLines(snapshot('meeting-1', [line('line-1')]), null)).toBeNull()
  })
})
