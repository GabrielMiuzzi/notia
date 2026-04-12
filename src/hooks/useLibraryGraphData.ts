import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildGraphFileStructureSignature,
  buildLibraryGraphModel,
} from '../engines/graph/libraryGraphEngine'
import { getIndexedLibraryGraphSourcesByPath } from '../services/libraries/librarySearchGraphIndex'
import { startPerformanceMeasurement } from '../services/runtime/performanceBaseline'
import type { NotiaFileNode } from '../types/notia'
import type { LibraryGraphModel } from '../types/graph/libraryGraph'
import type { GraphModelWorkerResponse } from '../types/graph/graphWorker'
import { getRuntimeDevice } from '../utils/platform/getRuntimeDevice'

const EMPTY_GRAPH_MODEL: LibraryGraphModel = {
  nodes: [],
  edges: [],
}
const MAIN_THREAD_GRAPH_MODEL_TREE_NODE_THRESHOLD = 600

interface UseLibraryGraphDataParams {
  enabled?: boolean
  libraryPath: string | null
  libraryAndroidTreeUri?: string
  rootPath: string | null
  treeNodes: NotiaFileNode[]
  revision: number
}

function countTreeNodes(nodes: NotiaFileNode[]): number {
  let count = 0

  const visit = (currentNodes: NotiaFileNode[]) => {
    for (const node of currentNodes) {
      count += 1
      if (node.children && node.children.length > 0) {
        visit(node.children)
      }
    }
  }

  visit(nodes)
  return count
}

export function useLibraryGraphData({
  enabled = true,
  libraryPath,
  libraryAndroidTreeUri,
  rootPath,
  treeNodes,
  revision,
}: UseLibraryGraphDataParams) {
  const runtimeDevice = useMemo(() => getRuntimeDevice(), [])
  const [graphSourcesByPath, setGraphSourcesByPath] = useState<Record<string, string>>({})
  const [graphModel, setGraphModel] = useState<LibraryGraphModel>(EMPTY_GRAPH_MODEL)
  const [isGraphSourcesPending, setIsGraphSourcesPending] = useState(false)
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
  const graphTreeNodeCount = useMemo(() => countTreeNodes(graphTreeNodes), [graphTreeNodes])
  const shouldPreferMainThreadGraphModelBuild =
    runtimeDevice !== 'Android'
    && graphTreeNodeCount <= MAIN_THREAD_GRAPH_MODEL_TREE_NODE_THRESHOLD

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
      setGraphSourcesByPath({})
      setGraphModel(EMPTY_GRAPH_MODEL)
      setIsGraphSourcesPending(false)
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
      setGraphSourcesByPath({})
      setGraphModel(EMPTY_GRAPH_MODEL)
      setIsGraphSourcesPending(false)
      setIsGraphModelPending(false)
    })
  }, [enabled, graphStructureCacheKey])

  useEffect(() => {
    if (!enabled) {
      return
    }

    if (!libraryPath) {
      setGraphSourcesByPath({})
      setIsGraphSourcesPending(false)
      return
    }

    let isCurrent = true
    setIsGraphSourcesPending(true)
    const graphLoadMeasurement = startPerformanceMeasurement('graph.load_sources', {
      libraryPath: libraryPath ?? undefined,
      revision,
    })
    void getIndexedLibraryGraphSourcesByPath({
      libraryPath,
      treeNodes: graphTreeNodes,
      androidDirectoryUri: libraryAndroidTreeUri,
    }).then((nextSourcesByPath) => {
      if (!isCurrent) {
        graphLoadMeasurement.cancel()
        return
      }

      setGraphSourcesByPath(nextSourcesByPath)
      setIsGraphSourcesPending(false)
      graphLoadMeasurement.success({
        loadedFileCount: Object.keys(nextSourcesByPath).length,
      })
    }).catch((error) => {
      if (isCurrent) {
        setIsGraphSourcesPending(false)
      }
      graphLoadMeasurement.error(error, {
        libraryPath: libraryPath ?? undefined,
      })
    })

    return () => {
      isCurrent = false
      setIsGraphSourcesPending(false)
      graphLoadMeasurement.cancel()
    }
  }, [enabled, graphTreeNodes, libraryAndroidTreeUri, libraryPath, revision])

  useEffect(() => {
    if (!enabled) {
      return
    }

    if (!shouldPreferMainThreadGraphModelBuild && workerMode === 'worker' && (!isWorkerReady || !workerRef.current)) {
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
      sourceCount: Object.keys(graphSourcesByPath).length,
    })
    pendingGraphModelMeasurementRef.current = {
      requestId,
      measurement: graphModelMeasurement,
    }
    setIsGraphModelPending(true)

    if (!shouldPreferMainThreadGraphModelBuild && workerMode === 'worker') {
      activeWorker?.postMessage({
        type: 'buildGraphModel',
        requestId,
        treeNodes: graphTreeNodes,
        rootPath,
        graphSourcesByPath,
      })

      return () => {
        if (pendingGraphModelMeasurementRef.current?.requestId === requestId) {
          cancelPendingGraphModelMeasurement('cleanup')
        }
      }
    }

    try {
      const nextGraphModel = buildLibraryGraphModel(graphTreeNodes, rootPath, graphSourcesByPath)
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
    enabled,
    graphSourcesByPath,
    graphTreeNodes,
    graphTreeNodeCount,
    isWorkerReady,
    libraryPath,
    revision,
    rootPath,
    runtimeDevice,
    shouldPreferMainThreadGraphModelBuild,
    workerMode,
  ])

  return {
    graphModel,
    graphSourcesByPath,
    isGraphLoading:
      enabled &&
      (isGraphSourcesPending || isGraphModelPending),
  }
}
