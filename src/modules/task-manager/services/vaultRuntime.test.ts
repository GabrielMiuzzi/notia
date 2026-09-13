import { afterEach, describe, expect, it, vi } from 'vitest'

const filesystemEngine = vi.hoisted(() => ({
  createLibraryEntry: vi.fn(),
  isDirectoryPath: vi.fn(),
  pathExists: vi.fn(),
}))

vi.mock('../../../services/files/filesystemEngine', () => filesystemEngine)
vi.mock('../../../services/libraries/libraryTreeEvents', () => ({
  dispatchLibraryTreeChanged: vi.fn(),
}))

import { ensureFolderPath } from './vaultRuntime'

afterEach(() => {
  vi.clearAllMocks()
})

describe('ensureFolderPath', () => {
  it('does not recreate existing directories in the published filesystem', async () => {
    filesystemEngine.pathExists.mockResolvedValue(true)
    filesystemEngine.isDirectoryPath.mockResolvedValue(true)

    await ensureFolderPath('published-vault', 'task-mannager/equipo')

    expect(filesystemEngine.createLibraryEntry).not.toHaveBeenCalled()
  })

  it('creates only the missing part of a workspace path', async () => {
    filesystemEngine.pathExists.mockImplementation(async (path: string) => path !== 'published-vault/equipo/subtasks')
    filesystemEngine.isDirectoryPath.mockResolvedValue(true)
    filesystemEngine.createLibraryEntry.mockResolvedValue({ ok: true })

    await ensureFolderPath('published-vault', 'equipo/subtasks')

    expect(filesystemEngine.createLibraryEntry).toHaveBeenCalledOnce()
    expect(filesystemEngine.createLibraryEntry).toHaveBeenCalledWith(
      'published-vault/equipo',
      'subtasks',
      'folder',
      { androidDirectoryUri: undefined },
    )
  })
})
