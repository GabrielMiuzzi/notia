import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getLibraryInventoryGeneration,
  loadLibraryInventoryFileEntries,
  reindexLibrary,
} from './libraryInventoryRuntime'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('libraryInventoryRuntime', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('asks the backend to reindex by library identity without sending entries', async () => {
    vi.mocked(invoke).mockResolvedValue({ ok: true, indexed: 3, generation: 2 })

    await expect(reindexLibrary('library-1')).resolves.toMatchObject({ ok: true, indexed: 3 })

    expect(invoke).toHaveBeenCalledWith('backend_reindex_library', { payload: { libraryId: 'library-1' } })
  })

  it('shares one backend run between concurrent requests for the same library', async () => {
    let resolveRun: ((value: unknown) => void) | undefined
    vi.mocked(invoke).mockReturnValue(new Promise((resolve) => { resolveRun = resolve }))

    const first = reindexLibrary('library-1')
    const second = reindexLibrary('library-1')
    resolveRun?.({ ok: true, indexed: 0, generation: 1 })

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('stops waiting when the caller cancels', async () => {
    vi.mocked(invoke).mockReturnValue(new Promise(() => {}))
    const controller = new AbortController()

    const request = reindexLibrary('library-2', controller.signal)
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
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
