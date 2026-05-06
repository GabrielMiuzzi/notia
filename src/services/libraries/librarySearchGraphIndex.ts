import { normalizeGraphSearchText, extractSearchableContent } from '../../engines/graph/graphSearchEngine'
import type { NotiaFileNode, NotiaFlatFileEntry } from '../../types/notia'
import { getFileExtension } from '../../utils/files/getFileExtension'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { notiaLog, notiaTimer } from '../runtime/notiaLogger'
import { readLibraryFileContent } from './libraryDocumentRuntime'
import { resolveFileViewKind } from '../views/fileViewResolver'

const INDEX_CACHE_LIMIT = 8
const INDEX_READ_BATCH_SIZE = 6

interface SearchGraphDescriptor {
  path: string
  label: string
  normalizedLabel: string
  graphSource: boolean
  searchableContent: boolean
}

interface SearchGraphEntry extends SearchGraphDescriptor {
  rawContent: string
  searchContent: string
  normalizedSearchContent: string
  hasGraphContent: boolean
  hasSearchContent: boolean
}

interface SearchGraphIndexState {
  libraryPath: string
  androidDirectoryUri?: string
  treeSignature: string
  descriptorsByPath: Map<string, SearchGraphDescriptor>
  entriesByPath: Map<string, SearchGraphEntry>
  dirtyPathHints: Set<string>
  requiresFullRefresh: boolean
}

interface EnsureLibrarySearchGraphIndexParams {
  libraryPath: string
  treeNodes?: NotiaFileNode[]
  flatFileList?: NotiaFlatFileEntry[]
  androidDirectoryUri?: string
  requireGraphSources?: boolean
  requireSearchableContent?: boolean
}

interface SearchIndexedLibraryFilesParams {
  libraryPath: string
  treeNodes?: NotiaFileNode[]
  flatFileList?: NotiaFlatFileEntry[]
  query: string
  androidDirectoryUri?: string
}

interface GetIndexedGraphSourcesParams {
  libraryPath: string
  treeNodes?: NotiaFileNode[]
  flatFileList?: NotiaFlatFileEntry[]
  androidDirectoryUri?: string
}

const librarySearchGraphIndexCache = new Map<string, SearchGraphIndexState>()
const inFlightLibrarySearchGraphIndexBuilds = new Map<string, Promise<SearchGraphIndexState>>()

function normalizePath(pathValue: string): string {
  return normalizeFilesystemPath(pathValue)
}

function buildLibraryCacheKey(libraryPath: string): string {
  return normalizePath(libraryPath)
}

function isSameOrNestedPath(basePath: string, candidatePath: string): boolean {
  const normalizedBasePath = normalizePath(basePath)
  const normalizedCandidatePath = normalizePath(candidatePath)

  return normalizedCandidatePath === normalizedBasePath
    || normalizedCandidatePath.startsWith(`${normalizedBasePath}/`)
}

function buildSearchGraphTreeSignature(
  nodes: NotiaFileNode[],
  tokens: string[] = [],
  parentLogicalPath = '',
): string {
  for (const node of nodes) {
    const logicalPath = parentLogicalPath ? `${parentLogicalPath}/${node.name}` : node.name

    if (node.type === 'folder') {
      tokens.push(`folder:${logicalPath}`)
      buildSearchGraphTreeSignature(node.children ?? [], tokens, logicalPath)
      continue
    }

    tokens.push(`file:${logicalPath}\u0001${node.path ? normalizePath(node.path) : ''}`)
  }

  return tokens.join('\u0002')
}

/** Build a signature from a flat file list. The path is the logical path
 *  relative to the library root, so we can use it directly. */
function buildSearchGraphFlatFileSignature(files: NotiaFlatFileEntry[]): string {
  const tokens: string[] = []
  for (const file of files) {
    const logicalPath = file.path
    if (file.type === 'folder') {
      tokens.push(`folder:${logicalPath}`)
    } else {
      tokens.push(`file:${logicalPath}\u0001${normalizePath(logicalPath)}`)
    }
  }
  return tokens.join('\u0002')
}

