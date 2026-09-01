import { memo, useCallback, useMemo } from 'react'
import { shallowEqual } from 'react-redux'
import { useAppSelector, useAppDispatch } from '../../store/hooks'
import { selectIsSettingsOpen, selectIsLibraryManagerOpen } from '../../features/ui/uiSelectors'
import { setSettingsOpen, setLibraryManagerOpen } from '../../features/ui/uiSlice'
import { selectAiSettings, selectInkMathPreferences, selectExplorerRefreshIntervalMs, selectTelegramSettings } from '../../features/preferences/preferencesSelectors'
import { selectLibraries, selectSelectedLibraryId } from '../../features/library/librarySelectors'
import { selectContextMenu, selectDialogState, selectClipboardEntry } from '../../features/documents/documentsSelectors'
import { setDialogState, setPendingCreation, setRenamingPath, setClipboardEntry, setContextMenu, setTreeNodes } from '../../features/documents/documentsSlice'
import { useNotiaActions } from '../../context/notiaActions/NotiaActionsContext'
import { useConfirmationEngine } from '../../context/confirmation/useConfirmationEngine'
import { SettingsModal } from './SettingsModal'
import { LibraryManagerModal } from './LibraryManagerModal'
import { FileTreeContextMenu } from './FileTreeContextMenu'
import { AppDialogModal } from './AppDialogModal'
import { ColdPassPasskeyModal } from './ColdPassPasskeyModal'
import { ColdPassCredentialModal } from './ColdPassCredentialModal'
import { performLibraryEntryOperation } from '../../services/libraries/libraryRuntime'
import { setFolderExpandedByPath } from '../../utils/tree/setFolderExpandedByPath'
import { store } from '../../store/index'
import { selectActiveLibrary } from '../../features/library/librarySelectors'
import type { AiPreferences } from '../../services/preferences/aiSettingsStorage'
import type { InkMathPreferences } from '../../services/preferences/inkMathSettingsStorage'
import type { TelegramPreferences } from '../../services/preferences/telegramSettingsStorage'
import type { ColdPassEntry } from '../../types/coldpass'
import type { BackupPreferences } from '../../services/preferences/backupSettingsStorage'

function getParentDirectory(filePath: string): string {
  const lastForwardSlash = filePath.lastIndexOf('/')
  const lastBackwardSlash = filePath.lastIndexOf('\\')
  const separatorIndex = Math.max(lastForwardSlash, lastBackwardSlash)
  if (separatorIndex < 0) { return filePath }
  if (separatorIndex === 0) { return filePath.slice(0, 1) }
  if (separatorIndex === 2 && /^[a-zA-Z]:[\\/]/.test(filePath)) { return filePath.slice(0, 3) }
  return filePath.slice(0, separatorIndex)
}

interface NotiaModalsProps {
  onAiPreferencesChange: (value: AiPreferences) => void
  onExplorerRefreshIntervalMsChange: (value: number) => void
  onInkMathPreferencesChange: (value: InkMathPreferences) => void
  onTelegramPreferencesChange: (value: TelegramPreferences) => void
  backupPreferences: BackupPreferences
  onBackupPreferencesChange: (value: BackupPreferences) => void
  coldPassPromptState: {
    open: boolean
    requiresConfirmation: boolean
    errorMessage: string | null
    isSubmitting: boolean
  }
  coldPassDeletePromptState: {
    open: boolean
    deletingIndex: number | null
    errorMessage: string | null
    isSubmitting: boolean
  }
  coldPassImportPromptState: {
    open: boolean
    pendingImport: { importedEntries: ColdPassEntry[]; sourceFileName: string; skippedRowCount: number } | null
    errorMessage: string | null
    isSubmitting: boolean
    isSelectingFile: boolean
  }
  coldPassCredentialModalState: {
    open: boolean
    mode: 'create' | 'edit'
    editingIndex: number | null
    errorMessage: string | null
    isSubmitting: boolean
  }
  coldPassSession: { entries: ColdPassEntry[]; filePath: string; passkey: string; markdown: string } | null
  handleSubmitColdPassPasskey: (passkey: string) => void
  handleCloseColdPassPrompt: () => void
  handleSubmitColdPassDeletePasskey: (passkey: string) => void
  handleCloseColdPassDeletePrompt: () => void
  handleSubmitColdPassImportPasskey: (passkey: string) => void
  handleCloseColdPassImportPrompt: () => void
  handleSubmitColdPassCredential: (entry: ColdPassEntry) => void
  handleCloseColdPassCredentialModal: () => void
}

