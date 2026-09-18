import { CONFIDENTIAL_CONTEXT_TAG, DEFAULT_CONTEXT_TAG, normalizeContextTag } from '../contexts/libraryContexts'
import type {
  AiAccessPrincipal,
  AiAuthorizationDecision,
  AiResourceDescriptor,
  AiToolPolicy,
  AiToolProjection,
} from '../../types/ai/globalAiContract'
import { getSafeAiAuthorizationError } from '../../types/ai/globalAiContract'

export const PUBLIC_AI_TOOL_NAMES = new Set(['search_web', 'request_user_clarification', 'request_user_confirmation'])

const TOOL_POLICIES: Record<string, AiToolPolicy> = {
  search_web: 'public',
  request_user_clarification: 'public',
  request_user_confirmation: 'public',
  get_workspace_context: 'public',
  add_agent_rule: 'memory',
  add_agent_memory: 'memory',
  search_library_documents: 'library-read',
  search_library_context: 'library-read',
  search_library_exact: 'library-read',
  get_document_metadata: 'library-read',
  find_document_references: 'library-read',
  compare_documents: 'library-read',
  extract_document_facts: 'library-read',
  read_library_documents: 'library-read',
  read_active_markdown_document: 'library-read',
  request_file_read_permission: 'library-read',
  read_all_task_tickets: 'task-read',
  search_task_tickets: 'task-read',
  search_task_context: 'task-read',
  read_task_tickets: 'task-read',
  get_task_manager_options: 'task-read',
  get_task_board_summary: 'task-read',
  set_agent_execution_plan: 'task-write',
  set_task_execution_plan: 'task-write',
  create_agent_plan: 'task-write',
  update_agent_plan: 'task-write',
  undo_ai_operation: 'library-write',
  get_finance_dashboard: 'finance-read',
  get_finance_dollar_quotes: 'finance-read',
  get_finance_inflation_indices: 'finance-read',
  get_finance_historical_dollar_quotes: 'finance-read',
  list_finance_accounts: 'finance-read',
  list_finance_categories: 'finance-read',
  list_finance_movements: 'finance-read',
  search_finance_categories: 'finance-read',
  list_finance_credit_card_statements: 'finance-read',
  list_finance_salaries: 'finance-read',
  list_finance_purchases: 'finance-read',
  list_finance_price_history: 'finance-read',
  get_finance_net_worth: 'finance-read',
  list_finance_net_worth_history: 'finance-read',
  list_finance_services: 'finance-read',
  list_finance_service_occurrences: 'finance-read',
  list_finance_service_invoices: 'finance-read',
  list_finance_audits: 'finance-read',
  preview_finance_audit_proposal: 'finance-read',
  get_finance_full_snapshot: 'finance-read',
  get_finance_record: 'finance-read',
  list_finance_records: 'finance-read',
}

const PUBLISHED_TASK_MANAGER_TOOLS = new Set([
  'get_workspace_context', 'request_user_clarification', 'read_all_task_tickets', 'search_task_tickets', 'search_task_context',
  'read_task_tickets', 'get_task_manager_options', 'get_task_board_summary', 'set_task_execution_plan',
  'create_task_ticket', 'replace_task_content', 'add_task_comment', 'add_task_subtask', 'move_task_group',
  'change_task_state', 'change_task_priority', 'update_task_fields', 'bulk_update_tasks', 'duplicate_task',
  'archive_task', 'restore_task', 'create_task_group', 'delete_task_group',
])

const TASK_READ_NAMES = new Set(['read_all_task_tickets', 'search_task_tickets', 'search_task_context', 'read_task_tickets', 'get_task_manager_options', 'get_task_board_summary'])
const TASK_WRITE_NAMES = new Set([...PUBLISHED_TASK_MANAGER_TOOLS].filter((name) => !TASK_READ_NAMES.has(name) && !name.startsWith('search_') && !name.startsWith('read_') && !name.startsWith('get_') && name !== 'request_user_clarification' && name !== 'request_file_read_permission'))
const FINANCE_READ_NAMES = new Set(Object.keys(TOOL_POLICIES).filter((name) => TOOL_POLICIES[name] === 'finance-read'))
const FINANCE_WRITE_NAMES = new Set([
  'create_finance_transaction', 'create_finance_savings_movement', 'create_finance_savings_exchange',
  'create_finance_category', 'create_finance_purchase', 'create_finance_salary',
  'create_finance_credit_card_statement', 'update_finance_transaction_status',
  'create_finance_service', 'create_finance_service_occurrence', 'create_finance_service_invoice',
  'save_finance_account', 'save_finance_category', 'save_finance_transaction',
  'save_finance_savings_reserve', 'save_finance_savings_movement', 'save_finance_savings_exchange',
  'save_finance_purchase', 'save_finance_salary', 'save_finance_credit_card_statement',
  'save_finance_installment_plan', 'save_finance_investment', 'save_finance_service',
  'save_finance_service_occurrence', 'save_finance_service_invoice', 'link_finance_savings_account',
  'set_finance_service_active', 'delete_finance_record', 'reverse_finance_transaction',
  'clear_finance_data', 'extract_finance_document',
  'audit_finance_month',
  'apply_finance_audit_proposal',
])

