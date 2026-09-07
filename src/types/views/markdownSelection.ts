export interface MarkdownSelectionBlock {
  index: number
  type: string
  text: string
  from: number
  to: number
}

export interface MarkdownSelectionContext {
  documentPath: string
  from: number
  to: number
  selectedText: string
  blocks: MarkdownSelectionBlock[]
}

export interface MarkdownDocumentUpdate {
  documentPath: string
  source: string
  revision: number
}
