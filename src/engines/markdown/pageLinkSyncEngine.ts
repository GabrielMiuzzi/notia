import {
  parseFrontmatterDocument,
  serializeFrontmatterDocument,
  getFrontmatterValue,
  setFrontmatterValue,
} from './frontmatterEngine'
import type { FrontmatterEntry } from './frontmatterEngine'
import { notiaLog } from '../../services/runtime/notiaLogger'

export interface PageLinkSyncResult {
  currentSource: string
  mutated: boolean
  error?: string
}

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

/**
 * Resolves a page-link reference to an absolute file path.
 * If the reference lacks an extension, auto-appends `.md` so that
 * `[[6-10]]` resolves to `/docs/6-10.md`, matching the actual file name.
 */
function resolveLinkPath(reference: string, basePath: string): string | null {
  if (!reference) {
    return null
  }
  if (reference.includes('/') || reference.includes('\\')) {
    return reference
  }
  const parentDir = basePath.split('\\').join('/').split('/').slice(0, -1).join('/')
  // If the reference has no extension (e.g. "6-10"), append .md so it resolves
  // to the actual file on disk (e.g. "6-10.md").
  const hasExtension = reference.includes('.')
  const resolvedReference = hasExtension ? reference : `${reference}.md`
  if (parentDir) {
    return `${parentDir}/${resolvedReference}`
  }
  return resolvedReference
}

function getBasenameFromPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

/**
 * Builds a new source string with an updated page-link property.
 * Preserves the raw value exactly as provided (e.g. `[[doc.md]]`).
 */
function buildSourceWithLink(
  source: string,
  key: 'nextPage' | 'previousPage',
  rawValue: unknown,
): string {
  const document = parseFrontmatterDocument(source)
  const stringValue = typeof rawValue === 'string' ? rawValue : 'N/A'
  const hasLink = extractLinkPath(stringValue) !== null
  const value = hasLink ? stringValue : 'N/A'
  const nextEntries = setFrontmatterValue(document.frontmatter, key, value)
  return serializeFrontmatterDocument({
    hasFrontmatter: true,
    frontmatter: nextEntries,
    body: document.body,
  })
}

/**
 * Detects if setting a link would create a cycle.
 * Walks forward from targetPath following nextPage links.
 * Walks backward from targetPath following previousPage links.
 */
export async function detectPageLinkCycle(
  startPath: string,
  targetReference: string,
  basePath: string,
  readSource: (path: string) => Promise<string | null>,
  visitedPaths = new Set<string>(),
  maxDepth = 50,
): Promise<boolean> {
  const targetPath = resolveLinkPath(targetReference, basePath)
  if (!targetPath) {
    return false
  }

  const normalizedStart = startPath.split('\\').join('/').toLowerCase()
  const normalizedTarget = targetPath.split('\\').join('/').toLowerCase()

  if (visitedPaths.has(normalizedTarget)) {
    return false
  }

  if (normalizedTarget === normalizedStart) {
    return true
  }

  if (visitedPaths.size >= maxDepth) {
    return false
  }

  const nextVisited = new Set(visitedPaths)
  nextVisited.add(normalizedTarget)

  const source = await readSource(targetPath)
  if (source === null) {
    return false
  }

  const document = parseFrontmatterDocument(source)
  const nextRef = extractLinkPath(getFrontmatterValue(document.frontmatter, 'nextPage'))
  const prevRef = extractLinkPath(getFrontmatterValue(document.frontmatter, 'previousPage'))

  // Walk forward
  if (nextRef) {
    const hasForwardCycle = await detectPageLinkCycle(
      startPath,
      nextRef,
      targetPath,
      readSource,
      nextVisited,
      maxDepth,
    )
    if (hasForwardCycle) {
      return true
    }
  }

  // Walk backward
  if (prevRef) {
    const hasBackwardCycle = await detectPageLinkCycle(
      startPath,
      prevRef,
      targetPath,
      readSource,
      nextVisited,
      maxDepth,
    )
    if (hasBackwardCycle) {
      return true
    }
  }

  return false
}

/**
 * Synchronizes a page-link property bidirectionally.
 * - Clears the old target's opposite link.
 * - Sets the new target's opposite link.
 * - Returns the updated source for the current document.
 *
 * @param currentPath  Absolute path of the current document.
 * @param currentSource Full source of the current document (frontmatter + body).
 * @param key           'nextPage' or 'previousPage'.
 * @param oldValue      Previous raw value (e.g. 'N/A' or '[[doc.md]]').
 * @param newValue      New raw value (e.g. 'N/A' or '[[doc.md]]').
 */
