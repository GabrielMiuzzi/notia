import { describe, expect, it } from 'vitest'
import {
  isArchivedTaskManagerChatPath,
  isExplicitArchivedTaskManagerRequest,
  resolveTaskManagerChatScope,
  taskManagerChatBoardFromPath,
} from './taskManagerChatScopeEngine'

describe('taskManagerChatScopeEngine', () => {
  it('detects completed and cancelled task folders, including the legacy folder', () => {
    expect(isArchivedTaskManagerChatPath('task-mannager/finished/ticket.md')).toBe(true)
    expect(isArchivedTaskManagerChatPath('task-mannager/cancelled/ticket.md')).toBe(true)
    expect(isArchivedTaskManagerChatPath('task-mannager/completadas/ticket.md')).toBe(true)
    expect(isArchivedTaskManagerChatPath('task-mannager/equipo/ticket.md')).toBe(false)
  })

  it('keeps the original board available from an active task path', () => {
    expect(taskManagerChatBoardFromPath('task-mannager/equipo/ticket.md')).toBe('equipo')
    expect(taskManagerChatBoardFromPath('task-mannager/finished/ticket.md')).toBeNull()
  })

  it('recognizes explicit archive requests without changing the default scope', () => {
    expect(isExplicitArchivedTaskManagerRequest(['Que tareas estan completadas'])).toBe(true)
    expect(isExplicitArchivedTaskManagerRequest(['Que tareas tiene X'])).toBe(false)
    expect(resolveTaskManagerChatScope('Equipo', null, false)).toEqual({ board: 'equipo', includeArchived: false })
    expect(resolveTaskManagerChatScope('Equipo', 'Otro', true)).toEqual({ board: 'otro', includeArchived: true })
  })
})
