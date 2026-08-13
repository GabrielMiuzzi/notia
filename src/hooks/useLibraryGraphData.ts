import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildGraphFileStructureSignature,
  buildGraphFileStructureSignatureFromFlatList,
  buildLibraryGraphModel,
} from '../engines/graph/libraryGraphEngine'
import { getIndexedLibraryGraphSourcesByPath } from '../services/libraries/librarySearchGraphIndex'
import { startPerformanceMeasurement } from '../services/runtime/performanceBaseline'
import type { NotiaFileNode, NotiaFlatFileEntry } from '../types/notia'
import type { LibraryGraphModel } from '../types/graph/libraryGraph'
import { scheduleLibraryLinkCacheRebuild } from '../services/libraries/libraryLinkCacheSchedule'

const EMPTY_GRAPH_MODEL: LibraryGraphModel = {
  nodes: [],
  edges: [],
}

interface UseLibraryGraphDataParams {
  enabled?: boolean
  libraryPath: string | null
  libraryAndroidTreeUri?: string
  rootPath: string | null
  treeNodes: NotiaFileNode[]
  flatFileList: NotiaFlatFileEntry[]
  revision: number
}

export function useLibraryGraphData({
  enabled = true,
  libraryPath,
  libraryAndroidTreeUri,
  rootPath,
  treeNodes,
  flatFileList,
  revision,
}: UseLibraryGraphDataParams) {
  const [graphSourcesByPath, setGraphSourcesByPath] = useState<Record<string, string>>({})
  const [graphModel, setGraphModel] = useState<LibraryGraphModel>(EMPTY_GRAPH_MODEL)
  const [isGraphSourcesPending, setIsGraphSourcesPending] = useState(false)
  const [isGraphModelPending, setIsGraphModelPending] = useState(false)
  const pendingGraphModelMeasurementRef = useRef<{
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

  const graphFileStructureSignature = useMemo(() => {
    if (!enabled) {
      return ''
    }

    // On Android with a flat file list, use it for a more complete signature
    if (flatFileList.length > 0) {
      return buildGraphFileStructureSignatureFromFlatList(flatFileList)
    }

    return buildGraphFileStructureSignature(treeNodes)
  }, [enabled, treeNodes, flatFileList])

  const graphTreeNodes = useMemo(() => treeNodes, [graphFileStructureSignature])

  const graphStructureCacheKey =
    enabled && (libraryPath || rootPath) && graphFileStructureSignature
      ? `${libraryPath ?? rootPath}::${graphFileStructureSignature}`
      : ''

  useEffect(() => {
    if (enabled) {
      return
    }

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
      cancelPendingGraphModelMeasurement('graph_structure_reset')
      startTransition(() => {
        setGraphModel(EMPTY_GRAPH_MODEL)
        setIsGraphModelPending(false)
      })
      return
    }

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
      treeNodes: flatFileList.length > 0 ? undefined : graphTreeNodes,
      flatFileList: flatFileList.length > 0 ? flatFileList : undefined,
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
  }, [enabled, graphTreeNodes, libraryAndroidTreeUri, libraryPath, revision, flatFileList])

  useEffect(() => {
    if (!enabled) {
      return
    }

    if (!graphStructureCacheKey) {
      return
    }

    cancelPendingGraphModelMeasurement('superseded')

    const graphModelMeasurement = startPerformanceMeasurement('graph.build_model', {
      libraryPath: libraryPath ?? undefined,
      nodeTreeSize: graphTreeNodes.length,
      revision,
      sourceCount: Object.keys(graphSourcesByPath).length,
    })
    pendingGraphModelMeasurementRef.current = {
      measurement: graphModelMeasurement,
    }
    setIsGraphModelPending(true)

    try {
      const nextGraphModel = buildLibraryGraphModel(
        graphTreeNodes,
        rootPath,
        graphSourcesByPath,
        flatFileList.length > 0 ? flatFileList : undefined,
      )
      graphModelMeasurement.success({
        edgeCount: nextGraphModel.edges.length,
        nodeCount: nextGraphModel.nodes.length,
      })
      pendingGraphModelMeasurementRef.current = null
      startTransition(() => {
        setGraphModel(nextGraphModel)
        setIsGraphModelPending(false)
      })

      // --- Trigger linkCache.md regeneration in background ---
      if (libraryPath) {
        scheduleLibraryLinkCacheRebuild({
          libraryPath,
          treeNodes: graphTreeNodes,
          flatFileList: flatFileList.length > 0 ? flatFileList : undefined,
          androidDirectoryUri: libraryAndroidTreeUri,
        })
      }
    } catch (error) {
      graphModelMeasurement.error(error, {
        libraryPath: libraryPath ?? undefined,
      })
      pendingGraphModelMeasurementRef.current = null
      setIsGraphModelPending(false)
    }

    return () => {
      cancelPendingGraphModelMeasurement('cleanup')
    }
  }, [
    enabled,
    graphSourcesByPath,
    graphTreeNodes,
    graphStructureCacheKey,
    libraryPath,
    revision,
    rootPath,
    libraryAndroidTreeUri,
    flatFileList,
  ])

  return {
    graphModel,
    graphSourcesByPath,
    isGraphLoading:
      enabled &&
      (isGraphSourcesPending || isGraphModelPending),
  }
}
