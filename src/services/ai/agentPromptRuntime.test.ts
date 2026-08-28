import { describe, expect, it } from 'vitest'
import {
  buildAgentPromptOptions,
  DEFAULT_AGENT_PROMPT,
  normalizeAgentPromptFileName,
  resolveAgentPromptContent,
  resolveDefaultAgentPromptPath,
  resolveAgentMemoryDirectoryPath,
  resolveAgentSkillsDirectoryPath,
  ensureDefaultAgentRules,
  resolveAgentRulesContent,
  appendAgentRuleContent,
  migrateMisclassifiedRules,
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
    expect(resolveAgentMemoryDirectoryPath('C:\\vault')).toBe('C:\\vault\\.agent\\memory')
    expect(resolveAgentSkillsDirectoryPath('C:\\vault')).toBe('C:\\vault\\.agent\\skills')
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

  it('preserves custom rules while ensuring defaults and filtering channel rules', () => {
    const content = ensureDefaultAgentRules('Regla personalizada.')
    expect(content).toContain('Regla personalizada.')
    expect(resolveAgentRulesContent(content)).not.toContain('No uses Markdown')
    expect(resolveAgentRulesContent(content, 'telegram-html')).toContain('No uses Markdown')
  })

  it('adds deduplicated rules inside NOTIA_IA_RULES', () => {
    const first = appendAgentRuleContent('', 'Cuando pregunte el estado, responde en tabla.')
    expect(first.content).toContain('<!-- NOTIA_IA_RULES_START -->\n- Cuando pregunte el estado, responde en tabla.\n<!-- NOTIA_IA_RULES_END -->')
    expect(appendAgentRuleContent(first.content, 'Cuando pregunte el estado, responde en tabla.').added).toBe(false)
  })

  it('moves personal facts out of NOTIA_IA_RULES', () => {
    const initial = appendAgentRuleContent('', 'El usuario se llama Gabriel y trabaja en un banco.')
    const migrated = migrateMisclassifiedRules(initial.content)
    expect(migrated.memories).toEqual(['El usuario se llama Gabriel y trabaja en un banco.'])
    expect(migrated.rules).not.toContain('- El usuario se llama Gabriel')
  })
})
