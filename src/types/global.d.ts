export {}

declare global {
  type NotiaWindowAction = 'minimize' | 'maximize' | 'fullscreen' | 'close'
  type NotiaLibraryEntryKind = 'folder' | 'note' | 'inkdoc'
  type NotiaClipboardMode = 'copy' | 'move'

  interface NotiaCreateLibraryEntryResult {
    ok: boolean
    error?: string
  }

  interface NotiaReadLibraryFileResult {
    ok: boolean
    content: string
    error?: string
  }

  interface NotiaWriteLibraryFileResult {
    ok: boolean
    error?: string
  }

  interface NotiaLibraryEntryOperationPayload {
    action: 'delete' | 'rename' | 'paste'
    targetPath?: string
    newName?: string
    sourcePath?: string
    targetDirectoryPath?: string
    mode?: NotiaClipboardMode
  }

  interface NotiaLibrarySelection {
    path: string
    name: string
  }
}
