import type { StoredChatDocument, StoredChatMessage } from './chatDocumentStorage'

const TEMPORARY_CHAT_TITLE_PREFIX = 'Chat temporal '
const TITLE_MAX_WORDS = 8
const GENERIC_GREETING_PATTERNS = [
  /^(hola|buenas|buen día|buen dia|buenas tardes|buenas noches)$/i,
  /^(hello|hi|hey|good morning|good afternoon|good evening)$/i,
] as const

function normalizePromptLine(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
}

function normalizeTitleCandidate(value: string): string {
  return value
    .replace(/^[,.;:!?-]+/, '')
    .replace(/[,.;:!?-]+$/g, '')
    .trim()
}

function isGenericGreeting(value: string): boolean {
  const normalizedValue = normalizeTitleCandidate(value)
  if (!normalizedValue) {
    return true
  }

  return GENERIC_GREETING_PATTERNS.some((pattern) => pattern.test(normalizedValue))
}

function buildTitleFromCandidate(value: string): string {
  const words = normalizeTitleCandidate(value).split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return ''
  }

  return words.slice(0, TITLE_MAX_WORDS).join(' ')
}

export function buildChatMemoryWindow(document: StoredChatDocument): StoredChatMessage[] {
  if (!document.contextMemoryEnabled) {
    return []
  }

  const messageCount = Math.max(1, Math.round(document.contextMemoryMessageCount))
  return document.messages.slice(-messageCount)
}

export function buildConversationTitleFromPrompt(prompt: string): string {
  const normalizedPrompt = normalizePromptLine(prompt)
  if (!normalizedPrompt) {
    return 'Chat sin titulo'
  }

  const sentenceCandidates = normalizedPrompt
    .split(/[.!?]+/)
    .map((candidate) => normalizeTitleCandidate(candidate))
    .filter(Boolean)

  const preferredCandidate = sentenceCandidates.find((candidate) => !isGenericGreeting(candidate))
    ?? sentenceCandidates[0]
    ?? normalizedPrompt

  const truncated = buildTitleFromCandidate(preferredCandidate)
  return truncated || 'Chat sin titulo'
}

export function resolvePersistedChatTitle(
  currentTitle: string,
  previousMessages: StoredChatMessage[],
  prompt: string,
): string {
  const normalizedCurrentTitle = currentTitle.trim()
  if (
    previousMessages.length > 0
    || (
      normalizedCurrentTitle
      && normalizedCurrentTitle !== 'Chat'
      && normalizedCurrentTitle !== 'Chat sin titulo'
      && !normalizedCurrentTitle.startsWith(TEMPORARY_CHAT_TITLE_PREFIX)
    )
  ) {
    return normalizedCurrentTitle || 'Chat'
  }

  return buildConversationTitleFromPrompt(prompt)
}
