/**
 * Join path segments using forward slashes
 */
export function join(...segments: string[]): string {
  const firstSegment = segments[0]?.trim() ?? ''
  if (firstSegment.startsWith('content://')) {
    const normalizedUri = firstSegment.replace(/\/+$/, '')
    const normalizedRest = segments.slice(1)
      .map((segment) => segment.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
      .filter((segment) => segment.length > 0)
    return [normalizedUri, ...normalizedRest].join('/')
  }

  const normalized = segments
    .map((s) => s.replace(/\\/g, '/').replace(/\/+/g, '/'))
    .filter((s) => s.length > 0)
    .join('/')
  return normalized.replace(/\/+/g, '/')
}
