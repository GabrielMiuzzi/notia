interface NetrunnerChatMemoryItem {
  message: string
  role: 'user' | 'assistant'
}

interface NetrunnerLongTermMemoryItem {
  memory: string
}

interface NetrunnerChatResponse {
  answer?: unknown
}

interface NetrunnerToolsResponse {
  suggested_title?: unknown
  long_term_memory?: unknown
  long_term_memories?: unknown
}

export interface NetrunnerToolsMetadata {
  suggestedTitle: string
  longTermMemories: string[]
}

export interface NetrunnerChatStreamHandlers {
  onThinkingDelta?: (delta: string) => void
  onMessageDelta?: (delta: string) => void
}

export async function requestNetrunnerChat(
  baseUrl: string,
  prompt: string,
  chatMemory: NetrunnerChatMemoryItem[],
  longTermMemories: NetrunnerLongTermMemoryItem[],
): Promise<string> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  const response = await fetch(`${normalizedBaseUrl}/v1/chat-with-files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      files: [],
      use_llama_index: false,
      chatMemory,
      longTermMemories,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Netrunner devolvió ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`)
  }

  const payload = (await response.json()) as NetrunnerChatResponse
  const answer = typeof payload.answer === 'string' ? payload.answer.trim() : ''
  if (!answer) {
    throw new Error('Netrunner no devolvió una respuesta válida.')
  }

  return answer
}

export async function streamNetrunnerChat(
  baseUrl: string,
  prompt: string,
  chatMemory: NetrunnerChatMemoryItem[],
  longTermMemories: NetrunnerLongTermMemoryItem[],
  handlers: NetrunnerChatStreamHandlers,
): Promise<string> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  const response = await fetch(`${normalizedBaseUrl}/v1/chat-with-files-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      files: [],
      use_llama_index: false,
      chatMemory,
      longTermMemories,
    }),
  })

  if (!response.ok || !response.body) {
    const detail = await response.text()
    throw new Error(`Netrunner stream ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  let buffer = ''
  let finalAnswer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const rawEvent of events) {
      const parsedEvent = parseSseEvent(rawEvent)
      if (!parsedEvent) {
        continue
      }

      if (parsedEvent.event === 'thinking') {
        const delta = extractDelta(parsedEvent.data)
        if (delta) {
          handlers.onThinkingDelta?.(delta)
        }
        continue
      }

      if (parsedEvent.event === 'message') {
        const delta = extractDelta(parsedEvent.data)
        if (!delta) {
          continue
        }
        finalAnswer += delta
        handlers.onMessageDelta?.(delta)
        continue
      }

      if (parsedEvent.event === 'error') {
        throw new Error(extractErrorMessage(parsedEvent.data) || 'Error en stream de Netrunner')
      }
    }
  }

  return finalAnswer.trim()
}

export async function requestNetrunnerToolsMetadata(
  baseUrl: string,
  prompt: string,
  isFirstMessage: boolean,
  includeLongTermMemory: boolean,
): Promise<NetrunnerToolsMetadata> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  const response = await fetch(`${normalizedBaseUrl}/v1/tools-chat-metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      is_first_message: isFirstMessage,
      include_long_term_memory: includeLongTermMemory,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Netrunner tools devolvió ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`)
  }

  const payload = (await response.json()) as NetrunnerToolsResponse
  const longTermMemories = resolveLongTermMemories(payload)

  return {
    suggestedTitle: typeof payload.suggested_title === 'string' ? payload.suggested_title.trim() : '',
    longTermMemories,
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function parseSseEvent(raw: string): { event: string; data: string } | null {
  const lines = raw.split('\n')
  let event = ''
  let data = ''

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      data += line.slice('data:'.length).trim()
    }
  }

  if (!event) {
    return null
  }

  return { event, data }
}

function extractDelta(rawData: string): string {
  if (!rawData) {
    return ''
  }

  try {
    const parsed = JSON.parse(rawData) as { delta?: unknown }
    return typeof parsed.delta === 'string' ? parsed.delta : ''
  } catch {
    return ''
  }
}

function extractErrorMessage(rawData: string): string {
  if (!rawData) {
    return ''
  }

  try {
    const parsed = JSON.parse(rawData) as { message?: unknown }
    return typeof parsed.message === 'string' ? parsed.message : ''
  } catch {
    return rawData
  }
}

function resolveLongTermMemories(payload: NetrunnerToolsResponse): string[] {
  const rawList = payload.long_term_memories
  if (Array.isArray(rawList)) {
    return rawList
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (typeof payload.long_term_memory === 'string') {
    const normalized = payload.long_term_memory.trim()
    return normalized ? [normalized] : []
  }

  return []
}
