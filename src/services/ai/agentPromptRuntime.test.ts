import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotiaLibrary } from '../../types/notia'
import { createLibraryEntry, readLibraryDirectory } from '../libraries/libraryRuntime'
import { readTextFile, writeTextFile } from '../files/filesystemEngine'
import { migrateLegacyAgentMemory, writeAgentMemories } from './agentPromptRuntime'

vi.mock('../libraries/libraryRuntime', () => ({
  createLibraryEntry: vi.fn(),
  readLibraryDirectory: vi.fn(),
}))

vi.mock('../files/filesystemEngine', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}))

const library: NotiaLibrary = { id: 'library-1', name: 'Test', path: '/library' }

describe('agent memory migration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(createLibraryEntry).mockResolvedValue({ ok: true })
    vi.mocked(readLibraryDirectory).mockResolvedValue([])
    vi.mocked(writeTextFile).mockResolvedValue({ ok: true })
  })

  it('migrates legacy list items to the active memory and creates a versioned backup', async () => {
    vi.mocked(readTextFile).mockImplementation(async (path) => {
      if (path.endsWith('LongTermMemory.md')) return { ok: true, content: '# Legacy\n\n- Preferir respuestas breves\n- Trabaja con Markdown' }
      if (path.endsWith('memory.md')) return { ok: true, content: '- Ya existente' }
      return { ok: false, content: '', error: 'missing' }
    })

    await expect(migrateLegacyAgentMemory(library)).resolves.toEqual({ migrated: true, memories: 2 })
    expect(createLibraryEntry).toHaveBeenCalledWith(
      expect.stringContaining('.agent/memory'),
      'LongTermMemory.legacy.v1.backup.md',
      'note',
      expect.any(Object),
    )
    expect(writeTextFile).toHaveBeenCalledWith(
      expect.stringContaining('memory.md'),
      expect.stringContaining('Preferir respuestas breves'),
      expect.any(Object),
    )
    expect(writeTextFile).toHaveBeenCalledWith(
      expect.stringContaining('LongTermMemory.legacy.v1.backup.md'),
      expect.stringContaining('Source: chat/LongTermMemory.md'),
      expect.any(Object),
    )
  })

  it('does not re-import the legacy source after a backup marks migration complete', async () => {
    vi.mocked(readTextFile).mockImplementation(async (path) => {
      if (path.endsWith('LongTermMemory.md')) return { ok: true, content: '- Legacy' }
      if (path.endsWith('LongTermMemory.legacy.v1.backup.md')) return { ok: true, content: '- Legacy' }
      return { ok: true, content: '- Active' }
    })

    await expect(migrateLegacyAgentMemory(library)).resolves.toEqual({ migrated: false, memories: 0 })
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(createLibraryEntry).not.toHaveBeenCalled()
  })

  it('clears the effective memory source when asked to persist an empty list', async () => {
    vi.mocked(readTextFile).mockResolvedValue({ ok: false, content: '', error: 'missing' })

    await writeAgentMemories(library, [])

    expect(writeTextFile).toHaveBeenCalledWith(
      expect.stringContaining('.agent/memory/memory.md'),
      expect.stringContaining('NOTIA_AGENT_MEMORY_VERSION:1'),
      expect.any(Object),
    )
    const memoryWrite = vi.mocked(writeTextFile).mock.calls.find(([path]) => path.endsWith('memory.md'))
    expect(memoryWrite?.[1]).not.toContain('Ya existente')
  })
})
