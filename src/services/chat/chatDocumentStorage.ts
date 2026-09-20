import { parseFrontmatterDocument, serializeFrontmatterDocument, type FrontmatterEntry } from '../../engines/markdown/frontmatterEngine'
import type { NotiaLibrary } from '../../types/notia'
import { fromStoredLibraryPath, toStoredLibraryPath } from '../libraries/libraryPathMapping'
import { readLibraryFileContent, writeLibraryFileContent } from '../libraries/libraryDocumentRuntime'
import { loadAgentMemories, writeAgentMemories } from '../ai/agentPromptRuntime'
import { CONFIDENTIAL_CONTEXT_TAG } from '../contexts/libraryContexts'

export interface StoredChatMessage {
  role: 'user' | 'assistant'
  content: string
  attachments?: StoredChatAttachment[]
}

export interface StoredChatAttachment {
  name: string
  mimeType: string
  base64: string
  additionalBase64?: string[]
  kind: 'image' | 'pdf' | 'text'
  extractedText?: string
  textContent?: string
  pageCount?: number
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
const CHAT_ATTACHMENTS_MARKER_PREFIX = '<!-- NOTIA_CHAT_ATTACHMENTS:'
const CHAT_ATTACHMENTS_MARKER_SUFFIX = ' -->'

function encodeAttachmentMetadata(attachments: StoredChatAttachment[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(attachments))
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function decodeAttachmentMetadata(encoded: string): StoredChatAttachment[] | null {
  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(parsed)) return null

    const attachments = parsed.filter((item): item is Record<string, unknown> => (
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    )).map((item) => {
      const kind = item.kind === 'pdf' || item.kind === 'text' ? item.kind : item.kind === 'image' ? 'image' : null
      if (!kind || typeof item.name !== 'string' || typeof item.mimeType !== 'string' || typeof item.base64 !== 'string') {
        return null
      }

      const additionalBase64 = Array.isArray(item.additionalBase64)
        ? item.additionalBase64.filter((value): value is string => typeof value === 'string')
        : undefined
      const pageCount = typeof item.pageCount === 'number' && Number.isFinite(item.pageCount)
        ? Math.max(0, Math.round(item.pageCount))
        : undefined
      return {
        name: item.name,
        mimeType: item.mimeType,
        base64: item.base64,
        ...(additionalBase64 && additionalBase64.length > 0 ? { additionalBase64 } : {}),
        kind,
        ...(typeof item.extractedText === 'string' ? { extractedText: item.extractedText } : {}),
        ...(typeof item.textContent === 'string' ? { textContent: item.textContent } : {}),
        ...(pageCount !== undefined ? { pageCount } : {}),
      } satisfies StoredChatAttachment
    }).filter((item): item is StoredChatAttachment => item !== null)

    return attachments
  } catch {
    return null
  }
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
  let activeAttachments: StoredChatAttachment[] = []

  const flushMessage = () => {
    if (!activeRole) {
      buffer = []
      activeAttachments = []
      return
    }

    const content = buffer.join('\n').trim()
    if (content || activeAttachments.length > 0) {
      messages.push({
        role: activeRole,
        content,
        ...(activeAttachments.length > 0 ? { attachments: activeAttachments } : {}),
      })
    }
    activeRole = null
    buffer = []
    activeAttachments = []
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

    if (activeRole && trimmedLine.startsWith(CHAT_ATTACHMENTS_MARKER_PREFIX) && trimmedLine.endsWith(CHAT_ATTACHMENTS_MARKER_SUFFIX)) {
      const encoded = trimmedLine.slice(CHAT_ATTACHMENTS_MARKER_PREFIX.length, -CHAT_ATTACHMENTS_MARKER_SUFFIX.length)
      const decoded = decodeAttachmentMetadata(encoded)
      if (decoded) activeAttachments = decoded
      continue
    }

    if (activeRole) {
      buffer.push(line)
    }
  }

  flushMessage()
  return messages
}

function buildMessageBlock(message: StoredChatMessage): string {
  return [
    `${CHAT_MESSAGE_MARKER_PREFIX}${message.role}${CHAT_MESSAGE_MARKER_SUFFIX}`,
    ...(message.attachments && message.attachments.length > 0
      ? [`${CHAT_ATTACHMENTS_MARKER_PREFIX}${encodeAttachmentMetadata(message.attachments)}${CHAT_ATTACHMENTS_MARKER_SUFFIX}`]
      : []),
    message.content.trim(),
    '',
  ].join('\n')
}

