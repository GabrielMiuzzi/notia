import type { ClusteredGraphLayout, ClusteredGraphLayoutOptions } from '../../engines/graph/clusteredGraphLayoutEngine'
import type { GraphSearchResult } from '../../engines/graph/graphSearchEngine'
import type { NotiaFileNode, NotiaFlatFileEntry } from '../notia'
import type { LibraryGraphModel } from './libraryGraph'

export interface GraphModelWorkerBuildRequest {
  type: 'buildGraphModel'
  requestId: number
  treeNodes: NotiaFileNode[]
  rootPath: string | null
  graphSourcesByPath: Record<string, string>
  flatFileList?: NotiaFlatFileEntry[]
}

export interface GraphModelWorkerBuildSuccessResponse {
  type: 'graphModelBuilt'
  requestId: number
  graphModel: LibraryGraphModel
}

export interface GraphModelWorkerBuildErrorResponse {
  type: 'graphModelBuildError'
  requestId: number
  message: string
}

export type GraphModelWorkerRequest = GraphModelWorkerBuildRequest

export type GraphModelWorkerResponse =
  | GraphModelWorkerBuildSuccessResponse
  | GraphModelWorkerBuildErrorResponse

export interface GraphViewWorkerHydrateRequest {
  type: 'hydrateGraphData'
  graphModel: LibraryGraphModel
  graphSourcesByPath: Record<string, string>
}

export interface GraphViewWorkerComputeRequest {
  type: 'computeGraphDerivedData'
  requestId: number
  canvasWidth: number
  canvasHeight: number
  layoutOptions: ClusteredGraphLayoutOptions
  searchQuery: string
}

export interface GraphViewWorkerComputeSuccessResponse {
  type: 'graphDerivedDataReady'
  requestId: number
  graphLayout: ClusteredGraphLayout
  searchResults: GraphSearchResult[]
}

export interface GraphViewWorkerComputeErrorResponse {
  type: 'graphDerivedDataError'
  requestId: number
  message: string
}

export type GraphViewWorkerRequest = GraphViewWorkerHydrateRequest | GraphViewWorkerComputeRequest

export type GraphViewWorkerResponse =
  | GraphViewWorkerComputeSuccessResponse
  | GraphViewWorkerComputeErrorResponse
