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
import { getLibraryInventoryGeneration, loadLibraryInventoryFileEntries } from '../services/libraries/libraryInventoryRuntime'
import type { LibraryContext } from '../services/contexts/libraryContexts'

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
  contexts?: readonly LibraryContext[]
  boardContextsByName?: Readonly<Record<string, string>>
}

export function useLibraryGraphData({
  enabled = true,
  libraryPath,
  libraryAndroidTreeUri,
  rootPath,
  treeNodes,
  flatFileList,
  revision,
  contexts = [],
  boardContextsByName = {},
}: UseLibraryGraphDataParams) {
  const [graphSourcesByPath, setGraphSourcesByPath] = useState<Record<string, string>>({})
  const [graphModel, setGraphModel] = useState<LibraryGraphModel>(EMPTY_GRAPH_MODEL)
  const [isGraphSourcesPending, setIsGraphSourcesPending] = useState(false)
  const [isGraphModelPending, setIsGraphModelPending] = useState(false)
  const [inventoryFlatFileList, setInventoryFlatFileList] = useState<NotiaFlatFileEntry[]>([])
  const effectiveFlatFileList = flatFileList.length > 0 ? flatFileList : inventoryFlatFileList
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
    if (effectiveFlatFileList.length > 0) {
      return buildGraphFileStructureSignatureFromFlatList(effectiveFlatFileList)
    }

    return buildGraphFileStructureSignature(treeNodes)
  }, [effectiveFlatFileList, enabled, treeNodes])

  const graphTreeNodes = useMemo(() => treeNodes, [treeNodes])

  const graphStructureCacheKey =
    enabled && (libraryPath || rootPath) && graphFileStructureSignature
      ? `${libraryPath ?? rootPath}::${graphFileStructureSignature}::${JSON.stringify(contexts)}::${JSON.stringify(boardContextsByName)}`
      : ''

  useEffect(() => {
    if (!enabled || !libraryPath || !libraryAndroidTreeUri || flatFileList.length > 0) {
      setInventoryFlatFileList([])
      return
    }
    const controller = new AbortController()
    void loadLibraryInventoryFileEntries({
      libraryPath,
      androidDirectoryUri: libraryAndroidTreeUri,
      generation: getLibraryInventoryGeneration(libraryPath),
    }, controller.signal).then((entries) => {
      if (!controller.signal.aborted) setInventoryFlatFileList(entries)
    }).catch(() => {
      if (!controller.signal.aborted) setInventoryFlatFileList([])
    })
    return () => controller.abort()
  }, [enabled, flatFileList.length, libraryAndroidTreeUri, libraryPath])

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
      treeNodes: effectiveFlatFileList.length > 0 ? undefined : graphTreeNodes,
      flatFileList: effectiveFlatFileList.length > 0 ? effectiveFlatFileList : undefined,
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
  }, [enabled, effectiveFlatFileList, graphTreeNodes, libraryAndroidTreeUri, libraryPath, revision])

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
        effectiveFlatFileList.length > 0 ? effectiveFlatFileList : undefined,
        { contexts, boardContextsByName },
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
    effectiveFlatFileList,
    contexts,
    boardContextsByName,
  ])

  return {
    graphModel,
    graphSourcesByPath,
    isGraphLoading:
      enabled &&
      (isGraphSourcesPending || isGraphModelPending),
  }
}
