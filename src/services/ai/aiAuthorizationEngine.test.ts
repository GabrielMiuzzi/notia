import { describe, expect, it } from 'vitest'
import {
  authorizeToolCall,
  canAccessResource,
  filterAuthorizedTools,
  normalizeAllowedContexts,
  resourceContextFromFrontmatter,
} from './aiAuthorizationEngine'

const laboralUser = {
  libraryUserId: 'user-laboral',
  allowedContexts: ['#Laboral', '#laboral', 'Personal no valido'],
  allContexts: false,
}

describe('aiAuthorizationEngine', () => {
  it('normalizes exact context tags without prefix inheritance', () => {
    expect(normalizeAllowedContexts(['Laboral', '#laboral', '#Laboral-Privado', '#Laboral-Privado'])).toEqual(['#Laboral', '#Laboral-Privado'])
    expect(canAccessResource(laboralUser, { contextTag: '#LABORAL' })).toBe(true)
    expect(canAccessResource(laboralUser, { contextTag: '#Laboral-Privado' })).toBe(false)
  })

  it('uses Personal for absent and malformed document context', () => {
    expect(resourceContextFromFrontmatter('# no es frontmatter')).toBe('#Personal')
    expect(resourceContextFromFrontmatter('---\ntitulo: Nota\n---\n\nTexto')).toBe('#Personal')
    expect(resourceContextFromFrontmatter('---\ncontexto: "#Laboral"\n---\n\nTexto')).toBe('#Laboral')
    expect(canAccessResource(laboralUser, { contextTag: '#Personal' })).toBe(false)
  })

  it('requires Confidential for every finance tool, including public quotes', () => {
    expect(authorizeToolCall(laboralUser, 'get_finance_dollar_quotes').allowed).toBe(false)
    expect(authorizeToolCall({ ...laboralUser, allowedContexts: ['#Confidencial'] }, 'get_finance_dollar_quotes').allowed).toBe(true)
    expect(authorizeToolCall({ ...laboralUser, allowedContexts: ['#Confidencial'] }, 'create_finance_transaction').allowed).toBe(true)
    expect(authorizeToolCall({ ...laboralUser, allowedContexts: ['#Confidencial'] }, 'preview_finance_audit_proposal').allowed).toBe(true)
    expect(authorizeToolCall(laboralUser, 'apply_finance_audit_proposal').allowed).toBe(false)
  })

  it('applies the Confidential boundary to the complete finance tool catalog', () => {
    const names = [
      'get_finance_full_snapshot', 'get_finance_record', 'list_finance_records',
      'save_finance_account', 'save_finance_savings_exchange', 'save_finance_service',
      'link_finance_savings_account', 'reverse_finance_transaction', 'clear_finance_data',
      'extract_finance_document',
    ]
    const confidential = { ...laboralUser, allowedContexts: ['#Confidencial'] }
    expect(names.every((name) => authorizeToolCall(confidential, name).allowed)).toBe(true)
    expect(names.every((name) => !authorizeToolCall(laboralUser, name).allowed)).toBe(true)
  })

  it('keeps memory Owner-only and projects the published surface', () => {
    expect(authorizeToolCall(laboralUser, 'add_agent_memory').allowed).toBe(false)
    const owner = { libraryUserId: 'user-owner', allowedContexts: [], allContexts: true }
    expect(authorizeToolCall(owner, 'add_agent_memory').allowed).toBe(true)
    const tools = [{ function: { name: 'search_task_tickets' } }, { function: { name: 'get_finance_dashboard' } }]
    expect(filterAuthorizedTools(tools, owner, 'published-task-manager').map((tool) => tool.function.name)).toEqual(['search_task_tickets'])
  })
})
