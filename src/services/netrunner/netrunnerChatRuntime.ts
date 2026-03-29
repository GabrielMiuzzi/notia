import type { StoredChatMessage } from '../chat/chatDocumentStorage'
import { normalizeNetrunnerSettingsInput, type NetrunnerPreferences } from '../preferences/netrunnerSettingsStorage'

interface NetrunnerPersistencePaths {
  chatFilePath?: string
  longTermMemoryFilePath?: string
}

export interface NetrunnerInlineFileAttachment {
  path: string
  name: string
  content: string
}

export interface NetrunnerImageAttachment {
  name: string
  mimeType: string
  base64: string
}

export interface NetrunnerChatAttachments {
  files?: NetrunnerInlineFileAttachment[]
  useLlamaIndex?: boolean
  image?: NetrunnerImageAttachment | null
  persistSelectedContext?: boolean
}

interface NetrunnerChatMemoryItem {
  message: string
  role: 'user' | 'assistant'
}

interface NetrunnerLongTermMemoryItem {
  memory: string
}

interface NetrunnerChatResponse {
  answer: string
}

interface NetrunnerChatMetadataResponse {
  suggested_title?: string
  long_term_memories?: string[]
}

interface NetrunnerStreamEventPayload {
  delta?: string
  message?: string
}

interface StreamNetrunnerChatReplyOptions {
  onThinkingDelta?: (delta: string) => void
  onMessageDelta?: (delta: string) => void
  onMeta?: (payload: Record<string, unknown>) => void
}

function toChatMemory(messages: StoredChatMessage[]): NetrunnerChatMemoryItem[] {
  return messages.map((message) => ({
    message: message.content,
    role: message.role,
  }))
}

function toLongTermMemories(memories: string[]): NetrunnerLongTermMemoryItem[] {
  return memories.map((memory) => ({ memory }))
}

async function postJson<TResponse>(baseUrl: string, path: string, body: unknown): Promise<TResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `Netrunner respondio con HTTP ${response.status}.`)
  }

  return response.json() as Promise<TResponse>
}

export async function requestNetrunnerChatReply(
  preferences: NetrunnerPreferences,
  prompt: string,
  chatMemory: StoredChatMessage[],
  longTermMemories: string[],
  attachments?: NetrunnerChatAttachments,
): Promise<string> {
  const normalizedPreferences = normalizeNetrunnerSettingsInput(preferences)
  const response = await postJson<NetrunnerChatResponse>(
    normalizedPreferences.baseUrl,
    '/v1/chat-with-files',
    buildChatRequestBody(prompt, chatMemory, longTermMemories, undefined, attachments),
  )

  return typeof response.answer === 'string' ? response.answer.trim() : ''
}

function buildChatRequestBody(
  prompt: string,
  chatMemory: StoredChatMessage[],
  longTermMemories: string[],
  persistencePaths?: NetrunnerPersistencePaths,
  attachments?: NetrunnerChatAttachments,
) {
  return {
    prompt,
    files: [],
    inlineFiles: attachments?.files ?? [],
    image: attachments?.image ?? null,
    use_llama_index: attachments?.useLlamaIndex ?? false,
    persist_selected_context: attachments?.persistSelectedContext ?? true,
    max_context_chars: 30000,
    chatMemory: toChatMemory(chatMemory),
    longTermMemories: toLongTermMemories(longTermMemories),
    chatFilePath: persistencePaths?.chatFilePath ?? '',
    longTermMemoryFilePath: persistencePaths?.longTermMemoryFilePath ?? '',
  }
}

function parseSsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function consumeSseChunk(
  chunk: string,
  options: StreamNetrunnerChatReplyOptions,
): { done: boolean; errorMessage: string | null } {
  const lines = chunk
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))

  let eventName = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (!line) {
      continue
    }

    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || 'message'
      continue
    }

    if (line.startsWith('data:')) {
      const dataValue = line.length > 5 && line[5] === ' ' ? line.slice(6) : line.slice(5)
      dataLines.push(dataValue)
    }
  }

  const payload = parseSsePayload(dataLines.join('\n'))
  const { delta, message } = payload as NetrunnerStreamEventPayload

  if (eventName === 'meta') {
    options.onMeta?.(payload)
    return { done: false, errorMessage: null }
  }

  if (eventName === 'thinking' && typeof delta === 'string' && delta) {
    options.onThinkingDelta?.(delta)
    return { done: false, errorMessage: null }
  }

  if (eventName === 'message' && typeof delta === 'string' && delta) {
    options.onMessageDelta?.(delta)
    return { done: false, errorMessage: null }
  }

  if (eventName === 'error') {
    return {
      done: false,
      errorMessage: typeof message === 'string' && message.trim()
        ? message.trim()
        : 'Netrunner devolvio un error durante el stream.',
    }
  }

  return { done: eventName === 'done', errorMessage: null }
}

export async function streamNetrunnerChatReply(
  preferences: NetrunnerPreferences,
  prompt: string,
  chatMemory: StoredChatMessage[],
  longTermMemories: string[],
  persistencePaths?: NetrunnerPersistencePaths,
  attachments?: NetrunnerChatAttachments,
  options: StreamNetrunnerChatReplyOptions = {},
): Promise<string> {
  const normalizedPreferences = normalizeNetrunnerSettingsInput(preferences)
  const response = await fetch(`${normalizedPreferences.baseUrl}/v1/chat-with-files-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(buildChatRequestBody(prompt, chatMemory, longTermMemories, persistencePaths, attachments)),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `Netrunner respondio con HTTP ${response.status}.`)
  }

  if (!response.body) {
    throw new Error('Netrunner no devolvio un stream legible.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    buffer = buffer.replace(/\r\n/g, '\n')

    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex >= 0) {
      const rawEvent = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)

      if (rawEvent.trim()) {
        const result = consumeSseChunk(rawEvent, {
          ...options,
          onMessageDelta: (delta) => {
            answer += delta
            options.onMessageDelta?.(delta)
          },
        })

        if (result.errorMessage) {
          throw new Error(result.errorMessage)
        }

        if (result.done) {
          return answer.trim()
        }
      }

      separatorIndex = buffer.indexOf('\n\n')
    }

    if (done) {
      break
    }
  }

  if (buffer.trim()) {
    const result = consumeSseChunk(buffer, {
      ...options,
      onMessageDelta: (delta) => {
        answer += delta
        options.onMessageDelta?.(delta)
      },
    })
    if (result.errorMessage) {
      throw new Error(result.errorMessage)
    }
  }

  return answer.trim()
}

export async function requestNetrunnerChatMetadata(
  preferences: NetrunnerPreferences,
  prompt: string,
  isFirstMessage: boolean,
  includeLongTermMemory: boolean,
): Promise<{ suggestedTitle: string; longTermMemories: string[] }> {
  const normalizedPreferences = normalizeNetrunnerSettingsInput(preferences)
  const response = await postJson<NetrunnerChatMetadataResponse>(normalizedPreferences.baseUrl, '/v1/tools-chat-metadata', {
    prompt,
    is_first_message: isFirstMessage,
    include_long_term_memory: includeLongTermMemory,
  })

  const suggestedTitle = typeof response.suggested_title === 'string'
    ? response.suggested_title.trim().slice(0, 120)
    : ''
  const longTermMemories = Array.isArray(response.long_term_memories)
    ? response.long_term_memories.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []

  return {
    suggestedTitle,
    longTermMemories,
  }
}
