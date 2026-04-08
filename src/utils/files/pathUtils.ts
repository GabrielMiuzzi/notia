/**
 * Join path segments using forward slashes
 */
export function join(...segments: string[]): string {
  const normalized = segments
    .map((s) => s.replace(/\\/g, '/').replace(/\/+/g, '/'))
    .filter((s) => s.length > 0)
    .join('/')
  return normalized.replace(/\/+/g, '/')
}
