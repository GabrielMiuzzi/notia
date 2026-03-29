import { parseFrontmatterDocument, serializeFrontmatterDocument, type FrontmatterEntry } from '../../engines/markdown/frontmatterEngine'
import type { NotiaLibrary } from '../../types/notia'
import { readLibraryFileContent, writeLibraryFileContent } from '../libraries/libraryDocumentRuntime'
import { resolveLongTermMemoryFilePath } from './chatLibraryStructure'

export interface StoredChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface StoredChatDocument {
  title: string
  longTermMemoryEnabled: boolean
  contextMemoryEnabled: boolean
  contextMemoryMessageCount: number
  contextScopeKey: string | null
  selectedContextMode: 'direct' | 'index'
  selectedContextFiles: string[]
  messages: StoredChatMessage[]
}

const CHAT_MESSAGE_MARKER_PREFIX = '<!-- NOTIA_CHAT_MESSAGE role:'
const CHAT_MESSAGE_MARKER_SUFFIX = ' -->'

function parseMarkdownListItem(line: string): string | null {
  const trimmedLine = line.trim()
  const match = /^[-*+]\s+(.+)$/.exec(trimmedLine)
  if (!match) {
    return null
  }

  const content = match[1]?.trim()
  return content || null
}

function clampContextMemoryMessageCount(value: unknown): number {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return 10
  }

  return Math.min(200, Math.max(1, Math.round(numericValue)))
}

function findFrontmatterValue(entries: FrontmatterEntry[], key: string): FrontmatterEntry['value'] | null {
  return entries.find((entry) => entry.key === key)?.value ?? null
}

function parseBooleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function parseSelectedContextMode(value: unknown): StoredChatDocument['selectedContextMode'] {
  return value === 'index' ? 'index' : 'direct'
}

function parseSelectedContextFiles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function extractChatMessages(body: string): StoredChatMessage[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const messages: StoredChatMessage[] = []

  let activeRole: StoredChatMessage['role'] | null = null
  let buffer: string[] = []

  const flushMessage = () => {
    if (!activeRole) {
      buffer = []
      return
    }

    const content = buffer.join('\n').trim()
    if (content) {
      messages.push({ role: activeRole, content })
    }
    activeRole = null
    buffer = []
  }

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (trimmedLine.startsWith(CHAT_MESSAGE_MARKER_PREFIX) && trimmedLine.endsWith(CHAT_MESSAGE_MARKER_SUFFIX)) {
      flushMessage()
      const roleToken = trimmedLine
        .slice(CHAT_MESSAGE_MARKER_PREFIX.length, -CHAT_MESSAGE_MARKER_SUFFIX.length)
        .trim()
        .toLowerCase()
      activeRole = roleToken === 'assistant' ? 'assistant' : roleToken === 'user' ? 'user' : null
      continue
    }

    if (activeRole) {
      buffer.push(line)
    }
  }

  flushMessage()
  return messages
}

function buildChatBody(title: string, messages: StoredChatMessage[]): string {
  const blocks = messages.flatMap((message) => [
    `${CHAT_MESSAGE_MARKER_PREFIX}${message.role}${CHAT_MESSAGE_MARKER_SUFFIX}`,
    message.content.trim(),
    '',
  ])

  return [
    `# ${title}`,
    '',
    ...blocks,
  ].join('\n').trimEnd() + '\n'
}

