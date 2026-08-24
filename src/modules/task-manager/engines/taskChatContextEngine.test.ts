import { describe, expect, it } from 'vitest'
import { resolveTaskManagerPanelChatPaths } from './taskChatContextEngine'

const DOCUMENT_PATHS = [
  'task-mannager/default/Estado actual.md',
  'task-mannager/default/subTasks/Seguimiento.md',
  'task-mannager/otro-tablero/Plan.md',
  'task-mannager/finished/Historial sincros.md',
  'task-mannager/cancelled/Status de los chicos en las sincros.md',
  'task-mannager/taskIndex.md',
  'task-mannager/pomodoro.md',
]

describe('resolveTaskManagerPanelChatPaths', () => {
  it('limits the default panel context to active default tasks', () => {
    expect(resolveTaskManagerPanelChatPaths('default', DOCUMENT_PATHS)).toEqual([
      'task-mannager/default/Estado actual.md',
      'task-mannager/default/subTasks/Seguimiento.md',
    ])
  })

  it('only exposes cancelled tasks while the cancelled panel is active', () => {
    expect(resolveTaskManagerPanelChatPaths('__cancelled__', DOCUMENT_PATHS)).toEqual([
      'task-mannager/cancelled/Status de los chicos en las sincros.md',
    ])
  })

  it('does not expose task files from the Pomodoro panel', () => {
    expect(resolveTaskManagerPanelChatPaths('__pomodoro__', DOCUMENT_PATHS)).toEqual([])
  })
})
