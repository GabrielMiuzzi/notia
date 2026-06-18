import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { getLibraryConfigDir } from './libraryConfig'
import {
  readTextFile,
  writeTextFile,
  createDirectory,
  pathExists,
} from '../files/filesystemEngine'
import { buildLibraryGraphModel } from '../../engines/graph/libraryGraphEngine'
import { buildLinkCacheMermaidCode } from '../../engines/graph/linkCacheMermaidEngine'
import { getIndexedLibraryGraphSourcesByPath } from './librarySearchGraphIndex'
import { notiaTimer } from '../runtime/notiaLogger'
import type { LibraryGraphModel } from '../../types/graph/libraryGraph'
import type { NotiaFileNode, NotiaFlatFileEntry } from '../../types/notia'

const LINK_CACHE_FILENAME = 'linkCache.md'

export function buildLibraryLinkCachePath(libraryPath: string): string {
  return `${normalizeFilesystemPath(getLibraryConfigDir(libraryPath))}/${LINK_CACHE_FILENAME}`
}

export function isLinkCachePath(filePath: string, libraryPath?: string): boolean {
  const normalizedPath = normalizeFilesystemPath(filePath)
  const normalizedFileName = normalizedPath.split('/').pop() ?? ''
  if (normalizedFileName !== LINK_CACHE_FILENAME) {
    return false
  }
  if (libraryPath) {
    const expectedPath = buildLibraryLinkCachePath(libraryPath)
    return normalizedPath === expectedPath
  }
  return true
}

export interface WriteLibraryLinkCacheOptions {
  androidDirectoryUri?: string
}

export async function writeLibraryLinkCache(
  libraryPath: string,
  mermaidCode: string,
  options?: WriteLibraryLinkCacheOptions,
): Promise<{ ok: boolean; error?: string }> {
  const configDir = getLibraryConfigDir(libraryPath)
  const cachePath = buildLibraryLinkCachePath(libraryPath)

  try {
    const dirExists = await pathExists(configDir, options)
    if (!dirExists) {
      const createResult = await createDirectory(configDir, options)
      if (!createResult.ok) {
        return { ok: false, error: 'No se pudo crear el directorio .notia.' }
      }
    }

    const result = await writeTextFile(cachePath, mermaidCode, options)
    return result
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo escribir el cache de enlaces.',
    }
  }
}

export interface ReadLibraryLinkCacheOptions {
  androidDirectoryUri?: string
}

export async function readLibraryLinkCache(
  libraryPath: string,
  options?: ReadLibraryLinkCacheOptions,
): Promise<string | null> {
  const cachePath = buildLibraryLinkCachePath(libraryPath)

  try {
    const result = await readTextFile(cachePath, options)
    if (!result.ok) {
      return null
    }
    return result.content
  } catch {
    return null
  }
}

export interface RebuildLibraryLinkCacheParams {
  libraryPath: string
  treeNodes: NotiaFileNode[]
  flatFileList?: NotiaFlatFileEntry[]
  androidDirectoryUri?: string
}

/**
 * Rebuild the link cache Mermaid diagram by re-computing the graph model
 * from the current tree and sources, then writing linkCache.md.
 */
export async function rebuildLibraryLinkCache(
  params: RebuildLibraryLinkCacheParams,
): Promise<{ ok: boolean; error?: string }> {
  const { libraryPath, treeNodes, flatFileList, androidDirectoryUri } = params

  const timer = notiaTimer('libraries', 'rebuildLibraryLinkCache', {
    libraryPath,
    nodeCount: treeNodes.length,
  })

  try {
    const graphSourcesByPath = await getIndexedLibraryGraphSourcesByPath({
      libraryPath,
      treeNodes,
      flatFileList,
      androidDirectoryUri,
    })

    const graphModel = buildLibraryGraphModel(
      treeNodes,
      libraryPath,
      graphSourcesByPath,
      flatFileList,
    )

    // Exclude the linkCache.md node itself (it shouldn't appear, but just in case)
    const filteredModel = filterLinkCacheFromGraphModel(graphModel, libraryPath)

    const { code } = buildLinkCacheMermaidCode(filteredModel, libraryPath)

    const wrappedCode = `<!-- Notia link cache - auto-generated, do not edit manually -->\n\n\`\`\`mermaid\n${code}\n\`\`\``

    const result = await writeLibraryLinkCache(libraryPath, wrappedCode, { androidDirectoryUri })
    timer.success({ nodeCount: graphModel.nodes.length, edgeCount: graphModel.edges.length })
    return result
  } catch (error) {
    timer.error(error)
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Error al regenerar linkCache.',
    }
  }
}

function filterLinkCacheFromGraphModel(
  graphModel: LibraryGraphModel,
  libraryPath: string,
): LibraryGraphModel {
  const cachePath = buildLibraryLinkCachePath(libraryPath)

  const filteredNodes = graphModel.nodes.filter((node) => node.path !== cachePath)
  const filteredNodePaths = new Set(filteredNodes.map((n) => n.path))

  const filteredEdges = graphModel.edges.filter(
    (edge) => filteredNodePaths.has(edge.sourcePath) && filteredNodePaths.has(edge.targetPath),
  )

  return {
    nodes: filteredNodes,
    edges: filteredEdges,
  }
}