function buildChatBody(title: string, messages: StoredChatMessage[]): string {
  const blocks = messages.map((message) => buildMessageBlock(message))

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
      { key: 'contexto', value: CONFIDENTIAL_CONTEXT_TAG },
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

function toRuntimeChatDocument(document: StoredChatDocument, library: NotiaLibrary): StoredChatDocument {
  return {
    ...document,
    selectedContextFiles: document.selectedContextFiles
      .map((pathValue) => fromStoredLibraryPath(library.path, pathValue))
      .filter(Boolean),
  }
}

function toPersistedChatDocument(document: StoredChatDocument, library: NotiaLibrary): StoredChatDocument {
  return {
    ...document,
    selectedContextFiles: document.selectedContextFiles
      .map((pathValue) => toStoredLibraryPath(library.path, pathValue))
      .filter(Boolean),
  }
}

export async function loadChatDocument(
  filePath: string,
  fallbackTitle: string,
  library: NotiaLibrary,
): Promise<StoredChatDocument> {
  const result = await readLibraryFileContent(filePath, {
    androidDirectoryUri: library.androidTreeUri,
  })
  if (!result.ok) {
    throw new Error(result.error ?? 'No se pudo leer el archivo del chat.')
  }

  return toRuntimeChatDocument(parseChatDocument(result.content, fallbackTitle), library)
}

export async function saveChatDocument(
  filePath: string,
  document: StoredChatDocument,
  library: NotiaLibrary,
): Promise<void> {
  const result = await writeLibraryFileContent(
    filePath,
    serializeChatDocument(toPersistedChatDocument(document, library)),
    { androidDirectoryUri: library.androidTreeUri },
  )
  if (!result.ok) {
    throw new Error(result.error ?? 'No se pudo guardar el archivo del chat.')
  }
}

interface AppendChatMessagesResult {
  appended: boolean
}

function findBodyStartOffset(source: string): number {
  const normalizedSource = source.replace(/\r\n/g, '\n')
  if (!normalizedSource.startsWith('---\n')) {
    return 0
  }

  const closingIndex = normalizedSource.indexOf('\n---\n')
  if (closingIndex < 0) {
    return 0
  }

  return closingIndex + '\n---\n'.length
}

function buildAppendContent(messages: StoredChatMessage[]): string {
  if (messages.length === 0) {
    return ''
  }

  const blocks = messages.map((message) => buildMessageBlock(message))
  return blocks.join('').trimEnd() + '\n'
}

export async function appendChatMessages(
  filePath: string,
  document: StoredChatDocument,
  library: NotiaLibrary,
): Promise<AppendChatMessagesResult> {
  const persistedDocument = toPersistedChatDocument(document, library)
  const readResult = await readLibraryFileContent(filePath, {
    androidDirectoryUri: library.androidTreeUri,
  })

  if (!readResult.ok) {
    await saveChatDocument(filePath, document, library)
    return { appended: false }
  }

  const source = readResult.content
  const bodyStart = findBodyStartOffset(source)
  const header = source.slice(0, bodyStart)
  const body = source.slice(bodyStart)
  const trimmedBody = body.trimEnd()

  const expectedHeader = `# ${persistedDocument.title}`
  const trimmedBodyLines = trimmedBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const hasValidHeader = trimmedBodyLines.length > 0 && trimmedBodyLines[0] === expectedHeader
  const nonHeaderLines = trimmedBodyLines.slice(1)
  const lastMarkerLine = nonHeaderLines
    .filter((line) => line.startsWith(CHAT_MESSAGE_MARKER_PREFIX))
    .pop() ?? ''
  const endsWithUserMarker = lastMarkerLine === `${CHAT_MESSAGE_MARKER_PREFIX}user${CHAT_MESSAGE_MARKER_SUFFIX}`
  const endsWithAssistantMarker = lastMarkerLine === `${CHAT_MESSAGE_MARKER_PREFIX}assistant${CHAT_MESSAGE_MARKER_SUFFIX}`

  if (!hasValidHeader || (!endsWithUserMarker && !endsWithAssistantMarker)) {
    await saveChatDocument(filePath, document, library)
    return { appended: false }
  }

  const appendContent = buildAppendContent(
    persistedDocument.messages.slice(persistedDocument.messages.length > 2 ? -2 : -1),
  )
  if (!appendContent) {
    return { appended: false }
  }

  const separator = trimmedBody.length === 0 || trimmedBody.endsWith('\n') ? '' : '\n'
  const nextContent = `${header}${trimmedBody}${separator}${appendContent}`

  const writeResult = await writeLibraryFileContent(filePath, nextContent, {
    androidDirectoryUri: library.androidTreeUri,
  })
  if (!writeResult.ok) {
    await saveChatDocument(filePath, document, library)
    return { appended: false }
  }

  return { appended: true }
}

/** @deprecated Use the .agent/memory/memory.md adapter through agentPromptRuntime. */
export async function loadLongTermMemories(library: NotiaLibrary): Promise<string[]> {
  return loadAgentMemories(library)
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
  await writeAgentMemories(library, mergedMemories)
  return mergedMemories
}

export async function clearLongTermMemories(library: NotiaLibrary): Promise<void> {
  await writeAgentMemories(library, [])
}
