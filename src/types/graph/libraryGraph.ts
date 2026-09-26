export interface LibraryGraphNode {
  id: string
  path: string
  label: string
  degree: number
  contextTag?: string
  contextColor?: string
  /** First folder of the note (a halo groups each); empty at the library root. */
  folder: string
  /** Linked notes, most connected first. */
  neighbors: string[]
}

export interface LibraryGraphEdge {
  id: string
  sourcePath: string
  targetPath: string
}

/** Notes of one context; `tag` `null` means without context. */
export interface LibraryGraphContextCount {
  tag: string | null
  color: string | null
  count: number
}

/** The library as a whole, computed by the backend. */
export interface LibraryGraphSummary {
  notes: number
  links: number
  orphans: number
  contexts: LibraryGraphContextCount[]
  /** Paths of the most connected notes. */
  topConnected: string[]
}

export interface LibraryGraphModel {
  nodes: LibraryGraphNode[]
  edges: LibraryGraphEdge[]
  summary: LibraryGraphSummary
}
