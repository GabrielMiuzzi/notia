import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, readTextFileMock, writeTextFileMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  readTextFileMock: vi.fn(),
  writeTextFileMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

vi.mock('../files/filesystemEngine', () => ({
  readTextFile: readTextFileMock,
  writeTextFile: writeTextFileMock,
}))

vi.mock('../runtime/notiaLogger', () => ({
  notiaTimer: () => ({ success: vi.fn(), error: vi.fn() }),
}))

import {
  getLibraryMarkdownDocumentOptions,
  readLibraryFileContent,
  resolveLibraryDocumentLogicalPath,
  writeLibraryFileContent,
} from './libraryDocumentRuntime'

describe('libraryDocumentRuntime backend routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockResolvedValue({ ok: true, content: 'backend content', revision: 'sha256:read' })
    readTextFileMock.mockResolvedValue({ ok: true, content: 'filesystem content', revision: 'sha256:old' })
    writeTextFileMock.mockResolvedValue({ ok: true })
  })

  it('routes reads with only the backend document identity', async () => {
    await expect(readLibraryFileContent('C:/private/library/note.md', {
      libraryId: 'library-1',
      logicalPath: 'notes/note.md',
      androidDirectoryUri: 'content://provider/tree/private',
      expectedRevision: 'sha256:ignored-on-read',
    })).resolves.toMatchObject({ ok: true, content: 'backend content', revision: 'sha256:read' })

    expect(invokeMock).toHaveBeenCalledWith('backend_read_library_document', {
      payload: { libraryId: 'library-1', logicalPath: 'notes/note.md' },
    })
    expect(readTextFileMock).not.toHaveBeenCalled()
    expect(JSON.stringify(invokeMock.mock.calls)).not.toContain('content://provider/tree/private')
    expect(JSON.stringify(invokeMock.mock.calls)).not.toContain('C:/private/library')
  })

  it('routes writes with content and the expected revision without roots or URIs', async () => {
    invokeMock.mockResolvedValueOnce({ ok: true })

    await expect(writeLibraryFileContent('C:/private/library/note.md', '# Updated', {
      libraryId: 'library-1',
      logicalPath: 'notes/note.md',
      androidDirectoryUri: 'content://provider/tree/private',
      expectedRevision: 'sha256:read',
    })).resolves.toEqual({ ok: true })

    expect(invokeMock).toHaveBeenCalledWith('backend_write_library_document', {
      payload: {
        libraryId: 'library-1',
        logicalPath: 'notes/note.md',
        content: '# Updated',
        expectedRevision: 'sha256:read',
      },
    })
    expect(writeTextFileMock).not.toHaveBeenCalled()
  })

  it('keeps the filesystem fallback when the backend identity is incomplete', async () => {
    await expect(readLibraryFileContent('/private/library/note.md', {
      libraryId: 'library-1',
      androidDirectoryUri: 'content://provider/tree/private',
    })).resolves.toMatchObject({ ok: true, content: 'filesystem content' })
    await expect(writeLibraryFileContent('/private/library/note.md', 'legacy', {
      logicalPath: 'notes/note.md',
      androidDirectoryUri: 'content://provider/tree/private',
    })).resolves.toEqual({ ok: true })

    expect(invokeMock).not.toHaveBeenCalled()
    expect(readTextFileMock).toHaveBeenCalledWith('/private/library/note.md', expect.objectContaining({
      androidDirectoryUri: 'content://provider/tree/private',
    }))
    expect(writeTextFileMock).toHaveBeenCalledWith('/private/library/note.md', 'legacy', expect.objectContaining({
      androidDirectoryUri: 'content://provider/tree/private',
    }))
  })

  it('derives a relative logical path and rejects roots or URIs', () => {
    expect(resolveLibraryDocumentLogicalPath('C:/private/library', 'C:/private/library/notes/note.md'))
      .toBe('notes/note.md')
    expect(resolveLibraryDocumentLogicalPath('content://provider/tree/root', 'content://provider/tree/root/notes/note.md'))
      .toBe('notes/note.md')
    expect(resolveLibraryDocumentLogicalPath('C:/private/library', 'C:/other/note.md')).toBeUndefined()
    expect(resolveLibraryDocumentLogicalPath('C:/private/library', 'content://provider/document/note')).toBeUndefined()
  })

  it('routes only safe existing Markdown identities', () => {
    const library = { id: 'library-1', name: 'Vault', path: 'C:/private/library' }

    expect(getLibraryMarkdownDocumentOptions(library, 'C:/private/library/notes/note.md')).toMatchObject({
      libraryId: 'library-1',
      logicalPath: 'notes/note.md',
    })
    expect(getLibraryMarkdownDocumentOptions(library, 'C:/private/library/notes/note.txt')).toBeUndefined()
    expect(getLibraryMarkdownDocumentOptions(library, 'C:/private/library/notes/note.markdown')).toBeUndefined()
    expect(getLibraryMarkdownDocumentOptions(library, 'C:/other/note.md')).toBeUndefined()
    expect(getLibraryMarkdownDocumentOptions(library, 'C:/private/library/../note.md')).toBeUndefined()
  })
})
