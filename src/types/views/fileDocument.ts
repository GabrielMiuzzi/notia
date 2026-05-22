export type NotiaFileViewKind = 'markdown' | 'text' | 'image' | 'inkdoc' | 'mermaid'

interface OpenFileDocumentBase {
  path: string
  name: string
  extension: string
  viewKind: NotiaFileViewKind
}

export interface OpenTextFileDocument extends OpenFileDocumentBase {
  viewKind: 'markdown' | 'text'
  source: string
}

export interface OpenInkdocFileDocument extends OpenFileDocumentBase {
  viewKind: 'inkdoc'
  source: string
}

export interface OpenImageFileDocument extends OpenFileDocumentBase {
  viewKind: 'image'
  imageUrl: string
}

export interface OpenMermaidFileDocument extends OpenFileDocumentBase {
  viewKind: 'mermaid'
  source: string
}

export type OpenFileDocument =
  | OpenTextFileDocument
  | OpenImageFileDocument
  | OpenInkdocFileDocument
  | OpenMermaidFileDocument

export type NotiaDocumentSaveStatus = 'idle' | 'saving' | 'error'

export function isTextFileDocument(document: OpenFileDocument): document is OpenTextFileDocument | OpenMermaidFileDocument {
  return document.viewKind === 'markdown' || document.viewKind === 'text' || document.viewKind === 'mermaid'
}
