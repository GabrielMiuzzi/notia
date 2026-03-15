import { useEffect, useMemo, useState } from 'react'
import { buildLibraryGraphModel, collectGraphSourceFilePaths } from '../engines/graph/libraryGraphEngine'
import { readLibraryFileContent } from '../services/libraries/libraryDocumentRuntime'
import type { NotiaFileNode } from '../types/notia'

const GRAPH_SOURCE_SIGNATURE_SEPARATOR = '\u0001'
const GRAPH_SOURCE_READ_BATCH_SIZE = 6
const GRAPH_SOURCE_CACHE_LIMIT = 8

const graphSourceSnapshotCache = new Map<string, Record<string, string>>()

interface UseLibraryGraphDataParams {
  enabled?: boolean
  libraryPath: string | null
  rootPath: string | null
  treeNodes: NotiaFileNode[]
  revision: number
}

async function loadGraphSourcesByPath(filePaths: string[]): Promise<Record<string, string>> {
  const nextSourcesByPath: Record<string, string> = {}

  for (let index = 0; index < filePaths.length; index += GRAPH_SOURCE_READ_BATCH_SIZE) {
    const batchPaths = filePaths.slice(index, index + GRAPH_SOURCE_READ_BATCH_SIZE)
    const batchEntries = await Promise.all(
      batchPaths.map(async (pathValue) => {
        const result = await readLibraryFileContent(pathValue)
        if (!result.ok) {
          return null
        }

        return { path: pathValue, content: result.content }
      }),
    )

    for (const entry of batchEntries) {
      if (!entry) {
        continue
      }

      nextSourcesByPath[entry.path] = entry.content
    }
  }

  return nextSourcesByPath
}

function cacheGraphSourceSnapshot(cacheKey: string, sourcesByPath: Record<string, string>): void {
  graphSourceSnapshotCache.set(cacheKey, sourcesByPath)

  if (graphSourceSnapshotCache.size <= GRAPH_SOURCE_CACHE_LIMIT) {
    return
  }

  const oldestCacheKey = graphSourceSnapshotCache.keys().next().value
  if (oldestCacheKey) {
    graphSourceSnapshotCache.delete(oldestCacheKey)
  }
}

export function useLibraryGraphData({
  enabled = true,
  libraryPath,
  rootPath,
  treeNodes,
  revision,
}: UseLibraryGraphDataParams) {
  const [graphSourcesByPath, setGraphSourcesByPath] = useState<Record<string, string>>({})
  const [activeSnapshotCacheKey, setActiveSnapshotCacheKey] = useState('')

  const graphSourcePathSignature = useMemo(() => {
    if (!enabled) {
      return ''
    }

    const graphSourcePaths = collectGraphSourceFilePaths(treeNodes).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' }),
    )
    return graphSourcePaths.join(GRAPH_SOURCE_SIGNATURE_SEPARATOR)
  }, [enabled, treeNodes])

  const currentSnapshotCacheKey =
    enabled && libraryPath && graphSourcePathSignature
      ? `${libraryPath}::${graphSourcePathSignature}`
      : ''

  useEffect(() => {
    if (!enabled) {
      return
    }

    if (!currentSnapshotCacheKey || !graphSourcePathSignature) {
      return
    }

    let isCurrent = true
    const cachedSnapshot = graphSourceSnapshotCache.get(currentSnapshotCacheKey)
    if (cachedSnapshot) {
      setGraphSourcesByPath(cachedSnapshot)
      setActiveSnapshotCacheKey(currentSnapshotCacheKey)
    }

    const graphSourcePaths = graphSourcePathSignature.split(GRAPH_SOURCE_SIGNATURE_SEPARATOR)
    void loadGraphSourcesByPath(graphSourcePaths).then((nextSourcesByPath) => {
      if (!isCurrent) {
        return
      }

      cacheGraphSourceSnapshot(currentSnapshotCacheKey, nextSourcesByPath)
      setGraphSourcesByPath(nextSourcesByPath)
      setActiveSnapshotCacheKey(currentSnapshotCacheKey)
    })

    return () => {
      isCurrent = false
    }
  }, [currentSnapshotCacheKey, enabled, graphSourcePathSignature, revision])

  const hasUsableSnapshot = Boolean(currentSnapshotCacheKey) && activeSnapshotCacheKey === currentSnapshotCacheKey

  const effectiveGraphSourcesByPath = useMemo(() => {
    if (!enabled || !hasUsableSnapshot) {
      return {}
    }

    return graphSourcesByPath
  }, [enabled, graphSourcesByPath, hasUsableSnapshot])

  const graphModel = useMemo(
    () => (enabled ? buildLibraryGraphModel(treeNodes, rootPath, effectiveGraphSourcesByPath) : { nodes: [], edges: [] }),
    [effectiveGraphSourcesByPath, enabled, rootPath, treeNodes],
  )

  return {
    graphModel,
    graphSourcesByPath: effectiveGraphSourcesByPath,
    isGraphLoading: enabled && Boolean(currentSnapshotCacheKey) && !hasUsableSnapshot,
  }
}
