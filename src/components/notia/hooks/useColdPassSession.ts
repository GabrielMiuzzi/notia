import { useCallback, useEffect, useState } from 'react'
import { useAppDispatch } from '../../../store/hooks'
import { setDialogState } from '../../../features/documents/documentsSlice'
import type { NotiaLibrary } from '../../../types/notia'
import type { ColdPassEntry } from '../../../types/coldpass'
import type { ColdPassSessionData } from '../../../services/coldpass/coldpassStorage'
import { resolveColdPassPaths, saveColdPassEntries, unlockColdPassSession } from '../../../services/coldpass/coldpassStorage'
import { importColdPassEntriesFromCsvFile, type ColdPassCsvImportResult } from '../../../services/coldpass/coldpassCsvImport'
import { pathExists, pickFile } from '../../../services/files/filesystemEngine'
import { useConfirmationEngine } from '../../../context/confirmation/useConfirmationEngine'

const EMPTY_COLDPASS_ENTRIES: ColdPassEntry[] = []

interface ColdPassPromptState {
  open: boolean
  requiresConfirmation: boolean
  errorMessage: string | null
  isSubmitting: boolean
}

const INITIAL_PROMPT_STATE: ColdPassPromptState = {
  open: false,
  requiresConfirmation: false,
  errorMessage: null,
  isSubmitting: false,
}

interface ColdPassCredentialModalState {
  open: boolean
  mode: 'create' | 'edit'
  editingIndex: number | null
  errorMessage: string | null
  isSubmitting: boolean
}

const INITIAL_CREDENTIAL_MODAL_STATE: ColdPassCredentialModalState = {
  open: false,
  mode: 'create',
  editingIndex: null,
  errorMessage: null,
  isSubmitting: false,
}

interface ColdPassDeletePromptState {
  open: boolean
  deletingIndex: number | null
  errorMessage: string | null
  isSubmitting: boolean
}

const INITIAL_DELETE_PROMPT_STATE: ColdPassDeletePromptState = {
  open: false,
  deletingIndex: null,
  errorMessage: null,
  isSubmitting: false,
}

interface ColdPassImportPromptState {
  open: boolean
  pendingImport: ColdPassCsvImportResult | null
  errorMessage: string | null
  isSubmitting: boolean
  isSelectingFile: boolean
}

const INITIAL_IMPORT_PROMPT_STATE: ColdPassImportPromptState = {
  open: false,
  pendingImport: null,
  errorMessage: null,
  isSubmitting: false,
  isSelectingFile: false,
}

interface UseColdPassSessionDeps {
  activeLibrary: NotiaLibrary | null
  activeWorkspaceView: string
  closeColdPassTab: () => void
}

export interface UseColdPassSessionReturn {
  coldPassSession: ColdPassSessionData | null
  coldPassEntries: ColdPassEntry[]
  coldPassPromptState: ColdPassPromptState
  coldPassCredentialModalState: ColdPassCredentialModalState
  coldPassDeletePromptState: ColdPassDeletePromptState
  coldPassImportPromptState: ColdPassImportPromptState
  isImportingVault: boolean
  handleSubmitColdPassPasskey: (passkey: string) => void
  handleCloseColdPassPrompt: () => void
  handleOpenColdPassCredentialModal: () => void
  handleEditColdPassCredential: (index: number) => void
  handleCloseColdPassCredentialModal: () => void
  handleDeleteColdPassCredential: (index: number) => Promise<void>
  handleImportColdPassVault: () => void
  handleSubmitColdPassCredential: (entry: ColdPassEntry) => void
  handleCloseColdPassDeletePrompt: () => void
  handleSubmitColdPassDeletePasskey: (passkey: string) => void
  handleCloseColdPassImportPrompt: () => void
  handleSubmitColdPassImportPasskey: (passkey: string) => void
  resetColdPassSession: () => void
}

