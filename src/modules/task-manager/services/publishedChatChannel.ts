import type { Unsubscribe } from '../../../services/transport'

/*
 * The chat of a published Task Manager. The page runs the same chat client
 * as the app (`startChatTurn`), and its three commands go to the
 * publication server: `/ai/stream` runs the turn in Rust and streams, line
 * by line, the events the app's window would receive; `/ai/answer` and
 * `/ai/cancel` answer or stop it. The server decides the user, the boards
 * and the tools; nothing is saved.
 */

export const PUBLISHED_CHAT_COMMANDS: ReadonlySet<string> = new Set(['ai_chat_send', 'ai_chat_answer', 'ai_chat_cancel'])

interface StreamLine {
  type?: unknown
  name?: unknown
  payload?: unknown
  outcome?: unknown
  error?: unknown
  message?: unknown
}

interface TurnPayload {
  requestId?: unknown
  message?: unknown
  chat?: { kind?: unknown; messages?: unknown }
  answer?: unknown
}

export interface PublishedChatChannel {
  call<T>(command: string, args: Record<string, unknown>): Promise<T>
  subscribe<T>(event: string, handler: (payload: T) => void): Unsubscribe
}

/** The error a line or a reply carries, as the chat client reads it. */
function lineError(line: StreamLine): unknown {
  if (line.error && typeof line.error === 'object') return line.error
  return new Error(typeof line.message === 'string' ? line.message : 'No se pudo completar el chat de IA.')
}

async function replyError(response: Response, fallback: string): Promise<Error> {
  const body: unknown = await response.json().catch(() => null)
  const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : fallback
  return new Error(message)
}

export function createPublishedChatChannel(
  publicationPath: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): PublishedChatChannel {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const emit = (name: string, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload))

  const post = (route: string, body: unknown) => fetchImpl(`${publicationPath}${route}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify(body),
  })

  const send = async (payload: TurnPayload): Promise<unknown> => {
    const messages = Array.isArray(payload.chat?.messages) ? payload.chat.messages : []
    const response = await post('/ai/stream', {
      requestId: payload.requestId,
      message: payload.message,
      previousMessages: messages.map((message: { role?: unknown; content?: unknown }) => ({ role: message.role, content: message.content })),
    })
    if (!response.ok || !response.body) throw await replyError(response, 'No se pudo contactar al chat publicado.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    let outcome: unknown = undefined
    let failure: unknown = undefined
    const read = (text: string) => {
      if (!text.trim()) return
      const line = JSON.parse(text) as StreamLine
      if (line.type === 'event' && typeof line.name === 'string') emit(line.name, line.payload)
      else if (line.type === 'done') outcome = line.outcome
      else if (line.type === 'error') failure = lineError(line)
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        pending += decoder.decode(value, { stream: !done })
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        lines.forEach(read)
        if (done) break
      }
      read(pending)
    } finally {
      reader.releaseLock()
    }
    if (failure !== undefined) throw failure
    if (outcome === undefined) throw new Error('El chat publicado se cortó antes de responder.')
    return outcome
  }

  const control = async (route: string, body: unknown, fallback: string) => {
    const response = await post(route, body)
    if (!response.ok) throw await replyError(response, fallback)
    return null
  }

  return {
    async call<T>(command: string, args: Record<string, unknown>): Promise<T> {
      const payload = (args.payload ?? {}) as TurnPayload
      if (command === 'ai_chat_send') return send(payload) as Promise<T>
      if (command === 'ai_chat_answer') {
        return control('/ai/answer', { requestId: payload.requestId, answer: payload.answer }, 'No se pudo responder la consulta.') as Promise<T>
      }
      if (command === 'ai_chat_cancel') {
        return control('/ai/cancel', { requestId: payload.requestId }, 'No se pudo cancelar la consulta.') as Promise<T>
      }
      throw new Error(`El chat publicado no ofrece ${command}.`)
    },
    subscribe<T>(event: string, handler: (payload: T) => void): Unsubscribe {
      const listener = handler as (payload: unknown) => void
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => {
        set.delete(listener)
      }
    },
  }
}
