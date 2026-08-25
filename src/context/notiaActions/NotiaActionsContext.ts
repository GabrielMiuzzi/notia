import { createContext, useContext } from 'react'
import type { NotiaFileNode, NotiaLibrary } from '../../types/notia'

export interface NotiaActions {
  openFile: (filePath: string) => Promise<void>
  openFileFromView: (filePath: string) => void
  closeTab: (tabPath: string) => void
  closeActiveTab: () => void
  cycleToNextTab: () => void
  toggleFolder: (folderId: string) => void
  toggleSidebar: () => void
  toggleRightChatPanel: () => void
  toggleTheme: () => void
  selectLibrary: (libraryId: string) => void
  activateTab: (tabPath: string) => void
  openSettings: () => void
  openLibraryManager: () => void
  railActionClick: (actionId: string) => void
  headerActionClick: (id: string) => void
  explorerToolClick: (toolId: string) => void
  closeSearchMenu: () => void
  submitPendingCreation: (name: string) => Promise<void>
  cancelPendingCreation: () => void
  renameSubmit: (path: string, name: string) => Promise<void>
  cancelRename: () => void
  nodeContextMenu: (node: NotiaFileNode, position: { x: number; y: number }) => void
  emptyContextMenu: (position: { x: number; y: number }) => void
  moveNode: (sourcePath: string, targetDirectoryPath: string) => void
  libraryAdded: (library: NotiaLibrary) => void
  libraryRemoved: (library: NotiaLibrary) => Promise<void>
  textDocumentChange: (nextSource: string) => void
  chatWorkspaceTreeChanged: (pathHint?: string) => void
  windowAction: (action: NotiaWindowAction) => void
  coldPassOpenCredentialModal: () => void
  coldPassImportVault: () => void
  coldPassEditCredential: (index: number) => void
  coldPassDeleteCredential: (index: number) => Promise<void>
}

export const NotiaActionsContext = createContext<NotiaActions | null>(null)

export function useNotiaActions(): NotiaActions {
  const actions = useContext(NotiaActionsContext)
  if (!actions) {
    throw new Error('useNotiaActions must be used within a NotiaActionsProvider')
  }
  return actions
}
