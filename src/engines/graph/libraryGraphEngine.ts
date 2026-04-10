import { findWikiLinkMatches } from '../markdown/wikiLinkEngine'
import { resolveFileViewKind } from '../../services/views/fileViewResolver'
import type { NotiaFileNode } from '../../types/notia'
import type { LibraryGraphEdge, LibraryGraphModel, LibraryGraphNode } from '../../types/graph/libraryGraph'
import { getFileExtension } from '../../utils/files/getFileExtension'

type MarkdownSourcesByPath = Record<string, string>
type PathLookup = Map<string, string | null>

interface FileDescriptor {
  path: string
  label: string
  logicalPath: string
  relativePath: string
  relativePathWithoutExtension: string
  fileName: string
  fileNameWithoutExtension: string
  isMarkdown: boolean
}

interface ParsedPath {
  prefix: string
  segments: string[]
}

const MARKDOWN_LINK_PATTERN = /!?\[[^\]]*]\(([^)\n]+)\)/g
const LEGACY_ESCAPED_WIKI_LINK_PATTERN = /\\\[\\\[([^\n\]]+?)\]\]/g

function normalizePath(pathValue: string): string {
  const withForwardSlashes = pathValue.replace(/\\/g, '/')
  const schemeMatch = withForwardSlashes.match(/^([a-zA-Z][a-zA-Z\d+.-]*:\/\/)(.*)$/)
  if (schemeMatch) {
    const [, schemePrefix, rest] = schemeMatch
    return `${schemePrefix}${rest.replace(/\/+/g, '/').replace(/\/$/, '')}`
  }

  return withForwardSlashes.replace(/\/+/g, '/').replace(/\/$/, '')
}

function normalizeLookupKey(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase()
}

function stripFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return fileName
  }

  return fileName.slice(0, dotIndex)
}

function hasFileExtension(pathValue: string): boolean {
  return /\.[^/.]+$/.test(pathValue)
}

function isExternalReference(reference: string): boolean {
  if (!reference) {
    return true
  }

  if (reference.startsWith('#') || reference.startsWith('//')) {
    return true
  }

  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(reference)
}

function parsePath(pathValue: string): ParsedPath {
  const normalizedPath = normalizePath(pathValue)

  const windowsRootMatch = normalizedPath.match(/^([a-zA-Z]:)(?:\/(.*))?$/)
  if (windowsRootMatch) {
    const drivePrefix = `${windowsRootMatch[1]}/`
    const rest = windowsRootMatch[2] ?? ''
    return {
      prefix: drivePrefix,
      segments: rest.split('/').filter(Boolean),
    }
  }

  if (normalizedPath.startsWith('/')) {
    return {
      prefix: '/',
      segments: normalizedPath.slice(1).split('/').filter(Boolean),
    }
  }

  return {
    prefix: '',
    segments: normalizedPath.split('/').filter(Boolean),
  }
}

function stringifyParsedPath(pathParts: ParsedPath): string {
  if (pathParts.prefix === '/') {
    return `/${pathParts.segments.join('/')}`
  }

  if (/^[a-zA-Z]:\/$/.test(pathParts.prefix)) {
    return pathParts.segments.length > 0 ? `${pathParts.prefix}${pathParts.segments.join('/')}` : pathParts.prefix
  }

  return pathParts.segments.join('/')
}

function resolveRelativePath(basePath: string, relativeReference: string): string {
  const base = parsePath(basePath)
  const nextSegments = [...base.segments]

  for (const segment of relativeReference.split('/')) {
    if (!segment || segment === '.') {
      continue
    }

    if (segment === '..') {
      nextSegments.pop()
      continue
    }

    nextSegments.push(segment)
  }

  return normalizePath(stringifyParsedPath({ prefix: base.prefix, segments: nextSegments }))
}

function getParentDirectoryPath(filePath: string): string {
  const normalizedPath = normalizePath(filePath)
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/')
  if (lastSeparatorIndex < 0) {
    return ''
  }

  if (lastSeparatorIndex === 0) {
    return '/'
  }

  return normalizedPath.slice(0, lastSeparatorIndex)
}

