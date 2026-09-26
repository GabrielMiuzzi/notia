import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (payload: unknown) => void
const listeners = new Map<string, Listener>()
let resolveSend: (value: unknown) => void = () => undefined

vi.mock('../transport', () => ({
  subscribeBackend: vi.fn(async (event: string, listener: Listener) => {
    listeners.set(event, listener)
    return () => listeners.delete(event)
  }),
  callBackend: vi.fn((command: string) => (
    command === 'ai_chat_send' ? new Promise((resolve) => { resolveSend = resolve }) : Promise.resolve(null)
  )),
}))

const { startChatTurn } = await import('./aiChatRuntime')

async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

describe('startChatTurn', () => {
  beforeEach(() => {
    listeners.clear()
  })

  it('follows each agent of the turn and its own run', async () => {
    const onAgentStart = vi.fn()
    const onAgentMessage = vi.fn()
    const onMessageDelta = vi.fn()
    const turn = startChatTurn(
      { libraryId: 'library', mode: 'chat', message: 'Hola', chat: { kind: 'saved', path: 'chat/chats/a.md' } },
      { onAgentStart, onAgentMessage, onMessageDelta },
    )
    await flush()
    const backendEvent = listeners.get('notia:backend-event')!
    const agentEvent = listeners.get('ai-chat-agent')!
    const delta = (requestId: string, sequence: number, text: string) =>
      backendEvent({ requestId, sequence, event: { type: 'assistant-delta', delta: text } })

    // Another turn and an agent run that has not started are ignored.
    agentEvent({ requestId: 'other', phase: 'start', runRequestId: 'other-1', agent: { fileName: 'x.md', name: 'X', initials: 'X' } })
    delta(`${turn.requestId}-1`, 1, 'antes')
    expect(onAgentStart).not.toHaveBeenCalled()
    expect(onMessageDelta).not.toHaveBeenCalled()

    const agent = { fileName: 'ana.md', name: 'Ana', initials: 'AN' }
    agentEvent({ requestId: turn.requestId, phase: 'start', runRequestId: `${turn.requestId}-1`, agent })
    expect(onAgentStart).toHaveBeenCalledWith(agent)
    delta(`${turn.requestId}-1`, 1, 'Ho')
    delta(`${turn.requestId}-1`, 1, 'Ho')
    delta(`${turn.requestId}-1`, 2, 'la')
    expect(onMessageDelta.mock.calls.map(([text]) => text)).toEqual(['Ho', 'la'])

    const message = { role: 'assistant', content: 'Hola', agent: 'ana.md' }
    agentEvent({ requestId: turn.requestId, phase: 'message', runRequestId: `${turn.requestId}-1`, message })
    expect(onAgentMessage).toHaveBeenCalledWith(message)

    resolveSend({ answer: 'Hola', dataChanged: false })
    await expect(turn.promise).resolves.toEqual({ answer: 'Hola', dataChanged: false })
  })
})
