const CONTENT_URI_PREFIX = 'content://'

function hasSafeUriCharacters(value: string): boolean {
  return value.length > CONTENT_URI_PREFIX.length
    && ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code <= 0x1f || code === 0x7f || /\s/.test(character)
    })
}

/** SAF URIs are opaque identifiers and must not be normalized as filesystem paths. */
export function isSafUri(value: unknown): value is string {
  return typeof value === 'string' && hasSafeUriCharacters(value) && value.startsWith(CONTENT_URI_PREFIX)
}

export function isSafTreeUri(value: unknown): value is string {
  return isSafUri(value)
    && value.includes('/tree/')
    && !value.includes('/document/')
}

/** Resolve the user-facing folder name encoded in an Android tree URI. */
export function getSafTreeDisplayName(value: unknown): string | null {
  if (!isSafTreeUri(value)) {
    return null
  }

  const rawDocumentId = value.split('/').pop() ?? ''
  if (!rawDocumentId) {
    return null
  }

  let decodedDocumentId = rawDocumentId
  try {
    decodedDocumentId = decodeURIComponent(rawDocumentId)
  } catch {
    // Keep the opaque segment as a safe fallback if a provider returns a
    // malformed percent-encoded document id.
  }

  const pathSegments = decodedDocumentId.split(/[\\/]/).filter(Boolean)
  const displayName = pathSegments[pathSegments.length - 1]?.trim()
  return displayName || null
}

export function isSafDocumentUri(value: unknown): value is string {
  return isSafUri(value) && value.includes('/document/')
}

/** The picker must return the grant root, never a synthetic or child URI. */
export function normalizeSafTreeUri(value: unknown): string | null {
  if (!isSafTreeUri(value)) {
    return null
  }
  return value.trim()
}

/** Prefix comparisons for logical SAF paths require a segment boundary. */
export function isSameOrNestedSafPath(basePath: string, candidatePath: string): boolean {
  const base = basePath.trim().replace(/[\\/]+$/, '')
  const candidate = candidatePath.trim().replace(/[\\/]+$/, '')
  return Boolean(base) && (candidate === base || candidate.startsWith(`${base}/`))
}

export function isValidSafLogicalSegment(value: string): boolean {
  const segment = value.trim()
  return Boolean(segment)
    && segment !== '.'
    && segment !== '..'
    && ![...segment].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return character === '/' || character === '\\' || code <= 0x1f || code === 0x7f
    })
}

/** Safe diagnostics metadata; never include the URI itself. */
export function describeSafUri(value: unknown): { present: boolean; kind: 'tree' | 'document' | 'other' } {
  if (!value || typeof value !== 'string' || !value.trim()) {
    return { present: false, kind: 'other' }
  }
  if (isSafTreeUri(value)) return { present: true, kind: 'tree' }
  if (isSafDocumentUri(value)) return { present: true, kind: 'document' }
  return { present: true, kind: 'other' }
}
