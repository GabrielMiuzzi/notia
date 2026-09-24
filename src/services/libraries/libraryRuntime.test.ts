import { afterEach, describe, expect, it, vi } from 'vitest'

const { callBackend } = vi.hoisted(() => ({ callBackend: vi.fn() }))

vi.mock('../transport', () => ({ callBackend }))

import { mutateLibraryEntry, openLibrary, pickLibraryDirectory, refreshLibrary } from './libraryRuntime'

afterEach(() => {
  callBackend.mockReset()
})

describe('libraryRuntime', () => {
  it('opens and refreshes a library by its id', async () => {
    callBackend.mockResolvedValueOnce({ nodes: [], lazy: true, watched: false })
    await expect(openLibrary('lib-1')).resolves.toEqual({ nodes: [], lazy: true, watched: false })
    expect(callBackend).toHaveBeenCalledWith('library_open', { payload: { libraryId: 'lib-1' } })

    callBackend.mockResolvedValueOnce({ changed: false })
    await refreshLibrary('lib-1')
    expect(callBackend).toHaveBeenLastCalledWith('library_refresh', { payload: { libraryId: 'lib-1', force: false } })
  })

  it('surfaces the backend error message', async () => {
    callBackend.mockRejectedValueOnce({ code: 'timeout', message: 'El selector de carpetas tardó demasiado.' })
    await expect(pickLibraryDirectory('lib-1')).rejects.toThrow('El selector de carpetas tardó demasiado.')
  })

  it('sends entry mutations with the paths the explorer shows', async () => {
    callBackend.mockResolvedValueOnce({ ok: true })
    await mutateLibraryEntry({ id: 'lib-1' }, {
      action: 'paste',
      sourcePath: 'C:/lib/a.md',
      targetDirectoryPath: 'C:/lib/docs',
      mode: 'move',
    })
    expect(callBackend).toHaveBeenCalledWith('library_mutate_entry', {
      payload: { libraryId: 'lib-1', action: 'paste', path: 'C:/lib/docs', sourcePath: 'C:/lib/a.md', mode: 'move' },
    })

    callBackend.mockRejectedValueOnce(new Error('La ruta está fuera de la biblioteca activa.'))
    await expect(mutateLibraryEntry({ id: 'lib-1' }, { action: 'delete', targetPath: 'D:/x.md' }))
      .resolves.toEqual({ ok: false, error: 'La ruta está fuera de la biblioteca activa.' })
  })
})
