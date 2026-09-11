import type { StoredChatMessage } from '../../../services/chat/chatDocumentStorage'
import type { TaskExecutionStep } from '../../../services/chat/chatScopedAgentRuntime'

interface PublishedTaskManagerChatProxyInput {
  scopePaths: string[]
  prompt: string
  previousMessages: StoredChatMessage[]
  signal: AbortSignal
  onExecutionPlanChange?: (steps: TaskExecutionStep[]) => void
  onMessageDelta?: (delta: string) => void
  onThinkingDelta?: (delta: string) => void
}

interface PublishedTaskManagerChatStreamEvent {
  type?: unknown
  delta?: unknown
  answer?: unknown
  message?: unknown
  steps?: unknown
}

export async function runPublishedTaskManagerChatProxy(
  input: PublishedTaskManagerChatProxyInput,
): Promise<string> {
  const publicationPath = window.location.pathname.replace(/\/app\/?$/, '').replace(/\/+$/, '')
  const response = await fetch(`${publicationPath}/ai/stream`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify({
      prompt: input.prompt,
      previousMessages: input.previousMessages,
      scopePaths: input.scopePaths,
    }),
    signal: input.signal,
  })
  if (!response.ok || !response.body) {
    const detail = await response.text()
    throw new Error(detail || 'No se pudo contactar a la app host.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let answer = ''
  let completed = false

  const processLine = (line: string): void => {
    if (!line.trim()) return
    const event = JSON.parse(line) as PublishedTaskManagerChatStreamEvent
    if (event.type === 'thinking' && typeof event.delta === 'string') {
      input.onThinkingDelta?.(event.delta)
      return
    }
    if (event.type === 'delta' && typeof event.delta === 'string') {
      answer += event.delta
      input.onMessageDelta?.(event.delta)
      return
    }
    if (event.type === 'plan' && Array.isArray(event.steps)) {
      input.onExecutionPlanChange?.(event.steps as TaskExecutionStep[])
      return
    }
    if (event.type === 'done') {
      if (typeof event.answer === 'string') answer = event.answer
      completed = true
      return
    }
    if (event.type === 'error') {
      throw new Error(typeof event.message === 'string' ? event.message : 'No se pudo completar el chat de IA en la app host.')
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      lines.forEach(processLine)
      if (done) break
    }
    processLine(pending)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }

  const normalizedAnswer = answer.trim()
  if (!completed || !normalizedAnswer) {
    throw new Error('La app host no devolvio contenido para la consulta de IA.')
  }
  return normalizedAnswer
}
