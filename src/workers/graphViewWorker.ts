/// <reference lib="webworker" />

import { buildClusteredGraphLayout } from '../engines/graph/clusteredGraphLayoutEngine'
import { buildGraphSearchResults } from '../engines/graph/graphSearchEngine'
import type { LibraryGraphModel } from '../types/graph/libraryGraph'
import type { GraphViewWorkerRequest, GraphViewWorkerResponse } from '../types/graph/graphWorker'

const EMPTY_GRAPH_MODEL: LibraryGraphModel = {
  nodes: [],
  edges: [],
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unknown graph worker error'
}

const graphViewWorker = self as DedicatedWorkerGlobalScope
let hydratedGraphModel: LibraryGraphModel = EMPTY_GRAPH_MODEL
let hydratedGraphSourcesByPath: Record<string, string> = {}

graphViewWorker.onmessage = (event: MessageEvent<GraphViewWorkerRequest>) => {
  const request = event.data

  if (request.type === 'hydrateGraphData') {
    hydratedGraphModel = request.graphModel
    hydratedGraphSourcesByPath = request.graphSourcesByPath
    return
  }

  if (request.type !== 'computeGraphDerivedData') {
    return
  }

  try {
    const graphLayout = buildClusteredGraphLayout(
      hydratedGraphModel,
      request.canvasWidth,
      request.canvasHeight,
      request.layoutOptions,
    )
    const searchResults = buildGraphSearchResults(
      hydratedGraphModel,
      hydratedGraphSourcesByPath,
      request.searchQuery,
    )
    const response: GraphViewWorkerResponse = {
      type: 'graphDerivedDataReady',
      requestId: request.requestId,
      graphLayout,
      searchResults,
    }
    graphViewWorker.postMessage(response)
  } catch (error) {
    const response: GraphViewWorkerResponse = {
      type: 'graphDerivedDataError',
      requestId: request.requestId,
      message: resolveErrorMessage(error),
    }
    graphViewWorker.postMessage(response)
  }
}

export {}