export function useColdPassSession(deps: UseColdPassSessionDeps): UseColdPassSessionReturn {
  const { activeLibrary, activeWorkspaceView, closeColdPassTab } = deps
  const dispatch = useAppDispatch()
  const { confirm } = useConfirmationEngine()

  const [coldPassSession, setColdPassSession] = useState<ColdPassSessionData | null>(null)
  const [coldPassPromptState, setColdPassPromptState] = useState<ColdPassPromptState>(INITIAL_PROMPT_STATE)
  const [coldPassCredentialModalState, setColdPassCredentialModalState] = useState<ColdPassCredentialModalState>(INITIAL_CREDENTIAL_MODAL_STATE)
  const [coldPassDeletePromptState, setColdPassDeletePromptState] = useState<ColdPassDeletePromptState>(INITIAL_DELETE_PROMPT_STATE)
  const [coldPassImportPromptState, setColdPassImportPromptState] = useState<ColdPassImportPromptState>(INITIAL_IMPORT_PROMPT_STATE)

  // Auto-open ColdPass prompt when entering coldpass view without session
  useEffect(() => {
    if (activeWorkspaceView !== 'coldpass' || !activeLibrary || coldPassSession?.filePath) {
      return
    }

    let cancelled = false

    const openColdPassPrompt = async () => {
      const { filePath } = resolveColdPassPaths(activeLibrary.path)
      const coldPassFileExists = await pathExists(filePath, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      })
      if (cancelled) {
        return
      }

      setColdPassPromptState((current) => (
        current.open
          ? current
          : {
              open: true,
              requiresConfirmation: !coldPassFileExists,
              errorMessage: null,
              isSubmitting: false,
            }
      ))
    }

    void openColdPassPrompt()

    return () => {
      cancelled = true
    }
  }, [activeLibrary, activeWorkspaceView, coldPassSession?.filePath])

  const handleSubmitColdPassPasskey = useCallback((passkey: string) => {
    if (!activeLibrary) {
      return
    }

    setColdPassPromptState({
      open: true,
      requiresConfirmation: coldPassPromptState.requiresConfirmation,
      errorMessage: null,
      isSubmitting: true,
    })

    void unlockColdPassSession(activeLibrary, passkey)
      .then((session) => {
        setColdPassSession(session)
        setColdPassPromptState({
          open: false,
          requiresConfirmation: false,
          errorMessage: null,
          isSubmitting: false,
        })
      })
      .catch((error) => {
        setColdPassSession(null)
        setColdPassPromptState({
          open: true,
          requiresConfirmation: coldPassPromptState.requiresConfirmation,
          errorMessage: error instanceof Error ? error.message : 'No se pudo desbloquear ColdPass.',
          isSubmitting: false,
        })
      })
  }, [activeLibrary, coldPassPromptState.requiresConfirmation])

  const handleCloseColdPassPrompt = useCallback(() => {
    setColdPassPromptState({
      open: false,
      requiresConfirmation: false,
      errorMessage: null,
      isSubmitting: false,
    })

    if (activeWorkspaceView === 'coldpass' && !coldPassSession) {
      closeColdPassTab()
    }
  }, [activeWorkspaceView, closeColdPassTab, coldPassSession])

  const handleOpenColdPassCredentialModal = useCallback(() => {
    if (!coldPassSession) {
      return
    }

    setColdPassCredentialModalState({
      open: true,
      mode: 'create',
      editingIndex: null,
      errorMessage: null,
      isSubmitting: false,
    })
  }, [coldPassSession])

  const handleEditColdPassCredential = useCallback((index: number) => {
    if (!coldPassSession || !coldPassSession.entries[index]) {
      return
    }

    setColdPassCredentialModalState({
      open: true,
      mode: 'edit',
      editingIndex: index,
      errorMessage: null,
      isSubmitting: false,
    })
  }, [coldPassSession])

  const handleCloseColdPassCredentialModal = useCallback(() => {
    setColdPassCredentialModalState({
      open: false,
      mode: 'create',
      editingIndex: null,
      errorMessage: null,
      isSubmitting: false,
    })
  }, [])

  const handleDeleteColdPassCredential = useCallback(async (index: number) => {
    if (!coldPassSession || !coldPassSession.entries[index]) {
      return
    }

    const entry = coldPassSession.entries[index]
    const shouldDelete = await confirm({
      title: 'Eliminar credencial',
      message: `Eliminar la credencial "${entry.name || entry.username || 'sin nombre'}"? Esta accion no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })

    if (!shouldDelete) {
      return
    }

    setColdPassDeletePromptState({
      open: true,
      deletingIndex: index,
      errorMessage: null,
      isSubmitting: false,
    })
  }, [coldPassSession, confirm])

  const handleImportColdPassVault = useCallback(() => {
    if (!coldPassSession) {
      return
    }

    setColdPassImportPromptState({
      open: false,
      pendingImport: null,
      errorMessage: null,
      isSubmitting: false,
      isSelectingFile: true,
    })

    void pickFile('Importar vault CSV', ['csv'])
      .then((selectedFile) => {
        if (!selectedFile) {
          setColdPassImportPromptState({
            open: false,
            pendingImport: null,
            errorMessage: null,
            isSubmitting: false,
            isSelectingFile: false,
          })
          return null
        }

        return importColdPassEntriesFromCsvFile(selectedFile.path)
      })
      .then((importResult) => {
        if (!importResult) {
          return
        }

        if (importResult.importedEntries.length === 0) {
          setColdPassImportPromptState({
            open: false,
            pendingImport: null,
            errorMessage: null,
            isSubmitting: false,
            isSelectingFile: false,
          })
          dispatch(setDialogState({
            type: 'info',
            title: 'Sin credenciales para importar',
            message: 'El CSV seleccionado no contiene filas importables para ColdPass.',
          }))
          return
        }

        setColdPassImportPromptState({
          open: true,
          pendingImport: importResult,
          errorMessage: null,
          isSubmitting: false,
          isSelectingFile: false,
        })
      })
      .catch((error) => {
        setColdPassImportPromptState({
          open: false,
          pendingImport: null,
          errorMessage: null,
          isSubmitting: false,
          isSelectingFile: false,
        })
        dispatch(setDialogState({
          type: 'info',
          title: 'No se pudo importar el vault',
          message: error instanceof Error ? error.message : 'No se pudo validar el CSV seleccionado.',
        }))
      })
  }, [coldPassSession, dispatch])

  const handleSubmitColdPassCredential = useCallback((entry: ColdPassEntry) => {
    if (!coldPassSession) {
      return
    }

    const nextEntries = [...coldPassSession.entries]
    if (
      coldPassCredentialModalState.mode === 'edit'
      && coldPassCredentialModalState.editingIndex !== null
      && nextEntries[coldPassCredentialModalState.editingIndex]
    ) {
      const previousEntry = nextEntries[coldPassCredentialModalState.editingIndex]
      const nextPasswordHistory = [...previousEntry.passwordHistory]
      if (previousEntry.password && previousEntry.password !== entry.password) {
        nextPasswordHistory.unshift(previousEntry.password)
      }

      nextEntries[coldPassCredentialModalState.editingIndex] = {
        ...entry,
        id: previousEntry.id,
        passwordHistory: nextPasswordHistory,
      }
    } else {
      nextEntries.push({
        ...entry,
        id: entry.id || crypto.randomUUID(),
        passwordHistory: entry.passwordHistory ?? [],
      })
    }

    setColdPassCredentialModalState({
      open: true,
      mode: coldPassCredentialModalState.mode,
      editingIndex: coldPassCredentialModalState.editingIndex,
      errorMessage: null,
      isSubmitting: true,
    })

    void saveColdPassEntries(
      coldPassSession.filePath,
      coldPassSession.passkey,
      nextEntries,
      activeLibrary?.androidTreeUri,
    )
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.error ?? 'No se pudo guardar la credencial.')
        }

        setColdPassSession({
          ...coldPassSession,
          entries: nextEntries,
          markdown: result.markdown,
        })
        setColdPassCredentialModalState({
          open: false,
          mode: 'create',
          editingIndex: null,
          errorMessage: null,
          isSubmitting: false,
        })
      })
      .catch((error) => {
        setColdPassCredentialModalState({
          open: true,
          mode: coldPassCredentialModalState.mode,
          editingIndex: coldPassCredentialModalState.editingIndex,
          errorMessage: error instanceof Error ? error.message : 'No se pudo guardar la credencial.',
          isSubmitting: false,
        })
      })
  }, [activeLibrary?.androidTreeUri, coldPassCredentialModalState.editingIndex, coldPassCredentialModalState.mode, coldPassSession])

  const handleCloseColdPassDeletePrompt = useCallback(() => {
    setColdPassDeletePromptState({
      open: false,
      deletingIndex: null,
      errorMessage: null,
      isSubmitting: false,
    })
  }, [])

  const handleCloseColdPassImportPrompt = useCallback(() => {
    setColdPassImportPromptState({
      open: false,
      pendingImport: null,
      errorMessage: null,
      isSubmitting: false,
      isSelectingFile: false,
    })
  }, [])

  const handleSubmitColdPassDeletePasskey = useCallback((passkey: string) => {
    if (
      !coldPassSession
      || coldPassDeletePromptState.deletingIndex === null
      || !coldPassSession.entries[coldPassDeletePromptState.deletingIndex]
    ) {
      return
    }

    if (passkey !== coldPassSession.passkey) {
      setColdPassDeletePromptState((current) => ({
        ...current,
        open: true,
        errorMessage: 'La passkey no coincide.',
        isSubmitting: false,
      }))
      return
    }

    const nextEntries = coldPassSession.entries.filter((_, index) => index !== coldPassDeletePromptState.deletingIndex)
    setColdPassDeletePromptState((current) => ({
      ...current,
      open: true,
      errorMessage: null,
      isSubmitting: true,
    }))

    void saveColdPassEntries(
      coldPassSession.filePath,
      coldPassSession.passkey,
      nextEntries,
      activeLibrary?.androidTreeUri,
    )
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.error ?? 'No se pudo eliminar la credencial.')
        }

        setColdPassSession({
          ...coldPassSession,
          entries: nextEntries,
          markdown: result.markdown,
        })
        setColdPassDeletePromptState({
          open: false,
          deletingIndex: null,
          errorMessage: null,
          isSubmitting: false,
        })
      })
      .catch((error) => {
        setColdPassDeletePromptState((current) => ({
          ...current,
          open: true,
          errorMessage: error instanceof Error ? error.message : 'No se pudo eliminar la credencial.',
          isSubmitting: false,
        }))
      })
  }, [activeLibrary?.androidTreeUri, coldPassDeletePromptState.deletingIndex, coldPassSession])

  const handleSubmitColdPassImportPasskey = useCallback((passkey: string) => {
    if (!coldPassSession || !coldPassImportPromptState.pendingImport) {
      return
    }

    if (passkey !== coldPassSession.passkey) {
      setColdPassImportPromptState((current) => ({
        ...current,
        open: true,
        errorMessage: 'La passkey no coincide.',
        isSubmitting: false,
      }))
      return
    }

    const importSummary = coldPassImportPromptState.pendingImport
    const nextEntries = [...coldPassSession.entries, ...importSummary.importedEntries]
    setColdPassImportPromptState((current) => ({
      ...current,
      open: true,
      errorMessage: null,
      isSubmitting: true,
    }))

    void saveColdPassEntries(
      coldPassSession.filePath,
      coldPassSession.passkey,
      nextEntries,
      activeLibrary?.androidTreeUri,
    )
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.error ?? 'No se pudo importar el vault.')
        }

        setColdPassSession({
          ...coldPassSession,
          entries: nextEntries,
          markdown: result.markdown,
        })
        dispatch(setDialogState({
          type: 'info',
          title: 'Vault importado',
          message: importSummary.skippedRowCount > 0
            ? `Se importaron ${importSummary.importedEntries.length} credenciales desde ${importSummary.sourceFileName} y se omitieron ${importSummary.skippedRowCount} filas vacias.`
            : `Se importaron ${importSummary.importedEntries.length} credenciales desde ${importSummary.sourceFileName}.`,
        }))
        setColdPassImportPromptState({
          open: false,
          pendingImport: null,
          errorMessage: null,
          isSubmitting: false,
          isSelectingFile: false,
        })
      })
      .catch((error) => {
        setColdPassImportPromptState((current) => ({
          ...current,
          open: true,
          errorMessage: error instanceof Error ? error.message : 'No se pudo importar el vault.',
          isSubmitting: false,
        }))
      })
  }, [activeLibrary?.androidTreeUri, coldPassImportPromptState.pendingImport, coldPassSession, dispatch])

  const resetColdPassSession = useCallback(() => {
    setColdPassSession(null)
    setColdPassPromptState(INITIAL_PROMPT_STATE)
    setColdPassCredentialModalState(INITIAL_CREDENTIAL_MODAL_STATE)
    setColdPassDeletePromptState(INITIAL_DELETE_PROMPT_STATE)
    setColdPassImportPromptState(INITIAL_IMPORT_PROMPT_STATE)
  }, [])

  const coldPassEntries = coldPassSession?.entries ?? EMPTY_COLDPASS_ENTRIES

  return {
    coldPassSession,
    coldPassEntries,
    coldPassPromptState,
    coldPassCredentialModalState,
    coldPassDeletePromptState,
    coldPassImportPromptState,
    isImportingVault: coldPassImportPromptState.isSelectingFile,
    handleSubmitColdPassPasskey,
    handleCloseColdPassPrompt,
    handleOpenColdPassCredentialModal,
    handleEditColdPassCredential,
    handleCloseColdPassCredentialModal,
    handleDeleteColdPassCredential,
    handleImportColdPassVault,
    handleSubmitColdPassCredential,
    handleCloseColdPassDeletePrompt,
    handleSubmitColdPassDeletePasskey,
    handleCloseColdPassImportPrompt,
    handleSubmitColdPassImportPasskey,
    resetColdPassSession,
  }
}