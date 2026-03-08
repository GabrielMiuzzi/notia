export type NotiaFileViewKind = 'markdown' | 'text' | 'image'

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

export interface OpenImageFileDocument extends OpenFileDocumentBase {
  viewKind: 'image'
  imageUrl: string
}

export type OpenFileDocument = OpenTextFileDocument | OpenImageFileDocument

export type NotiaDocumentSaveStatus = 'idle' | 'saving' | 'error'

export function isTextFileDocument(document: OpenFileDocument): document is OpenTextFileDocument {
  return document.viewKind === 'markdown' || document.viewKind === 'text'
}
