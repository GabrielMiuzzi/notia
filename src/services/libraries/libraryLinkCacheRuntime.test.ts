import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  readLibraryFileContent,
  writeLibraryFileContent,
} = vi.hoisted(() => ({
  readLibraryFileContent: vi.fn(),
  writeLibraryFileContent: vi.fn(),
}))

vi.mock('./libraryDocumentRuntime', () => ({
  readLibraryFileContent,
  writeLibraryFileContent,
}))

vi.mock('../runtime/notiaLogger', () => ({
  notiaTimer: () => ({ success: vi.fn(), error: vi.fn() }),
}))

vi.mock('../runtime/performanceBaseline', () => ({
  startPerformanceMeasurement: () => ({ success: vi.fn(), error: vi.fn(), cancel: vi.fn() }),
}))

import { readLibraryLinkCache, writeLibraryLinkCache } from './libraryLinkCacheRuntime'

describe('library link cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readLibraryFileContent.mockResolvedValue({ ok: true, content: 'backend cache' })
    writeLibraryFileContent.mockResolvedValue({ ok: true })
  })

  it('routes reads and revisioned writes through the backend by library identity', async () => {
    const libraryPath = 'C:/private/library'
    const cachePath = `${libraryPath}/.notia/linkCache.md`

    await expect(readLibraryLinkCache(libraryPath, { libraryId: 'library-1' })).resolves.toBe('backend cache')
    await expect(writeLibraryLinkCache(libraryPath, 'updated cache', {
      libraryId: 'library-1',
      expectedRevision: 'sha256:old',
    })).resolves.toEqual({ ok: true })

    expect(readLibraryFileContent).toHaveBeenCalledWith(cachePath, {
      libraryId: 'library-1',
      logicalPath: '.notia/linkCache.md',
    })
    expect(writeLibraryFileContent).toHaveBeenCalledWith(cachePath, 'updated cache', {
      libraryId: 'library-1',
      logicalPath: '.notia/linkCache.md',
      expectedRevision: 'sha256:old',
    })
  })

  it('lets the backend create the cache and hidden directory on desktop and SAF', async () => {
    const treeUri = 'content://provider/tree/primary%3Asyncthing%2FWork-sync'

    await expect(writeLibraryLinkCache(treeUri, 'cache', {
      libraryId: 'library-1',
      androidDirectoryUri: treeUri,
    })).resolves.toEqual({ ok: true })

    expect(writeLibraryFileContent).toHaveBeenCalledWith(`${treeUri}/.notia/linkCache.md`, 'cache', {
      libraryId: 'library-1',
      logicalPath: '.notia/linkCache.md',
      createIfMissing: true,
    })
  })

  it('preserves backend revision conflicts', async () => {
    const conflict = {
      kind: 'revision' as const,
      expectedRevision: 'sha256:old',
      currentRevision: 'sha256:new',
    }
    writeLibraryFileContent.mockResolvedValueOnce({
      ok: false,
      error: 'CONFLICT: el archivo cambió desde la última lectura.',
      conflict,
    })

    await expect(writeLibraryLinkCache('C:/private/library', 'updated cache', {
      libraryId: 'library-1',
      expectedRevision: 'sha256:old',
    })).resolves.toEqual({
      ok: false,
      error: 'CONFLICT: el archivo cambió desde la última lectura.',
      conflict,
    })
  })

  it('refuses to touch the filesystem without a library identity', async () => {
    await expect(readLibraryLinkCache('C:/private/library')).resolves.toBeNull()
    await expect(writeLibraryLinkCache('C:/private/library', 'legacy')).resolves.toMatchObject({ ok: false })

    expect(readLibraryFileContent).not.toHaveBeenCalled()
    expect(writeLibraryFileContent).not.toHaveBeenCalled()
  })
})