function collectSearchGraphDescriptors(
  nodes: NotiaFileNode[],
  descriptorsByPath: Map<string, SearchGraphDescriptor>,
  parentLogicalPath = '',
): void {
  for (const node of nodes) {
    const logicalPath = parentLogicalPath ? `${parentLogicalPath}/${node.name}` : node.name

    if (node.type === 'folder') {
      collectSearchGraphDescriptors(node.children ?? [], descriptorsByPath, logicalPath)
      continue
    }

    if (!node.path) {
      continue
    }

    const normalizedPath = normalizePath(node.path)
    const extension = getFileExtension(normalizedPath)
    const viewKind = resolveFileViewKind(extension)
    descriptorsByPath.set(normalizedPath, {
      path: normalizedPath,
      label: logicalPath,
      normalizedLabel: normalizeGraphSearchText(`${logicalPath} ${node.name}`),
      graphSource: viewKind === 'markdown' || viewKind === 'inkdoc',
      searchableContent: viewKind === 'markdown' || viewKind === 'inkdoc' || viewKind === 'drawio' || viewKind === 'text',
    })
  }
}

/** Collect descriptors from a flat file list. In the flat list, `path` IS the
 *  logical path (relative to root), and for files it's also the full filesystem
 *  path once prefixed with the library root. We derive both from `path`. */
function collectSearchGraphDescriptorsFromFlatList(
  files: NotiaFlatFileEntry[],
  descriptorsByPath: Map<string, SearchGraphDescriptor>,
): void {
  for (const file of files) {
    if (file.type === 'folder') {
      continue
    }

    const logicalPath = file.path
    const normalizedPath = normalizePath(logicalPath)
    const extension = getFileExtension(normalizedPath)
    const viewKind = resolveFileViewKind(extension)
    descriptorsByPath.set(normalizedPath, {
      path: normalizedPath,
      label: logicalPath,
      normalizedLabel: normalizeGraphSearchText(`${logicalPath} ${file.name}`),
      graphSource: viewKind === 'markdown' || viewKind === 'inkdoc',
      searchableContent: viewKind === 'markdown' || viewKind === 'inkdoc' || viewKind === 'drawio' || viewKind === 'text',
    })
  }
}

function getOrCreateLibraryIndexState(
  libraryPath: string,
  androidDirectoryUri?: string,
): SearchGraphIndexState {
  const cacheKey = buildLibraryCacheKey(libraryPath)
  const cachedState = librarySearchGraphIndexCache.get(cacheKey)
  if (cachedState) {
    librarySearchGraphIndexCache.delete(cacheKey)
    cachedState.androidDirectoryUri = androidDirectoryUri
    librarySearchGraphIndexCache.set(cacheKey, cachedState)
    return cachedState
  }

  const nextState: SearchGraphIndexState = {
    libraryPath: cacheKey,
    androidDirectoryUri,
    treeSignature: '',
    descriptorsByPath: new Map(),
    entriesByPath: new Map(),
    dirtyPathHints: new Set(),
    requiresFullRefresh: false,
  }
  librarySearchGraphIndexCache.set(cacheKey, nextState)
  trimLibraryIndexCache()
  return nextState
}

function trimLibraryIndexCache(): void {
  while (librarySearchGraphIndexCache.size > INDEX_CACHE_LIMIT) {
    const oldestCacheKey = librarySearchGraphIndexCache.keys().next().value
    if (!oldestCacheKey) {
      return
    }

    librarySearchGraphIndexCache.delete(oldestCacheKey)
  }
}

function shouldRefreshEntryFromHint(pathValue: string, dirtyPathHints: Set<string>): boolean {
  for (const dirtyPathHint of dirtyPathHints) {
    if (isSameOrNestedPath(dirtyPathHint, pathValue) || isSameOrNestedPath(pathValue, dirtyPathHint)) {
      return true
    }
  }

  return false
}

function hasRequiredIndexCapabilities(
  state: SearchGraphIndexState,
  expectedTreeSignature: string,
  requireGraphSources: boolean,
  requireSearchableContent: boolean,
): boolean {
  if (state.treeSignature !== expectedTreeSignature) {
    return false
  }

  for (const descriptor of state.descriptorsByPath.values()) {
    const entry = state.entriesByPath.get(descriptor.path)
    if (!entry) {
      return false
    }

    if (requireGraphSources && descriptor.graphSource && !entry.hasGraphContent) {
      return false
    }

    if (requireSearchableContent && descriptor.searchableContent && !entry.hasSearchContent) {
      return false
    }
  }

  return true
}

