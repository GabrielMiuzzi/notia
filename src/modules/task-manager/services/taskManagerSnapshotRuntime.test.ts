import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import {
  mapTaskManagerSnapshotTickets,
  parseTaskManagerSnapshotReadDto,
  parseTaskManagerSnapshotError,
  readTaskManagerSnapshot,
  TaskManagerSnapshotError,
} from './taskManagerSnapshotRuntime'

const response = {
  version: 1,
  context: { libraryId: 'library-1', libraryUserId: 'user-owner', allowedBoardIds: ['board-1'] },
  snapshot: {
    libraryId: 'library-1',
    users: ['user-owner'],
    boards: [{ libraryId: 'library-1', boardId: 'board-1', name: 'Board', color: '#2e6db0', revision: 2 }],
    groups: [],
    tickets: [{
      summary: {
        libraryId: 'library-1', ticketId: 'ticket-1', boardId: 'board-1', groupId: null,
        title: 'Ticket', state: 'Pendiente', priority: 'Media', parentTicketId: null,
        detailPreview: 'Detail', revision: 3, logicalPath: 'task-manager/tasks/ticket.md',
      },
       content: '# Ticket', tags: [], dependencies: [], checklist: [],
       startDate: '2026-09-01T08:00:00.000Z', endDate: '2026-09-02T16:30:00.000Z',
       dynamicEndDate: false, dedicatedHours: 1.25, estimatedHours: 4.5, deviationHours: 0.75,
       order: 12.5, context: '#Trabajo', relatedDocuments: ['notes/design.md'], relatedTasks: ['ticket-2'],
    }],
    comments: [],
    generation: 4,
    config: { activityHoursPerDay: { 'board-1': 24 } },
  },
  routes: [{ entityType: 'ticket', entityId: 'ticket-1', logicalPath: 'task-manager/tasks/ticket.md' }],
  revisions: [{ entityType: 'ticket', entityId: 'ticket-1', revision: 3 }],
}

beforeEach(() => invokeMock.mockReset())

describe('readTaskManagerSnapshot', () => {
  it('serializes the validated context and returns the versioned DTO', async () => {
    invokeMock.mockResolvedValue(response)

    await expect(readTaskManagerSnapshot({
      libraryId: 'library-1',
      libraryUserId: 'user-owner',
      allowedBoardIds: ['board-1'],
    })).resolves.toEqual(response)
    expect(invokeMock).toHaveBeenCalledWith('task_manager_snapshot', {
      payload: {
        libraryId: 'library-1',
        libraryUserId: 'user-owner',
        allowedBoardIds: ['board-1'],
      },
    })
  })

  it('rejects malformed or unbounded responses before a consumer sees them', () => {
    expect(() => parseTaskManagerSnapshotReadDto({ ...response, version: 2 })).toThrowError(TaskManagerSnapshotError)
    expect(() => parseTaskManagerSnapshotReadDto({ ...response, snapshot: { ...response.snapshot, tickets: [{ ...response.snapshot.tickets[0], content: 'x'.repeat(30_001) }] } })).toThrowError('tickets[0].content inválido')
  })

  it('accepts legacy Rust i64 and u64 values serialized as finite integers', () => {
    const legacy = {
      ...response,
      snapshot: {
        ...response.snapshot,
        generation: Number('18446744073709551615'),
        tickets: [{
          ...response.snapshot.tickets[0],
          summary: { ...response.snapshot.tickets[0].summary, revision: Number('18446744073709551615') },
        }],
        comments: [{
          libraryId: 'library-1', commentId: 'comment-1', ticketId: 'ticket-1', authorUserId: 'user-owner',
          body: 'Legacy', createdAtUnixMs: Number('9223372036854775807'), revision: Number('18446744073709551615'),
          logicalPath: 'task-manager/tasks/ticket.md',
        }],
      },
      revisions: [{ entityType: 'ticket', entityId: 'ticket-1', revision: Number('18446744073709551615') }],
    }

    expect(parseTaskManagerSnapshotReadDto(legacy)).toBe(legacy)
  })

  it('counts bounded strings like Rust chars instead of UTF-16 code units', () => {
    const unicodeTitle = '😀'.repeat(180)
    const unicode = {
      ...response,
      snapshot: {
        ...response.snapshot,
        tickets: [{
          ...response.snapshot.tickets[0],
          summary: { ...response.snapshot.tickets[0].summary, title: unicodeTitle },
        }],
      },
    }

    expect(parseTaskManagerSnapshotReadDto(unicode).snapshot.tickets[0].summary.title).toBe(unicodeTitle)
  })

  it('preserves structured backend errors, including retryability', () => {
    const error = parseTaskManagerSnapshotError({ code: 'conflict', message: 'El snapshot quedó obsoleto.', retryable: true, operationId: 'op-1' })
    expect(error).toBeInstanceOf(TaskManagerSnapshotError)
    expect(error).toMatchObject({ code: 'conflict', retryable: true, operationId: 'op-1' })
    expect(error.message).toBe('El snapshot quedó obsoleto.')
  })

  it('maps snapshot tickets to TaskItems without dropping ticket metadata', () => {
    const [task] = mapTaskManagerSnapshotTickets(response)

    expect(task).toMatchObject({
      id: 'ticket-1',
      filePath: 'task-manager/tasks/ticket.md',
      fileName: 'ticket',
      title: 'Ticket',
      detail: '# Ticket',
      startDate: '2026-09-01T08:00:00.000Z',
      endDate: '2026-09-02T16:30:00.000Z',
      dynamicEndDate: false,
      dedicatedHours: 1.25,
      estimatedHours: 4.5,
      deviationHours: 0.75,
      order: 12.5,
      contexto: '#Trabajo',
      relatedDocuments: ['notes/design.md'],
      relatedTasks: ['ticket-2'],
    })
  })

  it('keeps compatibility with snapshots that predate ticket metadata', () => {
    const legacy = { ...response, snapshot: { ...response.snapshot, tickets: [{
      ...response.snapshot.tickets[0],
      startDate: undefined,
      endDate: undefined,
      dynamicEndDate: undefined,
      dedicatedHours: undefined,
      estimatedHours: undefined,
      deviationHours: undefined,
      order: undefined,
      context: undefined,
      relatedDocuments: undefined,
      relatedTasks: undefined,
    }] } }
    const parsed = parseTaskManagerSnapshotReadDto(JSON.parse(JSON.stringify(legacy)))
    const [task] = mapTaskManagerSnapshotTickets(parsed)

    expect(task).toMatchObject({ startDate: '', endDate: '', dynamicEndDate: true, dedicatedHours: 0, estimatedHours: 0, deviationHours: 0, order: 999999 })
    expect(task).not.toHaveProperty('contexto')
    expect(task).not.toHaveProperty('relatedDocuments')
  })

  it('parses structured errors returned as JSON strings', () => {
    const error = parseTaskManagerSnapshotError(JSON.stringify({ code: 'unauthorized', message: 'No autorizado.', retryable: false }))
    expect(error).toMatchObject({ code: 'unauthorized', retryable: false })
    expect(error.message).toBe('No autorizado.')
  })
})