export function toolPolicy(toolName: string): AiToolPolicy {
  if (FINANCE_WRITE_NAMES.has(toolName)) return 'finance-write'
  if (FINANCE_READ_NAMES.has(toolName)) return 'finance-read'
  if (TASK_WRITE_NAMES.has(toolName)) return 'task-write'
  if (TASK_READ_NAMES.has(toolName)) return 'task-read'
  return TOOL_POLICIES[toolName] ?? 'library-write'
}

function normalized(value: string): string {
  return (normalizeContextTag(value) ?? value.trim()).toLocaleLowerCase()
}

export function normalizeAllowedContexts(contexts: readonly unknown[]): string[] {
  const unique = new Map<string, string>()
  for (const value of contexts) {
    const tag = normalizeContextTag(value)
    if (tag && !unique.has(tag.toLocaleLowerCase())) unique.set(tag.toLocaleLowerCase(), tag)
  }
  return [...unique.values()]
}

export function resolveResourceContext(frontmatterValue: unknown): string {
  return normalizeContextTag(frontmatterValue) ?? DEFAULT_CONTEXT_TAG
}

export function resourceContextFromFrontmatter(source: string): string {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/)
  const contextLine = match?.[1].split(/\r?\n/).find((line) => /^\s*contexto\s*:/i.test(line))
  const rawValue = contextLine?.replace(/^\s*contexto\s*:\s*/i, '').trim().replace(/^['"]|['"]$/g, '')
  return resolveResourceContext(rawValue)
}

export function principalFromUser(input: Pick<AiAccessPrincipal, 'libraryUserId' | 'roleId' | 'allowedContexts' | 'allContexts'>): AiAccessPrincipal {
  return {
    ...input,
    allowedContexts: normalizeAllowedContexts(input.allowedContexts),
  }
}

export function canAccessResource(principal: AiAccessPrincipal, resource: AiResourceDescriptor): boolean {
  if (resource.libraryId !== undefined && resource.libraryId.trim() === '') return false
  return principal.allContexts || normalizeAllowedContexts(principal.allowedContexts).some((tag) => normalized(tag) === normalized(resource.contextTag))
}

export function authorizeToolCall(
  principal: AiAccessPrincipal,
  toolName: string,
  projection: AiToolProjection = 'full',
): AiAuthorizationDecision {
  if (projection === 'published-task-manager' && !PUBLISHED_TASK_MANAGER_TOOLS.has(toolName)) {
    return { allowed: false, error: getSafeAiAuthorizationError('unauthorized-tool') }
  }
  const policy = toolPolicy(toolName)
  if (policy === 'public') return { allowed: true }
  if (policy === 'memory') {
    return principal.libraryUserId === 'user-owner'
      ? { allowed: true }
      : { allowed: false, error: getSafeAiAuthorizationError('unauthorized-tool') }
  }
  if (policy === 'finance-read' || policy === 'finance-write') {
    return canAccessResource(principal, { contextTag: CONFIDENTIAL_CONTEXT_TAG })
      ? { allowed: true }
      : { allowed: false, error: getSafeAiAuthorizationError('unauthorized-context') }
  }
  return { allowed: true }
}

export function filterAuthorizedTools<T extends { function: { name: string } }>(
  tools: readonly T[],
  principal: AiAccessPrincipal,
  projection: AiToolProjection = 'full',
): T[] {
  return tools.filter((tool) => authorizeToolCall(principal, tool.function.name, projection).allowed)
}

export function safeUnauthorizedContextResult(): { ok: false; error: ReturnType<typeof getSafeAiAuthorizationError> } {
  return { ok: false, error: getSafeAiAuthorizationError('unauthorized-context') }
}
