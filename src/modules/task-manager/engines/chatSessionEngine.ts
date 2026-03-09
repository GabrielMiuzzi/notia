import type { ChatMessage, ChatSessionOptions } from '../types/taskManagerTypes'

const DEFAULT_LONG_TERM_MEMORY_CONTENT = '# LongTermMemory\n'

export function createChatSessionContent(options: ChatSessionOptions): string {
  return [
    buildFrontmatter(options),
    '',
    ...serializeMessages([]),
  ].join('\n')
}

export function ensureLongTermMemoryFileContent(content: string): string {
  return content.trim() ? content : DEFAULT_LONG_TERM_MEMORY_CONTENT
}

export function loadChatMessagesFromContent(content: string): ChatMessage[] {
  const payload = extractMessagesPayload(content)
  if (!payload) {
    return []
  }

  try {
    const parsed = JSON.parse(payload) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((item): item is { role: unknown; content: unknown } => Boolean(item) && typeof item === 'object')
      .map((item, index) => ({
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        role: item.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: typeof item.content === 'string' ? item.content : '',
      }))
      .filter((item) => item.content.trim().length > 0)
  } catch {
    return []
  }
}

export function saveChatMessagesToContent(currentContent: string, messages: ChatMessage[]): string {
  const frontmatter = extractFrontmatter(currentContent)
  return [
    frontmatter || buildFrontmatter({ chatMemory: true, longTermMemory: false }),
    '',
    ...serializeMessages(messages),
  ].join('\n')
}

export function parseChatSessionOptions(content: string): ChatSessionOptions {
  const frontmatter = extractFrontmatter(content)
  if (!frontmatter) {
    return { chatMemory: true, longTermMemory: false }
  }

  return {
    chatMemory: readFrontmatterBoolean(frontmatter, 'chatMemory', true),
    longTermMemory: readFrontmatterBoolean(frontmatter, 'LongTermMemory', false),
  }
}

export function updateChatSessionFrontmatter(content: string, options: ChatSessionOptions): string {
  const nextFrontmatter = buildFrontmatter(options)
  const messages = loadChatMessagesFromContent(content)

  return [
    nextFrontmatter,
    '',
    ...serializeMessages(messages),
  ].join('\n')
}

export function readLongTermMemoriesFromContent(content: string): string[] {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')

  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .map((line) => {
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return line.slice(2).trim()
      }
      return line
    })
    .filter(Boolean)
}

export function appendLongTermMemoryToContent(content: string, memory: string): string {
  const normalizedMemory = memory.trim()
  if (!normalizedMemory) {
    return content
  }

  const existingMemories = new Set(readLongTermMemoriesFromContent(content).map((item) => item.toLowerCase()))
  if (existingMemories.has(normalizedMemory.toLowerCase())) {
    return content
  }

  const baseContent = ensureLongTermMemoryFileContent(content)
  const suffix = baseContent.endsWith('\n') ? '' : '\n'
  return `${baseContent}${suffix}- ${normalizedMemory}\n`
}

export function sanitizeChatFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function serializeMessages(messages: ChatMessage[]): string[] {
  const payload = messages.map((message) => ({ role: message.role, content: message.content }))

  return [
    '<!-- CHAT_MESSAGES_START -->',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '<!-- CHAT_MESSAGES_END -->',
    '',
  ]
}

function extractMessagesPayload(content: string): string {
  const match = content.match(/<!-- CHAT_MESSAGES_START -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- CHAT_MESSAGES_END -->/m)
  return match?.[1]?.trim() || ''
}

function extractFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---/)
  return match?.[0] || ''
}

function buildFrontmatter(options: ChatSessionOptions): string {
  return [
    '---',
    `chatMemory: ${String(options.chatMemory)}`,
    `LongTermMemory: ${String(options.longTermMemory)}`,
    '---',
  ].join('\n')
}

function readFrontmatterBoolean(frontmatter: string, key: string, fallback: boolean): boolean {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  if (!match) {
    return fallback
  }

  const rawValue = match[1].trim().toLowerCase()
  if (rawValue === 'true') {
    return true
  }

  if (rawValue === 'false') {
    return false
  }

  return fallback
}
