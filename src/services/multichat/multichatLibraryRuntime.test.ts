import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotiaLibrary } from '../../types/notia'
import { ensureAgentPromptFile } from '../ai/agentPromptRuntime'
import { ensureMultichatDynamicsDirectory, isValidMultichatMarkdownFileName, stripMultichatFrontmatter, validateMultichatLoadedSelection } from './multichatLibraryRuntime'

vi.mock('../ai/agentPromptRuntime', () => ({
  ensureAgentPromptFile: vi.fn(),
  listAgentPrompts: vi.fn(),
  loadAgentPrompt: vi.fn(),
}))

const library: NotiaLibrary = { id: 'library-1', name: 'Test', path: '/library' }

describe('multichatLibraryRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ensureAgentPromptFile).mockResolvedValue('')
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
