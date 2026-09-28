import { useCallback, useEffect, useState } from 'react'
import { useAppDispatch } from '../../../store/hooks'
import { setDialogState } from '../../../features/documents/documentsSlice'
import type { NotiaLibrary } from '../../../types/notia'
import type { ColdPassEntry, ColdPassEntryView } from '../../../types/coldpass'
import {
  confirmColdPassImport,
  deleteColdPassEntry,
  lockColdPassSession,
  pickColdPassCsvImport,
  getColdPassStatus,
  saveColdPassEntry,
  unlockColdPassSession,
  type ColdPassImportPreview,
  type ColdPassSessionData,
} from '../../../services/coldpass/coldpassStorage'
import { useConfirmationEngine } from '../../../context/confirmation/useConfirmationEngine'

const EMPTY_COLDPASS_ENTRIES: ColdPassEntryView[] = []

interface ColdPassPromptState {
  open: boolean
  /** The library has no vault yet: unlocking creates it. */
  isNew: boolean
  /** The vault still uses its own passkey, asked once to migrate it. */
  needsLegacyPasskey: boolean
  errorMessage: string | null
  isSubmitting: boolean
}

const INITIAL_PROMPT_STATE: ColdPassPromptState = {
  open: false,
  isNew: false,
  needsLegacyPasskey: false,
  errorMessage: null,
  isSubmitting: false,
}

/** What the unlock prompt sends. */
export interface ColdPassUnlockValues {
  password: string
  legacyPasskey?: string
}

interface ColdPassCredentialModalState {
  open: boolean
  mode: 'create' | 'edit'
  editingIndex: number | null
  /** Open the password generator at once («Generar nueva»). */
  generate: boolean
  errorMessage: string | null
  isSubmitting: boolean
}

