import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskManagerSettings } from '../types/taskManagerTypes'

const invoke = vi.hoisted(() => vi.fn())
const publicationMutation = vi.hoisted(() => vi.fn())
const setBatchOperation = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('./taskManagerPublicationClient', () => ({
  invokeTaskManagerPublicationMutation: publicationMutation,
  setActiveTaskManagerPublicationBatchOperation: setBatchOperation,
}))

import {
  beginTaskManagerPublicationBatch,
  endTaskManagerPublicationBatch,
  syncTaskManagerPublicationSettings,
  withTaskManagerPublicationBatch,
} from './taskManagerPublicationRuntime'

const settings = {} as TaskManagerSettings

afterEach(() => {
  invoke.mockReset()
  publicationMutation.mockReset()
  setBatchOperation.mockReset()
  vi.unstubAllGlobals()
})

describe('withTaskManagerPublicationBatch', () => {
  it('acquires the remote batch semaphore in the published browser client', async () => {
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {},
      __NOTIA_PUBLISHED_TASK_MANAGER__: true,
    })

    publicationMutation.mockResolvedValue({ ok: true, changed: false })
    await expect(beginTaskManagerPublicationBatch()).resolves.toBe(true)
    expect(publicationMutation).toHaveBeenCalledWith(
      { command: 'begin_task_manager_publication_batch', args: {} },
      expect.any(String),
    )
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

  it('keeps opening and closing batches across a long sequence of confirmed changes', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, __NOTIA_PUBLISHED_TASK_MANAGER__: true })
    publicationMutation.mockResolvedValue({ ok: true, changed: true })

    for (let index = 0; index < 100; index += 1) {
      await withTaskManagerPublicationBatch(async () => undefined)
    }

    const commands = publicationMutation.mock.calls.map((call) => call[0].command)
    expect(commands).toHaveLength(200)
    expect(commands.filter((command) => command === 'begin_task_manager_publication_batch')).toHaveLength(100)
    expect(commands.filter((command) => command === 'end_task_manager_publication_batch')).toHaveLength(100)
    expect(setBatchOperation).toHaveBeenLastCalledWith(null)
  })

  it('uses one operation id for begin, writes/settings and end of a remote batch', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, __NOTIA_PUBLISHED_TASK_MANAGER__: true })
    publicationMutation.mockResolvedValue({ ok: true, changed: true })

    await withTaskManagerPublicationBatch(async () => {
      await syncTaskManagerPublicationSettings('published-vault', settings)
    })

    const operationIds = publicationMutation.mock.calls.map((call) => call[1])
    expect(operationIds).toHaveLength(3)
    expect(new Set(operationIds).size).toBe(1)
    expect(publicationMutation.mock.calls.map((call) => call[0].command)).toEqual([
      'begin_task_manager_publication_batch',
      'update_task_manager_publication_settings',
      'end_task_manager_publication_batch',
    ])
    expect(setBatchOperation).toHaveBeenNthCalledWith(1, operationIds[0])
    expect(setBatchOperation).toHaveBeenLastCalledWith(null)
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
