import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import type { TaskManagerAgentMutation } from './taskManagerAgentMutationService'
import {
  executeTaskManagerRustMutation,
  mapTaskManagerAgentMutationToRequest,
  validateTaskManagerMutationReceipt,
} from './taskManagerRustMutationAdapter'
import type { TaskManagerSnapshotReadDto } from './taskManagerSnapshotRuntime'

const snapshot: TaskManagerSnapshotReadDto = {
  version: 1,
  context: { libraryId: 'library-1', libraryUserId: 'user-owner' },
  snapshot: {
    libraryId: 'library-1',
    users: ['user-owner'],
    boards: [{ libraryId: 'library-1', boardId: 'board-1', name: 'Producto', color: '#123456', revision: 2 }],
    groups: [{ libraryId: 'library-1', groupId: 'group-1', boardId: 'board-1', name: 'Backlog', color: '#abcdef', revision: 3 }],
    tickets: [
      {
        summary: {
          libraryId: 'library-1', ticketId: 'ticket-1', boardId: 'board-1', groupId: 'group-1', title: 'Principal',
          state: 'Pendiente', priority: 'Media', parentTicketId: null, detailPreview: 'detail', revision: 4,
          logicalPath: 'task-manager/tasks/producto/principal.md',
        },
        content: 'detail', tags: [], dependencies: [], checklist: [],
      },
      {
        summary: {
          libraryId: 'library-1', ticketId: 'ticket-2', boardId: 'board-1', groupId: 'group-1', title: 'Otro',
          state: 'En progreso', priority: 'Alta', parentTicketId: null, detailPreview: 'detail', revision: 5,
          logicalPath: 'task-manager/tasks/producto/otro.md',
        },
        content: 'detail', tags: [], dependencies: [], checklist: [],
      },
    ],
    comments: [],
    generation: 7,
    config: { activityHoursPerDay: { 'board-1': 24 } },
  },
  routes: [
    { entityType: 'ticket', entityId: 'ticket-1', logicalPath: 'task-manager/tasks/producto/principal.md' },
    { entityType: 'ticket', entityId: 'ticket-2', logicalPath: 'task-manager/tasks/producto/otro.md' },
  ],
  revisions: [],
}

const context = {
  libraryId: 'library-1',
  libraryUserId: 'user-owner',
  allowedBoardNames: ['Producto'],
}

const ids = { operationId: 'operation-1', now: () => 1_700_000_000_000 }

function map(mutation: TaskManagerAgentMutation) {
  return mapTaskManagerAgentMutationToRequest(mutation, snapshot, context, ids)
}

beforeEach(() => invokeMock.mockReset())

describe('mapTaskManagerAgentMutationToRequest', () => {
  it('maps every agent mutation to backend IDs and preserves board authorization', () => {
    const cases: Array<[TaskManagerAgentMutation, string]> = [
      [{ kind: 'create', board: 'Producto', title: 'Nueva', content: 'body', group: 'Backlog', priority: 'Alta', state: 'Pendiente' }, 'create-ticket'],
      [{ kind: 'replace-content', taskPath: 'principal.md', content: 'new' }, 'replace-ticket-content'],
      [{ kind: 'add-comment', taskPath: 'principal.md', comment: 'comment' }, 'add-comment'],
      [{ kind: 'add-subtask', taskPath: 'principal.md', title: 'Child', content: 'body', priority: 'Media' }, 'add-subtask'],
      [{ kind: 'move-group', taskPath: 'principal.md', group: 'Backlog' }, 'move-ticket'],
      [{ kind: 'change-state', taskPath: 'principal.md', state: 'Finalizada' }, 'change-state'],
      [{ kind: 'change-priority', taskPath: 'principal.md', priority: 'Urgente' }, 'change-priority'],
      [{ kind: 'update-fields', taskPath: 'principal.md', fields: { tarea: 'Renamed', estado: 'Bloqueada', equipo: 'Backlog', tags: ['one'] } }, 'update-ticket'],
      [{ kind: 'bulk-update', taskPaths: ['principal.md', 'otro.md'], fields: { prioridad: 'Alta' } }, 'bulk-update'],
      [{ kind: 'duplicate', taskPath: 'principal.md', title: 'Copy' }, 'duplicate-ticket'],
      [{ kind: 'archive', taskPath: 'principal.md' }, 'archive-ticket'],
      [{ kind: 'restore', taskPath: 'principal.md' }, 'restore-ticket'],
      [{ kind: 'delete', taskPath: 'principal.md' }, 'delete-ticket'],
      [{ kind: 'create-group', board: 'Producto', name: 'Doing', color: '#abcdef' }, 'create-group'],
      [{ kind: 'delete-group', board: 'Producto', name: 'Backlog' }, 'delete-group'],
      [{ kind: 'create-board', name: 'Nuevo', color: '#123456', contexto: '#Personal', activityHoursPerDay: 24 }, 'create-board'],
      [{ kind: 'update-board', previousName: 'Producto', name: 'Producto', color: '#654321', contexto: '#Personal', activityHoursPerDay: 24 }, 'update-board'],
      [{ kind: 'delete-board', board: 'Producto' }, 'delete-board'],
      [{ kind: 'update-group', board: 'Producto', previousBoard: 'Producto', previousName: 'Backlog', name: 'Doing', color: '#abcdef' }, 'update-group'],
      [{ kind: 'reorder-groups', board: 'Producto', groupNames: ['Backlog'] }, 'reorder-groups'],
    ]

    for (const [mutation, kind] of cases) {
      const request = map(mutation)
      expect(request.mutation.kind).toBe(kind)
      expect(request.context.allowedBoardIds).toEqual(['board-1'])
      expect(request.operationId).toBe('operation-1')
      expect(request.idempotencyKey).toBe('task-manager:operation-1')
    }
    expect(map({ kind: 'replace-content', taskPath: 'principal.md', content: 'new' }).mutation).toMatchObject({ ticketId: 'ticket-1' })
    expect(map({ kind: 'add-comment', taskPath: 'principal.md', comment: 'comment' }).mutation).toMatchObject({ commentId: 'operation-1:comment', createdAtUnixMs: 1_700_000_000_000 })
    expect(map({ kind: 'create', board: 'Producto', title: 'Nueva', content: 'body', group: 'Backlog', priority: 'Alta', state: 'Pendiente' }).mutation).toMatchObject({ boardId: 'board-1', groupId: 'group-1', ticketId: 'operation-1:ticket' })
    expect(map({ kind: 'update-fields', taskPath: 'principal.md', fields: { estimacion: 4, order: 2, parent: 'Otro' } }).mutation).toMatchObject({
      fields: { estimatedHours: 4, order: 2, parentTicketId: 'ticket-2' },
    })
  })

  it('rejects unknown routes and unauthorized boards before invoking Rust', () => {
    expect(() => map({ kind: 'archive', taskPath: 'missing.md' })).toThrow('no existe')
    expect(() => mapTaskManagerAgentMutationToRequest(
      { kind: 'create', board: 'Otro', title: 'Nueva', content: '', group: '', priority: 'Media', state: 'Pendiente' },
      snapshot,
      { ...context, allowedBoardNames: ['Otro'] },
      ids,
    )).toThrow('Ninguno de los tableros autorizados')
  })
})

