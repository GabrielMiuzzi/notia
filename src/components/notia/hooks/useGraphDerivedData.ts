import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react'
import {
  buildClusteredGraphLayout,
  type ClusteredGraphLayout,
  type ClusteredGraphLayoutOptions,
} from '../../../engines/graph/clusteredGraphLayoutEngine'
import { buildGraphSearchResults, type GraphSearchResult } from '../../../engines/graph/graphSearchEngine'
import { startPerformanceMeasurement } from '../../../services/runtime/performanceBaseline'
import type { LibraryGraphModel } from '../../../types/graph/libraryGraph'
import type { GraphViewWorkerResponse } from '../../../types/graph/graphWorker'

const EMPTY_GRAPH_LAYOUT: ClusteredGraphLayout = {
  nodes: [],
  edges: [],
}
const MAIN_THREAD_GRAPH_NODE_THRESHOLD = 240
const MAIN_THREAD_GRAPH_EDGE_THRESHOLD = 960

interface UseGraphDerivedDataParams {
  enabled?: boolean
  graphModel: LibraryGraphModel
  graphSourcesByPath: Record<string, string>
  canvasSize: {
    width: number
    height: number
  }
  layoutOptions: ClusteredGraphLayoutOptions
  searchQuery: string
}

type WorkerMode = 'worker' | 'fallback'

