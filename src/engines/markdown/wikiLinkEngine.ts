import { resolveFileViewKind } from '../../services/views/fileViewResolver'
import type { NotiaFileNode } from '../../types/notia'
import type { MarkdownWikiLinkTarget } from '../../types/views/markdownWikiLink'
import { getFileExtension } from '../../utils/files/getFileExtension'

const MAX_WIKI_LINK_SUGGESTIONS = 10

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

export type MarkdownWikiLinkLookup = Map<string, MarkdownWikiLinkTarget>

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
}

function stripFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return fileName
  }

  return fileName.slice(0, dotIndex)
}

function toRelativePath(filePath: string, rootPath: string | null): string {
  const normalizedFilePath = normalizePath(filePath)
  if (!rootPath) {
    return normalizedFilePath.split('/').pop() ?? normalizedFilePath
  }

  const normalizedRootPath = normalizePath(rootPath)
  if (normalizedFilePath === normalizedRootPath) {
    return normalizedFilePath.split('/').pop() ?? normalizedFilePath
  }

  if (normalizedFilePath.startsWith(`${normalizedRootPath}/`)) {
    return normalizedFilePath.slice(normalizedRootPath.length + 1)
  }

  return normalizedFilePath.split('/').pop() ?? normalizedFilePath
}

function collectWikiLinkTargets(
  nodes: NotiaFileNode[],
  rootPath: string | null,
  targets: MarkdownWikiLinkTarget[],
): void {
  for (const node of nodes) {
    if (node.type === 'folder') {
      collectWikiLinkTargets(node.children ?? [], rootPath, targets)
      continue
    }

    if (!node.path) {
      continue
    }

    const extension = getFileExtension(node.path)
    const viewKind = resolveFileViewKind(extension)
    if (viewKind !== 'markdown' && viewKind !== 'inkdoc') {
      continue
    }

    const relativePathWithExtension = toRelativePath(node.path, rootPath)
    const relativePath = stripFileExtension(relativePathWithExtension)
    const title = stripFileExtension(node.name)

    targets.push({
      path: node.path,
      name: node.name,
      title,
      relativePath,
      relativePathWithExtension,
      wikiLink: title,
    })
  }
}

export function buildWikiLinkTargets(
  nodes: NotiaFileNode[],
  rootPath: string | null,
): MarkdownWikiLinkTarget[] {
  const collectedTargets: MarkdownWikiLinkTarget[] = []
  collectWikiLinkTargets(nodes, rootPath, collectedTargets)

  const repeatedTitles = new Set<string>()
  const titleCounts = new Map<string, number>()
  for (const target of collectedTargets) {
    const key = target.title.toLowerCase()
    const nextCount = (titleCounts.get(key) ?? 0) + 1
    titleCounts.set(key, nextCount)
    if (nextCount > 1) {
      repeatedTitles.add(key)
    }
  }

  const normalizedTargets = collectedTargets
    .map((target) => ({
      ...target,
      wikiLink: repeatedTitles.has(target.title.toLowerCase()) ? target.relativePath : target.title,
    }))
    .sort((left, right) => {
      const titleCompare = left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
      if (titleCompare !== 0) {
        return titleCompare
      }

      return left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' })
    })

  return normalizedTargets
}

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

function scoreWikiLinkTarget(target: MarkdownWikiLinkTarget, query: string): number | null {
  const normalizedQuery = normalizeWikiLinkReference(query)
  if (!normalizedQuery) {
    return 100
  }

  const title = normalizeWikiLinkReference(target.title)
  const wikiLink = normalizeWikiLinkReference(target.wikiLink)
  const relativePath = normalizeWikiLinkReference(target.relativePath)

  if (title === normalizedQuery || wikiLink === normalizedQuery || relativePath === normalizedQuery) {
    return 0
  }

  if (title.startsWith(normalizedQuery)) {
    return 1
  }

  if (wikiLink.startsWith(normalizedQuery)) {
    return 2
  }

  if (relativePath.startsWith(normalizedQuery)) {
    return 3
  }

  if (title.includes(normalizedQuery)) {
    return 4
  }

  if (wikiLink.includes(normalizedQuery)) {
    return 5
  }

  if (relativePath.includes(normalizedQuery)) {
    return 6
  }

  return null
}

export function searchWikiLinkTargets(
  targets: MarkdownWikiLinkTarget[],
  query: string,
  limit = MAX_WIKI_LINK_SUGGESTIONS,
): MarkdownWikiLinkTarget[] {
  const scoredTargets = targets
    .map((target) => ({
      target,
      score: scoreWikiLinkTarget(target, query),
    }))
    .filter((item): item is { target: MarkdownWikiLinkTarget; score: number } => item.score !== null)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score
      }

      const leftDistance = Math.abs(left.target.wikiLink.length - query.length)
      const rightDistance = Math.abs(right.target.wikiLink.length - query.length)
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance
      }

      return left.target.title.localeCompare(right.target.title, undefined, { sensitivity: 'base' })
    })

  return scoredTargets.slice(0, Math.max(limit, 1)).map((item) => item.target)
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