describe('executeTaskManagerRustMutation', () => {
  it('runs snapshot, preview and confirmed apply, then validates the receipt', async () => {
    invokeMock
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({
        libraryId: 'library-1', libraryUserId: 'user-owner', operationId: 'operation-1', idempotencyKey: 'task-manager:operation-1',
        mutation: { kind: 'archive-ticket', ticketId: 'ticket-1' }, allowedActions: ['apply-all', 'reject', 'cancel'],
      })
      .mockResolvedValueOnce({
        libraryId: 'library-1', libraryUserId: 'user-owner', operationId: 'operation-1', idempotencyKey: 'task-manager:operation-1',
        changed: true, affectedIds: ['ticket-1'], revisions: [], replayed: false,
      })

    await expect(executeTaskManagerRustMutation({ kind: 'archive', taskPath: 'principal.md' }, context, ids)).resolves.toMatchObject({
      operationId: 'operation-1', affectedIds: ['ticket-1'],
    })
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'task_manager_snapshot', { payload: { libraryId: 'library-1', libraryUserId: 'user-owner' } })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'task_manager_preview_mutation', expect.objectContaining({ request: expect.objectContaining({ operationId: 'operation-1' }) }))
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'task_manager_apply_mutation', { request: expect.objectContaining({ confirmed: true, operationId: 'operation-1' }) })
  })

  it('does not hide backend preview errors or apply after a failed preview', async () => {
    invokeMock.mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error('backend-conflict'))

    await expect(executeTaskManagerRustMutation({ kind: 'archive', taskPath: 'principal.md' }, context, ids)).rejects.toThrow('backend-conflict')
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a receipt that belongs to another operation', () => {
    const request = map({ kind: 'archive', taskPath: 'principal.md' })
    expect(() => validateTaskManagerMutationReceipt({
      libraryId: 'library-1', libraryUserId: 'user-owner', operationId: 'other', idempotencyKey: request.idempotencyKey,
      changed: true, affectedIds: [], revisions: [], replayed: false,
    }, request)).toThrow('receipt')
  })

  it('accepts legacy Rust u64 revisions in a valid receipt', () => {
    const request = map({ kind: 'move-group', taskPath: 'principal.md', group: 'Backlog' })
    expect(validateTaskManagerMutationReceipt({
      libraryId: 'library-1', libraryUserId: 'user-owner', operationId: request.operationId, idempotencyKey: request.idempotencyKey,
      changed: true, affectedIds: ['ticket-1'],
      revisions: [{ entityType: 'ticket', entityId: 'ticket-1', revision: Number('18446744073709551615') }],
      replayed: false,
    }, request).changed).toBe(true)
  })
})
