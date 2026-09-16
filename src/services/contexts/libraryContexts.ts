export interface LibraryContext {
  tag: string
  color: string
}

export const DEFAULT_CONTEXT_TAG = '#Personal'
export const CONFIDENTIAL_CONTEXT_TAG = '#Confidencial'

export const DEFAULT_LIBRARY_CONTEXTS: readonly LibraryContext[] = [
  { tag: '#Laboral', color: '#2563EB' },
  { tag: '#Personal', color: '#16A34A' },
  { tag: '#Academico', color: '#9333EA' },
  { tag: CONFIDENTIAL_CONTEXT_TAG, color: '#DC2626' },
]

const CONTEXT_TAG_PATTERN = /^#[^\s#]+$/
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/

export function normalizeContextTag(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  return CONTEXT_TAG_PATTERN.test(withHash) ? withHash : null
}

export function normalizeContextColor(value: unknown, fallback = '#64748B'): string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim())
    ? value.trim().toUpperCase()
    : fallback
}

export function normalizeLibraryContexts(value: unknown): LibraryContext[] {
  if (!Array.isArray(value)) {
    return DEFAULT_LIBRARY_CONTEXTS.map((context) => ({ ...context }))
  }

  const contexts: LibraryContext[] = []
  const seenTags = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const candidate = item as { tag?: unknown; color?: unknown }
    const tag = normalizeContextTag(candidate.tag)
    if (!tag || seenTags.has(tag.toLowerCase())) {
      continue
    }

    seenTags.add(tag.toLowerCase())
    contexts.push({
      tag,
      color: normalizeContextColor(candidate.color),
    })
  }

  return contexts
}

export function ensureDefaultLibraryContexts(value: unknown): LibraryContext[] {
  const contexts = normalizeLibraryContexts(value)
  const knownTags = new Set(contexts.map((context) => context.tag.toLowerCase()))
  for (const defaultContext of DEFAULT_LIBRARY_CONTEXTS) {
    if (!knownTags.has(defaultContext.tag.toLowerCase())) {
      contexts.push({ ...defaultContext })
    }
  }
  return contexts
}

export function findLibraryContext(
  contexts: readonly LibraryContext[],
  tag: unknown,
): LibraryContext | undefined {
  const normalizedTag = normalizeContextTag(tag)
  if (!normalizedTag) {
    return undefined
  }

  return contexts.find((context) => context.tag.toLowerCase() === normalizedTag.toLowerCase())
}

export function resolveContextColor(
  contexts: readonly LibraryContext[],
  tag: unknown,
): string | undefined {
  return findLibraryContext(contexts, tag)?.color
}
