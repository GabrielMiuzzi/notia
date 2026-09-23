import { afterEach, describe, expect, it, vi } from 'vitest'

const { invoke, pickDirectory } = vi.hoisted(() => ({
  invoke: vi.fn(),
  pickDirectory: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

vi.mock('../files/filesystemEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../files/filesystemEngine')>()),
  pickDirectory,
}))

vi.mock('../../utils/platform/getRuntimeDevice', () => ({
  getRuntimeDevice: () => 'Android',
}))

import { pickLibraryDirectory, registerLibraryBinding } from './libraryRuntime'

describe('pickLibraryDirectory', () => {
  afterEach(() => {
    vi.useRealTimers()
    pickDirectory.mockReset()
    invoke.mockReset()
  })

  it('does not leave the Android picker pending forever', async () => {
    vi.useFakeTimers()
    pickDirectory.mockReturnValue(new Promise(() => undefined))

    const pendingSelection = pickLibraryDirectory()
    const rejection = expect(pendingSelection).rejects.toThrow(
      'El selector de carpetas tardó demasiado. Intenta nuevamente.',
    )
    await vi.advanceTimersByTimeAsync(60_000)

    await rejection
  })

  it('rejects a picker response without a tree grant', async () => {
    pickDirectory.mockResolvedValue({
      path: 'content://provider/tree/root',
    })

    await expect(pickLibraryDirectory()).rejects.toThrow('URI SAF valida')
  })

  it('preserves one consistent tree URI in the selected library', async () => {
    const treeUri = 'content://provider/tree/root'
    pickDirectory.mockResolvedValue({ path: treeUri, uri: treeUri })

    await expect(pickLibraryDirectory()).resolves.toMatchObject({
      path: treeUri,
      androidTreeUri: treeUri,
    })
  })

  it('forwards the library identity to the native picker registration flow', async () => {
    const treeUri = 'content://provider/tree/root'
    pickDirectory.mockResolvedValue({ path: treeUri, uri: treeUri })

    await pickLibraryDirectory('library-one')

    expect(pickDirectory).toHaveBeenCalledWith('Seleccionar libreria', 'library-one')
  })

  it('uses the decoded Android folder name for the library title', async () => {
    const treeUri = 'content://provider/tree/primary%3Asyncthing%2FWork-sync'
    pickDirectory.mockResolvedValue({ path: treeUri, uri: treeUri })

    await expect(pickLibraryDirectory()).resolves.toMatchObject({
      name: 'Work-sync',
    })
  })

  it('rejects a path and URI that identify different grants', async () => {
    pickDirectory.mockResolvedValue({
      path: 'content://provider/tree/other',
      uri: 'content://provider/tree/root',
    })

    await expect(pickLibraryDirectory()).rejects.toThrow('URI SAF valida')
  })

  it('rehydrates a persisted desktop binding by library identity', async () => {
    await registerLibraryBinding({
      id: 'library-one',
      name: 'Notas',
      path: 'C:/Libraries/Notas',
    })

    expect(invoke).toHaveBeenCalledWith('register_library_binding', {
      payload: {
        libraryId: 'library-one',
        libraryPath: 'C:/Libraries/Notas',
      },
    })
  })
})
