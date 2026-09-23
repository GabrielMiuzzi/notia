import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { selectSettingsActiveSection } from '../../features/ui/uiSelectors'
import { Brain, ChevronDown, Eye, KeyRound, Pencil, Trash2, Unlink, Wrench, X } from 'lucide-react'
import {
  clampOcrDebounceMs,
  INKMATH_OCR_DEBOUNCE_MAX_MS,
  INKMATH_OCR_DEBOUNCE_MIN_MS,
} from '../../modules/inkmath/settings'
import type { InkMathPreferences } from '../../services/preferences/inkMathSettingsStorage'
import {
  getDefaultOllamaApiUrl,
  getSessionAiApiKey,
  subscribeSessionAiApiKey,
  normalizeAiSettingsInput,
  type AiPreferences,
} from '../../services/preferences/aiSettingsStorage'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import { getExplorerRefreshIntervalBounds } from '../../services/preferences/explorerPanelStorage'
import { getAppVersion } from '../../services/runtime/appVersion'
import { checkAiHealth, invalidateAiHealthCache, listAiModels, type AiModelOption } from '../../services/ai/aiRuntime'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'
import { normalizeTelegramPreferences, type TelegramPreferences } from '../../services/preferences/telegramSettingsStorage'
import { checkTelegramBot } from '../../services/telegram/telegramRuntime'
import { selectQwen3AsrSettings, selectQwen3TtsSettings, selectTheme } from '../../features/preferences/preferencesSelectors'
import { setQwen3AsrSettings, setQwen3TtsSettings } from '../../features/preferences/preferencesSlice'
import { QWEN3_TTS_VOICES } from '../../services/preferences/qwen3TtsSettingsStorage'
import type { Qwen3AsrModel } from '../../services/preferences/qwen3AsrSettingsStorage'
import { checkQwen3TtsConnection, getQwen3TtsStatus, reloadQwen3Tts } from '../../services/qwen3Tts/qwen3TtsRuntime'
import { selectActiveLibrary } from '../../features/library/librarySelectors'
import { clearAllFinanceData } from '../../modules/finance/services/financeService'
import { financeErrorMessage } from '../../modules/finance/engines/financeError'
import { notifyFinanceDataChanged } from '../../modules/finance/services/financeDataEvents'
import { ConfirmationDialogModal } from './ConfirmationDialogModal'
import { useSubmenuEngine } from '../../hooks/useSubmenuEngine'
import { NotiaSubmenuPanel } from './NotiaSubmenuPanel'
import { NotiaSelectMenu } from '../common/NotiaSelectMenu'
import { disableBackups, loadBackupStatus, pickBackupDirectory, type BackupStatus } from '../../services/preferences/backupSettingsStorage'
import { saveDevicePreferences } from '../../services/preferences/devicePreferencesStorage'
import type { TaskManagerPublicationPreferences } from '../../services/preferences/taskManagerPublicationSettingsStorage'
import { loadTaskManagerSettings } from '../../modules/task-manager/services/taskManagerStorage'
import { getTaskManagerPublicationStatus, getTaskManagerPublicationUrl, openTaskManagerPublication, publishTaskManagerBoards, stopTaskManagerPublication, type TaskManagerPublicationStatusSnapshot } from '../../modules/task-manager/services/taskManagerPublicationRuntime'
import { loadTaskManagerPublicationTelemetry, recordTaskManagerPublicationTelemetry } from '../../modules/task-manager/services/taskManagerPublicationTelemetry'
import { normalizeContextTag, normalizeLibraryContexts, type LibraryContext } from '../../services/contexts/libraryContexts'
import {
  createLibraryRole,
  createLibraryUser,
  deleteLibraryUser,
  listLibraryRoles,
  listLibraryUsers,
  unlinkLibraryUserTelegram,
  updateLibraryUserName,
  updateLibraryUserPassword,
  updateLibraryUserRole,
  updateLibraryUserContexts,
  type LibraryRole,
  type LibraryUser,
} from '../../services/libraries/libraryUsers'

type SettingsSection = 'General' | 'Contextos' | 'Roles' | 'Usuarios' | 'Panel desplegable' | 'InkMath' | 'IA' | 'Voz' | 'Telegram' | 'Finanzas' | 'Backups' | 'Publicar'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  explorerRefreshIntervalMs: number
  onExplorerRefreshIntervalMsChange: (value: number) => void
  inkMathPreferences: InkMathPreferences
  onInkMathPreferencesChange: (value: InkMathPreferences) => void
  aiPreferences: AiPreferences
  onAiPreferencesChange: (value: AiPreferences) => void
  telegramPreferences: TelegramPreferences
  onTelegramPreferencesChange: (value: TelegramPreferences) => void
  taskManagerPublicationPreferences: TaskManagerPublicationPreferences
  onTaskManagerPublicationPreferencesChange: (value: TaskManagerPublicationPreferences) => void
  contexts: LibraryContext[]
  onContextsChange: (value: LibraryContext[]) => void
}

const SECTIONS: SettingsSection[] = ['General', 'Contextos', 'Roles', 'Usuarios', 'Panel desplegable', 'InkMath', 'IA', 'Voz', 'Telegram', 'Finanzas', 'Backups', 'Publicar']
const VALID_SETTINGS_SECTIONS = new Set<SettingsSection>(SECTIONS)

function formatPublicationBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function formatPublicationMilliseconds(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return 'sin datos'
  return `${Math.max(0, Math.round(milliseconds))} ms`
}