async function loadEntriesIntoIndex(
  state: SearchGraphIndexState,
  descriptorsToLoad: SearchGraphDescriptor[],
): Promise<void> {
  const timer = notiaTimer('searchIndex', 'loadEntriesIntoIndex', {
    fileCount: descriptorsToLoad.length,
  })
  for (let index = 0; index < descriptorsToLoad.length; index += INDEX_READ_BATCH_SIZE) {
    const batchDescriptors = descriptorsToLoad.slice(index, index + INDEX_READ_BATCH_SIZE)
    const batchEntries = await Promise.all(
      batchDescriptors.map(async (descriptor) => {
        const existingEntry = state.entriesByPath.get(descriptor.path)
        if (!descriptor.graphSource && !descriptor.searchableContent) {
          return {
            descriptor,
            rawContent: '',
            searchContent: '',
            normalizedSearchContent: '',
            hasGraphContent: false,
            hasSearchContent: false,
          }
        }

        const result = await readLibraryFileContent(descriptor.path, {
          androidDirectoryUri: state.androidDirectoryUri,
        })

        if (!result.ok) {
          return {
            descriptor,
            rawContent: existingEntry?.rawContent ?? '',
            searchContent: existingEntry?.searchContent ?? '',
            normalizedSearchContent: existingEntry?.normalizedSearchContent ?? '',
            hasGraphContent: existingEntry?.hasGraphContent ?? false,
            hasSearchContent: existingEntry?.hasSearchContent ?? false,
          }
        }

        const rawContent = result.content
        const searchContent = descriptor.searchableContent
          ? extractSearchableContent(descriptor.path, rawContent)
          : existingEntry?.searchContent ?? ''

        return {
          descriptor,
          rawContent,
          searchContent,
          normalizedSearchContent: descriptor.searchableContent
            ? normalizeGraphSearchText(searchContent)
            : existingEntry?.normalizedSearchContent ?? '',
          hasGraphContent: descriptor.graphSource,
          hasSearchContent: descriptor.searchableContent,
        }
      }),
    )

    for (const entry of batchEntries) {
      const existingEntry = state.entriesByPath.get(entry.descriptor.path)
      state.entriesByPath.set(entry.descriptor.path, {
        ...entry.descriptor,
        rawContent: entry.descriptor.graphSource ? entry.rawContent : (existingEntry?.rawContent ?? ''),
        searchContent: entry.descriptor.searchableContent ? entry.searchContent : (existingEntry?.searchContent ?? ''),
        normalizedSearchContent: entry.descriptor.searchableContent
          ? entry.normalizedSearchContent
          : (existingEntry?.normalizedSearchContent ?? ''),
        hasGraphContent: entry.descriptor.graphSource ? entry.hasGraphContent : false,
        hasSearchContent: entry.descriptor.searchableContent ? entry.hasSearchContent : false,
      })
    }
  }

  timer.success({ fileCount: descriptorsToLoad.length })
}

