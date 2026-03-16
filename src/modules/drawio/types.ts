export interface DrawioDocumentController {
  flush: () => Promise<void>
}

export interface DrawioDocumentDescriptor {
  path: string
  name: string
  source: string
  onPersistSource: (nextSource: string) => Promise<void>
}