function formatPublicationTimestamp(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return 'sin cambios'
  return new Date(timestamp).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function SettingsModal({
  open,
  onClose,
  explorerRefreshIntervalMs,
  onExplorerRefreshIntervalMsChange,
  inkMathPreferences,
  onInkMathPreferencesChange,
  aiPreferences,
  onAiPreferencesChange,
  telegramPreferences,
  onTelegramPreferencesChange,
  taskManagerPublicationPreferences,
  onTaskManagerPublicationPreferencesChange,
  contexts,
  onContextsChange,
}: SettingsModalProps) {
  const dispatch = useAppDispatch()
  const qwen3TtsPreferences = useAppSelector(selectQwen3TtsSettings)
  const qwen3AsrPreferences = useAppSelector(selectQwen3AsrSettings)
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const appTheme = useAppSelector(selectTheme)
  const [qwen3TtsStatus, setQwen3TtsStatus] = useState('Consultando el runtime local...')
  const [isCheckingQwen3Tts, setIsCheckingQwen3Tts] = useState(false)
  const [qwen3TtsLoadedSelection, setQwen3TtsLoadedSelection] = useState<{ model: string, device: string } | null>(null)
  const sessionApiKey = useSyncExternalStore(subscribeSessionAiApiKey, getSessionAiApiKey)
  const normalizedIncomingAiPreferences = {
    ...normalizeAiSettingsInput(aiPreferences),
    apiKey: sessionApiKey,
  }
  const requestedSection = useAppSelector(selectSettingsActiveSection)
  const [activeSection, setActiveSection] = useState<SettingsSection>(() => {
    if (requestedSection && VALID_SETTINGS_SECTIONS.has(requestedSection)) {
      return requestedSection
    }
    return 'General'
  })

  useEffect(() => {
    if (open && requestedSection && VALID_SETTINGS_SECTIONS.has(requestedSection)) {
      setActiveSection(requestedSection)
    }
  }, [open, requestedSection])

  useEffect(() => {
    if (!open || activeSection !== 'Voz') return
    let active = true
    void getQwen3TtsStatus()
      .then((status) => {
        if (!active) return
        if (status.ready && !qwen3TtsLoadedSelection) setQwen3TtsLoadedSelection({ model: qwen3TtsPreferences.model, device: qwen3TtsPreferences.device })
        if (status.ready) setQwen3TtsStatus(`Runtime Qwen3-TTS listo con backend ${status.backend ?? 'desconocido'}.`)
        else if (status.loading) setQwen3TtsStatus('Cargando el modelo seleccionado...')
        else setQwen3TtsStatus(status.error ?? 'El runtime nativo todavía no está listo.')
      })
      .catch((error) => {
        if (active) setQwen3TtsStatus(error instanceof Error ? error.message : 'No se pudo consultar el runtime local.')
      })
    return () => { active = false }
  }, [activeSection, open, qwen3TtsLoadedSelection, qwen3TtsPreferences.model, qwen3TtsPreferences.device])
  const [ollamaUrlDraft, setOllamaUrlDraft] = useState(normalizedIncomingAiPreferences.ollamaUrl)
  const [apiKeyDraft, setApiKeyDraft] = useState(normalizedIncomingAiPreferences.apiKey)
  const [selectedModelDraft, setSelectedModelDraft] = useState(normalizedIncomingAiPreferences.selectedModel)
  const [thinkingEnabledDraft, setThinkingEnabledDraft] = useState(normalizedIncomingAiPreferences.thinkingEnabled)
  const [thinkingLevelDraft, setThinkingLevelDraft] = useState(normalizedIncomingAiPreferences.thinkingLevel)
  const [progressModeDraft, setProgressModeDraft] = useState(normalizedIncomingAiPreferences.progressMode)
  const [showPlanDraft, setShowPlanDraft] = useState(normalizedIncomingAiPreferences.showPlan)
  const [showReasoningSummaryDraft, setShowReasoningSummaryDraft] = useState(normalizedIncomingAiPreferences.showReasoningSummary)
  const [editProgressMessageDraft, setEditProgressMessageDraft] = useState(normalizedIncomingAiPreferences.editProgressMessage)
  const [telegramTokenDraft, setTelegramTokenDraft] = useState(telegramPreferences.botToken)
  const [telegramStatus, setTelegramStatus] = useState('Todavia no se probo la conexion.')
  const [isCheckingTelegram, setIsCheckingTelegram] = useState(false)
  const [isFinanceDeleteConfirmationOpen, setIsFinanceDeleteConfirmationOpen] = useState(false)
  const [isClearingFinanceData, setIsClearingFinanceData] = useState(false)
  const [backupStatus, setBackupStatus] = useState('')
  const [backupSettings, setBackupSettings] = useState<BackupStatus | null>(null)
  useEffect(() => {
    if (activeSection !== 'Backups') return
    let isCurrent = true
    void loadBackupStatus()
      .then((status) => { if (isCurrent) setBackupSettings(status) })
      .catch(() => { if (isCurrent) setBackupStatus('No se pudo leer la configuración de backups.') })
    return () => { isCurrent = false }
  }, [activeSection])
  const [publicationStatus, setPublicationStatus] = useState('Seleccioná uno o más tableros para habilitar la publicación local.')
  const [publicationUrl, setPublicationUrl] = useState<string | null>(null)
  const [isPublishingBoards, setIsPublishingBoards] = useState(false)

  const [publicationMetrics, setPublicationMetrics] = useState<TaskManagerPublicationStatusSnapshot | null>(null)
  const [publicationTelemetrySamples, setPublicationTelemetrySamples] = useState(() => loadTaskManagerPublicationTelemetry().samples.length)
  const [financeClearStatus, setFinanceClearStatus] = useState<{
    tone: 'idle' | 'success' | 'error'
    message: string
  }>({ tone: 'idle', message: 'Esta acción elimina definitivamente todos los datos del módulo Finanzas en la biblioteca activa.' })
  const [availableModels, setAvailableModels] = useState<AiModelOption[]>([])
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [newContextTag, setNewContextTag] = useState('')
  const [newContextColor, setNewContextColor] = useState('#64748B')
  const [libraryRoles, setLibraryRoles] = useState<LibraryRole[]>([])
  const [libraryUsers, setLibraryUsers] = useState<LibraryUser[]>([])
  const [libraryDataStatus, setLibraryDataStatus] = useState<{ tone: 'idle' | 'loading' | 'success' | 'error', message: string }>({ tone: 'idle', message: '' })
  const [newRoleName, setNewRoleName] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [selectedUserRoleId, setSelectedUserRoleId] = useState('')
  const [isSavingLibraryData, setIsSavingLibraryData] = useState(false)
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null)
  const [passwordDraft, setPasswordDraft] = useState('')
  const [passwordConfirmationDraft, setPasswordConfirmationDraft] = useState('')
  const [showPasswordDraft, setShowPasswordDraft] = useState(false)
  const [renameUserId, setRenameUserId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteUser, setDeleteUser] = useState<LibraryUser | null>(null)
  const libraryDataGenerationRef = useRef(0)
  const { triggerRef: modelTriggerRef, panelRef: modelPanelRef } = useSubmenuEngine<HTMLButtonElement, HTMLDivElement>({
    open: isModelMenuOpen,
    onClose: () => setIsModelMenuOpen(false),
  })
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [modelsErrorMessage, setModelsErrorMessage] = useState<string | null>(null)
  const [aiHealthStatus, setAiHealthStatus] = useState<{
    tone: 'idle' | 'success' | 'error'
    message: string
  }>({
    tone: 'idle',
    message: 'Todavia no se probo la conexion.',
  })
  const [isCheckingAiHealth, setIsCheckingAiHealth] = useState(false)
  const projectVersion = getAppVersion()
  const runtimeDevice = getRuntimeDevice()
  const isAndroidRuntime = runtimeDevice === 'Android'
  const visibleSections = runtimeDevice === 'Windows'
    ? SECTIONS
    : SECTIONS.filter((section) => section !== 'Backups' && section !== 'Publicar' && (!isAndroidRuntime || section !== 'Telegram'))

  useEffect(() => {
    if (isAndroidRuntime && activeSection === 'Telegram') setActiveSection('General')
  }, [activeSection, isAndroidRuntime])
  const taskManagerSettings = loadTaskManagerSettings()
  const publishedBoardNames = new Set(taskManagerPublicationPreferences.publishedBoardNames)
  const refreshBounds = getExplorerRefreshIntervalBounds()
  const refreshSliderMin = refreshBounds.allowDisabled ? 0 : refreshBounds.minSeconds
  const isAutoRefreshDisabled = refreshBounds.allowDisabled && explorerRefreshIntervalMs <= 0
  const refreshIntervalSeconds = isAutoRefreshDisabled
    ? 0
    : Math.max(refreshBounds.minSeconds, Math.round(explorerRefreshIntervalMs / 1000))
  const refreshIntervalLabel = isAutoRefreshDisabled ? 'Manual' : `${refreshIntervalSeconds}s`
  const refreshIntervalRangeLabel = refreshBounds.allowDisabled
    ? `Cooldown del chequeo automatico (0 = manual, ${refreshBounds.minSeconds}s a ${refreshBounds.maxSeconds}s)`
    : `Cooldown del chequeo automatico (${refreshBounds.minSeconds}s a ${refreshBounds.maxSeconds}s)`
  const ocrDebounceMs = clampOcrDebounceMs(inkMathPreferences.debounceMs)
  const ocrDebounceLabel = `${ocrDebounceMs} ms`
  const normalizedAiPreferences = normalizeAiSettingsInput({
    ollamaUrl: ollamaUrlDraft,
    apiKey: apiKeyDraft,
    selectedModel: selectedModelDraft,
    thinkingEnabled: thinkingEnabledDraft,
    thinkingLevel: thinkingLevelDraft,
    progressMode: progressModeDraft,
    showPlan: showPlanDraft,
    showReasoningSummary: showReasoningSummaryDraft,
    editProgressMessage: editProgressMessageDraft,
  })
  const selectedModelOption = availableModels.find((model) => model.name === selectedModelDraft) ?? null

  useEffect(() => {
    if (!open) {
      return
    }

    setOllamaUrlDraft(normalizedIncomingAiPreferences.ollamaUrl)
    setApiKeyDraft(normalizedIncomingAiPreferences.apiKey)
    setSelectedModelDraft(normalizedIncomingAiPreferences.selectedModel)
    setThinkingEnabledDraft(normalizedIncomingAiPreferences.thinkingEnabled)
    setThinkingLevelDraft(normalizedIncomingAiPreferences.thinkingLevel)
    setProgressModeDraft(normalizedIncomingAiPreferences.progressMode)
    setShowPlanDraft(normalizedIncomingAiPreferences.showPlan)
    setShowReasoningSummaryDraft(normalizedIncomingAiPreferences.showReasoningSummary)
    setEditProgressMessageDraft(normalizedIncomingAiPreferences.editProgressMessage)
  }, [
    normalizedIncomingAiPreferences.apiKey,
    normalizedIncomingAiPreferences.ollamaUrl,
    normalizedIncomingAiPreferences.selectedModel,
    normalizedIncomingAiPreferences.thinkingEnabled,
    normalizedIncomingAiPreferences.thinkingLevel,
    normalizedIncomingAiPreferences.progressMode,
    normalizedIncomingAiPreferences.showPlan,
    normalizedIncomingAiPreferences.showReasoningSummary,
    normalizedIncomingAiPreferences.editProgressMessage,
    open,
  ])

  useEffect(() => {
    if (open) setTelegramTokenDraft(telegramPreferences.botToken)
  }, [open, telegramPreferences.botToken])

  useEffect(() => {
    if (!open) setIsFinanceDeleteConfirmationOpen(false)
  }, [open])

  useEffect(() => {
    libraryDataGenerationRef.current += 1
    const generation = libraryDataGenerationRef.current
    setIsSavingLibraryData(false)
    setRenameUserId(null)
    setPasswordUserId(null)
    if (!open || !activeLibrary) {
      setLibraryRoles([])
      setLibraryUsers([])
      setSelectedUserRoleId('')
      setLibraryDataStatus({ tone: 'idle', message: '' })
      return
    }
    const context = { libraryPath: activeLibrary.path, androidDirectoryUri: activeLibrary.androidTreeUri }
    setLibraryRoles([])
    setLibraryUsers([])
    setSelectedUserRoleId('')
    setLibraryDataStatus({ tone: 'loading', message: 'Cargando roles y usuarios desde SQLite…' })
    void Promise.all([listLibraryRoles(context), listLibraryUsers(context)])
      .then(([roles, users]) => {
        if (generation !== libraryDataGenerationRef.current) return
        setLibraryRoles(roles)
        setLibraryUsers(users)
        setSelectedUserRoleId(roles[0]?.id ?? '')
        setLibraryDataStatus({ tone: 'success', message: '' })
      })
      .catch((error: unknown) => {
        if (generation !== libraryDataGenerationRef.current) return
        setLibraryDataStatus({ tone: 'error', message: error instanceof Error ? error.message : 'No se pudieron cargar los datos de la biblioteca.' })
      })
    return () => { libraryDataGenerationRef.current += 1 }
  }, [activeLibrary, open])

  useEffect(() => {
    if (!open || runtimeDevice !== 'Windows') return
    let cancelled = false
    void getTaskManagerPublicationUrl()
      .then((url) => {
        if (!cancelled) setPublicationUrl(url)
      })
      .catch(() => {
        if (!cancelled) setPublicationUrl(null)
      })
    return () => { cancelled = true }
  }, [open, runtimeDevice])

  useEffect(() => {
    if (!open || activeSection !== 'Publicar') return
    const refreshStatus = () => void getTaskManagerPublicationStatus()
      .then((status) => {
        setPublicationMetrics(status)
        setPublicationTelemetrySamples(recordTaskManagerPublicationTelemetry(status).samples.length)
      })
      .catch(() => setPublicationMetrics(null))
    refreshStatus()
    const timer = window.setInterval(refreshStatus, 2000)
    return () => window.clearInterval(timer)
  }, [activeSection, open])

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    const currentPreferences = normalizeAiSettingsInput(aiPreferences)

    setIsLoadingModels(true)
    setModelsErrorMessage(null)

    void listAiModels(currentPreferences)
      .then((models) => {
        if (cancelled) {
          return
        }

        const names = models.map((model) => model.name)
        setAvailableModels(models)

        const nextSelectedModel = currentPreferences.selectedModel && names.includes(currentPreferences.selectedModel)
          ? currentPreferences.selectedModel
          : names[0] ?? ''

        if (nextSelectedModel !== currentPreferences.selectedModel) {
          onAiPreferencesChange({
            ...currentPreferences,
            selectedModel: nextSelectedModel,
          })
        }

        setSelectedModelDraft(nextSelectedModel)
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setAvailableModels([])
        setModelsErrorMessage(
          error instanceof Error && error.message.trim()
            ? error.message
            : 'No se pudieron cargar los modelos.',
        )
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingModels(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [aiPreferences, onAiPreferencesChange, open])

  const commitAiPreferences = () => {
    const normalized = normalizeAiSettingsInput({
      ollamaUrl: ollamaUrlDraft,
      apiKey: apiKeyDraft,
      selectedModel: selectedModelDraft,
      thinkingEnabled: thinkingEnabledDraft,
      thinkingLevel: thinkingLevelDraft,
      progressMode: progressModeDraft,
      showPlan: showPlanDraft,
      showReasoningSummary: showReasoningSummaryDraft,
      editProgressMessage: editProgressMessageDraft,
    })

    setOllamaUrlDraft(normalized.ollamaUrl)
    setApiKeyDraft(normalized.apiKey)
    setSelectedModelDraft(normalized.selectedModel)
    setThinkingEnabledDraft(normalized.thinkingEnabled)
    setThinkingLevelDraft(normalized.thinkingLevel)
    setProgressModeDraft(normalized.progressMode)
    setShowPlanDraft(normalized.showPlan)
    setShowReasoningSummaryDraft(normalized.showReasoningSummary)
    setEditProgressMessageDraft(normalized.editProgressMessage)
    onAiPreferencesChange(normalized)
  }

  // Save pending changes when modal closes
  useEffect(() => {
    if (!open) {
      // Commit any pending changes when closing
      commitAiPreferences()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleCheckAiConnection = async () => {
    const normalized = normalizeAiSettingsInput({
      ollamaUrl: ollamaUrlDraft,
      apiKey: apiKeyDraft,
      selectedModel: selectedModelDraft,
    })

    setOllamaUrlDraft(normalized.ollamaUrl)
    setApiKeyDraft(normalized.apiKey)
    setSelectedModelDraft(normalized.selectedModel)
    onAiPreferencesChange(normalized)
    invalidateAiHealthCache()
    setIsCheckingAiHealth(true)

    const result = await checkAiHealth(normalized)
    setAiHealthStatus({
      tone: result.ok ? 'success' : 'error',
      message: result.message,
    })
    setIsCheckingAiHealth(false)
  }

  const commitTelegramToken = () => {
    onTelegramPreferencesChange(normalizeTelegramPreferences({ ...telegramPreferences, botToken: telegramTokenDraft }))
  }

  const handleCheckTelegram = async () => {
    const token = telegramTokenDraft.trim()
    commitTelegramToken()
    setIsCheckingTelegram(true)
    try {
      const bot = await checkTelegramBot(token)
      setTelegramStatus(`Conexion correcta con @${bot.username ?? bot.displayName}. Envia /start al bot para emparejar.`)
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : 'No se pudo verificar el bot.')
    } finally { setIsCheckingTelegram(false) }
  }

  const handleAddLibraryRole = async () => {
    if (!activeLibrary || !newRoleName.trim() || isSavingLibraryData) return
    const generation = libraryDataGenerationRef.current
    const context = { libraryPath: activeLibrary.path, androidDirectoryUri: activeLibrary.androidTreeUri }
    setIsSavingLibraryData(true)
    setLibraryDataStatus({ tone: 'loading', message: 'Guardando rol…' })
    try {
      const roles = await createLibraryRole(context, newRoleName)
      if (generation === libraryDataGenerationRef.current) {
        setLibraryRoles(roles)
        setSelectedUserRoleId((current) => current || roles[0]?.id || '')
        setNewRoleName('')
        setLibraryDataStatus({ tone: 'success', message: 'Rol guardado.' })
      }
    } catch (error) {
      if (generation === libraryDataGenerationRef.current) setLibraryDataStatus({ tone: 'error', message: error instanceof Error ? error.message : 'No se pudo guardar el rol.' })
     } finally { if (generation === libraryDataGenerationRef.current) setIsSavingLibraryData(false) }
  }

  const handleAddLibraryUser = async () => {
    if (!activeLibrary || !newUserName.trim() || !selectedUserRoleId || isSavingLibraryData) return
    const generation = libraryDataGenerationRef.current
    const context = { libraryPath: activeLibrary.path, androidDirectoryUri: activeLibrary.androidTreeUri }
    setIsSavingLibraryData(true)
    setLibraryDataStatus({ tone: 'loading', message: 'Guardando usuario…' })
    try {
      const users = await createLibraryUser(context, newUserName, selectedUserRoleId)
      if (generation === libraryDataGenerationRef.current) {
        setLibraryUsers(users)
        setNewUserName('')
        setLibraryDataStatus({ tone: 'success', message: 'Usuario guardado.' })
      }
    } catch (error) {
      if (generation === libraryDataGenerationRef.current) setLibraryDataStatus({ tone: 'error', message: error instanceof Error ? error.message : 'No se pudo guardar el usuario.' })
     } finally { if (generation === libraryDataGenerationRef.current) setIsSavingLibraryData(false) }
  }

  const handleLibraryMutationError = (error: unknown, generation = libraryDataGenerationRef.current) => {
    if (generation !== libraryDataGenerationRef.current) return
    setLibraryDataStatus({ tone: 'error', message: error instanceof Error ? error.message : 'No se pudo actualizar la biblioteca.' })
  }

  const handleUpdateLibraryUserName = async (userId: string) => {
    if (!activeLibrary || !renameDraft.trim() || isSavingLibraryData) return
    const generation = libraryDataGenerationRef.current
    const context = { libraryPath: activeLibrary.path, androidDirectoryUri: activeLibrary.androidTreeUri }
    setIsSavingLibraryData(true)
    try {
      const users = await updateLibraryUserName(context, userId, renameDraft)
      if (generation !== libraryDataGenerationRef.current) return
      setLibraryUsers(users)
      setRenameUserId(null)
      setRenameDraft('')
      setLibraryDataStatus({ tone: 'success', message: 'Nombre actualizado.' })
    } catch (error) {
      handleLibraryMutationError(error, generation)
    } finally {
      if (generation === libraryDataGenerationRef.current) setIsSavingLibraryData(false)
    }
  }

  const handleUpdateLibraryUserRole = async (userId: string, roleId: string) => {
    if (!activeLibrary || isSavingLibraryData) return
    const generation = libraryDataGenerationRef.current
    const context = { libraryPath: activeLibrary.path, androidDirectoryUri: activeLibrary.androidTreeUri }
    setIsSavingLibraryData(true)
    try {
      const users = await updateLibraryUserRole(context, userId, roleId)
      if (generation !== libraryDataGenerationRef.current) return
      setLibraryUsers(users)
      setLibraryDataStatus({ tone: 'success', message: 'Rol actualizado.' })
    } catch (error) {
      handleLibraryMutationError(error, generation)
    } finally {
      if (generation === libraryDataGenerationRef.current) setIsSavingLibraryData(false)
    }
  }

  const handleUpdateLibraryUserContexts = async (user: LibraryUser, contextTag: string, checked: boolean) => {
    if (!activeLibrary || user.allContexts || isSavingLibraryData) return
    const generation = libraryDataGenerationRef.current
    const context = { libraryPath: activeLibrary.path, androidDirectoryUri: activeLibrary.androidTreeUri }
    const nextTags = new Set(user.allowedContexts.map((tag) => tag.toLowerCase()))
    if (checked) nextTags.add(contextTag.toLowerCase())
    else nextTags.delete(contextTag.toLowerCase())
    const selectedTags = contexts
      .filter((item) => nextTags.has(item.tag.toLowerCase()))
      .map((item) => item.tag)
    setIsSavingLibraryData(true)
    try {
      const users = await updateLibraryUserContexts(context, user.id, selectedTags)
      if (generation !== libraryDataGenerationRef.current) return
      setLibraryUsers(users)
      setLibraryDataStatus({ tone: 'success', message: 'Contextos permitidos actualizados.' })
    } catch (error) {
      handleLibraryMutationError(error, generation)
    } finally {
      if (generation === libraryDataGenerationRef.current) setIsSavingLibraryData(false)
    }
  }

  const handleUnlinkLibraryUserTelegram = async (userId: string) => {
    if (!activeLibrary || isSavingLibraryData) return
    const generation = libraryDataGenerationRef.current
    const context = { libraryPath: activeLibrary.path, androidDirectoryUri: activeLibrary.androidTreeUri }
    setIsSavingLibraryData(true)
    try {
      const users = await unlinkLibraryUserTelegram(context, userId)
      if (generation !== libraryDataGenerationRef.current) return
      setLibraryUsers(users)
      setLibraryDataStatus({ tone: 'success', message: 'Telegram desvinculado.' })
    } catch (error) {
      handleLibraryMutationError(error, generation)
    } finally {
      if (generation === libraryDataGenerationRef.current) setIsSavingLibraryData(false)
    }
  }

  const handleUpdateLibraryUserPassword = async (userId: string) => {
    if (!activeLibrary || isSavingLibraryData) return
    if (passwordDraft.length < 8 || passwordDraft.length > 256) {
      setLibraryDataStatus({ tone: 'error', message: 'La contraseña debe tener entre 8 y 256 caracteres.' })
      return
    }
    if (passwordDraft !== passwordConfirmationDraft) {
      setLibraryDataStatus({ tone: 'error', message: 'Las contraseñas no coinciden.' })
      return
    }
    const generation = libraryDataGenerationRef.current
    const context = { libraryPath: activeLibrary.path, androidDirectoryUri: activeLibrary.androidTreeUri }
    setIsSavingLibraryData(true)
    try {
      const users = await updateLibraryUserPassword(context, userId, passwordDraft)
      if (generation !== libraryDataGenerationRef.current) return
      setLibraryUsers(users)
      setPasswordUserId(null)
      setPasswordDraft('')
      setPasswordConfirmationDraft('')
      setLibraryDataStatus({ tone: 'success', message: 'Contraseña actualizada.' })
    } catch (error) {
      handleLibraryMutationError(error, generation)
    } finally {
      if (generation === libraryDataGenerationRef.current) setIsSavingLibraryData(false)
    }
  }

  const handleDeleteLibraryUser = async (userId: string) => {
    if (!activeLibrary || isSavingLibraryData) return
    const generation = libraryDataGenerationRef.current
    const context = { libraryPath: activeLibrary.path, androidDirectoryUri: activeLibrary.androidTreeUri }
    setIsSavingLibraryData(true)
    try {
      const users = await deleteLibraryUser(context, userId)
      if (generation !== libraryDataGenerationRef.current) return
      setLibraryUsers(users)
      setLibraryDataStatus({ tone: 'success', message: 'Usuario eliminado.' })
    } catch (error) {
      handleLibraryMutationError(error, generation)
    } finally {
      if (generation === libraryDataGenerationRef.current) setIsSavingLibraryData(false)
    }
  }

  const handleClearFinanceData = async () => {
    if (!activeLibrary || isClearingFinanceData) return
    setIsFinanceDeleteConfirmationOpen(false)
    setIsClearingFinanceData(true)
    setFinanceClearStatus({ tone: 'idle', message: 'Eliminando los datos financieros…' })
    try {
      await clearAllFinanceData(activeLibrary)
      notifyFinanceDataChanged()
      setFinanceClearStatus({ tone: 'success', message: 'Se eliminaron los datos financieros y se restauraron las categorías iniciales.' })
    } catch (error) {
      setFinanceClearStatus({
        tone: 'error',
        message: financeErrorMessage(error, 'No se pudieron eliminar los datos financieros.'),
      })
    } finally {
      setIsClearingFinanceData(false)
    }
  }

  const handlePublicationBoardToggle = (boardName: string) => {
    const nextBoardNames = new Set(taskManagerPublicationPreferences.publishedBoardNames)
    if (nextBoardNames.has(boardName)) nextBoardNames.delete(boardName)
    else nextBoardNames.add(boardName)
    onTaskManagerPublicationPreferencesChange({
      ...taskManagerPublicationPreferences,
      publishedBoardNames: Array.from(nextBoardNames),
    })
    setPublicationUrl(null)
    setPublicationStatus('La publicación anterior se detuvo. Publicá la nueva selección para generar una URL.')
    void stopTaskManagerPublication().catch((error: unknown) => {
      setPublicationStatus(error instanceof Error ? error.message : 'No se pudo detener la publicación anterior.')
    })
  }

  const handlePublishBoards = async () => {
    if (!activeLibrary?.path || taskManagerPublicationPreferences.publishedBoardNames.length === 0) {
      setPublicationStatus('Seleccioná al menos un tablero y asegurate de tener una biblioteca activa.')
      return
    }
   setIsPublishingBoards(true)
   try {
      // The backend reads the selection it stores; save it before publishing.
      await saveDevicePreferences({ taskManagerPublication: taskManagerPublicationPreferences })
      const url = await publishTaskManagerBoards(activeLibrary.id, appTheme)
      setPublicationUrl(url)
      setPublicationStatus('Tableros publicados en la red local. La URL solo funciona mientras Notia esté abierta.')
    } catch (error) {
      setPublicationStatus(error instanceof Error ? error.message : 'No se pudieron publicar los tableros.')
    } finally {
      setIsPublishingBoards(false)
    }
  }

  if (!open) {
    return null
  }

  return (
    <NotiaModalShell open={open} onClose={onClose} size="xl" panelClassName="notia-settings-modal">
      <div className="notia-settings-content">
        <div className="notia-settings-header">
          <h2>Configuraciones</h2>
          <NotiaButton
            size="icon"
            variant="ghost"
            className="notia-settings-close"
            title="Cerrar"
            onClick={onClose}
          >
            <X size={16} />
          </NotiaButton>
        </div>
        <div className="notia-settings-body">
          {activeSection === 'General' ? (
            <div className="notia-settings-card">
              <div className="notia-settings-card-label">Version del proyecto</div>
              <div className="notia-settings-card-value">v{projectVersion}</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">
                Dispositivo
              </div>
              <div className="notia-settings-card-value">{runtimeDevice}</div>
            </div>
          ) : activeSection === 'Contextos' ? (
            <div className="notia-settings-card">
              <div className="notia-settings-card-label">Contextos de la biblioteca</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">
                Cada nota puede declarar una propiedad <code>contexto</code> con un tag como <code>#Personal</code>. El color se usa en Graph View.
              </div>
              <div className="notia-settings-context-create">
                <label className="notia-settings-context-create-label" htmlFor="notia-new-context-tag">Nuevo contexto</label>
                <div className="notia-settings-context-create-row">
                  <input
                    id="notia-new-context-tag"
                    className="notia-settings-input"
                    aria-label="Nuevo tag de contexto"
                    placeholder="#NuevoContexto"
                    value={newContextTag}
                    onChange={(event) => setNewContextTag(event.target.value)}
                  />
                  <input type="color" aria-label="Color del nuevo contexto" value={newContextColor} onChange={(event) => setNewContextColor(event.target.value.toUpperCase())} />
                  <NotiaButton
                    onClick={() => {
                      const tag = normalizeContextTag(newContextTag)
                      if (!tag || contexts.some((item) => item.tag.toLowerCase() === tag.toLowerCase())) return
                      onContextsChange(normalizeLibraryContexts([...contexts, { tag, color: newContextColor }]))
                      setNewContextTag('')
                    }}
                    disabled={!newContextTag.trim()}
                  >
                    Agregar contexto
                  </NotiaButton>
                </div>
              </div>
              <div className="notia-settings-context-table-wrap">
                <table className="notia-settings-context-table">
                  <caption className="notia-settings-visually-hidden">Contextos configurados</caption>
                  <thead>
                    <tr>
                      <th scope="col">Contexto</th>
                      <th scope="col">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contexts.map((context) => {
                      const isUsedByBoard = taskManagerSettings.boards.some((board) => board.contexto?.toLowerCase() === context.tag.toLowerCase())
                      return (
                        <tr key={context.tag}>
                          <td>
                            <input
                              className="notia-settings-input"
                              aria-label={`Tag de contexto ${context.tag}`}
                              value={context.tag}
                              onChange={(event) => {
                                const nextTag = normalizeContextTag(event.target.value)
                                if (!nextTag || contexts.some((item) => item !== context && item.tag.toLowerCase() === nextTag.toLowerCase())) return
                                onContextsChange(contexts.map((item) => item === context ? { ...item, tag: nextTag } : item))
                              }}
                            />
                          </td>
                          <td>
                            <div className="notia-settings-context-actions">
                              <input
                                type="color"
                                aria-label={`Color de contexto ${context.tag}`}
                                value={context.color}
                                onChange={(event) => onContextsChange(contexts.map((item) => item === context ? { ...item, color: event.target.value.toUpperCase() } : item))}
                              />
                              <NotiaButton
                                variant="secondary"
                                disabled={contexts.length <= 1 || isUsedByBoard}
                                title={isUsedByBoard ? 'No se puede eliminar un contexto usado por un tablero.' : undefined}
                                onClick={() => onContextsChange(contexts.filter((item) => item !== context))}
                              >
                                Eliminar
                              </NotiaButton>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeSection === 'Roles' ? (
            <div className="notia-settings-card">
              <div className="notia-settings-card-label">Roles de la biblioteca activa</div>
              <form className="notia-settings-context-create" onSubmit={(event) => { event.preventDefault(); void handleAddLibraryRole() }}>
                <label className="notia-settings-context-create-label" htmlFor="notia-new-library-role">Nuevo rol</label>
                <div className="notia-settings-context-create-row">
                  <input id="notia-new-library-role" className="notia-settings-input" value={newRoleName} maxLength={64} placeholder="Nombre del rol" onChange={(event) => setNewRoleName(event.target.value)} />
                  <NotiaButton type="submit" disabled={!activeLibrary || !newRoleName.trim() || isSavingLibraryData}>{isSavingLibraryData ? 'Guardando…' : 'Agregar rol'}</NotiaButton>
                </div>
              </form>
              {libraryDataStatus.tone === 'error' ? <div className="notia-settings-status" role="alert">{libraryDataStatus.message}</div> : null}
              {libraryDataStatus.tone === 'loading' ? <div className="notia-settings-status" role="status">{libraryDataStatus.message}</div> : null}
              <div className="notia-settings-context-table-wrap">
                <table className="notia-settings-context-table">
                  <caption className="notia-settings-visually-hidden">Roles configurados en la biblioteca</caption>
                  <thead><tr><th scope="col">Rol</th></tr></thead>
                  <tbody>
                    {libraryRoles.map((role) => <tr key={role.id}><td>{role.name}</td></tr>)}
                  </tbody>
                </table>
                {!libraryDataStatus.message && libraryRoles.length === 0 ? <div className="notia-settings-card-label">No hay roles para mostrar.</div> : null}
              </div>
            </div>
          ) : activeSection === 'Usuarios' ? (
            <div className="notia-settings-card">
              <div className="notia-settings-card-label">Usuarios de la biblioteca activa</div>
              <form className="notia-settings-user-create" onSubmit={(event) => { event.preventDefault(); void handleAddLibraryUser() }}>
                <label className="notia-settings-input-wrap"><span className="notia-settings-card-label">Nombre del usuario</span><input className="notia-settings-input" value={newUserName} maxLength={64} placeholder="Nombre" onChange={(event) => setNewUserName(event.target.value)} /></label>
                <label className="notia-settings-input-wrap"><span className="notia-settings-card-label">Rol</span><NotiaSelectMenu className="notia-settings-input" value={selectedUserRoleId} options={[{ value: '', label: 'Seleccioná un rol', disabled: true }, ...libraryRoles.map((role) => ({ value: role.id, label: role.name }))]} onChange={setSelectedUserRoleId} ariaLabel="Rol del nuevo usuario" disabled={libraryRoles.length === 0} /></label>
                <div className="notia-settings-actions"><NotiaButton type="submit" disabled={!activeLibrary || !newUserName.trim() || !selectedUserRoleId || libraryRoles.length === 0 || isSavingLibraryData}>{isSavingLibraryData ? 'Guardando…' : 'Agregar un usuario'}</NotiaButton></div>
              </form>
              {libraryDataStatus.tone === 'error' ? <div className="notia-settings-status" role="alert">{libraryDataStatus.message}</div> : null}
              {libraryDataStatus.tone === 'loading' ? <div className="notia-settings-status" role="status">{libraryDataStatus.message}</div> : null}
              <div className="notia-settings-context-table-wrap">
                <table className="notia-settings-context-table">
                  <caption className="notia-settings-visually-hidden">Usuarios y roles de la biblioteca</caption>
                  <thead><tr><th scope="col">Usuario</th><th scope="col">Rol</th><th scope="col">Contraseña</th><th scope="col">Contextos permitidos</th><th scope="col">Acciones</th></tr></thead>
                  <tbody>
                    {libraryUsers.map((user) => (
                      <tr key={user.id}>
                        <td>
                          {renameUserId === user.id ? <form onSubmit={(event) => { event.preventDefault(); void handleUpdateLibraryUserName(user.id) }}><input className="notia-settings-input" aria-label={`Nuevo nombre para ${user.name}`} value={renameDraft} maxLength={64} onChange={(event) => setRenameDraft(event.target.value)} /><div className="notia-settings-actions"><NotiaButton size="sm" type="submit" disabled={isSavingLibraryData || !renameDraft.trim()}>Guardar</NotiaButton><NotiaButton size="sm" type="button" variant="ghost" onClick={() => { setRenameUserId(null); setRenameDraft('') }}>Cancelar</NotiaButton></div></form> : user.name}
                        </td>
                         <td><NotiaSelectMenu className="notia-settings-input" ariaLabel={`Rol de ${user.name}`} value={user.roleId} options={libraryRoles.map((role) => ({ value: role.id, label: role.name }))} disabled={isSavingLibraryData} onChange={(roleId) => { void handleUpdateLibraryUserRole(user.id, roleId) }} /></td>
                        <td>{user.passwordConfigured ? 'Configurada' : 'Sin contraseña configurada'}</td>
                        <td>
                          <div className="notia-settings-user-context-list">
                            {user.allContexts ? (
                              <span className="notia-settings-user-context-all">Todos los contextos</span>
                            ) : contexts.length === 0 ? (
                              <span className="notia-settings-card-label">Sin contextos configurados</span>
                            ) : contexts.map((context) => {
                              const checked = user.allowedContexts.some((tag) => tag.toLowerCase() === context.tag.toLowerCase())
                              return (
                                <label key={context.tag} className="notia-settings-user-context-option">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={isSavingLibraryData}
                                    aria-label={`${context.tag} permitido para ${user.name}`}
                                    onChange={(event) => { void handleUpdateLibraryUserContexts(user, context.tag, event.target.checked) }}
                                  />
                                  <span className="notia-settings-context-dot" style={{ backgroundColor: context.color }} aria-hidden="true" />
                                  <span>{context.tag}</span>
                                </label>
                              )
                            })}
                          </div>
                          <div className="notia-settings-context-actions notia-settings-user-actions">
                            <NotiaButton
                              size="icon"
                              variant="secondary"
                              aria-label={`Cambiar nombre de ${user.name}`}
                              title="Cambiar nombre"
                              disabled={isSavingLibraryData}
                              onClick={() => { setRenameUserId(user.id); setRenameDraft(user.name) }}
                            >
                              <Pencil size={16} aria-hidden="true" />
                            </NotiaButton>
                            <NotiaButton
                              size="icon"
                              variant="secondary"
                              aria-label={`Establecer nueva contraseña para ${user.name}`}
                              title="Establecer nueva contraseña"
                              disabled={isSavingLibraryData}
                              onClick={() => { setPasswordUserId(user.id); setPasswordDraft(''); setPasswordConfirmationDraft(''); setShowPasswordDraft(false) }}
                            >
                              <KeyRound size={16} aria-hidden="true" />
                            </NotiaButton>
                            {user.telegramLinked ? (
                              <NotiaButton
                                size="icon"
                                variant="secondary"
                                aria-label={`Desvincular Telegram de ${user.name}`}
                                title="Desvincular Telegram"
                                disabled={isSavingLibraryData}
                                onClick={() => { void handleUnlinkLibraryUserTelegram(user.id) }}
                              >
                                <Unlink size={16} aria-hidden="true" />
                              </NotiaButton>
                            ) : null}
                            {user.id === 'user-owner' ? (
                              <span className="notia-settings-card-label" title="Owner es un usuario protegido">Owner protegido</span>
                            ) : (
                              <NotiaButton
                                size="icon"
                                variant="danger"
                                aria-label={`Eliminar usuario ${user.name}`}
                                title="Eliminar usuario"
                                disabled={isSavingLibraryData}
                                onClick={() => setDeleteUser(user)}
                              >
                                <Trash2 size={16} aria-hidden="true" />
                              </NotiaButton>
                            )}
                          </div>
                          {passwordUserId === user.id ? <form className="notia-settings-user-inline-form" onSubmit={(event) => { event.preventDefault(); void handleUpdateLibraryUserPassword(user.id) }}><input className="notia-settings-input" aria-label="Nueva contraseña" type={showPasswordDraft ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={256} value={passwordDraft} onChange={(event) => setPasswordDraft(event.target.value)} placeholder="Nueva contraseña" /><input className="notia-settings-input" aria-label="Confirmar nueva contraseña" type={showPasswordDraft ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={256} value={passwordConfirmationDraft} onChange={(event) => setPasswordConfirmationDraft(event.target.value)} placeholder="Confirmar contraseña" /><NotiaButton size="sm" type="button" onClick={() => setShowPasswordDraft((current) => !current)}>{showPasswordDraft ? 'Ocultar' : 'Mostrar'}</NotiaButton><NotiaButton size="sm" type="submit" disabled={isSavingLibraryData}>Guardar</NotiaButton><NotiaButton size="sm" type="button" variant="ghost" onClick={() => setPasswordUserId(null)}>Cancelar</NotiaButton></form> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {libraryUsers.length === 0 && libraryDataStatus.tone !== 'loading' ? <div className="notia-settings-card-label">No hay usuarios para mostrar.</div> : null}
              </div>
            </div>
          ) : activeSection === 'Panel desplegable' ? (
            <div className="notia-settings-card">
              <div className="notia-settings-card-label">Chequeo automatico de cambios</div>
              <div className="notia-settings-card-value">{refreshIntervalLabel}</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">
                {refreshIntervalRangeLabel}
              </div>
              <div className="notia-settings-slider-wrap">
                <input
                  type="range"
                  min={refreshSliderMin}
                  max={refreshBounds.maxSeconds}
                  step={1}
                  value={refreshIntervalSeconds}
                  onChange={(event) => {
                    const seconds = Number(event.target.value)
                    if (refreshBounds.allowDisabled && seconds <= 0) {
                      onExplorerRefreshIntervalMsChange(0)
                      return
                    }

                    onExplorerRefreshIntervalMsChange(seconds * 1000)
                  }}
                />
              </div>
            </div>
          ) : activeSection === 'InkMath' ? (
            <>
              <div className="notia-settings-card">
                <div className="notia-settings-card-label">Debounce OCR</div>
                <div className="notia-settings-card-value">{ocrDebounceLabel}</div>
                <div className="notia-settings-card-label notia-settings-card-label--spaced">
                  Tiempo de inactividad antes de enviar la fórmula manuscrita a Ollama
                </div>
                <div className="notia-settings-slider-wrap">
                  <input
                    type="range"
                    min={INKMATH_OCR_DEBOUNCE_MIN_MS}
                    max={INKMATH_OCR_DEBOUNCE_MAX_MS}
                    step={50}
                    value={ocrDebounceMs}
                    onChange={(event) => {
                      onInkMathPreferencesChange({
                        ...inkMathPreferences,
                        debounceMs: clampOcrDebounceMs(Number(event.target.value)),
                      })
                    }}
                  />
                </div>
              </div>
            </>
          ) : activeSection === 'IA' ? (
            <>
                <div className="notia-settings-card">
                <div className="notia-settings-card-label">Host de Ollama Cloud</div>
                <div className="notia-settings-card-value">{normalizedAiPreferences.ollamaUrl}</div>
                <div className="notia-settings-card-label notia-settings-card-label--spaced">
                  Por defecto usa Ollama Cloud (`https://ollama.com`). Si querés, podés reemplazarlo por una URL local propia.
                </div>
                <div className="notia-settings-input-wrap">
                  <input
                    className="notia-settings-input"
                    type="text"
                    value={ollamaUrlDraft}
                    onChange={(event) => {
                      setOllamaUrlDraft(event.target.value)
                    }}
                    onBlur={commitAiPreferences}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitAiPreferences()
                      }
                    }}
                    placeholder={getDefaultOllamaApiUrl()}
                  />
                </div>
              </div>
              <div className="notia-settings-card">
                <div className="notia-settings-card-label">Modelo de Ollama</div>
                <div className="notia-settings-card-value">
                  {normalizedAiPreferences.selectedModel || 'Sin seleccionar'}
                </div>
                <div className="notia-settings-card-label notia-settings-card-label--spaced">
                  Selecciona cualquier modelo disponible. Para enviar imagenes, elegi uno con capacidad de vision.
                </div>
                <div className="notia-ai-model-select">
                  <button
                    ref={modelTriggerRef}
                    type="button"
                    className="notia-ai-model-select-trigger"
                    aria-haspopup="listbox"
                    aria-expanded={isModelMenuOpen}
                    aria-controls={isModelMenuOpen ? 'notia-ai-model-select-menu' : undefined}
                    onClick={() => setIsModelMenuOpen((current) => !current)}
                    disabled={isLoadingModels || availableModels.length === 0}
                  >
                    <span>{selectedModelDraft || (isLoadingModels ? 'Cargando modelos...' : 'No hay modelos disponibles')}</span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                  {isModelMenuOpen ? (
                    <NotiaSubmenuPanel ref={modelPanelRef} id="notia-ai-model-select-menu" className="notia-ai-model-select-menu" role="listbox" aria-label="Modelos de Ollama">
                      {availableModels.map((model) => (
                        <button
                          type="button"
                          role="option"
                          aria-selected={model.name === selectedModelDraft}
                          className={`notia-ai-model-select-option${model.name === selectedModelDraft ? ' is-selected' : ''}`}
                          key={model.name}
                          onClick={() => {
                            const nextValue = model.name
                            setSelectedModelDraft(nextValue)
                            onAiPreferencesChange(normalizeAiSettingsInput({
                              ollamaUrl: ollamaUrlDraft,
                              apiKey: apiKeyDraft,
                              selectedModel: nextValue,
                              thinkingEnabled: thinkingEnabledDraft,
                              thinkingLevel: thinkingLevelDraft,
                            }))
                            setIsModelMenuOpen(false)
                          }}
                        >
                          <span className="notia-ai-model-select-name">{model.name}</span>
                          <span className="notia-ai-model-capabilities">
                            {model.supportsThinking ? <span title="Admite thinking"><Brain size={13} /> Thinking</span> : null}
                            {model.supportsVision ? <span title="Admite imágenes"><Eye size={13} /> Vision</span> : null}
                            {model.supportsTools ? <span title="Admite tool calling nativo"><Wrench size={13} /> Tools</span> : null}
                            {!model.supportsThinking && !model.supportsVision && !model.supportsTools ? <span>Texto</span> : null}
                          </span>
                        </button>
                      ))}
                    </NotiaSubmenuPanel>
                  ) : null}
                </div>
                {selectedModelOption?.supportsThinking ? (
                  <div className="notia-ai-thinking-settings">
                    <div className="notia-ai-thinking-toggle-row">
                      <div>
                        <strong>Thinking</strong>
                        <span>Incluye el razonamiento separado de la respuesta.</span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label="Activar Thinking"
                        aria-checked={thinkingEnabledDraft}
                        className={`notia-settings-switch${thinkingEnabledDraft ? ' is-on' : ''}`}
                        onClick={() => {
                          const nextEnabled = !thinkingEnabledDraft
                          setThinkingEnabledDraft(nextEnabled)
                          onAiPreferencesChange({
                            ...normalizedAiPreferences,
                            thinkingEnabled: nextEnabled,
                          })
                        }}
                      >
                        <span />
                      </button>
                    </div>
                    {selectedModelOption.supportsThinkingLevels ? (
                      <div className="notia-ai-thinking-levels" role="group" aria-label="Nivel de thinking">
                        {(['low', 'medium', 'high'] as const).map((level) => (
                          <button
                            type="button"
                            key={level}
                            className={thinkingLevelDraft === level ? 'is-selected' : ''}
                            disabled={!thinkingEnabledDraft}
                            onClick={() => {
                              setThinkingLevelDraft(level)
                              onAiPreferencesChange({
                                ...normalizedAiPreferences,
                                thinkingLevel: level,
                              })
                            }}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="notia-ai-thinking-note">Este modelo admite activar o desactivar Thinking, pero no niveles.</span>
                    )}
                  </div>
                ) : null}
                <div className="notia-ai-thinking-settings">
                  <div className="notia-settings-card-label">Feedback del agente</div>
                  <label className="notia-settings-checkbox-row">
                    <span>Detalle del progreso</span>
                    <NotiaSelectMenu
                      className="notia-settings-select"
                      ariaLabel="Detalle del progreso"
                      value={progressModeDraft}
                      options={[
                        { value: 'minimal', label: 'Mínimo' },
                        { value: 'standard', label: 'Estándar' },
                        { value: 'detailed', label: 'Detallado' },
                        { value: 'off', label: 'Desactivado' },
                      ]}
                      onChange={(value) => {
                        if (value !== 'minimal' && value !== 'standard' && value !== 'detailed' && value !== 'off') return
                        setProgressModeDraft(value)
                        onAiPreferencesChange({ ...normalizedAiPreferences, progressMode: value })
                      }}
                    />
                  </label>
                  <label className="notia-settings-checkbox-row">
                    <span>Mostrar TO-DO</span>
                    <input type="checkbox" checked={showPlanDraft} onChange={(event) => {
                      setShowPlanDraft(event.target.checked)
                      onAiPreferencesChange({ ...normalizedAiPreferences, showPlan: event.target.checked })
                    }} />
                  </label>
                  <label className="notia-settings-checkbox-row">
                    <span>Mostrar resumen del enfoque</span>
                    <input type="checkbox" checked={showReasoningSummaryDraft} onChange={(event) => {
                      setShowReasoningSummaryDraft(event.target.checked)
                      onAiPreferencesChange({ ...normalizedAiPreferences, showReasoningSummary: event.target.checked })
                    }} />
                  </label>
                  <label className="notia-settings-checkbox-row">
                    <span>Editar un único mensaje de progreso</span>
                    <input type="checkbox" checked={editProgressMessageDraft} onChange={(event) => {
                      setEditProgressMessageDraft(event.target.checked)
                      onAiPreferencesChange({ ...normalizedAiPreferences, editProgressMessage: event.target.checked })
                    }} />
                  </label>
                </div>
                {modelsErrorMessage ? (
                  <div className="notia-settings-status notia-settings-status--error">
                    {modelsErrorMessage}
                  </div>
                ) : null}
              </div>
              <div className="notia-settings-card">
                <div className="notia-settings-card-label">API key</div>
                <div className="notia-settings-card-value">
                  {normalizedAiPreferences.apiKey ? 'Configurada' : 'No configurada'}
                </div>
                <div className="notia-settings-card-label notia-settings-card-label--spaced">
                  Se envía como header `Authorization: Bearer ...`
                </div>
                <p className="notia-settings-hint">
                  Se guarda en `.notia/notiaConfig.json` de la biblioteca activa. No se guarda en Redux ni en localStorage; no compartas ese archivo.
                </p>
                <div className="notia-settings-input-wrap">
                  <input
                    className="notia-settings-input"
                    type="password"
                    value={apiKeyDraft}
                    onChange={(event) => {
                      setApiKeyDraft(event.target.value)
                    }}
                    onBlur={commitAiPreferences}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitAiPreferences()
                      }
                    }}
                    placeholder="ollama-api-key"
                    autoComplete="off"
                  />
                </div>
                <div className={`notia-settings-status notia-settings-status--${aiHealthStatus.tone}`}>
                  {aiHealthStatus.message}
                </div>
                <div className="notia-settings-card-label notia-settings-card-label--spaced">
                  En Android, Notia usa el bridge nativo hacia Python embebido. La autenticación sigue el esquema `Bearer` de Ollama Cloud.
                </div>
                <div className="notia-settings-actions">
                  <NotiaButton
                    variant="secondary"
                    onClick={() => {
                      void handleCheckAiConnection()
                    }}
                    disabled={isCheckingAiHealth}
                  >
                    {isCheckingAiHealth ? 'Probando...' : 'Probar conexion'}
                  </NotiaButton>
                </div>
              </div>
            </>
          ) : activeSection === 'Voz' ? (
            <>
            <div className="notia-settings-card">
              <div className="notia-settings-card-label">Reconocimiento de voz</div>
              <div className="notia-settings-card-value">{qwen3AsrPreferences.enabled ? 'Activo' : 'Desactivado'}</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">
                {qwen3AsrPreferences.model === 'parakeet-v3'
                  ? 'Parakeet TDT en CPU mediante sherpa-onnx. Detecta el idioma automáticamente.'
                  : 'Reconocimiento local GGUF mediante llama.cpp.'}
              </div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Modelo</div>
              <NotiaSelectMenu
                className="notia-settings-input"
                ariaLabel="Modelo de reconocimiento de voz"
                value={qwen3AsrPreferences.model}
                options={[
                  { value: 'parakeet-v3', label: 'Parakeet TDT 0.6B v3 (rápido)' },
                  { value: '0.6b', label: 'Qwen3-ASR 0.6B Q8' },
                  { value: '1.7b', label: 'Qwen3-ASR 1.7B Q8' },
                ]}
                onChange={(value) => dispatch(setQwen3AsrSettings({ ...qwen3AsrPreferences, model: value as Qwen3AsrModel }))}
              />
              {qwen3AsrPreferences.model !== 'parakeet-v3' ? (
                <>
                  <div className="notia-settings-card-label notia-settings-card-label--spaced">Dispositivo</div>
                  <NotiaSelectMenu
                    className="notia-settings-input"
                    ariaLabel="Dispositivo de Qwen3-ASR"
                    value={qwen3AsrPreferences.device}
                    options={[{ value: 'cpu', label: 'CPU' }, { value: 'gpu', label: 'GPU (Vulkan)' }]}
                    onChange={(value) => dispatch(setQwen3AsrSettings({ ...qwen3AsrPreferences, device: value as 'cpu' | 'gpu' }))}
                  />
                </>
              ) : null}
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Idioma</div>
              <input className="notia-settings-input" aria-label="Idioma del reconocimiento de voz" value={qwen3AsrPreferences.language}
                onChange={(event) => dispatch(setQwen3AsrSettings({ ...qwen3AsrPreferences, language: event.target.value }))} />
              <div className="notia-settings-actions">
                <NotiaButton variant={qwen3AsrPreferences.enabled ? 'primary' : 'secondary'}
                  onClick={() => dispatch(setQwen3AsrSettings({ ...qwen3AsrPreferences, enabled: !qwen3AsrPreferences.enabled }))}>
                  {qwen3AsrPreferences.enabled ? 'Desactivar' : 'Activar'}
                </NotiaButton>
              </div>
            </div>
            <div className="notia-settings-card">
              <div className="notia-settings-card-label">Qwen3-TTS</div>
              <div className="notia-settings-card-value">{qwen3TtsPreferences.enabled ? 'Activo' : 'Desactivado'}</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Motor GGML nativo precargado al iniciar Notia en Windows y Android.</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Modelo</div>
              <NotiaSelectMenu
                className="notia-settings-input"
                ariaLabel="Modelo de Qwen3-TTS"
                value={qwen3TtsPreferences.model}
                options={[{ value: '0.6b', label: 'Qwen3-TTS 0.6B' }, { value: '1.7b', label: 'Qwen3-TTS 1.7B' }]}
                onChange={(value) => dispatch(setQwen3TtsSettings({ ...qwen3TtsPreferences, model: value as '0.6b' | '1.7b' }))}
              />
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Dispositivo</div>
              <NotiaSelectMenu
                className="notia-settings-input"
                ariaLabel="Dispositivo de Qwen3-TTS"
                value={qwen3TtsPreferences.device}
                options={[{ value: 'cpu', label: 'Automático (CUDA en Windows, CPU como respaldo)' }]}
                onChange={() => dispatch(setQwen3TtsSettings({ ...qwen3TtsPreferences, device: 'cpu' }))}
              />
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Voz</div>
              <NotiaSelectMenu
                className="notia-settings-input"
                ariaLabel="Voz de Qwen3-TTS"
                value={qwen3TtsPreferences.voice}
                options={QWEN3_TTS_VOICES.map((voice) => ({ value: voice, label: voice }))}
                onChange={(voice) => dispatch(setQwen3TtsSettings({ ...qwen3TtsPreferences, voice }))}
              />
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Idioma</div>
              <input className="notia-settings-input" aria-label="Idioma de Qwen3-TTS" value={qwen3TtsPreferences.language}
                onChange={(event) => dispatch(setQwen3TtsSettings({ ...qwen3TtsPreferences, language: event.target.value }))} />
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Velocidad: {qwen3TtsPreferences.speed.toFixed(2)}</div>
              <input type="range" min="0.7" max="1.8" step="0.05" value={qwen3TtsPreferences.speed}
                onChange={(event) => dispatch(setQwen3TtsSettings({ ...qwen3TtsPreferences, speed: Number(event.target.value) }))} />
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Pausa para enviar: {qwen3TtsPreferences.pauseDetectionMs} ms</div>
              <input type="range" min="600" max="4000" step="100" value={qwen3TtsPreferences.pauseDetectionMs}
                onChange={(event) => dispatch(setQwen3TtsSettings({ ...qwen3TtsPreferences, pauseDetectionMs: Number(event.target.value) }))} />
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Saludo inicial</div>
              <input className="notia-settings-input" aria-label="Saludo del modo charla" value={qwen3TtsPreferences.greeting}
                onChange={(event) => dispatch(setQwen3TtsSettings({ ...qwen3TtsPreferences, greeting: event.target.value }))} />
              <div className="notia-settings-actions">
                <NotiaButton variant={qwen3TtsPreferences.enabled ? 'primary' : 'secondary'}
                  onClick={() => {
                    if (qwen3TtsLoadedSelection && (qwen3TtsLoadedSelection.model !== qwen3TtsPreferences.model || qwen3TtsLoadedSelection.device !== qwen3TtsPreferences.device)) {
                      void reloadQwen3Tts().then(() => setQwen3TtsLoadedSelection(null))
                    } else dispatch(setQwen3TtsSettings({ ...qwen3TtsPreferences, enabled: !qwen3TtsPreferences.enabled }))
                  }}>
                  {qwen3TtsLoadedSelection && (qwen3TtsLoadedSelection.model !== qwen3TtsPreferences.model || qwen3TtsLoadedSelection.device !== qwen3TtsPreferences.device) ? 'Recargar' : qwen3TtsPreferences.enabled ? 'Desactivar' : 'Activar'}
                </NotiaButton>
                <NotiaButton variant="secondary" disabled={isCheckingQwen3Tts} onClick={() => {
                  setIsCheckingQwen3Tts(true)
                  void checkQwen3TtsConnection(qwen3TtsPreferences)
                    .then(() => setQwen3TtsStatus('Runtime Qwen3-TTS y voz verificados.'))
                    .catch((error) => setQwen3TtsStatus(error instanceof Error ? error.message : 'No se pudo iniciar la voz local.'))
                    .finally(() => setIsCheckingQwen3Tts(false))
                }}>{isCheckingQwen3Tts ? 'Probando...' : 'Probar voz'}</NotiaButton>
              </div>
              <div className="notia-settings-status">{qwen3TtsStatus}</div>
            </div>
            </>
          ) : activeSection === 'Telegram' ? (
            <>
              <div className="notia-settings-card">
                <div className="notia-settings-card-label">Bot de Telegram</div>
                <div className="notia-settings-card-value">{telegramPreferences.enabled ? 'Activo' : 'Desactivado'}</div>
                <div className="notia-settings-card-label notia-settings-card-label--spaced">
                  Configurá el token del bot para esta biblioteca. El enlace de usuarios se inicia desde Telegram con /start.
                </div>
                <div className="notia-settings-input-wrap">
                  <input className="notia-settings-input" type="password" value={telegramTokenDraft}
                    aria-label="Token del bot de Telegram" autoComplete="off" placeholder="123456:ABC..."
                    onChange={(event) => setTelegramTokenDraft(event.target.value)} onBlur={commitTelegramToken}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitTelegramToken() } }} />
                </div>
                <div className="notia-settings-actions">
                  <NotiaButton variant="secondary" disabled={!telegramTokenDraft.trim() || isCheckingTelegram}
                    onClick={() => { void handleCheckTelegram() }}>
                    {isCheckingTelegram ? 'Probando...' : 'Probar conexión'}
                  </NotiaButton>
                  <NotiaButton variant={telegramPreferences.enabled ? 'primary' : 'secondary'}
                    disabled={!telegramTokenDraft.trim()}
                    onClick={() => onTelegramPreferencesChange({ ...telegramPreferences, botToken: telegramTokenDraft.trim(), enabled: !telegramPreferences.enabled })}>
                    {telegramPreferences.enabled ? 'Desactivar' : 'Activar'}
                  </NotiaButton>
                </div>
                <div className="notia-settings-status" role="status">{telegramStatus}</div>
              </div>
              <div className="notia-settings-card">
                <div className="notia-settings-card-label">Asociaciones de Telegram</div>
                <div className="notia-settings-card-label notia-settings-card-label--spaced">
                  Las asociaciones se completan desde el bot con /start y una contraseña del usuario. Solo se aceptan chats privados.
                </div>
                {libraryUsers.filter((user) => user.telegramLinked).length === 0
                  ? <div className="notia-settings-card-value">No hay usuarios vinculados.</div>
                  : <ul className="notia-settings-association-list">
                    {libraryUsers.filter((user) => user.telegramLinked).map((user) => (
                      <li key={user.id}>
                        <span>{user.name}</span>
                        <NotiaButton
                          size="sm"
                          variant="secondary"
                          disabled={isSavingLibraryData}
                          onClick={() => {
                            void handleUnlinkLibraryUserTelegram(user.id)
                          }}
                        >
                          Desvincular Telegram
                        </NotiaButton>
                      </li>
                    ))}
                  </ul>}
              </div>
            </>
          ) : activeSection === 'Finanzas' ? (
            <div className="notia-settings-card">
              <div className="notia-settings-card-label">Datos financieros de la biblioteca activa</div>
              <div className="notia-settings-card-value">{activeLibrary?.name ?? 'Sin biblioteca activa'}</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">
                Elimina cuentas, categorías personalizadas, movimientos, tickets, productos y precios, sueldos, ahorro, cuotas, inversiones y sus archivos de extracción registrados. Al finalizar, restaura las diez categorías de gasto iniciales. Esta acción no se puede deshacer.
              </div>
              <div className="notia-settings-actions">
                <NotiaButton
                  variant="danger"
                  disabled={!activeLibrary || isClearingFinanceData}
                  onClick={() => setIsFinanceDeleteConfirmationOpen(true)}
                >
                  {isClearingFinanceData ? 'Eliminando…' : 'Eliminar datos financieros'}
                </NotiaButton>
              </div>
              <div className={`notia-settings-status notia-settings-status--${financeClearStatus.tone}`} role="status">
                {financeClearStatus.message}
              </div>
            </div>
          ) : activeSection === 'Backups' ? (
            <div className="notia-settings-card">
              <div className="notia-settings-card-label">Backups automáticos</div>
              <div className="notia-settings-card-value">{backupSettings?.directoryPath || 'Desactivados'}</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">
                Disponible solo en Windows. Guarda un ZIP de la biblioteca activa cada hora y conserva como máximo 2 días (48 backups).
                {backupSettings?.lastBackupAt ? ` Último backup: ${new Date(backupSettings.lastBackupAt * 1000).toLocaleString()}.` : ''}
                {backupSettings?.lastError ? ` Último error: ${backupSettings.lastError}` : ''}
              </div>
              <div className="notia-settings-actions">
                <NotiaButton variant="secondary" disabled={backupSettings?.supported === false} onClick={() => {
                  void pickBackupDirectory().then((status) => {
                    setBackupSettings(status)
                    if (status.directoryPath) setBackupStatus('Carpeta de backups configurada.')
                  }).catch((error: unknown) => setBackupStatus(error instanceof Error ? error.message : 'No se pudo elegir la carpeta.'))
                }}>Elegir carpeta</NotiaButton>
                <NotiaButton variant="secondary" disabled={!backupSettings?.directoryPath} onClick={() => {
                  void disableBackups().then((status) => {
                    setBackupSettings(status)
                    setBackupStatus('Backups desactivados.')
                  }).catch((error: unknown) => setBackupStatus(error instanceof Error ? error.message : 'No se pudieron desactivar los backups.'))
                }}>Desactivar</NotiaButton>
              </div>
              <div className="notia-settings-status" role="status">{backupStatus}</div>
            </div>
          ) : activeSection === 'Publicar' ? (
            <div className="notia-settings-card">
              <div className="notia-settings-card-label">Publicar tableros de Task Manager</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">
                Disponible solo en Windows. Abre el mismo Task Manager, con sus vistas y funciones de edición, para los tableros seleccionados en cualquier navegador de la red local. Notia debe permanecer abierta.
              </div>
              <div className="notia-settings-actions" role="group" aria-label="Tableros publicados">
                {taskManagerSettings.boards.map((board) => (
                  <label key={board.name} className="notia-settings-checkbox-label">
                    <input
                      type="checkbox"
                      checked={publishedBoardNames.has(board.name)}
                      onChange={() => handlePublicationBoardToggle(board.name)}
                    />
                    {board.name}
                  </label>
                ))}
              </div>
              {taskManagerSettings.boards.length === 0 ? <div className="notia-settings-status">Todavía no hay tableros disponibles.</div> : null}
              <label className="notia-settings-input-wrap"><span className="notia-settings-card-label">Puerto fijo de publicación</span><input className="notia-settings-input" type="number" min="1024" max="65535" value={taskManagerPublicationPreferences.port} onChange={(event) => { const port = Number(event.target.value); if (Number.isInteger(port) && port >= 1024 && port <= 65535) onTaskManagerPublicationPreferencesChange({ ...taskManagerPublicationPreferences, port }) }} /></label>
              <label className="notia-settings-input-wrap"><span className="notia-settings-card-label">Clientes simultáneos máximos</span><input className="notia-settings-input" type="number" min="1" max="64" value={taskManagerPublicationPreferences.maxClients} onChange={(event) => { const maxClients = Number(event.target.value); if (Number.isInteger(maxClients) && maxClients >= 1 && maxClients <= 64) onTaskManagerPublicationPreferencesChange({ ...taskManagerPublicationPreferences, maxClients }) }} /></label>
              <div className="notia-settings-actions">
                <NotiaButton onClick={() => void handlePublishBoards()} disabled={isPublishingBoards || !activeLibrary || taskManagerPublicationPreferences.publishedBoardNames.length === 0}>
                  {isPublishingBoards ? 'Publicando…' : 'Publicar y actualizar'}
                </NotiaButton>
                <NotiaButton variant="secondary" onClick={() => void openTaskManagerPublication()} disabled={!publicationUrl}>
                  Abrir en el navegador
                </NotiaButton>
              </div>
              {publicationUrl ? <div className="notia-settings-card-value" aria-label="URL de publicación">{publicationUrl}</div> : null}
              {publicationMetrics ? <div className="notia-settings-status" role="status">
                {publicationMetrics.active ? <>
                  {publicationMetrics.recoveryRequired ? <div role="alert">La publicación requiere recuperación: quedó una operación parcial o no verificada. Revisá el workspace y ejecutá una operación del Task Manager que termine correctamente; no se reejecutará nada automáticamente.</div> : null}
                  {publicationMetrics.websocketSessions >= publicationMetrics.maxWebsocketSessions ? <div role="alert">La publicación alcanzó su capacidad de WebSocket. Los nuevos accesos serán rechazados hasta que se desconecte alguien.</div> : null}
                  {publicationMetrics.mutationLatencyLastMs !== null && publicationMetrics.mutationLatencyLastMs > 1000 ? <div role="alert">El filesystem está tardando más de un segundo en confirmar cambios. Revisá la carga del host antes de continuar con operaciones masivas.</div> : null}
                  <div>Latencia de mutaciones: última {formatPublicationMilliseconds(publicationMetrics.mutationLatencyLastMs)} · p95 aproximado {formatPublicationMilliseconds(publicationMetrics.mutationLatencyP95Ms)} · muestras {publicationMetrics.mutationLatencySamples}</div>
                  <div>Conexiones WebSocket: {publicationMetrics.websocketSessions}/{publicationMetrics.maxWebsocketSessions} · sesiones: {publicationMetrics.authenticatedSessions}/{publicationMetrics.maxAuthenticatedSessions} · revisión {publicationMetrics.revision}</div>
                  <div>Época: {publicationMetrics.publicationEpoch.slice(0, 8) || '—'} · última operación: {publicationMetrics.lastOperationId?.slice(0, 8) || '—'} · actor: {publicationMetrics.lastActorId?.slice(0, 8) || '—'}</div>
                  <div>Frames recibidos/enviados: {publicationMetrics.websocketFramesReceived}/{publicationMetrics.websocketFramesSent} · bytes: {formatPublicationBytes(publicationMetrics.websocketBytesReceived)}/{formatPublicationBytes(publicationMetrics.websocketBytesSent)} · errores: {publicationMetrics.mutationErrors} · streams cancelados: {publicationMetrics.aiStreamCancellations}</div>
                  <div>Conflictos: {publicationMetrics.conflicts} · resync: {publicationMetrics.resyncRequired} · eventos descartados: {publicationMetrics.droppedEvents}</div>
                  <div>Último cambio: {formatPublicationTimestamp(publicationMetrics.lastChangeAtUnixMs)}</div>
                  <div>Telemetría local: {publicationTelemetrySamples} muestras acotadas (sin contenido ni secretos)</div>
                </> : 'La publicación no está activa.'}
              </div> : null}
              {publicationUrl ? <div className="notia-settings-card-label notia-settings-card-label--spaced">Si otro equipo no puede abrirla, permití Notia en el Firewall de Windows para redes privadas.</div> : null}
              {publicationUrl ? <div className="notia-settings-card-label notia-settings-card-label--spaced">La URL usa HTTPS con un certificado autofirmado: en cada equipo remoto aceptá o instalá el certificado de Notia la primera vez.</div> : null}
              <div className="notia-settings-status" role="status">{publicationStatus}</div>
            </div>
          ) : (
            <div>Seccion: {activeSection}</div>
          )}
        </div>
      </div>
      <aside className="notia-settings-menu">
        {visibleSections.map((section) => (
          <NotiaButton
            key={section}
            className={`notia-settings-menu-item ${
              section === activeSection ? 'notia-settings-menu-item--active' : ''
            }`}
            variant={section === activeSection ? 'primary' : 'secondary'}
            onClick={() => setActiveSection(section)}
          >
            {section}
          </NotiaButton>
        ))}
      </aside>
      <ConfirmationDialogModal
        open={isFinanceDeleteConfirmationOpen}
        title="Eliminar datos financieros"
        message={`Se eliminarán definitivamente los datos financieros de ${activeLibrary?.name ?? 'la biblioteca activa'} y se restaurarán las diez categorías iniciales. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar definitivamente"
        cancelLabel="Cancelar"
        tone="danger"
        onConfirm={() => { void handleClearFinanceData() }}
        onCancel={() => setIsFinanceDeleteConfirmationOpen(false)}
      />
      <ConfirmationDialogModal
        open={deleteUser !== null}
        title="Eliminar usuario"
        message={`¿Querés eliminar a ${deleteUser?.name ?? 'este usuario'}? Se revocará su vínculo de Telegram y no se puede deshacer.`}
        confirmLabel="Eliminar usuario"
        cancelLabel="Cancelar"
        tone="danger"
          onConfirm={() => {
           if (!deleteUser) return
           const userId = deleteUser.id
           setDeleteUser(null)
           void handleDeleteLibraryUser(userId)
         }}
        onCancel={() => setDeleteUser(null)}
      />
    </NotiaModalShell>
  )
}
