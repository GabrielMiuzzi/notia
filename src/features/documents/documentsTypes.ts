import type { NotiaFileNode, NotiaFlatFileEntry } from '../../types/notia'
import type { NotiaDocumentSaveStatus, OpenFileDocument } from '../../types/views/fileDocument'

export type DocumentKind = 'markdown' | 'image' | 'text' | 'mermaid' | 'unknown'

export interface OpenDocumentTab {
  document: OpenFileDocument
  saveStatus: NotiaDocumentSaveStatus
  latestSavedSource: string
}

export interface OpenWorkspaceSpecialTabs {
  graph: boolean
  chat: boolean
  taskManager: boolean
  coldPass: boolean
  meeting: boolean
}

export interface DocumentsState {
  openTabs: OpenDocumentTab[]
  activeTabPath: string | null
  specialTabs: OpenWorkspaceSpecialTabs
  treeNodes: NotiaFileNode[]
  searchQuery: string
  searchMatchedPaths: string[]
  isSearchLoading: boolean
  pendingCreation: {
    id: string
    kind: 'folder' | 'note' | 'mermaid'
    initialName: string
    parentPath: string
  } | null
  renamingPath: string | null
  clipboardEntry: {
    path: string
    mode: 'copy' | 'move'
  } | null
  contextMenu:
    | { type: 'empty'; x: number; y: number }
    | { type: 'node'; x: number; y: number; node: NotiaFileNode }
    | null
  dialogState: { type: 'info'; title: string; message: string } | null
  loadingFolderIds: string[]
  flatFileList: NotiaFlatFileEntry[]
}
