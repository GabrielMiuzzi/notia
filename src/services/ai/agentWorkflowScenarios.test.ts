import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { runNativeToolAgent, type AiNativeToolCall } from './aiRuntime'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../utils/platform/getRuntimeDevice', () => ({ getRuntimeDevice: () => 'Windows' }))

const preferences = {
  ollamaUrl: 'https://ollama.com',
  apiKey: '',
  selectedModel: 'qwen3:test',
  thinkingEnabled: false,
  thinkingLevel: 'medium' as const,
}

function tool(name: string): { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } } {
  return { type: 'function', function: { name, description: name, parameters: {} } }
}

function call(name: string, argumentsValue: Record<string, unknown> = {}): AiNativeToolCall {
  return { function: { name, arguments: argumentsValue } }
}

async function runWorkflow(
  calls: readonly AiNativeToolCall[],
  results: Readonly<Record<string, unknown>>,
): Promise<{ answer: string; executed: string[] }> {
  const executed: string[] = []
  const responses: Array<{ message: { tool_calls?: AiNativeToolCall[]; content?: string } }> = calls.map((nextCall) => ({ message: { tool_calls: [nextCall] } }))
  responses.push({ message: { content: 'Flujo completo y verificable.' } })
  vi.mocked(invoke).mockImplementation(async () => responses.shift())

  const answer = await runNativeToolAgent(preferences, {
    systemPrompt: 'Ejecutá el flujo compuesto con evidencia.',
    prompt: 'Resolver la solicitud.',
    previousMessages: [],
    tools: calls.map((nextCall) => tool(nextCall.function.name)),
    executeTool: vi.fn(async (nextCall) => {
      executed.push(nextCall.function.name)
      return results[nextCall.function.name] ?? { ok: true, changed: false }
    }),
  })
  return { answer, executed }
}

describe('agent workflow scenarios', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('window', { setTimeout, clearTimeout })
  })

  it('AI-110.1 reads, previews, confirms, applies and verifies a document edit', async () => {
    const result = await runWorkflow([
      call('read_active_markdown_document'),
      call('propose_document_edit'),
      call('apply_document_edit', { operationId: 'op-1' }),
      call('verify_operation', { operationId: 'op-1' }),
    ], {
      propose_document_edit: { ok: true, pending: true, operationId: 'op-1' },
      apply_document_edit: { ok: true, changed: true, operationId: 'op-1' },
      verify_operation: { ok: true, verified: true, operationId: 'op-1' },
    })

    expect(result.executed).toEqual([
      'read_active_markdown_document', 'propose_document_edit', 'apply_document_edit', 'verify_operation',
    ])
    expect(result.answer).toContain('completo')
  })

  it('AI-110.2 searches public sources, plans, writes a cited note and verifies it', async () => {
    const result = await runWorkflow([
      call('search_web'),
      call('create_agent_plan', { steps: ['Comparar fuentes', 'Crear nota'] }),
      call('create_library_note', { planStepId: 'step-2' }),
      call('verify_operation', { operationId: 'op-note' }),
    ], {
      search_web: { ok: true, results: [{ title: 'Fuente pública', url: 'https://example.org' }] },
      create_agent_plan: { ok: true, approved: true },
      create_library_note: { ok: true, changed: true, operationId: 'op-note' },
      verify_operation: { ok: true, verified: true, operationId: 'op-note' },
    })

    expect(result.executed).toEqual(['search_web', 'create_agent_plan', 'create_library_note', 'verify_operation'])
  })

  it('AI-110.3 requests access before reading multiple documents and reindexes after patching', async () => {
    const result = await runWorkflow([
      call('search_library_documents'),
      call('request_file_read_permission'),
      call('read_library_documents'),
      call('apply_multi_document_patch'),
      call('reindex_changed_documents'),
    ], {
      request_file_read_permission: { ok: true, accepted: true },
      read_library_documents: { ok: true, documents: [] },
      apply_multi_document_patch: { ok: true, changed: true, operationId: 'op-multi' },
      reindex_changed_documents: { ok: true, reindexed: 2 },
    })

    expect(result.executed.indexOf('request_file_read_permission')).toBeLessThan(result.executed.indexOf('read_library_documents'))
    expect(result.executed.at(-1)).toBe('reindex_changed_documents')
  })

  it('AI-110.4 disambiguates a ticket before approving and executing its plan', async () => {
    const result = await runWorkflow([
      call('search_task_tickets'),
      call('request_user_clarification'),
      call('set_task_execution_plan', { steps: ['Actualizar ticket', 'Verificar ticket'] }),
      call('change_task_state', { planStepId: 'step-1' }),
    ], {
      request_user_clarification: { ok: true, answer: 'Ticket A' },
      set_task_execution_plan: { ok: true, approved: true },
      change_task_state: { ok: true, changed: true },
    })

    expect(result.executed).toEqual([
      'search_task_tickets', 'request_user_clarification', 'set_task_execution_plan', 'change_task_state',
    ])
  })

  it('AI-110.5 preserves the pending plan while incorporating a clarification answer', async () => {
    const result = await runWorkflow([
      call('create_agent_plan', { steps: ['Elegir documento', 'Aplicar cambio'] }),
      call('request_user_clarification'),
      call('replace_library_document', { planStepId: 'step-2' }),
    ], {
      create_agent_plan: { ok: true, approved: true },
      request_user_clarification: { ok: true, answer: 'Documento A' },
      replace_library_document: { ok: true, changed: true, operationId: 'op-2' },
    })

    expect(result.executed).toEqual(['create_agent_plan', 'request_user_clarification', 'replace_library_document'])
  })

  it('AI-110.6 stops on conflict, replans and only then retries the mutation', async () => {
    const result = await runWorkflow([
      call('read_active_markdown_document'),
      call('apply_document_patch', { operationId: 'op-conflict' }),
      call('create_agent_plan', { steps: ['Volver a leer', 'Aplicar nueva propuesta'] }),
      call('apply_document_patch', { operationId: 'op-replanned' }),
    ], {
      apply_document_patch: { ok: false, error: 'revision-conflict', retryable: true },
      create_agent_plan: { ok: true, approved: true },
    })

    expect(result.executed).toEqual([
      'read_active_markdown_document', 'apply_document_patch', 'create_agent_plan', 'apply_document_patch',
    ])
  })
})
