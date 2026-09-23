import { afterEach, describe, expect, it, vi } from 'vitest'

const filesystemEngine = vi.hoisted(() => ({
  createLibraryEntry: vi.fn(),
  isDirectoryPath: vi.fn(),
  pathExists: vi.fn(),
  readLibraryTree: vi.fn(),
  readMarkdownDocuments: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}))

const libraryDocumentRuntime = vi.hoisted(() => ({
  getLibraryMarkdownDocumentOptions: vi.fn((library: { id: string; path: string; androidTreeUri?: string }, targetPath: string) => {
    if (!targetPath.toLowerCase().endsWith('.md')) {
      return undefined
    }

    return {
      androidDirectoryUri: library.androidTreeUri,
      libraryId: library.id,
      logicalPath: targetPath.slice(`${library.path}/`.length),
    }
  }),
  readLibraryFileContent: vi.fn(),
  writeLibraryFileContent: vi.fn(),
}))

vi.mock('../../../services/files/filesystemEngine', () => filesystemEngine)
vi.mock('../../../services/libraries/libraryDocumentRuntime', () => libraryDocumentRuntime)
vi.mock('../../../utils/platform/getRuntimeDevice', () => ({
  getRuntimeDevice: () => 'Windows',
}))
vi.mock('../../../services/libraries/libraryTreeEvents', () => ({
  dispatchLibraryTreeChanged: vi.fn(),
}))

import {
  ensureFolderPath,
  readFileContent,
  readMarkdownFiles,
  setActiveTaskManagerVaultContext,
  writeFileContent,
} from './vaultRuntime'

afterEach(() => {
  vi.clearAllMocks()
  setActiveTaskManagerVaultContext(null)
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

  it('routes safe Markdown reads and writes through the library document runtime', async () => {
    setActiveTaskManagerVaultContext({
      path: 'C:/library',
      androidTreeUri: 'content://tree/library',
      libraryId: 'library-1',
    })
    libraryDocumentRuntime.readLibraryFileContent.mockResolvedValue({ ok: true, content: '# Before', revision: 'r1' })
    libraryDocumentRuntime.writeLibraryFileContent.mockResolvedValue({ ok: true })

    const readResult = await readFileContent('C:/library/tasks/task.md')
    const writeResult = await writeFileContent('C:/library/tasks/task.md', '# After', readResult.revision)

    expect(readResult).toMatchObject({ ok: true, revision: 'r1' })
    expect(writeResult).toEqual({ ok: true })
    expect(libraryDocumentRuntime.readLibraryFileContent).toHaveBeenCalledWith(
      'C:/library/tasks/task.md',
      {
        androidDirectoryUri: 'content://tree/library',
        libraryId: 'library-1',
        logicalPath: 'tasks/task.md',
      },
    )
    expect(libraryDocumentRuntime.writeLibraryFileContent).toHaveBeenCalledWith(
      'C:/library/tasks/task.md',
      '# After',
      {
        androidDirectoryUri: 'content://tree/library',
        libraryId: 'library-1',
        logicalPath: 'tasks/task.md',
        expectedRevision: 'r1',
      },
    )
    expect(filesystemEngine.readTextFile).not.toHaveBeenCalled()
    expect(filesystemEngine.writeTextFile).not.toHaveBeenCalled()
  })

  it('keeps identity-less published vaults on filesystem reads and writes', async () => {
    setActiveTaskManagerVaultContext({ path: 'published-vault' })
    filesystemEngine.readTextFile.mockResolvedValue({ ok: true, content: '# Published', revision: 'r1' })
    filesystemEngine.writeTextFile.mockResolvedValue({ ok: true })

    await readFileContent('published-vault/tasks/task.md')
    await writeFileContent('published-vault/tasks/task.md', '# Updated', 'r1')

    expect(filesystemEngine.readTextFile).toHaveBeenCalledWith('published-vault/tasks/task.md', { androidDirectoryUri: undefined })
    expect(filesystemEngine.writeTextFile).toHaveBeenCalledWith(
      'published-vault/tasks/task.md',
      '# Updated',
      { androidDirectoryUri: undefined, expectedRevision: 'r1' },
    )
    expect(libraryDocumentRuntime.readLibraryFileContent).not.toHaveBeenCalled()
    expect(libraryDocumentRuntime.writeLibraryFileContent).not.toHaveBeenCalled()
  })

  it('enumerates the existing tree but reads identified Markdown files through the document runtime', async () => {
    setActiveTaskManagerVaultContext({ path: 'C:/library', libraryId: 'library-1' })
    filesystemEngine.readLibraryTree.mockResolvedValue([{
      id: 'task',
      name: 'task.md',
      path: 'C:/library/tasks/task.md',
      type: 'file',
    }])
    libraryDocumentRuntime.readLibraryFileContent.mockResolvedValue({ ok: true, content: '# Task' })

    await expect(readMarkdownFiles('C:/library')).resolves.toEqual([{
      path: 'C:/library/tasks/task.md',
      content: '# Task',
    }])

    expect(filesystemEngine.readLibraryTree).toHaveBeenCalledOnce()
    expect(libraryDocumentRuntime.readLibraryFileContent).toHaveBeenCalledOnce()
    expect(filesystemEngine.readMarkdownDocuments).not.toHaveBeenCalled()
  })
})
