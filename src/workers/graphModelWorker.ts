/// <reference lib="webworker" />

import { buildLibraryGraphModel } from '../engines/graph/libraryGraphEngine'
import type { GraphModelWorkerRequest, GraphModelWorkerResponse } from '../types/graph/graphWorker'

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unknown graph model worker error'
}

const graphModelWorker = self as DedicatedWorkerGlobalScope

graphModelWorker.onmessage = (event: MessageEvent<GraphModelWorkerRequest>) => {
  const request = event.data
  if (request.type !== 'buildGraphModel') {
    return
  }

  try {
    const graphModel = buildLibraryGraphModel(request.treeNodes, request.rootPath, request.graphSourcesByPath)
    const response: GraphModelWorkerResponse = {
      type: 'graphModelBuilt',
      requestId: request.requestId,
      graphModel,
    }
    graphModelWorker.postMessage(response)
  } catch (error) {
    const response: GraphModelWorkerResponse = {
      type: 'graphModelBuildError',
      requestId: request.requestId,
      message: resolveErrorMessage(error),
    }
    graphModelWorker.postMessage(response)
  }
}

export {}
