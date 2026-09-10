import { describe, expect, it } from 'vitest'
import { mergeTaskManagerBoards, parseTaskManagerSharedMetadata } from './taskManagerSharedMetadata'

describe('taskManagerSharedMetadata', () => {
  it('accepts versioned shared metadata and normalizes legacy boards/groups', () => {
    expect(parseTaskManagerSharedMetadata({
      version: 1,
      boards: ['equipo'],
      groups: ['Sprint'],
    })).toMatchObject({
      version: 1,
      boards: [
        { name: 'default' },
        { name: 'equipo' },
      ],
      groups: [
        { name: 'Sprint', board: 'default' },
      ],
    })
  })

  it('rejects unversioned or malformed metadata instead of applying it', () => {
    expect(parseTaskManagerSharedMetadata({ boards: [], groups: [] })).toBeNull()
    expect(parseTaskManagerSharedMetadata(null)).toBeNull()
  })

  it('preserves legacy board customization while adding discovered boards', () => {
    expect(mergeTaskManagerBoards(
      [{ name: 'default', color: '#custom', activityHoursPerDay: 12 }],
      [
        { name: 'default', color: '#generated', activityHoursPerDay: 24 },
        { name: 'equipo', color: '#new', activityHoursPerDay: 24 },
      ],
    )).toEqual([
      { name: 'default', color: '#custom', activityHoursPerDay: 12 },
      { name: 'equipo', color: '#new', activityHoursPerDay: 24 },
    ])
  })
})
