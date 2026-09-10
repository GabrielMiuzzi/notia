import { afterEach, describe, expect, it, vi } from 'vitest'

const vaultRuntime = vi.hoisted(() => ({
  createMarkdownFile: vi.fn(),
  deleteEntry: vi.fn(),
  directoryExists: vi.fn(),
  ensureFolderPath: vi.fn(),
  moveEntry: vi.fn(),
  readFileContent: vi.fn(),
  readMarkdownFiles: vi.fn(),
  renameEntry: vi.fn(),
  taskManagerPathExists: vi.fn(),
  writeFileContent: vi.fn(),
}))

vi.mock('./vaultRuntime', () => vaultRuntime)

import { loadTaskManagerSnapshot, updateTaskFrontmatter } from './taskManagerService'

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
})
