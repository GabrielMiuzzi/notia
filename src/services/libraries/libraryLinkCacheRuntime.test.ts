import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createFile, createDirectory, pathExists, readTextFile, writeTextFile } = vi.hoisted(() => ({
  createFile: vi.fn(),
  createDirectory: vi.fn(),
  pathExists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}))

vi.mock('../files/filesystemEngine', () => ({
  createFile,
  createDirectory,
  pathExists,
  readTextFile,
  writeTextFile,
}))

vi.mock('../runtime/notiaLogger', () => ({
  notiaTimer: () => ({ success: vi.fn(), error: vi.fn() }),
}))

vi.mock('../runtime/performanceBaseline', () => ({
  startPerformanceMeasurement: () => ({ success: vi.fn(), error: vi.fn(), cancel: vi.fn() }),
}))

import { writeLibraryLinkCache } from './libraryLinkCacheRuntime'

describe('writeLibraryLinkCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createFile.mockResolvedValue({ ok: true })
    writeTextFile.mockResolvedValue({ ok: true })
    createDirectory.mockResolvedValue({ ok: true })
    pathExists.mockResolvedValue(false)
  })

  it('creates the complete hidden Android path before overwriting the cache', async () => {
    const treeUri = 'content://provider/tree/primary%3Asyncthing%2FWork-sync'
    const cachePath = `${treeUri}/.notia/linkCache.md`

    await expect(writeLibraryLinkCache(treeUri, 'cache', { androidDirectoryUri: treeUri }))
      .resolves.toEqual({ ok: true })

    expect(createFile).toHaveBeenCalledWith(cachePath, 'cache', {
      androidDirectoryUri: treeUri,
    })
    expect(writeTextFile).toHaveBeenCalledWith(cachePath, 'cache', {
      androidDirectoryUri: treeUri,
    })
    expect(pathExists).not.toHaveBeenCalled()
    expect(createDirectory).not.toHaveBeenCalled()
  })
})
