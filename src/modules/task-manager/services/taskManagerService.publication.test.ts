import { afterEach, describe, expect, it, vi } from 'vitest'

const vaultRuntime = vi.hoisted(() => ({
  createMarkdownFile: vi.fn(),
  deleteEntry: vi.fn(),
  directoryExists: vi.fn(),
  ensureFolderPath: vi.fn(),
  getActiveTaskManagerVaultContext: vi.fn(() => null),
  moveEntry: vi.fn(),
  readFileContent: vi.fn(),
  readMarkdownFiles: vi.fn(),
  renameEntry: vi.fn(),
  taskManagerPathExists: vi.fn(),
  writeFileContent: vi.fn(),
}))
const snapshotRuntime = vi.hoisted(() => ({
  mapTaskManagerSnapshotTickets: vi.fn(),
  readTaskManagerSnapshot: vi.fn(),
}))

vi.mock('./vaultRuntime', () => vaultRuntime)
vi.mock('./taskManagerSnapshotRuntime', () => snapshotRuntime)

import { createTask, loadTaskManagerSnapshot, resolveTaskManagerRuntimePath, updateTaskFrontmatter } from './taskManagerService'

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('published Task Manager filesystem flow', () => {
  it('updates ticket frontmatter from the confirmed snapshot without an HTTP read per ticket', async () => {
    vi.stubGlobal('window', {
      __NOTIA_PUBLISHED_TASK_MANAGER__: true,
      __NOTIA_PUBLISHED_TASK_ROOT_AT_VAULT__: false,
      __NOTIA_PUBLISHED_TASK_ROOT_FOLDER__: 'task-mannager',
    })
    vaultRuntime.writeFileContent.mockResolvedValue({ ok: true })
    const baseContent = '---\ntablero: default\nequipo: Pendiente\norder: 10\n---\n\nDetalle\n'

    await updateTaskFrontmatter(
      'published-vault',
      'task-mannager/default/ticket.md',
      { equipo: 'En curso', order: 20 },
      { baseContent },
    )

    expect(vaultRuntime.readFileContent).not.toHaveBeenCalled()
    expect(vaultRuntime.writeFileContent).toHaveBeenCalledOnce()
    const [path, content, expectedRevision] = vaultRuntime.writeFileContent.mock.calls[0] ?? []
    expect(path).toBe('published-vault/task-mannager/default/ticket.md')
    expect(content).toContain('equipo: "En curso"')
    expect(content).toContain('order: 20')
    expect(expectedRevision).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('propagates a snapshot read failure instead of replacing all tickets with an empty snapshot', async () => {
    vi.stubGlobal('window', {
      __NOTIA_PUBLISHED_TASK_MANAGER__: true,
      __NOTIA_PUBLISHED_TASK_ROOT_AT_VAULT__: false,
      __NOTIA_PUBLISHED_TASK_ROOT_FOLDER__: 'task-mannager',
    })
    vaultRuntime.readMarkdownFiles.mockRejectedValue(new Error('429 Too Many Requests'))

    await expect(loadTaskManagerSnapshot('published-vault')).rejects.toThrow('429 Too Many Requests')
  })

  it('loads an identified published snapshot through the backend command', async () => {
    vi.stubGlobal('window', { __NOTIA_PUBLISHED_TASK_MANAGER__: true })
    vaultRuntime.getActiveTaskManagerVaultContext.mockReturnValue({
      path: 'published-vault',
      libraryId: 'library-1',
      libraryUserId: 'user-1',
    } as never)
    snapshotRuntime.readTaskManagerSnapshot.mockResolvedValue({
      snapshot: { tickets: [{ summary: { logicalPath: 'task.md' }, content: '# Task' }] },
    })
    snapshotRuntime.mapTaskManagerSnapshotTickets.mockReturnValue([{ id: 'ticket-1' }])

    await expect(loadTaskManagerSnapshot('published-vault')).resolves.toEqual({
      documents: [{ path: 'task.md', content: '# Task' }],
      tasks: [{ id: 'ticket-1' }],
      pomodoroEntries: [],
    })
    expect(snapshotRuntime.readTaskManagerSnapshot).toHaveBeenCalledWith({
      libraryId: 'library-1',
      libraryUserId: 'user-1',
    })
    expect(vaultRuntime.readMarkdownFiles).not.toHaveBeenCalled()
  })

  it('resolves the published task path through the opaque vault alias', async () => {
    vi.stubGlobal('window', {
      __NOTIA_PUBLISHED_TASK_MANAGER__: true,
      __NOTIA_PUBLISHED_TASK_ROOT_AT_VAULT__: false,
      __NOTIA_PUBLISHED_TASK_ROOT_FOLDER__: 'task-mannager',
    })

    await expect(resolveTaskManagerRuntimePath(
      'published-vault',
      'task-mannager/default/ticket.md',
    )).resolves.toBe('published-vault/task-mannager/default/ticket.md')
  })

  it('rejects a stale published parent before creating a potentially orphaned file', async () => {
    vi.stubGlobal('window', {
      __NOTIA_PUBLISHED_TASK_MANAGER__: true,
      __NOTIA_PUBLISHED_TASK_ROOT_AT_VAULT__: false,
      __NOTIA_PUBLISHED_TASK_ROOT_FOLDER__: 'task-mannager',
    })

    await expect(createTask('published-vault', {
      title: 'Seguimiento',
      detail: '',
      state: 'Pendiente',
      endDate: '',
      dynamicEndDate: true,
      board: 'equipo',
      group: 'Pendiente',
      priority: 'Media',
      estimatedHours: 0,
      parentTaskName: 'padre-desactualizado',
    }, [])).rejects.toThrow('La tarea padre ya no está disponible')

    expect(vaultRuntime.createMarkdownFile).not.toHaveBeenCalled()
    expect(vaultRuntime.writeFileContent).not.toHaveBeenCalled()
  })
})
