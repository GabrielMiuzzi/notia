import { startTransition, useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { startPerformanceMeasurement } from '../services/runtime/performanceBaseline'
import type { LibraryGraphModel } from '../types/graph/libraryGraph'

const EMPTY_GRAPH_MODEL: LibraryGraphModel = {
  nodes: [],
  edges: [],
}

export interface GraphSearchResult {
  path: string
  label: string
  preview: string
  score: number
}

interface UseLibraryGraphDataParams {
  enabled?: boolean
  libraryId?: string
  libraryPath: string | null
  /** Index revision; a new value makes the backend re-read the sources. */
  revision: number
}

/** Backend paths are logical; the UI opens files by their visible path. */
function toVisiblePath(libraryPath: string, logicalPath: string): string {
  return `${libraryPath.replace(/[\\/]+$/, '')}/${logicalPath}`
}

function mapGraphModel(model: LibraryGraphModel, libraryPath: string): LibraryGraphModel {
  return {
    nodes: model.nodes.map((node) => ({
      ...node,
      id: toVisiblePath(libraryPath, node.id),
      path: toVisiblePath(libraryPath, node.path),
    })),
    edges: model.edges.map((edge) => ({
      id: `${toVisiblePath(libraryPath, edge.sourcePath)}<=>${toVisiblePath(libraryPath, edge.targetPath)}`,
      sourcePath: toVisiblePath(libraryPath, edge.sourcePath),
      targetPath: toVisiblePath(libraryPath, edge.targetPath),
    })),
  }
}

/**
 * Graph View data. The backend builds the model (links, degrees, contexts)
 * from the library inventory and searches titles and contents; this hook
 * only requests it and maps paths for rendering.
 */
export function useLibraryGraphData({
  enabled = true,
  libraryId,
  libraryPath,
  revision,
}: UseLibraryGraphDataParams) {
  const [graphModel, setGraphModel] = useState<LibraryGraphModel>(EMPTY_GRAPH_MODEL)
  const [isGraphLoading, setIsGraphLoading] = useState(false)

  useEffect(() => {
    if (!enabled || !libraryId || !libraryPath) {
      startTransition(() => {
        setGraphModel(EMPTY_GRAPH_MODEL)
        setIsGraphLoading(false)
      })
      return
    }

    let isCurrent = true
    setIsGraphLoading(true)
    const measurement = startPerformanceMeasurement('graph.build_model', { libraryPath, revision })
    invoke<LibraryGraphModel>('backend_library_graph', { payload: { libraryId, revision } })
      .then((model) => {
        if (!isCurrent) {
          measurement.cancel()
          return
        }
        measurement.success({ nodeCount: model.nodes.length, edgeCount: model.edges.length })
        startTransition(() => {
          setGraphModel(mapGraphModel(model, libraryPath))
          setIsGraphLoading(false)
        })
      })
      .catch((error: unknown) => {
        if (!isCurrent) return
        measurement.error(error instanceof Error ? error : new Error('No se pudo construir el grafo.'))
        setGraphModel(EMPTY_GRAPH_MODEL)
        setIsGraphLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [enabled, libraryId, libraryPath, revision])

  const searchGraph = useCallback(async (query: string): Promise<GraphSearchResult[]> => {
    if (!libraryId || !libraryPath || !query.trim()) {
      return []
    }
    const results = await invoke<GraphSearchResult[]>('backend_library_graph_search', {
      payload: { libraryId, revision, query, maxResults: Math.max(8, graphModel.nodes.length) },
    })
    return results.map((result) => ({ ...result, path: toVisiblePath(libraryPath, result.path) }))
  }, [graphModel.nodes.length, libraryId, libraryPath, revision])

  return {
    graphModel,
    searchGraph,
    isGraphLoading: enabled && isGraphLoading,
  }
}
