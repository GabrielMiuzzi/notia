/** The result of rendering a Mermaid diagram. */
export interface MermaidRenderResult {
  svg: string
  bindFunctions?: (element: Element) => void
  diagramType?: string
}
