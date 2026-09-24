import { afterEach, describe, expect, it, vi } from 'vitest'

const { callBackend } = vi.hoisted(() => ({ callBackend: vi.fn() }))

vi.mock('../transport', () => ({ callBackend }))

import { readLibraryDocument, writeLibraryDocument } from './libraryDocumentRuntime'

afterEach(() => {
  callBackend.mockReset()
})

describe('libraryDocumentRuntime', () => {
  it('reads by library and path and only asks for note defaults when opening in the editor', async () => {
    callBackend.mockResolvedValue({ ok: true, content: '# a', revision: 'r1', logicalPath: 'a.md' })
    await readLibraryDocument('lib-1', 'C:/lib/a.md')
    expect(callBackend).toHaveBeenLastCalledWith('library_read_document', { payload: { libraryId: 'lib-1', path: 'C:/lib/a.md' } })

    await readLibraryDocument('lib-1', 'C:/lib/a.md', { markdownDefaults: true })
    expect(callBackend).toHaveBeenLastCalledWith('library_read_document', {
      payload: { libraryId: 'lib-1', path: 'C:/lib/a.md', markdownDefaults: true },
    })
  })

  it('writes against the loaded revision', async () => {
    callBackend.mockResolvedValue({ ok: true, revision: 'r2' })
    await writeLibraryDocument('lib-1', 'C:/lib/a.md', 'b', { expectedRevision: 'r1' })
    expect(callBackend).toHaveBeenLastCalledWith('library_write_document', {
      payload: { libraryId: 'lib-1', path: 'C:/lib/a.md', content: 'b', expectedRevision: 'r1' },
    })
  })

  it('reports a failed call as a failed read', async () => {
    callBackend.mockRejectedValue(new Error('boom'))
    await expect(readLibraryDocument('lib-1', 'a.md')).resolves.toEqual({
      ok: false,
      content: '',
      error: 'No se pudo leer el archivo.',
    })
  })
})
