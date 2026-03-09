export type NotiaFileViewKind = 'markdown' | 'text' | 'image' | 'inkdoc'

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

export type OpenFileDocument = OpenTextFileDocument | OpenImageFileDocument | OpenInkdocFileDocument

export type NotiaDocumentSaveStatus = 'idle' | 'saving' | 'error'

export function isTextFileDocument(document: OpenFileDocument): document is OpenTextFileDocument {
  return document.viewKind === 'markdown' || document.viewKind === 'text'
}
