import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import type { NotiaLibrary } from '../../types/notia'
import { appendAgentRule, loadAgentPromptSelection, loadSelectedAgentPromptFileName, writeAgentMemories } from './agentPromptRuntime'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const library: NotiaLibrary = { id: 'library-1', name: 'Test', path: '/library' }

// The workspace rules (default rules, memories, legacy migration, confidential
// context) are covered in Rust (`backend-core::agent_workspace`).
describe('agent workspace client', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    window.localStorage.clear()
  })

  it('sends the library id and the items to the backend', async () => {
    vi.mocked(invoke).mockResolvedValue(true)
    await expect(appendAgentRule(library, 'Cuando X, hacé Y')).resolves.toEqual({ added: true })
    await writeAgentMemories(library, ['Se llama Ana'])
    expect(invoke).toHaveBeenCalledWith('backend_append_agent_rule', { payload: { libraryId: 'library-1', rule: 'Cuando X, hacé Y' } })
    expect(invoke).toHaveBeenCalledWith('backend_save_agent_memories', { payload: { libraryId: 'library-1', items: ['Se llama Ana'] } })
  })

  it('moves the legacy WebView selection to the backend once', async () => {
    window.localStorage.setItem('notia:agent-prompt-selection:v1', JSON.stringify({ 'library-1': 'custom.md', other: 'x.md' }))
    vi.mocked(invoke).mockImplementation(async (command: string) => (
      command === 'backend_agent_prompts' ? { prompts: [], selected: 'custom.md' } : 'custom.md'
    ))
    await expect(loadAgentPromptSelection(library)).resolves.toEqual({ prompts: [], selected: 'custom.md' })
    expect(invoke).toHaveBeenCalledWith('backend_select_agent_prompt', { payload: { libraryId: 'library-1', fileName: 'custom.md' } })
    expect(JSON.parse(window.localStorage.getItem('notia:agent-prompt-selection:v1') ?? '{}')).toEqual({ other: 'x.md' })
  })

  it('falls back to the default prompt when the backend is unavailable', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('unavailable'))
    await expect(loadSelectedAgentPromptFileName('library-1')).resolves.toBe('default.md')
  })
})
