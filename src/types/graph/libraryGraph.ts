export interface LibraryGraphNode {
  id: string
  path: string
  label: string
  degree: number
}

export interface LibraryGraphEdge {
  id: string
  sourcePath: string
  targetPath: string
}

export interface LibraryGraphModel {
  nodes: LibraryGraphNode[]
  edges: LibraryGraphEdge[]
}