function collectFileDescriptors(
  nodes: NotiaFileNode[],
  descriptors: FileDescriptor[],
  parentLogicalPath = '',
): void {
  for (const node of nodes) {
    if (node.type === 'folder') {
      const nextParentLogicalPath = parentLogicalPath ? `${parentLogicalPath}/${node.name}` : node.name
      collectFileDescriptors(node.children ?? [], descriptors, nextParentLogicalPath)
      continue
    }

    if (!node.path) {
      continue
    }

    const normalizedPath = normalizePath(node.path)
    const logicalPath = parentLogicalPath ? `${parentLogicalPath}/${node.name}` : node.name
    const relativePath = logicalPath
    descriptors.push({
      path: normalizedPath,
      label: relativePath,
      logicalPath,
      relativePath,
      relativePathWithoutExtension: stripFileExtension(relativePath),
      fileName: node.name,
      fileNameWithoutExtension: stripFileExtension(node.name),
      isMarkdown: /\.md$/i.test(node.name),
    })
  }
}

function registerLookupKey(lookup: PathLookup, key: string, pathValue: string): void {
  const normalizedKey = normalizeLookupKey(key)
  if (!normalizedKey) {
    return
  }

  const previousValue = lookup.get(normalizedKey)
  if (previousValue === undefined) {
    lookup.set(normalizedKey, pathValue)
    return
  }

  if (previousValue !== pathValue) {
    lookup.set(normalizedKey, null)
  }
}

function buildPathLookup(fileDescriptors: FileDescriptor[]): PathLookup {
  const lookup: PathLookup = new Map()

  for (const descriptor of fileDescriptors) {
    registerLookupKey(lookup, descriptor.path, descriptor.path)
    registerLookupKey(lookup, descriptor.logicalPath, descriptor.path)
    registerLookupKey(lookup, descriptor.relativePath, descriptor.path)
    registerLookupKey(lookup, descriptor.relativePathWithoutExtension, descriptor.path)
    registerLookupKey(lookup, descriptor.fileName, descriptor.path)
    registerLookupKey(lookup, descriptor.fileNameWithoutExtension, descriptor.path)
  }

  return lookup
}

