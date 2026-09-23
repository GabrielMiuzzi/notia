import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotiaLibrary } from '../../types/notia'
import { ensureAgentPromptFile } from '../ai/agentPromptRuntime'

const { readLibraryDirectoryMock, readLibraryFileContentMock } = vi.hoisted(() => ({
  readLibraryDirectoryMock: vi.fn(),
  readLibraryFileContentMock: vi.fn(),
}))

vi.mock('../ai/agentPromptRuntime', () => ({
  ensureAgentPromptFile: vi.fn(),
  listAgentPrompts: vi.fn(),
  loadAgentPrompt: vi.fn(),
}))

vi.mock('../libraries/libraryRuntime', () => ({
  readLibraryDirectory: readLibraryDirectoryMock,
}))

vi.mock('../libraries/libraryDocumentRuntime', () => ({
  readLibraryFileContent: readLibraryFileContentMock,
  resolveLibraryDocumentLogicalPath: (libraryPath: string, targetPath: string) => {
    const prefix = `${libraryPath.replace(/[\\/]+$/, '')}/`
    return targetPath.startsWith(prefix) ? targetPath.slice(prefix.length) : undefined
  },
}))

import {
  ensureMultichatDynamicsDirectory,
  isValidMultichatMarkdownFileName,
  listMultichatDynamics,
  loadMultichatAgent,
  loadMultichatDynamic,
  stripMultichatFrontmatter,
  validateMultichatLoadedSelection,
} from './multichatLibraryRuntime'

const library: NotiaLibrary = {
  id: 'library-1',
  name: 'Test',
  path: '/library',
  androidTreeUri: 'content://provider/tree/library',
}

describe('multichatLibraryRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ensureAgentPromptFile).mockResolvedValue(undefined)
    readLibraryDirectoryMock.mockResolvedValue([])
    readLibraryFileContentMock.mockResolvedValue({ ok: true, content: 'Contenido de prueba' })
  })

  it('delegates idempotent dynamics-folder creation to the agent initializer', async () => {
    await ensureMultichatDynamicsDirectory(library)
    await ensureMultichatDynamicsDirectory(library)

    expect(ensureAgentPromptFile).toHaveBeenCalledTimes(2)
    expect(ensureAgentPromptFile).toHaveBeenCalledWith(library)
  })

  it('accepts only direct markdown file names', () => {
    expect(isValidMultichatMarkdownFileName('debate.md')).toBe(true)
    expect(isValidMultichatMarkdownFileName('../secret.md')).toBe(false)
    expect(isValidMultichatMarkdownFileName('nested/debate.md')).toBe(false)
    expect(isValidMultichatMarkdownFileName('debate.txt')).toBe(false)
  })

  it('removes frontmatter without changing the source file', () => {
    expect(stripMultichatFrontmatter('---\ntitle: Debate\n---\n\n# Turnos\n')).toBe('# Turnos')
    expect(stripMultichatFrontmatter('# Sin frontmatter')).toBe('# Sin frontmatter')
  })

  it('reads dynamics through the library document identity while listing remains filesystem-based', async () => {
    readLibraryDirectoryMock.mockResolvedValue([{ type: 'file', name: 'debate.md' }])
    readLibraryFileContentMock.mockResolvedValue({ ok: true, content: '---\ntitle: Debate\n---\n\n# Turnos' })

    await expect(listMultichatDynamics(library)).resolves.toEqual([{
      fileName: 'debate.md',
      name: 'debate',
      content: '# Turnos',
    }])

    expect(readLibraryDirectoryMock).toHaveBeenCalledWith('/library/.agent/dynamics', {
      androidDirectoryUri: library.androidTreeUri,
    })
    expect(readLibraryFileContentMock).toHaveBeenCalledWith('/library/.agent/dynamics/debate.md', {
      androidDirectoryUri: library.androidTreeUri,
      libraryId: 'library-1',
      logicalPath: '.agent/dynamics/debate.md',
    })
  })

  it('leaves document identity incomplete so the document runtime can use its filesystem fallback', async () => {
    const libraryWithoutIdentity: NotiaLibrary = { ...library, id: '' }

    await loadMultichatDynamic(libraryWithoutIdentity, 'debate.md')

    expect(readLibraryFileContentMock).toHaveBeenCalledWith('/library/.agent/dynamics/debate.md', {
      androidDirectoryUri: library.androidTreeUri,
    })
  })

  it('uses the same identity-aware read for custom agent prompts', async () => {
    await expect(loadMultichatAgent(library, 'critic.md', 1)).resolves.toMatchObject({
      fileName: 'critic.md',
      prompt: 'Contenido de prueba',
    })

    expect(readLibraryFileContentMock).toHaveBeenCalledWith('/library/.agent/promps/critic.md', {
      androidDirectoryUri: library.androidTreeUri,
      libraryId: 'library-1',
      logicalPath: '.agent/promps/critic.md',
    })
  })

  it('rejects missing or empty selections', () => {
    expect(validateMultichatLoadedSelection(null, [])).toBe('Seleccioná una dinámica válida.')
    expect(validateMultichatLoadedSelection({ fileName: 'x.md', name: 'x', content: 'x' }, [])).toContain('uno y seis')
  })

  it('accepts the one-to-six agent boundary and rejects invalid prompts', () => {
    const agent = (index: number) => ({ fileName: `agent-${index}.md`, name: `agent-${index}`, prompt: 'Prompt', icon: '●', color: '#2563eb' })
    expect(validateMultichatLoadedSelection({ fileName: 'x.md', name: 'x', content: 'Dinámica' }, [agent(1)])).toBeNull()
    expect(validateMultichatLoadedSelection({ fileName: 'x.md', name: 'x', content: 'Dinámica' }, Array.from({ length: 6 }, (_, index) => agent(index)))).toBeNull()
    expect(validateMultichatLoadedSelection({ fileName: 'x.md', name: 'x', content: 'Dinámica' }, Array.from({ length: 7 }, (_, index) => agent(index)))).toContain('uno y seis')
    expect(validateMultichatLoadedSelection({ fileName: 'x.md', name: 'x', content: 'Dinámica' }, [{ ...agent(1), prompt: ' ' }])).toContain('contenido')
  })
})
