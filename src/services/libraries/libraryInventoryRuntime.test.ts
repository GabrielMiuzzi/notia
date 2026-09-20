import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getLibraryInventoryGeneration,
  loadLibraryInventoryFileEntries,
  syncLibraryInventoryFromFlatFiles,
} from './libraryInventoryRuntime'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('libraryInventoryRuntime', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('uploads the complete inventory in bounded batches', async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'upsert_library_inventory_batch') {
        const payload = (args as { payload: { entries: unknown[] } }).payload
        return { ok: true, entries: [], upserted: payload.entries.length, generation: 3 }
      }
      return { ok: true, entries: [], upserted: 0, generation: 3 }
    })
    const files = Array.from({ length: 501 }, (_, index) => ({
      path: `/library/${index}.md`,
      type: 'file' as const,
      name: `${index}.md`,
    }))

    const result = await syncLibraryInventoryFromFlatFiles({ libraryPath: '/library', generation: 3 }, files)

    expect(result).toMatchObject({ ok: true, upserted: 501 })
    expect(invoke).toHaveBeenCalledTimes(4)
    expect(vi.mocked(invoke).mock.calls[1]?.[1]).toMatchObject({ payload: { entries: expect.any(Array) } })
    expect((vi.mocked(invoke).mock.calls[1]?.[1] as { payload: { entries: unknown[] } }).payload.entries).toHaveLength(500)
    expect(vi.mocked(invoke).mock.calls[3]?.[0]).toBe('commit_library_inventory_snapshot')
  })

  it('commits an empty snapshot so deleted files are removed', async () => {
    vi.mocked(invoke).mockResolvedValue({ ok: true, entries: [], upserted: 0, generation: 3 })

    const result = await syncLibraryInventoryFromFlatFiles({ libraryPath: '/library', generation: 3 }, [])

    expect(result).toMatchObject({ ok: true, upserted: 0 })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      'begin_library_inventory_snapshot',
      'commit_library_inventory_snapshot',
    ])
  })

  it('does not start a snapshot after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(syncLibraryInventoryFromFlatFiles({ libraryPath: '/cancelled-library', generation: 0 }, [], controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent snapshots for the same library generation', async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'upsert_library_inventory_batch') {
        const payload = (args as { payload: { entries: unknown[] } }).payload
        return { ok: true, entries: [], upserted: payload.entries.length, generation: 4 }
      }
      return { ok: true, entries: [], upserted: 0, generation: 4 }
    })
    const context = { libraryPath: '/deduplicated-library', generation: 4 }
    const files = [{ path: '/deduplicated-library/note.md', type: 'file' as const, name: 'note.md' }]

    const [first, second] = await Promise.all([
      syncLibraryInventoryFromFlatFiles(context, files),
      syncLibraryInventoryFromFlatFiles(context, files),
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      'begin_library_inventory_snapshot',
      'upsert_library_inventory_batch',
      'commit_library_inventory_snapshot',
    ])
  })

  it('loads persistent inventory pages without exposing a full response to each call', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, generation: 0, upserted: 0, entries: Array.from({ length: 500 }, (_, index) => ({ path: `/library/${index}`, type: 'file', name: `${index}` })) })
      .mockResolvedValueOnce({ ok: true, generation: 0, upserted: 0, entries: [{ path: '/library/last', type: 'file', name: 'last' }] })

    const entries = await loadLibraryInventoryFileEntries({ libraryPath: '/library', generation: 0 })

    expect(entries).toHaveLength(501)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(getLibraryInventoryGeneration('/library')).toBe(0)
  })
})
