import { describe, expect, it } from 'vitest'
import {
  buildAgentPromptOptions,
  DEFAULT_AGENT_PROMPT,
  normalizeAgentPromptFileName,
  resolveAgentPromptContent,
  resolveDefaultAgentPromptPath,
} from './agentPromptRuntime'

describe('agentPromptRuntime', () => {
  it('uses the bundled default when the prompt file is empty', () => {
    expect(resolveAgentPromptContent('  \n')).toBe(DEFAULT_AGENT_PROMPT)
    expect(DEFAULT_AGENT_PROMPT).toContain('# Agente IA de Notia')
    expect(DEFAULT_AGENT_PROMPT).toContain('# Principios fundamentales')
    expect(DEFAULT_AGENT_PROMPT).toContain('# Objetivo general')
  })

  it('preserves a custom library prompt', () => {
    expect(resolveAgentPromptContent('  Responde de forma concisa.  ')).toBe('Responde de forma concisa.')
  })

  it('resolves the prompt inside the requested library structure', () => {
    expect(resolveDefaultAgentPromptPath('C:\\vault')).toBe('C:\\vault\\.agent\\promps\\default.md')
  })

  it('always exposes default first and names agents after their files', () => {
    expect(buildAgentPromptOptions(['reviewer.md', 'default.md', 'notes.txt'])).toEqual([
      { fileName: 'default.md', name: 'default' },
      { fileName: 'reviewer.md', name: 'reviewer' },
    ])
  })

  it('rejects prompt paths outside the prompts directory', () => {
    expect(normalizeAgentPromptFileName('../secret.md')).toBe('default.md')
  })
})
