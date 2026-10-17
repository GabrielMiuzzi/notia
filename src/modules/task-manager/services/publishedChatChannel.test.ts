import { describe, expect, it, vi } from 'vitest'
import { createPublishedChatChannel } from './publishedChatChannel'
import { createTaskManagerPublicationTransport } from './taskManagerPublicationTransport'

function stream(lines: unknown[]): Response {
  const text = lines.map((line) => JSON.stringify(line)).join('\n')
  // Split in the middle of a line, as a network delivers it.
  const middle = Math.floor(text.length / 2)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      controller.enqueue(encoder.encode(text.slice(0, middle)))
      controller.enqueue(encoder.encode(text.slice(middle)))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
}

describe('published chat channel', () => {
  it('runs a turn: delivers its events in order and resolves with its outcome', async () => {
    const fetchImpl = vi.fn(async () => stream([
      { type: 'event', name: 'notia:backend-event', payload: { requestId: 'r1', sequence: 1, event: { type: 'assistant-delta', delta: 'Ho' } } },
      { type: 'event', name: 'ai-chat-interaction', payload: { requestId: 'r1', interaction: { type: 'clarification', question: '¿Cuál?', choices: [] } } },
      { type: 'done', outcome: { answer: 'Hola', dataChanged: false } },
    ]))
    const channel = createPublishedChatChannel('/tm', fetchImpl as unknown as typeof fetch)
    const seen: string[] = []
    channel.subscribe<{ event: { type: string } }>('notia:backend-event', (payload) => seen.push(payload.event.type))
    channel.subscribe<{ interaction: { type: string } }>('ai-chat-interaction', (payload) => seen.push(payload.interaction.type))

    const outcome = await channel.call('ai_chat_send', {
      payload: {
        requestId: 'r1',
        message: '¿Qué hay pendiente?',
        chat: { kind: 'transient', messages: [{ role: 'user', content: 'Hola', attachments: [] }] },
        libraryUserId: 'otro-usuario',
      },
    })

    expect(outcome).toEqual({ answer: 'Hola', dataChanged: false })
    expect(seen).toEqual(['assistant-delta', 'clarification'])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/tm/ai/stream')
    // The server decides the user: the page only sends the conversation.
    expect(JSON.parse(String(init.body))).toEqual({
      requestId: 'r1',
      message: '¿Qué hay pendiente?',
      previousMessages: [{ role: 'user', content: 'Hola' }],
    })
  })

  it('rejects with the turn error, so the chat client reads a cancel as one', async () => {
    const fetchImpl = vi.fn(async () => stream([{ type: 'error', error: { code: 'cancelled', message: 'Cancelada', retryable: false } }]))
    const channel = createPublishedChatChannel('/tm', fetchImpl as unknown as typeof fetch)
    await expect(channel.call('ai_chat_send', { payload: { requestId: 'r2', message: 'x' } })).rejects.toEqual({
      code: 'cancelled',
      message: 'Cancelada',
      retryable: false,
    })
  })

  it('answers and cancels through their endpoints', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    const channel = createPublishedChatChannel('/tm', fetchImpl as unknown as typeof fetch)
    await channel.call('ai_chat_answer', { payload: { requestId: 'r3', answer: { type: 'clarification', answer: 'El primero' } } })
    await channel.call('ai_chat_cancel', { payload: { requestId: 'r3' } })
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls.map(([url]) => url)).toEqual(['/tm/ai/answer', '/tm/ai/cancel'])
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ requestId: 'r3', answer: { type: 'clarification', answer: 'El primero' } })
  })

  it('reports a refused answer', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"La consulta no pertenece a esta sesión."}', { status: 403 }))
    const channel = createPublishedChatChannel('/tm', fetchImpl as unknown as typeof fetch)
    await expect(channel.call('ai_chat_answer', { payload: { requestId: 'r4', answer: { type: 'clarification', answer: 'a' } } }))
      .rejects.toThrow('La consulta no pertenece a esta sesión.')
  })

  it('is what the publication transport uses for the chat', async () => {
    const fetchImpl = vi.fn(async () => stream([
      { type: 'event', name: 'ai-chat-agent', payload: { requestId: 'r5', phase: 'silent', runRequestId: 'r5' } },
      { type: 'done', outcome: { answer: 'Listo', dataChanged: true } },
    ]))
    const transport = createTaskManagerPublicationTransport('/tm', fetchImpl as unknown as typeof fetch, () => undefined)
    expect(transport.supports('ai_chat_send')).toBe(true)
    expect(transport.supports('backend_load_chat')).toBe(false)
    const phases: string[] = []
    const unsubscribe = await transport.subscribe<{ phase: string }>('ai-chat-agent', (payload) => phases.push(payload.phase))
    await expect(transport.call('ai_chat_send', { payload: { requestId: 'r5', message: 'Hola' } })).resolves.toEqual({ answer: 'Listo', dataChanged: true })
    unsubscribe()
    expect(phases).toEqual(['silent'])
  })
})
