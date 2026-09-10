import { afterEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const publicationMutation = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('./taskManagerPublicationClient', () => ({ invokeTaskManagerPublicationMutation: publicationMutation }))

import {
  beginTaskManagerPublicationBatch,
  endTaskManagerPublicationBatch,
  buildTaskManagerPublicationPayload,
  withTaskManagerPublicationBatch,
} from './taskManagerPublicationRuntime'

afterEach(() => {
  invoke.mockReset()
  publicationMutation.mockReset()
  vi.unstubAllGlobals()
})

describe('buildTaskManagerPublicationPayload', () => {
  it('includes only explicitly published active board tasks', () => {
    const payload = buildTaskManagerPublicationPayload(
      [{ name: 'equipo', color: '#123', activityHoursPerDay: 24 }, { name: 'privado', color: '#456', activityHoursPerDay: 24 }],
      [{ name: 'Sprint', color: '#111', board: 'equipo' }],
      [
        { filePath: 'tasks/equipo/a.md', fileName: 'a.md', title: 'Visible', detail: '', state: 'Pendiente', startDate: '', endDate: '', dynamicEndDate: false, board: 'equipo', group: 'Sprint', priority: '', dedicatedHours: 0, estimatedHours: 0, deviationHours: 0, parentTaskName: '', order: 2, preview: '' },
        { filePath: 'tasks/privado/b.md', fileName: 'b.md', title: 'Oculta', detail: '', state: 'Pendiente', startDate: '', endDate: '', dynamicEndDate: false, board: 'privado', group: '', priority: '', dedicatedHours: 0, estimatedHours: 0, deviationHours: 0, parentTaskName: '', order: 1, preview: '' },
        { filePath: 'tasks/equipo/finished/c.md', fileName: 'c.md', title: 'Finalizada', detail: '', state: 'Finalizada', startDate: '', endDate: '', dynamicEndDate: false, board: 'equipo', group: '', priority: '', dedicatedHours: 0, estimatedHours: 0, deviationHours: 0, parentTaskName: '', order: 0, preview: '' },
      ],
      ['equipo'],
      'C:/vault',
      'light',
      '$notia-pbkdf2-sha256$test',
      { ollamaUrl: 'https://ollama.example', apiKey: 'secret', selectedModel: 'qwen3', thinkingEnabled: true, thinkingLevel: 'medium' },
      [],
      52471,
    )

    expect(payload).toEqual({
      vaultPath: 'C:/vault',
      theme: 'light',
      passwordHash: '$notia-pbkdf2-sha256$test',
      approvedDevices: [],
      maxClients: 64,
      port: 52471,
      aiPreferences: { ollamaUrl: 'https://ollama.example', apiKey: 'secret', selectedModel: 'qwen3', thinkingEnabled: true, thinkingLevel: 'medium' },
      settings: expect.objectContaining({ boards: [expect.objectContaining({ name: 'equipo' })] }),
      boards: [{ name: 'equipo', color: '#123', groups: [{ name: 'Sprint', color: '#111' }], tasks: [expect.objectContaining({ title: 'Visible' })] }],
    })
  })

  it('restores case-insensitively persisted board selections', () => {
    const payload = buildTaskManagerPublicationPayload(
      [{ name: 'Equipo', color: '#123', activityHoursPerDay: 24 }],
      [],
      [],
      ['equipo'],
      'C:/vault',
      'dark',
      '$notia-pbkdf2-sha256$test',
      { ollamaUrl: 'https://ollama.example', apiKey: '', selectedModel: 'qwen3', thinkingEnabled: true, thinkingLevel: 'medium' },
      [],
      52471,
    )

    expect(payload.boards).toHaveLength(1)
    expect(payload.settings.activeTab).toBe('Equipo')
  })
})

describe('withTaskManagerPublicationBatch', () => {
  it('acquires the remote batch semaphore in the published browser client', async () => {
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {},
      __NOTIA_PUBLISHED_TASK_MANAGER__: true,
    })

    publicationMutation.mockResolvedValue({ ok: true, changed: false })
    await expect(beginTaskManagerPublicationBatch()).resolves.toBe(true)
    expect(publicationMutation).toHaveBeenCalledWith({ command: 'begin_task_manager_publication_batch', args: {} })
    publicationMutation.mockResolvedValue({ ok: true, changed: true })
    await expect(endTaskManagerPublicationBatch()).resolves.toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('releases consecutive remote batches including a partial failure', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, __NOTIA_PUBLISHED_TASK_MANAGER__: true })
    const order: string[] = []
    let active = false
    publicationMutation.mockImplementation(async ({ command }: { command: string }) => {
      if (command === 'begin_task_manager_publication_batch') {
        expect(active).toBe(false)
        active = true
        order.push('begin')
      } else {
        expect(active).toBe(true)
        active = false
        order.push('end')
      }
      return { ok: true, changed: true }
    })
    const operation = (fail = false) => withTaskManagerPublicationBatch(async () => {
      expect(active).toBe(true)
      order.push('write')
      if (fail) throw new Error('partial')
    })
    await operation()
    await expect(operation(true)).rejects.toThrow('partial')
    await operation()
    expect(active).toBe(false)
    expect(order).toEqual(['begin', 'write', 'end', 'begin', 'write', 'end', 'begin', 'write', 'end'])
  })

  it('reconciles a failed compound host mutation before releasing its publication batch', async () => {
    const order: string[] = []
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {},
      __NOTIA_PUBLISHED_TASK_MANAGER__: false,
    })
    invoke.mockImplementation(async (command: string) => {
      order.push(command)
      if (command === 'begin_task_manager_publication_batch') return true
      if (command === 'end_task_manager_publication_batch') return null
      return null
    })

    await expect(withTaskManagerPublicationBatch(
      async () => {
        order.push('runner')
        throw new Error('partial write')
      },
      undefined,
      {
        onFailure: async () => {
          order.push('reconcile')
        },
      },
    )).rejects.toThrow('partial write')

    expect(order).toEqual([
      'begin_task_manager_publication_batch',
      'runner',
      'reconcile',
      'end_task_manager_publication_batch',
    ])
  })
})