const INITIAL_CREDENTIAL_MODAL_STATE: ColdPassCredentialModalState = {
  open: false,
  mode: 'create',
  editingIndex: null,
  generate: false,
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
  pendingImport: ColdPassImportPreview | null
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
  coldPassEntries: ColdPassEntryView[]
  coldPassPromptState: ColdPassPromptState
  coldPassCredentialModalState: ColdPassCredentialModalState
  coldPassDeletePromptState: ColdPassDeletePromptState
  coldPassImportPromptState: ColdPassImportPromptState
  isImportingVault: boolean
  handleSubmitColdPassUnlock: (values: ColdPassUnlockValues) => void
  handleCloseColdPassPrompt: () => void
  handleOpenColdPassCredentialModal: () => void
  handleEditColdPassCredential: (index: number, options?: { generate?: boolean }) => void
  handleCloseColdPassCredentialModal: () => void
  handleDeleteColdPassCredential: (index: number) => Promise<void>
  handleImportColdPassVault: () => void
  handleSubmitColdPassCredential: (entry: ColdPassEntry) => void
  handleCloseColdPassDeletePrompt: () => void
  handleSubmitColdPassDeletePassword: (password: string) => void
  handleCloseColdPassImportPrompt: () => void
  handleSubmitColdPassImportPassword: (password: string) => void
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
    if (activeWorkspaceView !== 'coldpass' || !activeLibrary || coldPassSession) {
      return
    }

    let cancelled = false

    const openColdPassPrompt = async () => {
      const status = await getColdPassStatus(activeLibrary.id)
        .catch(() => ({ exists: true, needsLegacyPasskey: false }))
      if (cancelled) {
        return
      }

      setColdPassPromptState((current) => (
        current.open
          ? current
          : {
              open: true,
              isNew: !status.exists,
              needsLegacyPasskey: status.needsLegacyPasskey,
              errorMessage: null,
              isSubmitting: false,
            }
      ))
    }

    void openColdPassPrompt()

    return () => {
      cancelled = true
    }
  }, [activeLibrary, activeWorkspaceView, coldPassSession])

  const handleSubmitColdPassUnlock = useCallback(({ password, legacyPasskey }: ColdPassUnlockValues) => {
    if (!activeLibrary) {
      return
    }

    setColdPassPromptState((current) => ({ ...current, open: true, errorMessage: null, isSubmitting: true }))

    void unlockColdPassSession(activeLibrary.id, password, legacyPasskey)
      .then((session) => {
        setColdPassSession(session)
        setColdPassPromptState(INITIAL_PROMPT_STATE)
      })
      .catch((error) => {
        setColdPassSession(null)
        setColdPassPromptState((current) => ({
          ...current,
          open: true,
          errorMessage: error instanceof Error ? error.message : 'No se pudo desbloquear ColdPass.',
          isSubmitting: false,
        }))
      })
  }, [activeLibrary])

  const handleCloseColdPassPrompt = useCallback(() => {
    setColdPassPromptState(INITIAL_PROMPT_STATE)

    if (activeWorkspaceView === 'coldpass' && !coldPassSession) {
      closeColdPassTab()
    }
  }, [activeWorkspaceView, closeColdPassTab, coldPassSession])

  const handleOpenColdPassCredentialModal = useCallback(() => {
    if (!coldPassSession) {
      return
    }

    setColdPassCredentialModalState({ ...INITIAL_CREDENTIAL_MODAL_STATE, open: true })
  }, [coldPassSession])

  const handleEditColdPassCredential = useCallback((index: number, options?: { generate?: boolean }) => {
    if (!coldPassSession || !coldPassSession.entries[index]) {
      return
    }

    setColdPassCredentialModalState({
      ...INITIAL_CREDENTIAL_MODAL_STATE,
      open: true,
      mode: 'edit',
      editingIndex: index,
      generate: Boolean(options?.generate),
    })
  }, [coldPassSession])

  const handleCloseColdPassCredentialModal = useCallback(() => {
    setColdPassCredentialModalState(INITIAL_CREDENTIAL_MODAL_STATE)
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

    if (!activeLibrary) {
      setColdPassImportPromptState(INITIAL_IMPORT_PROMPT_STATE)
      return
    }
    void pickColdPassCsvImport(activeLibrary.id)
      .then((importResult) => {
        if (!importResult) {
          setColdPassImportPromptState(INITIAL_IMPORT_PROMPT_STATE)
          return
        }

        if (importResult.importedCount === 0) {
          setColdPassImportPromptState(INITIAL_IMPORT_PROMPT_STATE)
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
        setColdPassImportPromptState(INITIAL_IMPORT_PROMPT_STATE)
        dispatch(setDialogState({
          type: 'info',
          title: 'No se pudo importar el vault',
          message: error instanceof Error ? error.message : 'No se pudo validar el CSV seleccionado.',
        }))
      })
  }, [activeLibrary, coldPassSession, dispatch])

  const handleSubmitColdPassCredential = useCallback((entry: ColdPassEntry) => {
    if (!coldPassSession || !activeLibrary) {
      return
    }

    const editingEntry = coldPassCredentialModalState.mode === 'edit' && coldPassCredentialModalState.editingIndex !== null
      ? coldPassSession.entries[coldPassCredentialModalState.editingIndex]
      : undefined
    setColdPassCredentialModalState((current) => ({ ...current, open: true, errorMessage: null, isSubmitting: true }))

    void saveColdPassEntry(activeLibrary.id, entry, editingEntry?.id)
      .then((session) => {
        setColdPassSession(session)
        setColdPassCredentialModalState(INITIAL_CREDENTIAL_MODAL_STATE)
      })
      .catch((error) => {
        setColdPassCredentialModalState((current) => ({
          ...current,
          open: true,
          errorMessage: error instanceof Error ? error.message : 'No se pudo guardar la credencial.',
          isSubmitting: false,
        }))
      })
  }, [activeLibrary, coldPassCredentialModalState.editingIndex, coldPassCredentialModalState.mode, coldPassSession])

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

  const handleSubmitColdPassDeletePassword = useCallback((password: string) => {
    const deletingEntry = coldPassDeletePromptState.deletingIndex === null
      ? undefined
      : coldPassSession?.entries[coldPassDeletePromptState.deletingIndex]
    if (!activeLibrary || !deletingEntry) {
      return
    }

    setColdPassDeletePromptState((current) => ({
      ...current,
      open: true,
      errorMessage: null,
      isSubmitting: true,
    }))

    void deleteColdPassEntry(activeLibrary.id, deletingEntry.id, password)
      .then((session) => {
        setColdPassSession(session)
        setColdPassDeletePromptState(INITIAL_DELETE_PROMPT_STATE)
      })
      .catch((error) => {
        setColdPassDeletePromptState((current) => ({
          ...current,
          open: true,
          errorMessage: error instanceof Error ? error.message : 'No se pudo eliminar la credencial.',
          isSubmitting: false,
        }))
      })
  }, [activeLibrary, coldPassDeletePromptState.deletingIndex, coldPassSession])

  const handleSubmitColdPassImportPassword = useCallback((password: string) => {
    const importSummary = coldPassImportPromptState.pendingImport
    if (!activeLibrary || !coldPassSession || !importSummary) {
      return
    }

    setColdPassImportPromptState((current) => ({
      ...current,
      open: true,
      errorMessage: null,
      isSubmitting: true,
    }))

    void confirmColdPassImport(activeLibrary.id, password)
      .then((session) => {
        setColdPassSession(session)
        dispatch(setDialogState({
          type: 'info',
          title: 'Vault importado',
          message: importSummary.skippedRowCount > 0
            ? `Se importaron ${importSummary.importedCount} credenciales desde ${importSummary.sourceFileName} y se omitieron ${importSummary.skippedRowCount} filas vacias.`
            : `Se importaron ${importSummary.importedCount} credenciales desde ${importSummary.sourceFileName}.`,
        }))
        setColdPassImportPromptState(INITIAL_IMPORT_PROMPT_STATE)
      })
      .catch((error) => {
        setColdPassImportPromptState((current) => ({
          ...current,
          open: true,
          errorMessage: error instanceof Error ? error.message : 'No se pudo importar el vault.',
          isSubmitting: false,
        }))
      })
  }, [activeLibrary, coldPassImportPromptState.pendingImport, coldPassSession, dispatch])

  const resetColdPassSession = useCallback(() => {
    if (activeLibrary) {
      // The unlocked vault lives in the backend; closing the view locks it.
      void lockColdPassSession(activeLibrary.id).catch(() => undefined)
    }
    setColdPassSession(null)
    setColdPassPromptState(INITIAL_PROMPT_STATE)
    setColdPassCredentialModalState(INITIAL_CREDENTIAL_MODAL_STATE)
    setColdPassDeletePromptState(INITIAL_DELETE_PROMPT_STATE)
    setColdPassImportPromptState(INITIAL_IMPORT_PROMPT_STATE)
  }, [activeLibrary])

  const coldPassEntries = coldPassSession?.entries ?? EMPTY_COLDPASS_ENTRIES

  return {
    coldPassSession,
    coldPassEntries,
    coldPassPromptState,
    coldPassCredentialModalState,
    coldPassDeletePromptState,
    coldPassImportPromptState,
    isImportingVault: coldPassImportPromptState.isSelectingFile,
    handleSubmitColdPassUnlock,
    handleCloseColdPassPrompt,
    handleOpenColdPassCredentialModal,
    handleEditColdPassCredential,
    handleCloseColdPassCredentialModal,
    handleDeleteColdPassCredential,
    handleImportColdPassVault,
    handleSubmitColdPassCredential,
    handleCloseColdPassDeletePrompt,
    handleSubmitColdPassDeletePassword,
    handleCloseColdPassImportPrompt,
    handleSubmitColdPassImportPassword,
    resetColdPassSession,
  }
}
