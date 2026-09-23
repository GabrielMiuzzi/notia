/**
 * Page-link helpers used to order the explorer. Linking notes (cycle checks
 * and updating the opposite link) is done by the backend
 * (`backend_sync_page_link`).
 */

/**
 * Extracts the raw file path reference from a page-link value.
 * Handles wikilink format `[[path]]`, `[[alias|path]]`, plain paths, and 'N/A'.
 *
 * For wikilinks with aliases (`[[alias|path]]`), the path is the last segment.
 */
export function extractLinkPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'N/A') {
    return null
  }
  const wikiMatch = trimmed.match(/^\[\[(.*?)\]\]$/)
  if (wikiMatch) {
    const inner = wikiMatch[1]
    if (!inner.trim()) {
      return null
    }
    const segments = inner.split('|')
    const reference = segments[segments.length - 1]?.trim() ?? inner.trim()
    if (!reference) {
      return null
    }
    return reference
  }
  return trimmed
}
