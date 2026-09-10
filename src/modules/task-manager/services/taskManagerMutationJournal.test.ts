import { describe, expect, it } from 'vitest'
import {
  normalizeTaskManagerMutationJournal,
  TASK_MANAGER_MUTATION_JOURNAL_VERSION,
} from './taskManagerMutationJournal'

describe('task manager mutation journal', () => {
  it('normalizes unknown or malformed persisted data to an empty journal', () => {
    expect(normalizeTaskManagerMutationJournal(null)).toEqual({
      version: TASK_MANAGER_MUTATION_JOURNAL_VERSION,
      entries: [],
    })
    expect(normalizeTaskManagerMutationJournal({ version: 99, entries: [] })).toEqual({
      version: TASK_MANAGER_MUTATION_JOURNAL_VERSION,
      entries: [],
    })
  })

  it('keeps only bounded valid operation records and statuses', () => {
    expect(normalizeTaskManagerMutationJournal({
      version: TASK_MANAGER_MUTATION_JOURNAL_VERSION,
      entries: [
        {
          operationId: 'op-1',
          status: 'pending',
          scopes: ['task-manager', 'task-manager'],
          startedAt: 10,
          updatedAt: 11,
        },
        {
          operationId: 'invalid',
          status: 'unknown',
          scopes: [],
          startedAt: 10,
          updatedAt: 11,
        },
      ],
    })).toEqual({
      version: TASK_MANAGER_MUTATION_JOURNAL_VERSION,
      entries: [{
        operationId: 'op-1',
        status: 'pending',
        scopes: ['task-manager'],
        startedAt: 10,
        updatedAt: 11,
      }],
    })
  })

  it('normalizes a bounded logical recovery manifest without accepting absolute paths', () => {
    expect(normalizeTaskManagerMutationJournal({
      version: TASK_MANAGER_MUTATION_JOURNAL_VERSION,
      entries: [{
        operationId: 'op-2',
        status: 'pending',
        scopes: ['task-manager'],
        changedPaths: [
          'task-mannager/equipo/demo.md',
          'task-mannager\\equipo\\demo.md',
          'C:/Users/secret.md',
          '/Users/secret.md',
          '',
        ],
        startedAt: 10,
        updatedAt: 11,
      }],
    })).toEqual({
      version: TASK_MANAGER_MUTATION_JOURNAL_VERSION,
      entries: [{
        operationId: 'op-2',
        status: 'pending',
        scopes: ['task-manager'],
        changedPaths: ['task-mannager/equipo/demo.md'],
        startedAt: 10,
        updatedAt: 11,
      }],
    })
  })
})
