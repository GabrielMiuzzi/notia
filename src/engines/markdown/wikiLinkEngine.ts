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
  /**
   * Where the text the link shows sits inside the match: `nota` in
   * `[[nota.md]]`, `alias` in `[[nota|alias]]`. The rest is syntax.
   */
  labelStartOffset: number
  labelEndOffset: number
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

/**
 * Undoes the escape the Markdown writer puts on the brackets of a wikilink:
 * it writes `[` as `\[` so it cannot start a link, which turned `[[nota]]`
 * into `\[\[nota]]` on every save. Only complete links are restored.
 */
export function restoreEscapedWikiLinks(markdown: string): string {
  return markdown.replace(/\\\[\\\[(?=[^\n\]]+?\]\])/g, '[[')
}

export function findWikiLinkMatches(text: string): WikiLinkTextMatch[] {
  const matches: WikiLinkTextMatch[] = []
  const pattern = /\[\[([^\n\]]+?)\]\]/g

  let result = pattern.exec(text)
  while (result) {
    const fullMatch = result[0]
    const inner = result[1] ?? ''
    const rawInner = inner.trim()
    const reference = normalizeWikiLinkReference(rawInner)
    // The alias is shown when there is one; otherwise the reference without `.md`.
    const innerStart = result.index + 2
    const pipe = inner.indexOf('|')
    const alias = pipe >= 0 ? inner.slice(pipe + 1) : ''
    const [segment, segmentStart] = alias.trim()
      ? [alias, innerStart + pipe + 1]
      : [pipe >= 0 ? inner.slice(0, pipe) : inner, innerStart]
    const labelStartOffset = segmentStart + segment.length - segment.trimStart().length
    const labelEndOffset = labelStartOffset + segment.trim().replace(/\.md$/i, '').length
    const displayLabel = text.slice(labelStartOffset, labelEndOffset)

    if (rawInner && reference) {
      matches.push({
        startOffset: result.index,
        endOffset: result.index + fullMatch.length,
        labelStartOffset,
        labelEndOffset,
        rawInner,
        reference,
        displayLabel,
      })
    }

    result = pattern.exec(text)
  }

  return matches
}
