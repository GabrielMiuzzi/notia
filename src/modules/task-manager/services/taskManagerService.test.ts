import { describe, expect, it } from 'vitest'
import { resolveTaskManagerSnapshotChangedPaths, type TaskManagerSnapshot } from './taskManagerService'

const snapshot = (documents: Array<{ path: string; content: string }>): TaskManagerSnapshot => ({
  documents,
  tasks: [],
  pomodoroEntries: [],
})

describe('resolveTaskManagerSnapshotChangedPaths', () => {
  it('detects created, updated and deleted Markdown sources in stable order', () => {
    const previous = snapshot([
      { path: 'task-mannager/equipo/old.md', content: 'old' },
      { path: 'task-mannager/equipo/updated.md', content: 'before' },
    ])
    const next = snapshot([
      { path: 'task-mannager/equipo/created.md', content: 'new' },
      { path: 'task-mannager/equipo/updated.md', content: 'after' },
    ])

    expect(resolveTaskManagerSnapshotChangedPaths(previous, next)).toEqual([
      'task-mannager/equipo/created.md',
      'task-mannager/equipo/old.md',
      'task-mannager/equipo/updated.md',
    ])
  })

  it('does not report unchanged sources', () => {
    const unchanged = snapshot([{ path: 'task-mannager/equipo/task.md', content: '# Task' }])

    expect(resolveTaskManagerSnapshotChangedPaths(unchanged, unchanged)).toEqual([])
  })

  it('requests a full snapshot when more than the protocol hint limit changed', () => {
    const previous = snapshot([])
    const next = snapshot(Array.from({ length: 33 }, (_, index) => ({
      path: `task-mannager/equipo/task-${index}.md`,
      content: `# Task ${index}`,
    })))

    expect(resolveTaskManagerSnapshotChangedPaths(previous, next)).toEqual([])
  })
})