function sanitizeLinkReference(rawReference: string): string {
  const trimmedReference = rawReference.trim()
  if (!trimmedReference) {
    return ''
  }

  const withoutAngleBrackets =
    trimmedReference.startsWith('<') && trimmedReference.endsWith('>')
      ? trimmedReference.slice(1, -1)
      : trimmedReference

  const withoutFragment = withoutAngleBrackets.split('#', 1)[0]
  const withoutQuery = withoutFragment.split('?', 1)[0]
  const withoutQuotes = withoutQuery.replace(/^['"]|['"]$/g, '')

  try {
    return decodeURIComponent(withoutQuotes)
  } catch {
    return withoutQuotes
  }
}

function extractMarkdownLinkReferences(sourceContent: string): string[] {
  const references: string[] = []
  MARKDOWN_LINK_PATTERN.lastIndex = 0
  let match = MARKDOWN_LINK_PATTERN.exec(sourceContent)

  while (match) {
    const rawHref = (match[1] ?? '').trim()
    if (rawHref) {
      const firstToken = rawHref.split(/\s+/, 1)[0] ?? ''
      const sanitizedReference = sanitizeLinkReference(firstToken)
      if (sanitizedReference && !isExternalReference(sanitizedReference)) {
        references.push(sanitizedReference)
      }
    }

    match = MARKDOWN_LINK_PATTERN.exec(sourceContent)
  }

  return references
}

function extractWikiLinkReferences(sourceContent: string): string[] {
  const references: string[] = []

  for (const wikiMatch of findWikiLinkMatches(sourceContent)) {
    const rawReference = wikiMatch.rawInner.split('|', 1)[0]?.trim() ?? ''
    const sanitizedReference = sanitizeLinkReference(rawReference)
    if (!sanitizedReference || isExternalReference(sanitizedReference)) {
      continue
    }

    references.push(sanitizedReference)
  }

  return references
}

function extractLegacyEscapedWikiLinkReferences(sourceContent: string): string[] {
  const references: string[] = []

  LEGACY_ESCAPED_WIKI_LINK_PATTERN.lastIndex = 0
  let match = LEGACY_ESCAPED_WIKI_LINK_PATTERN.exec(sourceContent)

  while (match) {
    const rawInner = match[1]?.trim() ?? ''
    const rawReference = rawInner.split('|', 1)[0]?.trim() ?? ''
    const sanitizedReference = sanitizeLinkReference(rawReference)
    if (sanitizedReference && !isExternalReference(sanitizedReference)) {
      references.push(sanitizedReference)
    }

    match = LEGACY_ESCAPED_WIKI_LINK_PATTERN.exec(sourceContent)
  }

  return references
}

function extractAllLinkReferences(sourceContent: string): string[] {
  const uniqueReferences = new Set<string>()
  for (const reference of extractWikiLinkReferences(sourceContent)) {
    uniqueReferences.add(reference)
  }
  for (const reference of extractLegacyEscapedWikiLinkReferences(sourceContent)) {
    uniqueReferences.add(reference)
  }
  for (const reference of extractMarkdownLinkReferences(sourceContent)) {
    uniqueReferences.add(reference)
  }

  return [...uniqueReferences]
}

function extractInkDocLinkReferences(sourceContent: string): string[] {
  const uniqueReferences = new Set<string>()

  try {
    const parsedDocument = JSON.parse(sourceContent) as {
      pages?: Array<{ textBlocks?: Array<{ text?: string; html?: string; type?: string }> }>
    }

    for (const page of parsedDocument.pages ?? []) {
      for (const block of page.textBlocks ?? []) {
        if (block.type === 'latex') {
          continue
        }

        const linkSource = typeof block.html === 'string' && block.html.trim().length > 0 ? block.html : block.text ?? ''
        if (!linkSource) {
          continue
        }

        for (const reference of extractWikiLinkReferences(linkSource)) {
          uniqueReferences.add(reference)
        }
      }
    }
  } catch {
    return []
  }

  return [...uniqueReferences]
}

function extractGraphLinkReferences(filePath: string, sourceContent: string): string[] {
  const extension = getFileExtension(filePath)
  const viewKind = resolveFileViewKind(extension)

  if (viewKind === 'inkdoc') {
    return extractInkDocLinkReferences(sourceContent)
  }

  if (viewKind === 'markdown') {
    return extractAllLinkReferences(sourceContent)
  }

  return []
}

function resolveReferenceCandidates(
  sourceLogicalPath: string,
  rawReference: string,
): string[] {
  const sanitizedReference = sanitizeLinkReference(rawReference)
  if (!sanitizedReference || isExternalReference(sanitizedReference)) {
    return []
  }

  const normalizedReference = sanitizeLinkReference(normalizePath(sanitizedReference))
  if (!normalizedReference) {
    return []
  }

  const candidates = new Set<string>()

  const sourceDirectoryPath = getParentDirectoryPath(sourceLogicalPath)
  candidates.add(resolveRelativePath(sourceDirectoryPath, normalizedReference))

  if (/^([a-zA-Z]:)?\//.test(normalizedReference)) {
    candidates.add(normalizePath(normalizedReference))
    if (normalizedReference.startsWith('/')) {
      candidates.add(normalizedReference.slice(1))
    }
  }

  return [...candidates]
}

function resolveTargetPath(
  sourceLogicalPath: string,
  rawReference: string,
  pathLookup: PathLookup,
): string | null {
  const referenceCandidates = resolveReferenceCandidates(sourceLogicalPath, rawReference)
  for (const candidate of referenceCandidates) {
    const directLookupPath = pathLookup.get(normalizeLookupKey(candidate))
    if (directLookupPath) {
      return directLookupPath
    }
    if (!hasFileExtension(candidate)) {
      const markdownLookupPath = pathLookup.get(normalizeLookupKey(`${candidate}.md`))
      if (markdownLookupPath) {
        return markdownLookupPath
      }
    }
  }

  const normalizedReferenceKey = normalizeLookupKey(rawReference)
  const lookupPath = pathLookup.get(normalizedReferenceKey)
  if (lookupPath) {
    return lookupPath
  }

  const withoutExtensionReference = stripFileExtension(rawReference)
  const normalizedWithoutExtensionKey = normalizeLookupKey(withoutExtensionReference)
  const lookupPathWithoutExtension = pathLookup.get(normalizedWithoutExtensionKey)
  if (lookupPathWithoutExtension) {
    return lookupPathWithoutExtension
  }

  return null
}

function buildGraphNodes(fileDescriptors: FileDescriptor[]): LibraryGraphNode[] {
  return fileDescriptors
    .map((descriptor) => ({
      id: descriptor.path,
      path: descriptor.path,
      label: descriptor.fileNameWithoutExtension || descriptor.fileName || descriptor.label,
      degree: 0,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }))
}

function collectGraphStructureTokens(
  nodes: NotiaFileNode[],
  tokens: string[],
  parentLogicalPath = '',
): void {
  for (const node of nodes) {
    const logicalPath = parentLogicalPath ? `${parentLogicalPath}/${node.name}` : node.name

    if (node.type === 'folder') {
      tokens.push(`folder:${logicalPath}`)
      collectGraphStructureTokens(node.children ?? [], tokens, logicalPath)
      continue
    }

    tokens.push(`file:${logicalPath}\u0001${node.path ? normalizePath(node.path) : ''}`)
  }
}

export function buildGraphFileStructureSignature(nodes: NotiaFileNode[]): string {
  const tokens: string[] = []
  collectGraphStructureTokens(nodes, tokens)
  return tokens.join('\u0002')
}

export function collectGraphSourceFilePaths(nodes: NotiaFileNode[]): string[] {
  const descriptors: FileDescriptor[] = []
  collectFileDescriptors(nodes, descriptors)

  return descriptors
    .filter((descriptor) => {
      const extension = getFileExtension(descriptor.path)
      const viewKind = resolveFileViewKind(extension)
      return viewKind === 'markdown' || viewKind === 'inkdoc'
    })
    .map((descriptor) => descriptor.path)
}

export function buildLibraryGraphModel(
  nodes: NotiaFileNode[],
  _rootPath: string | null,
  markdownSourcesByPath: MarkdownSourcesByPath,
): LibraryGraphModel {
  const fileDescriptors: FileDescriptor[] = []
  collectFileDescriptors(nodes, fileDescriptors)
  if (fileDescriptors.length === 0) {
    return { nodes: [], edges: [] }
  }

  const graphNodes = buildGraphNodes(fileDescriptors)
  const pathLookup = buildPathLookup(fileDescriptors)
  const relativePathByNodePath = new Map(fileDescriptors.map((descriptor) => [descriptor.path, descriptor.relativePath]))
  const edgeKeySet = new Set<string>()
  const graphEdges: LibraryGraphEdge[] = []

  for (const [rawSourcePath, sourceContent] of Object.entries(markdownSourcesByPath)) {
    const sourcePath = normalizePath(rawSourcePath)
    const sourceRelativePath = relativePathByNodePath.get(sourcePath)
    if (!sourceRelativePath) {
      continue
    }

    for (const linkReference of extractGraphLinkReferences(sourcePath, sourceContent)) {
      const targetPath = resolveTargetPath(sourceRelativePath, linkReference, pathLookup)
      if (!targetPath || sourcePath === targetPath) {
        continue
      }

      const sourceAndTarget = [sourcePath, targetPath].sort((left, right) => left.localeCompare(right))
      const edgeKey = `${sourceAndTarget[0]}<=>${sourceAndTarget[1]}`
      if (edgeKeySet.has(edgeKey)) {
        continue
      }

      edgeKeySet.add(edgeKey)
      graphEdges.push({
        id: edgeKey,
        sourcePath: sourceAndTarget[0],
        targetPath: sourceAndTarget[1],
      })
    }
  }

  const nodeDegreeByPath = new Map<string, number>()
  for (const edge of graphEdges) {
    nodeDegreeByPath.set(edge.sourcePath, (nodeDegreeByPath.get(edge.sourcePath) ?? 0) + 1)
    nodeDegreeByPath.set(edge.targetPath, (nodeDegreeByPath.get(edge.targetPath) ?? 0) + 1)
  }

  const nodesWithDegree = graphNodes.map((node) => ({
    ...node,
    degree: nodeDegreeByPath.get(node.path) ?? 0,
  }))

  return {
    nodes: nodesWithDegree,
    edges: graphEdges,
  }
}
