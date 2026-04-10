import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildGraphFileStructureSignature,
  buildLibraryGraphModel,
  collectGraphSourceFilePaths,
} from '../engines/graph/libraryGraphEngine'
import { readLibraryFileContent } from '../services/libraries/libraryDocumentRuntime'
import { startPerformanceMeasurement } from '../services/runtime/performanceBaseline'
import type { NotiaFileNode } from '../types/notia'
import type { LibraryGraphModel } from '../types/graph/libraryGraph'
import type { GraphModelWorkerResponse } from '../types/graph/graphWorker'

const GRAPH_SOURCE_SIGNATURE_SEPARATOR = '\u0001'
const GRAPH_SOURCE_READ_BATCH_SIZE = 6
const GRAPH_SOURCE_CACHE_LIMIT = 8
const EMPTY_GRAPH_MODEL: LibraryGraphModel = {
  nodes: [],
  edges: [],
}

const graphSourceSnapshotCache = new Map<string, Record<string, string>>()

interface UseLibraryGraphDataParams {
  enabled?: boolean
  libraryPath: string | null
  libraryAndroidTreeUri?: string
  rootPath: string | null
  treeNodes: NotiaFileNode[]
  revision: number
}

async function loadGraphSourcesByPath(
  filePaths: string[],
  libraryAndroidTreeUri?: string,
): Promise<Record<string, string>> {
  const nextSourcesByPath: Record<string, string> = {}

  for (let index = 0; index < filePaths.length; index += GRAPH_SOURCE_READ_BATCH_SIZE) {
    const batchPaths = filePaths.slice(index, index + GRAPH_SOURCE_READ_BATCH_SIZE)
    const batchEntries = await Promise.all(
      batchPaths.map(async (pathValue) => {
        const result = await readLibraryFileContent(pathValue, {
          androidDirectoryUri: libraryAndroidTreeUri,
        })
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
  libraryAndroidTreeUri,
  rootPath,
  treeNodes,
  revision,
}: UseLibraryGraphDataParams) {
  const [graphSourcesByPath, setGraphSourcesByPath] = useState<Record<string, string>>({})
  const [activeSnapshotCacheKey, setActiveSnapshotCacheKey] = useState('')
  const [graphModel, setGraphModel] = useState<LibraryGraphModel>(EMPTY_GRAPH_MODEL)
  const [isGraphModelPending, setIsGraphModelPending] = useState(false)
  const [workerMode, setWorkerMode] = useState<'worker' | 'fallback'>(() => (typeof Worker === 'undefined' ? 'fallback' : 'worker'))
  const [isWorkerReady, setIsWorkerReady] = useState(workerMode === 'fallback')
  const workerRef = useRef<Worker | null>(null)
  const activeModelRequestIdRef = useRef(0)
  const pendingGraphModelMeasurementRef = useRef<{
    requestId: number
    measurement: ReturnType<typeof startPerformanceMeasurement>
  } | null>(null)

  const cancelPendingGraphModelMeasurement = (reason: string) => {
    const pendingMeasurement = pendingGraphModelMeasurementRef.current
    if (!pendingMeasurement) {
      return
    }

    pendingMeasurement.measurement.cancel({ reason })
    pendingGraphModelMeasurementRef.current = null
  }

  useEffect(() => {
    if (workerMode !== 'worker') {
      setIsWorkerReady(true)
      return
    }

    setIsWorkerReady(false)

    try {
      const worker = new Worker(new URL('../workers/graphModelWorker.ts', import.meta.url), {
        type: 'module',
      })

      workerRef.current = worker
      worker.onmessage = (event: MessageEvent<GraphModelWorkerResponse>) => {
        const response = event.data
        if (response.requestId !== activeModelRequestIdRef.current) {
          return
        }

        const pendingMeasurement = pendingGraphModelMeasurementRef.current

        if (response.type === 'graphModelBuildError') {
          if (pendingMeasurement?.requestId === response.requestId) {
            pendingMeasurement.measurement.error(new Error(response.message))
            pendingGraphModelMeasurementRef.current = null
          }
          setIsGraphModelPending(false)
          return
        }

        if (pendingMeasurement?.requestId === response.requestId) {
          pendingMeasurement.measurement.success({
            edgeCount: response.graphModel.edges.length,
            nodeCount: response.graphModel.nodes.length,
          })
          pendingGraphModelMeasurementRef.current = null
        }

        startTransition(() => {
          setGraphModel(response.graphModel)
          setIsGraphModelPending(false)
        })
      }
      worker.onerror = () => {
        cancelPendingGraphModelMeasurement('worker_error')
        setIsGraphModelPending(false)
        worker.terminate()
        if (workerRef.current === worker) {
          workerRef.current = null
        }
        setWorkerMode('fallback')
      }

      setIsWorkerReady(true)

      return () => {
        cancelPendingGraphModelMeasurement('worker_terminated')
        worker.terminate()
        if (workerRef.current === worker) {
          workerRef.current = null
        }
      }
    } catch {
      setWorkerMode('fallback')
      setIsWorkerReady(true)
      return undefined
    }
  }, [workerMode])

  const graphFileStructureSignature = useMemo(() => {
    if (!enabled) {
      return ''
    }

    return buildGraphFileStructureSignature(treeNodes)
  }, [enabled, treeNodes])

  const graphTreeNodes = useMemo(() => treeNodes, [graphFileStructureSignature])

  const graphSourcePathSignature = useMemo(() => {
    if (!enabled) {
      return ''
    }

    const graphSourcePaths = collectGraphSourceFilePaths(graphTreeNodes).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' }),
    )
    return graphSourcePaths.join(GRAPH_SOURCE_SIGNATURE_SEPARATOR)
  }, [enabled, graphTreeNodes])

  const currentSnapshotCacheKey =
    enabled && libraryPath && graphSourcePathSignature
      ? `${libraryPath}::${graphSourcePathSignature}`
      : ''

  const graphStructureCacheKey =
    enabled && (libraryPath || rootPath) && graphFileStructureSignature
      ? `${libraryPath ?? rootPath}::${graphFileStructureSignature}`
      : ''

  useEffect(() => {
    if (enabled) {
      return
    }

    activeModelRequestIdRef.current = 0
    cancelPendingGraphModelMeasurement('disabled')
    startTransition(() => {
      setGraphModel(EMPTY_GRAPH_MODEL)
      setIsGraphModelPending(false)
    })
  }, [enabled])

  useEffect(() => {
    if (!enabled || !graphStructureCacheKey) {
      activeModelRequestIdRef.current += 1
      cancelPendingGraphModelMeasurement('graph_structure_reset')
      startTransition(() => {
        setGraphModel(EMPTY_GRAPH_MODEL)
        setIsGraphModelPending(false)
      })
      return
    }

    activeModelRequestIdRef.current += 1
    cancelPendingGraphModelMeasurement('graph_structure_changed')
    startTransition(() => {
      setGraphModel(EMPTY_GRAPH_MODEL)
      setIsGraphModelPending(false)
    })
  }, [enabled, graphStructureCacheKey])

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
    const graphLoadMeasurement = startPerformanceMeasurement('graph.load_sources', {
      fileCount: graphSourcePaths.length,
      libraryPath: libraryPath ?? undefined,
      revision,
    })
    void loadGraphSourcesByPath(graphSourcePaths, libraryAndroidTreeUri).then((nextSourcesByPath) => {
      if (!isCurrent) {
        graphLoadMeasurement.cancel({
          fileCount: graphSourcePaths.length,
        })
        return
      }

      cacheGraphSourceSnapshot(currentSnapshotCacheKey, nextSourcesByPath)
      setGraphSourcesByPath(nextSourcesByPath)
      setActiveSnapshotCacheKey(currentSnapshotCacheKey)
      graphLoadMeasurement.success({
        loadedFileCount: Object.keys(nextSourcesByPath).length,
      })
    }).catch((error) => {
      graphLoadMeasurement.error(error, {
        fileCount: graphSourcePaths.length,
      })
    })

    return () => {
      isCurrent = false
      graphLoadMeasurement.cancel({
        fileCount: graphSourcePaths.length,
      })
    }
  }, [currentSnapshotCacheKey, enabled, graphSourcePathSignature, libraryAndroidTreeUri, libraryPath, revision])

  const hasUsableSnapshot = Boolean(currentSnapshotCacheKey) && activeSnapshotCacheKey === currentSnapshotCacheKey

  const effectiveGraphSourcesByPath = useMemo(() => {
    if (!enabled || !hasUsableSnapshot) {
      return {}
    }

    return graphSourcesByPath
  }, [enabled, graphSourcesByPath, hasUsableSnapshot])

  useEffect(() => {
    if (!enabled) {
      return
    }

    if (workerMode === 'worker' && (!isWorkerReady || !workerRef.current)) {
      return
    }

    const activeWorker = workerRef.current

    cancelPendingGraphModelMeasurement('superseded')

    const requestId = activeModelRequestIdRef.current + 1
    activeModelRequestIdRef.current = requestId

    const graphModelMeasurement = startPerformanceMeasurement('graph.build_model', {
      libraryPath: libraryPath ?? undefined,
      nodeTreeSize: graphTreeNodes.length,
      revision,
      sourceCount: Object.keys(effectiveGraphSourcesByPath).length,
    })
    pendingGraphModelMeasurementRef.current = {
      requestId,
      measurement: graphModelMeasurement,
    }
    setIsGraphModelPending(true)

    if (workerMode === 'worker') {
      activeWorker?.postMessage({
        type: 'buildGraphModel',
        requestId,
        treeNodes: graphTreeNodes,
        rootPath,
        graphSourcesByPath: effectiveGraphSourcesByPath,
      })

      return () => {
        if (pendingGraphModelMeasurementRef.current?.requestId === requestId) {
          cancelPendingGraphModelMeasurement('cleanup')
        }
      }
    }

    try {
      const nextGraphModel = buildLibraryGraphModel(graphTreeNodes, rootPath, effectiveGraphSourcesByPath)
      graphModelMeasurement.success({
        edgeCount: nextGraphModel.edges.length,
        nodeCount: nextGraphModel.nodes.length,
      })
      pendingGraphModelMeasurementRef.current = null
      startTransition(() => {
        setGraphModel(nextGraphModel)
        setIsGraphModelPending(false)
      })
    } catch (error) {
      graphModelMeasurement.error(error, {
        libraryPath: libraryPath ?? undefined,
      })
      pendingGraphModelMeasurementRef.current = null
      setIsGraphModelPending(false)
    }

    return undefined
  }, [
    effectiveGraphSourcesByPath,
    enabled,
    graphTreeNodes,
    isWorkerReady,
    libraryPath,
    revision,
    rootPath,
    workerMode,
  ])

  return {
    graphModel,
    graphSourcesByPath: effectiveGraphSourcesByPath,
    isGraphLoading:
      enabled &&
      ((Boolean(currentSnapshotCacheKey) && !hasUsableSnapshot) || isGraphModelPending),
  }
}
