import { describe, expect, it } from 'vitest'
import { CANCELLED_TAB_ID, FINISHED_TAB_ID, archivedPanels } from './archivedPanels'

const task = (logical: string) => ({
  filePath: logical,
  path: `C:\\Biblioteca\\${logical}`,
})

describe('archivedPanels', () => {
  it('matches the explorer paths the backend lists, not the logical ones', () => {
    const done = task('task-mannager/finished/Hecha.md')
    const dropped = task('task-mannager/cancelled/Descartada.md')
    const open = task('task-mannager/work/Abierta.md')
    const panels = archivedPanels([done, dropped, open], {
      [FINISHED_TAB_ID]: [done.path],
      [CANCELLED_TAB_ID]: [dropped.path],
      work: [open.path],
    })

    expect(panels.finished).toEqual([done])
    expect(panels.cancelled).toEqual([dropped])
    expect(panels.isArchived(done)).toBe(true)
    expect(panels.isArchived(dropped)).toBe(true)
    expect(panels.isArchived(open)).toBe(false)
  })

  it('is empty without archived panels', () => {
    const panels = archivedPanels([task('task-mannager/work/A.md')], {})
    expect(panels.finished).toEqual([])
    expect(panels.cancelled).toEqual([])
  })
})