export function parseChatDocument(source: string, fallbackTitle: string): StoredChatDocument {
  const document = parseFrontmatterDocument(source)
  const titleValue = findFrontmatterValue(document.frontmatter, 'title')
  const longTermMemoryValue = findFrontmatterValue(document.frontmatter, 'longTermMemory')
  const contextMemoryValue = findFrontmatterValue(document.frontmatter, 'contextMemory')
  const contextMemoryMessageCountValue = findFrontmatterValue(document.frontmatter, 'contextMemoryMessageCount')
  const contextScopeKeyValue = findFrontmatterValue(document.frontmatter, 'contextScopeKey')
  const selectedContextModeValue = findFrontmatterValue(document.frontmatter, 'selectedContextMode')
  const selectedContextFilesValue = findFrontmatterValue(document.frontmatter, 'selectedContextFiles')

  return {
    title: typeof titleValue === 'string' && titleValue.trim() ? titleValue.trim() : fallbackTitle,
    longTermMemoryEnabled: parseBooleanValue(longTermMemoryValue, true),
    contextMemoryEnabled: parseBooleanValue(contextMemoryValue, true),
    contextMemoryMessageCount: clampContextMemoryMessageCount(contextMemoryMessageCountValue),
    contextScopeKey: typeof contextScopeKeyValue === 'string' && contextScopeKeyValue.trim()
      ? contextScopeKeyValue.trim()
      : null,
    selectedContextMode: parseSelectedContextMode(selectedContextModeValue),
    selectedContextFiles: parseSelectedContextFiles(selectedContextFilesValue),
    messages: extractChatMessages(document.body),
  }
}

export function serializeChatDocument(document: StoredChatDocument): string {
  return serializeFrontmatterDocument({
    hasFrontmatter: true,
    frontmatter: [
      { key: 'title', value: document.title },
      { key: 'longTermMemory', value: document.longTermMemoryEnabled },
      { key: 'contextMemory', value: document.contextMemoryEnabled },
      { key: 'contextMemoryMessageCount', value: clampContextMemoryMessageCount(document.contextMemoryMessageCount) },
      { key: 'contextScopeKey', value: document.contextScopeKey },
      { key: 'selectedContextMode', value: document.selectedContextMode },
      { key: 'selectedContextFiles', value: document.selectedContextFiles },
    ],
    body: buildChatBody(document.title, document.messages),
  })
}

export async function loadChatDocument(filePath: string, fallbackTitle: string): Promise<StoredChatDocument> {
  const result = await readLibraryFileContent(filePath)
  if (!result.ok) {
    throw new Error(result.error ?? 'No se pudo leer el archivo del chat.')
  }

  return parseChatDocument(result.content, fallbackTitle)
}

export async function saveChatDocument(filePath: string, document: StoredChatDocument): Promise<void> {
  const result = await writeLibraryFileContent(filePath, serializeChatDocument(document))
  if (!result.ok) {
    throw new Error(result.error ?? 'No se pudo guardar el archivo del chat.')
  }
}

export async function loadLongTermMemories(library: NotiaLibrary): Promise<string[]> {
  const filePath = resolveLongTermMemoryFilePath(library.path)
  const result = await readLibraryFileContent(filePath)
  if (!result.ok) {
    throw new Error(result.error ?? 'No se pudo leer LongTermMemory.md.')
  }

  return result.content
    .split(/\r?\n/)
    .map((line) => parseMarkdownListItem(line))
    .filter(Boolean)
    .map((line) => line as string)
}

function dedupeLongTermMemories(memories: string[]): string[] {
  const seen = new Set<string>()
  const nextMemories: string[] = []

  for (const memory of memories) {
    const normalizedMemory = memory.trim()
    if (!normalizedMemory) {
      continue
    }

    const key = normalizedMemory.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    nextMemories.push(normalizedMemory)
  }

  return nextMemories
}

export async function appendLongTermMemories(library: NotiaLibrary, incomingMemories: string[]): Promise<string[]> {
  const currentMemories = await loadLongTermMemories(library)
  const mergedMemories = dedupeLongTermMemories([...currentMemories, ...incomingMemories]).slice(0, 200)
  const filePath = resolveLongTermMemoryFilePath(library.path)
  const nextContent = [
    '# Long Term Memory',
    '',
    ...mergedMemories.map((memory) => `- ${memory}`),
    '',
  ].join('\n')

  const result = await writeLibraryFileContent(filePath, nextContent)
  if (!result.ok) {
    throw new Error(result.error ?? 'No se pudo guardar LongTermMemory.md.')
  }

  return mergedMemories
}

export async function clearLongTermMemories(library: NotiaLibrary): Promise<void> {
  const filePath = resolveLongTermMemoryFilePath(library.path)
  const result = await writeLibraryFileContent(filePath, '# Long Term Memory\n\n')
  if (!result.ok) {
    throw new Error(result.error ?? 'No se pudo vaciar LongTermMemory.md.')
  }
}
