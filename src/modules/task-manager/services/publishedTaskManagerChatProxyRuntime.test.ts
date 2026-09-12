import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPublishedTaskManagerChatProxy } from './publishedTaskManagerChatProxyRuntime'

describe('runPublishedTaskManagerChatProxy', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sends only the published context to the host and preserves streamed events', async () => {
    vi.stubGlobal('window', { location: { pathname: '/task-manager/session/app' } })
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      JSON.stringify({ type: 'thinking', delta: 'Leo archivos…' }),
      JSON.stringify({ type: 'plan', steps: [{ id: 'step-1', label: 'Leer', status: 'pending' }] }),
      JSON.stringify({ type: 'delta', delta: 'Respuesta ' }),
      JSON.stringify({ type: 'delta', delta: 'host.' }),
      JSON.stringify({ type: 'done', answer: 'Respuesta host.' }),
    ].join('\n')))
    vi.stubGlobal('fetch', fetchMock)
    const onThinkingDelta = vi.fn()
    const onExecutionPlanChange = vi.fn()
    const onMessageDelta = vi.fn()

    await expect(runPublishedTaskManagerChatProxy({
      taskManagerScopeKey: 'task-manager:panel:equipo',
      scopePaths: ['published-vault/task-mannager/equipo/ticket.md'],
      prompt: 'Resume el ticket',
      previousMessages: [{ role: 'user', content: 'Hola' }],
      signal: new AbortController().signal,
      onThinkingDelta,
      onExecutionPlanChange,
      onMessageDelta,
    })).resolves.toBe('Respuesta host.')

    expect(fetchMock).toHaveBeenCalledWith('/task-manager/session/ai/stream', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({
        prompt: 'Resume el ticket',
        previousMessages: [{ role: 'user', content: 'Hola' }],
        taskManagerScopeKey: 'task-manager:panel:equipo',
        scopePaths: ['published-vault/task-mannager/equipo/ticket.md'],
      }),
    }))
    expect(onThinkingDelta).toHaveBeenCalledWith('Leo archivos…')
    expect(onExecutionPlanChange).toHaveBeenCalledWith([{ id: 'step-1', label: 'Leer', status: 'pending' }])
    expect(onMessageDelta).toHaveBeenCalledWith('Respuesta ')
    expect(onMessageDelta).toHaveBeenCalledWith('host.')
  })
})
