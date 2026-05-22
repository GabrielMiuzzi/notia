export type MermaidShapeType = 'rect' | 'circle' | 'diamond' | 'cylinder'

export type MermaidEdgeType =
  | 'arrow'
  | 'open'
  | 'dotted'
  | 'dottedArrow'
  | 'thick'
  | 'thickArrow'
  | 'circle'
  | 'cross'
  | 'invisible'

export interface ParsedEdgeLine {
  index: number
  from: string
  to: string
  type: MermaidEdgeType
  label?: string
  raw: string
}

export interface MermaidNode {
  id: string
  label: string
  shape: MermaidShapeType
  x: number
  y: number
  width: number
  height: number
}

export interface MermaidEdge {
  id: string
  from: string
  to: string
  label?: string
}

export interface MermaidDiagram {
  nodes: MermaidNode[]
  edges: MermaidEdge[]
}

export interface MermaidRenderResult {
  svg: string
  bindFunctions?: (element: Element) => void
  diagramType?: string
}