function NotiaModalsComponent({
  onAiPreferencesChange,
  onExplorerRefreshIntervalMsChange,
  onInkMathPreferencesChange,
  onTelegramPreferencesChange,
  backupPreferences,
  onBackupPreferencesChange,
  coldPassPromptState,
  coldPassDeletePromptState,
  coldPassImportPromptState,
  coldPassCredentialModalState,
  coldPassSession,
  handleSubmitColdPassPasskey,
  handleCloseColdPassPrompt,
  handleSubmitColdPassDeletePasskey,
  handleCloseColdPassDeletePrompt,
  handleSubmitColdPassImportPasskey,
  handleCloseColdPassImportPrompt,
  handleSubmitColdPassCredential,
  handleCloseColdPassCredentialModal,
}: NotiaModalsProps) {
  const dispatch = useAppDispatch()
  const actions = useNotiaActions()
  const { confirm } = useConfirmationEngine()

  const isSettingsOpen = useAppSelector(selectIsSettingsOpen)
  const isLibraryManagerOpen = useAppSelector(selectIsLibraryManagerOpen)
  const explorerRefreshIntervalMs = useAppSelector(selectExplorerRefreshIntervalMs)
  const inkMathPreferences = useAppSelector(selectInkMathPreferences, shallowEqual)
  const aiPreferences = useAppSelector(selectAiSettings, shallowEqual)
  const telegramPreferences = useAppSelector(selectTelegramSettings, shallowEqual)
  const libraries = useAppSelector(selectLibraries)
  const activeLibraryId = useAppSelector(selectSelectedLibraryId)
  const contextMenu = useAppSelector(selectContextMenu, shallowEqual)
  const dialogState = useAppSelector(selectDialogState, shallowEqual)
  const clipboardEntry = useAppSelector(selectClipboardEntry, shallowEqual)
  const activeLibrary = useAppSelector(selectActiveLibrary)

  // --- Context menu action handler (self-contained, no longer passed from NotiaMenu) ---
  const activeLibraryAndroidDirectoryUri = useCallback((pathValue?: string | null): string | undefined => {
    if (!activeLibrary?.androidTreeUri) { return undefined }
    if (!pathValue) { return activeLibrary.androidTreeUri }
    return activeLibrary.androidTreeUri
  }, [activeLibrary])

  const handleContextMenuAction = useCallback(async (actionId: string) => {
    const currentContextMenu = store.getState().documents.contextMenu
    if (!activeLibrary || !currentContextMenu) {
      dispatch(setContextMenu(null))
      return
    }
    if (actionId === 'new-folder-root') {
      dispatch(setPendingCreation({ id: `pending-folder-${Date.now()}`, kind: 'folder', initialName: 'Nueva carpeta', parentPath: activeLibrary.path }))
      dispatch(setContextMenu(null))
      return
    }
    if (actionId === 'new-note-root') {
      dispatch(setPendingCreation({ id: `pending-note-${Date.now()}`, kind: 'note', initialName: 'Nueva nota', parentPath: activeLibrary.path }))
      dispatch(setContextMenu(null))
      return
    }
    if (actionId === 'new-mermaid-root') {
      dispatch(setPendingCreation({ id: `pending-mermaid-${Date.now()}`, kind: 'mermaid', initialName: 'Nuevo diagrama', parentPath: activeLibrary.path }))
      dispatch(setContextMenu(null))
      return
    }
    if (currentContextMenu.type !== 'node') { dispatch(setContextMenu(null)); return }
    const targetNode = currentContextMenu.node
    const targetPath = targetNode.path
    if (!targetPath) { dispatch(setContextMenu(null)); return }
    const targetDirectory = targetNode.type === 'folder' ? targetPath : getParentDirectory(targetPath)

    if (actionId === 'copy') {
      dispatch(setClipboardEntry({ path: targetPath, mode: 'copy' }))
      dispatch(setContextMenu(null))
      return
    }
    if (actionId === 'copy-system-path') {
      try { await navigator.clipboard.writeText(targetPath) } catch {
        dispatch(setDialogState({ type: 'info', title: 'No se pudo copiar', message: 'No se pudo copiar el path al portapapeles.' }))
      }
      dispatch(setContextMenu(null))
      return
    }
    if (actionId === 'move') {
      dispatch(setClipboardEntry({ path: targetPath, mode: 'move' }))
      dispatch(setContextMenu(null))
      return
    }
    if (actionId === 'paste') {
      const currentClipboardEntry = store.getState().documents.clipboardEntry
      if (!currentClipboardEntry) { dispatch(setContextMenu(null)); return }
      const pasteResult = await performLibraryEntryOperation({
        action: 'paste', sourcePath: currentClipboardEntry.path,
        targetDirectoryPath: targetDirectory || activeLibrary.path, mode: currentClipboardEntry.mode,
      }, {
        androidDirectoryUri: activeLibraryAndroidDirectoryUri(targetDirectory || activeLibrary.path)
          ?? activeLibraryAndroidDirectoryUri(currentClipboardEntry.path),
      })
      if (!pasteResult.ok) {
        dispatch(setDialogState({ type: 'info', title: 'No se pudo pegar', message: pasteResult.error ?? 'No se pudo pegar el elemento.' }))
      } else if (currentClipboardEntry.mode === 'move') {
        actions.closeTab(currentClipboardEntry.path)
        dispatch(setClipboardEntry(null))
      }
      dispatch(setContextMenu(null))
      actions.chatWorkspaceTreeChanged(targetDirectory || currentClipboardEntry.path)
      return
    }
    if (actionId === 'delete') {
      const shouldDelete = await confirm({
        title: 'Confirmar eliminacion',
        message: `Eliminar "${targetNode.name}"? Esta accion no se puede deshacer.`,
        confirmLabel: 'Eliminar', cancelLabel: 'Cancelar', tone: 'danger',
      })
      if (!shouldDelete) { dispatch(setContextMenu(null)); return }
      const deleteResult = await performLibraryEntryOperation({
        action: 'delete', targetPath,
      }, { androidDirectoryUri: activeLibraryAndroidDirectoryUri(targetPath) })
      if (!deleteResult.ok) {
        dispatch(setDialogState({ type: 'info', title: 'No se pudo eliminar', message: deleteResult.error ?? 'No se pudo eliminar el elemento.' }))
        dispatch(setContextMenu(null))
        return
      }
      actions.closeTab(targetPath)
      dispatch(setContextMenu(null))
      actions.chatWorkspaceTreeChanged(targetPath)
      return
    }
    if (actionId === 'rename') {
      dispatch(setRenamingPath(targetPath))
      dispatch(setContextMenu(null))
      return
    }
    if (actionId === 'new-subfolder' && targetNode.type === 'folder') {
      const currentTreeNodes = store.getState().documents.treeNodes
      store.dispatch(setTreeNodes(setFolderExpandedByPath(currentTreeNodes, targetPath, true)))
      dispatch(setPendingCreation({ id: `pending-subfolder-${Date.now()}`, kind: 'folder', initialName: 'Nueva carpeta', parentPath: targetPath }))
      dispatch(setContextMenu(null))
      return
    }
    if (actionId === 'new-note' && targetNode.type === 'folder') {
      const currentTreeNodes = store.getState().documents.treeNodes
      store.dispatch(setTreeNodes(setFolderExpandedByPath(currentTreeNodes, targetPath, true)))
      dispatch(setPendingCreation({ id: `pending-note-${Date.now()}`, kind: 'note', initialName: 'Nueva nota', parentPath: targetPath }))
      dispatch(setContextMenu(null))
      return
    }
    if (actionId === 'new-mermaid' && targetNode.type === 'folder') {
      const currentTreeNodes = store.getState().documents.treeNodes
      store.dispatch(setTreeNodes(setFolderExpandedByPath(currentTreeNodes, targetPath, true)))
      dispatch(setPendingCreation({ id: `pending-mermaid-${Date.now()}`, kind: 'mermaid', initialName: 'Nuevo diagrama', parentPath: targetPath }))
      dispatch(setContextMenu(null))
      return
    }
    dispatch(setContextMenu(null))
  }, [activeLibrary, activeLibraryAndroidDirectoryUri, actions, confirm, dispatch])

  const handleCloseSettings = useMemo(() => () => dispatch(setSettingsOpen(false)), [dispatch])
  const handleCloseLibraryManager = useMemo(() => () => dispatch(setLibraryManagerOpen(false)), [dispatch])
  const contextMenuPosition = useMemo(
    () => ({ x: contextMenu?.x ?? 0, y: contextMenu?.y ?? 0 }),
    [contextMenu?.x, contextMenu?.y],
  )
  const handleContextMenuActionWrapped = useMemo(
    () => (id: string) => { void handleContextMenuAction(id) },
    [handleContextMenuAction],
  )
  const handleContextMenuClose = useMemo(
    () => () => dispatch(setContextMenu(null)),
    [dispatch],
  )
  const handleAppDialogConfirm = useMemo(
    () => () => dispatch(setDialogState(null)),
    [dispatch],
  )
  const handleDialogClose = useMemo(
    () => () => dispatch(setDialogState(null)),
    [dispatch],
  )

  const contextMenuItems = contextMenu?.type === 'empty'
    ? [
        { id: 'new-folder-root', label: 'Crear carpeta nueva' },
        { id: 'new-note-root', label: 'Crear nota nueva' },
        { id: 'new-mermaid-root', label: 'Crear diagrama nuevo' },
      ]
    : contextMenu?.type === 'node'
      ? [
          { id: 'copy', label: 'Copiar' },
          ...(contextMenu.node.type === 'file'
            ? [{ id: 'copy-system-path', label: 'Copiar path del sistema' }]
            : []),
          { id: 'paste', label: 'Pegar', disabled: !clipboardEntry },
          { id: 'move', label: 'Mover' },
          { id: 'rename', label: 'Renombrar' },
          { id: 'delete', label: 'Eliminar', danger: true },
          ...(contextMenu.node.type === 'folder'
            ? [
                { id: 'new-subfolder', label: 'Crear subcarpeta' },
                { id: 'new-note', label: 'Crear nota' },
                { id: 'new-mermaid', label: 'Crear diagrama' },
              ]
            : []),
        ]
      : []

  return (
    <>
      <SettingsModal
        open={isSettingsOpen}
        onClose={handleCloseSettings}
        explorerRefreshIntervalMs={explorerRefreshIntervalMs}
        onExplorerRefreshIntervalMsChange={onExplorerRefreshIntervalMsChange}
        inkMathPreferences={inkMathPreferences}
        onInkMathPreferencesChange={onInkMathPreferencesChange}
        aiPreferences={aiPreferences}
        onAiPreferencesChange={onAiPreferencesChange}
        telegramPreferences={telegramPreferences}
        onTelegramPreferencesChange={onTelegramPreferencesChange}
        backupPreferences={backupPreferences}
        onBackupPreferencesChange={onBackupPreferencesChange}
      />
      <LibraryManagerModal
        open={isLibraryManagerOpen}
        libraries={libraries}
        activeLibraryId={activeLibraryId}
        onLibraryAdded={actions.libraryAdded}
        onLibraryRemoved={actions.libraryRemoved}
        onClose={handleCloseLibraryManager}
      />
      <FileTreeContextMenu
        open={Boolean(contextMenu)}
        position={contextMenuPosition}
        items={contextMenuItems}
        onAction={handleContextMenuActionWrapped}
        onClose={handleContextMenuClose}
      />
      <AppDialogModal
        open={Boolean(dialogState)}
        title={dialogState?.title ?? ''}
        message={dialogState?.message ?? ''}
        confirmLabel="Aceptar"
        onConfirm={handleAppDialogConfirm}
        onClose={handleDialogClose}
      />
      <ColdPassPasskeyModal
        open={coldPassPromptState.open}
        title={coldPassPromptState.requiresConfirmation ? 'Crear ColdPass' : 'Desbloquear ColdPass'}
        message={coldPassPromptState.requiresConfirmation
          ? 'ColdPass/ColdPass.md no existe todavia. Ingresá una passkey para crear la bóveda cifrada. Si la olvidás, no hay forma de recuperar el contenido cifrado.'
          : 'La passkey se usa para desencriptar ColdPass/ColdPass.md solo en memoria. Si la olvidás, no hay forma de recuperar el contenido cifrado. Al cerrar la pestaña, el contenido se olvida.'}
        requiresConfirmation={coldPassPromptState.requiresConfirmation}
        errorMessage={coldPassPromptState.errorMessage}
        isSubmitting={coldPassPromptState.isSubmitting}
        onSubmit={handleSubmitColdPassPasskey}
        onClose={handleCloseColdPassPrompt}
      />
      <ColdPassPasskeyModal
        open={coldPassDeletePromptState.open}
        title="Confirmar eliminacion"
        message="Ingresá la passkey de ColdPass para confirmar la eliminacion de esta credencial."
        errorMessage={coldPassDeletePromptState.errorMessage}
        isSubmitting={coldPassDeletePromptState.isSubmitting}
        onSubmit={handleSubmitColdPassDeletePasskey}
        onClose={handleCloseColdPassDeletePrompt}
      />
      <ColdPassPasskeyModal
        open={coldPassImportPromptState.open}
        title="Confirmar importacion"
        message={coldPassImportPromptState.pendingImport
          ? `Se validaron ${coldPassImportPromptState.pendingImport.importedEntries.length} credenciales desde ${coldPassImportPromptState.pendingImport.sourceFileName}. Ingresá la passkey de ColdPass para importarlas dentro de la bóveda cifrada.`
          : 'Ingresá la passkey de ColdPass para confirmar la importacion del vault.'}
        errorMessage={coldPassImportPromptState.errorMessage}
        isSubmitting={coldPassImportPromptState.isSubmitting}
        onSubmit={handleSubmitColdPassImportPasskey}
        onClose={handleCloseColdPassImportPrompt}
      />
      <ColdPassCredentialModal
        open={coldPassCredentialModalState.open}
        mode={coldPassCredentialModalState.mode}
        initialEntry={
          coldPassCredentialModalState.mode === 'edit'
            && coldPassCredentialModalState.editingIndex !== null
            ? coldPassSession?.entries[coldPassCredentialModalState.editingIndex] ?? null
            : null
        }
        isSubmitting={coldPassCredentialModalState.isSubmitting}
        errorMessage={coldPassCredentialModalState.errorMessage}
        onSubmit={handleSubmitColdPassCredential}
        onClose={handleCloseColdPassCredentialModal}
      />
    </>
  )
}

export const NotiaModals = memo(NotiaModalsComponent)
NotiaModals.displayName = 'NotiaModals'