export async function syncPageLink(
  currentPath: string,
  currentSource: string,
  key: 'nextPage' | 'previousPage',
  oldValue: unknown,
  newValue: unknown,
  readSource: (path: string) => Promise<string | null>,
  writeSource: (path: string, source: string) => Promise<void>,
): Promise<PageLinkSyncResult> {
  const oppositeKey = key === 'nextPage' ? 'previousPage' : 'nextPage'

  const oldReference = extractLinkPath(oldValue)
  const newReference = extractLinkPath(newValue)
  const oldPath = oldReference ? resolveLinkPath(oldReference, currentPath) : null
  const newPath = newReference ? resolveLinkPath(newReference, currentPath) : null

  // No change
  if (oldPath === newPath) {
    return { currentSource, mutated: false }
  }

  // Detect cycle before creating new link
  if (newPath && newReference) {
    const hasCycle = await detectPageLinkCycle(currentPath, newReference, currentPath, readSource)
    if (hasCycle) {
      return {
        currentSource,
        mutated: false,
        error: 'No se puede crear un ciclo de paginas.',
      }
    }
  }

  // Build updated source for current document (preserves raw wikilink format)
  const nextSource = buildSourceWithLink(currentSource, key, newValue)

  // Clear old target's opposite link
  if (oldPath && oldPath !== newPath) {
    try {
      const oldTargetSource = await readSource(oldPath)
      if (oldTargetSource !== null) {
        const oldParsed = parseFrontmatterDocument(oldTargetSource)
        const oldOppositeRaw = getFrontmatterValue(oldParsed.frontmatter, oppositeKey)
        const oldOppositeRef = extractLinkPath(oldOppositeRaw)
        const oldOppositePath = oldOppositeRef ? resolveLinkPath(oldOppositeRef, oldPath) : null

        const normalizedCurrent = currentPath.split('\\').join('/').toLowerCase()
        const normalizedOldOpposite = oldOppositePath
          ? oldOppositePath.split('\\').join('/').toLowerCase()
          : null

        if (normalizedOldOpposite === normalizedCurrent) {
          const updatedOld = buildSourceWithLink(oldTargetSource, oppositeKey, 'N/A')
          await writeSource(oldPath, updatedOld)
          notiaLog('pageLinkSync', 'Cleared old target opposite link', { oldPath, oppositeKey })
        }
      } else {
        notiaLog('pageLinkSync', 'Old target not found during clear', { oldPath })
      }
    } catch (error) {
      notiaLog('pageLinkSync', 'Failed to clear old target opposite link', { oldPath, error: String(error) }, 'warn')
    }
  }

  // Set new target's opposite link
  if (newPath) {
    try {
      const newTargetSource = await readSource(newPath)
      if (newTargetSource !== null) {
        // Use the basename of the current file as the wikilink reference.
        // This keeps the link clickable when both files are in the same directory.
        const currentBasename = getBasenameFromPath(currentPath)
        const linkValue = `[[${currentBasename}]]`
        const updatedTarget = buildSourceWithLink(newTargetSource, oppositeKey, linkValue)
        await writeSource(newPath, updatedTarget)
        notiaLog('pageLinkSync', 'Set new target opposite link', { newPath, oppositeKey, linkValue })
      } else {
        notiaLog('pageLinkSync', 'New target not found during set', { newPath })
      }
    } catch (error) {
      notiaLog('pageLinkSync', 'Failed to set new target opposite link', { newPath, error: String(error) }, 'warn')
    }
  }

  return { currentSource: nextSource, mutated: true }
}

/**
 * Convenience wrapper for nextPage (for backward compatibility).
 * @deprecated Use syncPageLink directly.
 */
export async function syncNextPage(
  currentPath: string,
  currentSource: string,
  nextReference: string | null,
  readSource: (path: string) => Promise<string | null>,
  writeSource: (path: string, source: string) => Promise<void>,
): Promise<PageLinkSyncResult> {
  const document = parseFrontmatterDocument(currentSource)
  const oldValue = getFrontmatterValue(document.frontmatter, 'nextPage')
  return syncPageLink(currentPath, currentSource, 'nextPage', oldValue, nextReference, readSource, writeSource)
}

/**
 * Convenience wrapper for previousPage (for backward compatibility).
 * @deprecated Use syncPageLink directly.
 */
export async function syncPreviousPage(
  currentPath: string,
  currentSource: string,
  previousReference: string | null,
  readSource: (path: string) => Promise<string | null>,
  writeSource: (path: string, source: string) => Promise<void>,
): Promise<PageLinkSyncResult> {
  const document = parseFrontmatterDocument(currentSource)
  const oldValue = getFrontmatterValue(document.frontmatter, 'previousPage')
  return syncPageLink(currentPath, currentSource, 'previousPage', oldValue, previousReference, readSource, writeSource)
}
