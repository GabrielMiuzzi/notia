import { resolveFileViewKind } from '../../services/views/fileViewResolver'
import type { MarkdownWikiLinkTarget } from '../../types/views/markdownWikiLink'
import { getFileExtension } from '../../utils/files/getFileExtension'

export interface InlineWikiLinkContext {
  query: string
  startOffset: number
  endOffset: number
}

export interface WikiLinkTextMatch {
  startOffset: number
  endOffset: number
  rawInner: string
  reference: string
  displayLabel: string
}

/*
 * Wikilinks inside the editor: finding the link being typed and the links of
 * a text, and resolving each one against the targets the backend listed
 * (`library_link_targets`). Suggestions come from the backend.
 */

export type MarkdownWikiLinkLookup = Map<string, MarkdownWikiLinkTarget>

export function normalizeWikiLinkReference(value: string): string {
  const rawReference = value.split('|')[0]?.trim() ?? ''
  if (!rawReference) {
    return ''
  }

  const normalizedPath = rawReference
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')

  const extension = getFileExtension(normalizedPath)
  if (resolveFileViewKind(extension) === 'markdown') {
    const suffixLength = extension.length + 1
    return normalizedPath.slice(0, normalizedPath.length - suffixLength).toLowerCase()
  }

  return normalizedPath.toLowerCase()
}

function registerLookupKey(
  lookup: MarkdownWikiLinkLookup,
  rawReference: string,
  target: MarkdownWikiLinkTarget,
): void {
  const normalizedReference = normalizeWikiLinkReference(rawReference)
  if (!normalizedReference || lookup.has(normalizedReference)) {
    return
  }

  lookup.set(normalizedReference, target)
}

export function buildWikiLinkLookup(targets: MarkdownWikiLinkTarget[]): MarkdownWikiLinkLookup {
  const lookup: MarkdownWikiLinkLookup = new Map()

  for (const target of targets) {
    registerLookupKey(lookup, target.wikiLink, target)
    registerLookupKey(lookup, target.title, target)
    registerLookupKey(lookup, target.relativePath, target)
    registerLookupKey(lookup, target.relativePathWithExtension, target)
    registerLookupKey(lookup, target.name, target)
  }

  return lookup
}

export function resolveWikiLinkTarget(
  lookup: MarkdownWikiLinkLookup,
  rawReference: string,
): MarkdownWikiLinkTarget | null {
  const normalizedReference = normalizeWikiLinkReference(rawReference)
  if (!normalizedReference) {
    return null
  }

  return lookup.get(normalizedReference) ?? null
}

export function findActiveWikiLinkContext(text: string, cursorOffset: number): InlineWikiLinkContext | null {
  if (cursorOffset < 0 || cursorOffset > text.length) {
    return null
  }

  const openIndex = text.lastIndexOf('[[', Math.max(cursorOffset - 1, 0))
  if (openIndex < 0) {
    return null
  }

  if (openIndex + 2 > cursorOffset) {
    return null
  }

  const closeIndex = text.indexOf(']]', openIndex + 2)
  if (closeIndex >= 0 && cursorOffset >= closeIndex + 2) {
    return null
  }

  const hasNestedOpen = text.slice(openIndex + 2, cursorOffset).includes('[[')
  if (hasNestedOpen) {
    return null
  }

  const queryEnd = closeIndex >= 0 ? closeIndex : cursorOffset
  const query = text.slice(openIndex + 2, queryEnd)
  if (query.includes(']')) {
    return null
  }

  return {
    query,
    startOffset: openIndex,
    endOffset: closeIndex >= 0 ? closeIndex + 2 : cursorOffset,
  }
}

export function findWikiLinkMatches(text: string): WikiLinkTextMatch[] {
  const matches: WikiLinkTextMatch[] = []
  const pattern = /\[\[([^\n\]]+?)\]\]/g

  let result = pattern.exec(text)
  while (result) {
    const fullMatch = result[0]
    const rawInner = result[1]?.trim() ?? ''
    const reference = normalizeWikiLinkReference(rawInner)
    const [rawReferencePart, rawAliasPart] = rawInner.split('|', 2)
    const displayLabel = (rawAliasPart?.trim() || rawReferencePart?.trim() || rawInner).replace(/\.md$/i, '')

    if (rawInner && reference) {
      matches.push({
        startOffset: result.index,
        endOffset: result.index + fullMatch.length,
        rawInner,
        reference,
        displayLabel,
      })
    }

    result = pattern.exec(text)
  }

  return matches
}