export function useGraphDerivedData({
  enabled = true,
  graphModel,
  graphSourcesByPath,
  canvasSize,
  layoutOptions,
  searchQuery,
}: UseGraphDerivedDataParams) {
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const shouldPreferMainThreadDerivation =
    graphModel.nodes.length <= MAIN_THREAD_GRAPH_NODE_THRESHOLD
    && graphModel.edges.length <= MAIN_THREAD_GRAPH_EDGE_THRESHOLD
  const [graphLayout, setGraphLayout] = useState<ClusteredGraphLayout>(EMPTY_GRAPH_LAYOUT)
  const [searchResults, setSearchResults] = useState<GraphSearchResult[]>([])
  const [isGraphDerivedDataLoading, setIsGraphDerivedDataLoading] = useState(false)
  const [workerMode, setWorkerMode] = useState<WorkerMode>(() => (typeof Worker === 'undefined' ? 'fallback' : 'worker'))
  const [isWorkerReady, setIsWorkerReady] = useState(workerMode === 'fallback')
  const workerRef = useRef<Worker | null>(null)
  const activeRequestIdRef = useRef(0)
  const pendingMeasurementRef = useRef<{
    requestId: number
    measurement: ReturnType<typeof startPerformanceMeasurement>
  } | null>(null)

  const cancelPendingMeasurement = (reason: string) => {
    const pendingMeasurement = pendingMeasurementRef.current
    if (!pendingMeasurement) {
      return
    }

    pendingMeasurement.measurement.cancel({ reason })
    pendingMeasurementRef.current = null
  }

  useEffect(() => {
    if (workerMode !== 'worker') {
      setIsWorkerReady(true)
      return
    }

    setIsWorkerReady(false)

    try {
      const worker = new Worker(new URL('../../../workers/graphViewWorker.ts', import.meta.url), {
        type: 'module',
      })

      workerRef.current = worker
      worker.onmessage = (event: MessageEvent<GraphViewWorkerResponse>) => {
        const response = event.data
        if (response.requestId !== activeRequestIdRef.current) {
          return
        }

        const pendingMeasurement = pendingMeasurementRef.current

        if (response.type === 'graphDerivedDataError') {
          if (pendingMeasurement?.requestId === response.requestId) {
            pendingMeasurement.measurement.error(new Error(response.message))
            pendingMeasurementRef.current = null
          }
          setIsGraphDerivedDataLoading(false)
          return
        }

        if (pendingMeasurement?.requestId === response.requestId) {
          pendingMeasurement.measurement.success({
            edgeCount: response.graphLayout.edges.length,
            nodeCount: response.graphLayout.nodes.length,
            searchResultCount: response.searchResults.length,
          })
          pendingMeasurementRef.current = null
        }

        startTransition(() => {
          setGraphLayout(response.graphLayout)
          setSearchResults(response.searchResults)
          setIsGraphDerivedDataLoading(false)
        })
      }
      worker.onerror = () => {
        cancelPendingMeasurement('worker_error')
        setIsGraphDerivedDataLoading(false)
        worker.terminate()
        if (workerRef.current === worker) {
          workerRef.current = null
        }
        setWorkerMode('fallback')
      }

      setIsWorkerReady(true)

      return () => {
        cancelPendingMeasurement('worker_terminated')
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

  useEffect(() => {
    if (enabled) {
      return
    }

    activeRequestIdRef.current = 0
    cancelPendingMeasurement('disabled')
    startTransition(() => {
      setGraphLayout(EMPTY_GRAPH_LAYOUT)
      setSearchResults([])
      setIsGraphDerivedDataLoading(false)
    })
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      return
    }

    activeRequestIdRef.current += 1
    cancelPendingMeasurement('graph_data_changed')
    startTransition(() => {
      setGraphLayout(EMPTY_GRAPH_LAYOUT)
      setSearchResults([])
      setIsGraphDerivedDataLoading(false)
    })
  }, [enabled, graphModel, graphSourcesByPath])

  useEffect(() => {
    const activeWorker = workerRef.current
    if (!enabled || shouldPreferMainThreadDerivation || workerMode !== 'worker' || !isWorkerReady || !activeWorker) {
      return
    }

    activeWorker.postMessage({
      type: 'hydrateGraphData',
      graphModel,
      graphSourcesByPath,
    })
  }, [enabled, graphModel, graphSourcesByPath, isWorkerReady, shouldPreferMainThreadDerivation, workerMode])

  useEffect(() => {
    if (!enabled || canvasSize.width <= 0 || canvasSize.height <= 0) {
      setIsGraphDerivedDataLoading(false)
      return
    }

    if (!shouldPreferMainThreadDerivation && workerMode === 'worker' && (!isWorkerReady || !workerRef.current)) {
      return
    }

    const activeWorker = workerRef.current

    cancelPendingMeasurement('superseded')

    const requestId = activeRequestIdRef.current + 1
    activeRequestIdRef.current = requestId

    const graphDeriveMeasurement = startPerformanceMeasurement('graph.derive_view', {
      canvasHeight: canvasSize.height,
      canvasWidth: canvasSize.width,
      nodeCount: graphModel.nodes.length,
      searchQueryLength: deferredSearchQuery.trim().length,
    })
    pendingMeasurementRef.current = {
      requestId,
      measurement: graphDeriveMeasurement,
    }
    setIsGraphDerivedDataLoading(true)

    if (!shouldPreferMainThreadDerivation && workerMode === 'worker') {
      activeWorker?.postMessage({
        type: 'computeGraphDerivedData',
        requestId,
        canvasWidth: canvasSize.width,
        canvasHeight: canvasSize.height,
        layoutOptions,
        searchQuery: deferredSearchQuery,
      })

      return () => {
        if (pendingMeasurementRef.current?.requestId === requestId) {
          cancelPendingMeasurement('cleanup')
        }
      }
    }

    try {
      const nextGraphLayout = buildClusteredGraphLayout(graphModel, canvasSize.width, canvasSize.height, layoutOptions)
      const nextSearchResults = buildGraphSearchResults(graphModel, graphSourcesByPath, deferredSearchQuery)
      graphDeriveMeasurement.success({
        edgeCount: nextGraphLayout.edges.length,
        nodeCount: nextGraphLayout.nodes.length,
        searchResultCount: nextSearchResults.length,
      })
      pendingMeasurementRef.current = null
      startTransition(() => {
        setGraphLayout(nextGraphLayout)
        setSearchResults(nextSearchResults)
        setIsGraphDerivedDataLoading(false)
      })
    } catch (error) {
      graphDeriveMeasurement.error(error, {
        canvasHeight: canvasSize.height,
        canvasWidth: canvasSize.width,
      })
      pendingMeasurementRef.current = null
      setIsGraphDerivedDataLoading(false)
    }

    return undefined
  }, [
    canvasSize.height,
    canvasSize.width,
    deferredSearchQuery,
    enabled,
    graphModel,
    graphSourcesByPath,
    isWorkerReady,
    layoutOptions,
    shouldPreferMainThreadDerivation,
    workerMode,
  ])

  return {
    graphLayout,
    isGraphDerivedDataLoading,
    searchResults,
  }
}