async function ensureLibrarySearchGraphIndex({
  libraryPath,
  treeNodes,
  flatFileList,
  androidDirectoryUri,
  requireGraphSources = false,
  requireSearchableContent = false,
}: EnsureLibrarySearchGraphIndexParams): Promise<SearchGraphIndexState> {
  // Support either treeNodes (desktop/full tree) or flatFileList (Android background)
  const useFlatList = Boolean(flatFileList && flatFileList.length > 0)
  const effectiveNodeCount = useFlatList
    ? flatFileList!.length
    : (treeNodes?.length ?? 0)

  const timer = notiaTimer('searchIndex', 'ensureLibrarySearchGraphIndex', {
    libraryPath,
    requireGraphSources,
    requireSearchableContent,
    nodeCount: effectiveNodeCount,
    source: useFlatList ? 'flatFileList' : 'treeNodes',
  })
  const cacheKey = buildLibraryCacheKey(libraryPath)
  const expectedTreeSignature = useFlatList
    ? buildSearchGraphFlatFileSignature(flatFileList!)
    : buildSearchGraphTreeSignature(treeNodes ?? [])
  const existingBuild = inFlightLibrarySearchGraphIndexBuilds.get(cacheKey)
  if (existingBuild) {
    const settledState = await existingBuild
    if (hasRequiredIndexCapabilities(
      settledState,
      expectedTreeSignature,
      requireGraphSources,
      requireSearchableContent,
    )) {
      return settledState
    }
  }

  const buildPromise = (async () => {
    const state = getOrCreateLibraryIndexState(cacheKey, androidDirectoryUri)
    const nextDescriptorsByPath = new Map<string, SearchGraphDescriptor>()
    if (useFlatList) {
      collectSearchGraphDescriptorsFromFlatList(flatFileList!, nextDescriptorsByPath)
    } else {
      collectSearchGraphDescriptors(treeNodes ?? [], nextDescriptorsByPath)
    }
    const nextTreeSignature = expectedTreeSignature

    for (const pathValue of state.entriesByPath.keys()) {
      if (!nextDescriptorsByPath.has(pathValue)) {
        state.entriesByPath.delete(pathValue)
      }
    }

    const descriptorsToLoad: SearchGraphDescriptor[] = []
    for (const [pathValue, nextDescriptor] of nextDescriptorsByPath) {
      const previousDescriptor = state.descriptorsByPath.get(pathValue)
      const previousEntry = state.entriesByPath.get(pathValue)
      const shouldRefreshFromTreeChange =
        !previousDescriptor
        || previousDescriptor.label !== nextDescriptor.label
        || previousDescriptor.graphSource !== nextDescriptor.graphSource
        || previousDescriptor.searchableContent !== nextDescriptor.searchableContent
      const shouldRefreshFromInvalidation =
        state.requiresFullRefresh || shouldRefreshEntryFromHint(pathValue, state.dirtyPathHints)
      const needsGraphLoad =
        requireGraphSources && nextDescriptor.graphSource && (!previousEntry || !previousEntry.hasGraphContent)
      const needsSearchLoad =
        requireSearchableContent && nextDescriptor.searchableContent && (!previousEntry || !previousEntry.hasSearchContent)

      if (shouldRefreshFromTreeChange || shouldRefreshFromInvalidation || needsGraphLoad || needsSearchLoad) {
        descriptorsToLoad.push(nextDescriptor)
      } else if (previousEntry) {
        state.entriesByPath.set(pathValue, {
          ...previousEntry,
          ...nextDescriptor,
        })
      }
    }

    if (descriptorsToLoad.length > 0) {
      await loadEntriesIntoIndex(state, descriptorsToLoad)
    }

    state.treeSignature = nextTreeSignature
    state.androidDirectoryUri = androidDirectoryUri
    state.descriptorsByPath = nextDescriptorsByPath
    state.requiresFullRefresh = false
    state.dirtyPathHints.clear()
    timer.success({
      descriptorCount: nextDescriptorsByPath.size,
      filesLoaded: descriptorsToLoad.length,
    })
    return state
  })()

  inFlightLibrarySearchGraphIndexBuilds.set(cacheKey, buildPromise)
  return buildPromise.finally(() => {
    if (inFlightLibrarySearchGraphIndexBuilds.get(cacheKey) === buildPromise) {
      inFlightLibrarySearchGraphIndexBuilds.delete(cacheKey)
    }
  })
}

export function invalidateLibrarySearchGraphIndex(libraryPath: string, pathHint?: string): void {
  const normalizedLibraryPath = buildLibraryCacheKey(libraryPath)
  const state = getOrCreateLibraryIndexState(normalizedLibraryPath)
  const normalizedPathHint = typeof pathHint === 'string' && pathHint.trim()
    ? normalizePath(pathHint)
    : normalizedLibraryPath

  if (normalizedPathHint === normalizedLibraryPath) {
    state.requiresFullRefresh = true
    state.dirtyPathHints.clear()
    return
  }

  state.dirtyPathHints.add(normalizedPathHint)
}

export async function getIndexedLibraryGraphSourcesByPath({
  libraryPath,
  treeNodes,
  androidDirectoryUri,
}: GetIndexedGraphSourcesParams): Promise<Record<string, string>> {
  const state = await ensureLibrarySearchGraphIndex({
    libraryPath,
    treeNodes,
    androidDirectoryUri,
    requireGraphSources: true,
  })
  const graphSourcesByPath: Record<string, string> = {}

  for (const entry of state.entriesByPath.values()) {
    if (!entry.graphSource || !entry.hasGraphContent) {
      continue
    }

    graphSourcesByPath[entry.path] = entry.rawContent
  }

  return graphSourcesByPath
}

export async function searchIndexedLibraryFiles({
  libraryPath,
  treeNodes,
  query,
  androidDirectoryUri,
}: SearchIndexedLibraryFilesParams): Promise<string[]> {
  const normalizedQuery = normalizeGraphSearchText(query.trim())
  if (!normalizedQuery) {
    return []
  }

  const state = await ensureLibrarySearchGraphIndex({
    libraryPath,
    treeNodes,
    androidDirectoryUri,
    requireSearchableContent: true,
  })

  return [...state.entriesByPath.values()]
    .filter((entry) => (
      entry.normalizedLabel.includes(normalizedQuery)
      || (entry.hasSearchContent && entry.normalizedSearchContent.includes(normalizedQuery))
    ))
    .sort((left, right) => {
      const labelComparison = left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
      if (labelComparison !== 0) {
        return labelComparison
      }

      return left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
    })
    .map((entry) => entry.path)
}
