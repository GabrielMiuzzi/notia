import { useEffect, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { selectSettingsActiveSection } from '../../features/ui/uiSelectors'
import { Brain, ChevronDown, Eye, Wrench, X } from 'lucide-react'
import {
  clampOcrDebounceMs,
  INKMATH_OCR_DEBOUNCE_MAX_MS,
  INKMATH_OCR_DEBOUNCE_MIN_MS,
} from '../../modules/inkmath/settings'
import type { InkMathPreferences } from '../../services/preferences/inkMathSettingsStorage'
import {
  getDefaultOllamaApiUrl,
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
import { selectQwen3AsrSettings, selectQwen3TtsSettings } from '../../features/preferences/preferencesSelectors'
import { setQwen3AsrSettings, setQwen3TtsSettings } from '../../features/preferences/preferencesSlice'
import { QWEN3_TTS_VOICES } from '../../services/preferences/qwen3TtsSettingsStorage'
import { checkQwen3TtsConnection, getQwen3TtsStatus, reloadQwen3Tts } from '../../services/qwen3Tts/qwen3TtsRuntime'
import { selectActiveLibrary } from '../../features/library/librarySelectors'
import { clearAllFinanceData } from '../../modules/finance/services/financeService'
import { financeErrorMessage } from '../../modules/finance/engines/financeError'
import { notifyFinanceDataChanged } from '../../modules/finance/services/financeDataEvents'
import { ConfirmationDialogModal } from './ConfirmationDialogModal'
import { pickDirectory } from '../../services/files/filesystemEngine'
import type { BackupPreferences } from '../../services/preferences/backupSettingsStorage'

type SettingsSection = 'General' | 'Panel desplegable' | 'InkMath' | 'IA' | 'Voz' | 'Telegram' | 'Finanzas' | 'Backups'

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
  backupPreferences: BackupPreferences
  onBackupPreferencesChange: (value: BackupPreferences) => void
}

const SECTIONS: SettingsSection[] = ['General', 'Panel desplegable', 'InkMath', 'IA', 'Voz', 'Telegram', 'Finanzas', 'Backups']
const VALID_SETTINGS_SECTIONS = new Set<SettingsSection>(SECTIONS)

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
  backupPreferences,
  onBackupPreferencesChange,
}: SettingsModalProps) {
  const dispatch = useAppDispatch()
  const qwen3TtsPreferences = useAppSelector(selectQwen3TtsSettings)
  const qwen3AsrPreferences = useAppSelector(selectQwen3AsrSettings)
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const [qwen3TtsStatus, setQwen3TtsStatus] = useState('Consultando el runtime local...')
  const [isCheckingQwen3Tts, setIsCheckingQwen3Tts] = useState(false)
  const [qwen3TtsLoadedSelection, setQwen3TtsLoadedSelection] = useState<{ model: string, device: string } | null>(null)
  const normalizedIncomingAiPreferences = normalizeAiSettingsInput(aiPreferences)
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
  const [telegramTokenDraft, setTelegramTokenDraft] = useState(telegramPreferences.botToken)
  const [telegramStatus, setTelegramStatus] = useState('Todavia no se probo la conexion.')
  const [isCheckingTelegram, setIsCheckingTelegram] = useState(false)
  const [isFinanceDeleteConfirmationOpen, setIsFinanceDeleteConfirmationOpen] = useState(false)
  const [isClearingFinanceData, setIsClearingFinanceData] = useState(false)
  const [backupStatus, setBackupStatus] = useState('')
  const [financeClearStatus, setFinanceClearStatus] = useState<{
    tone: 'idle' | 'success' | 'error'
    message: string
  }>({ tone: 'idle', message: 'Esta acción elimina definitivamente todos los datos del módulo Finanzas en la biblioteca activa.' })
  const [availableModels, setAvailableModels] = useState<AiModelOption[]>([])
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const modelSelectRef = useRef<HTMLDivElement | null>(null)
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
  const visibleSections = runtimeDevice === 'Windows' ? SECTIONS : SECTIONS.filter((section) => section !== 'Backups')
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
  }, [
    normalizedIncomingAiPreferences.apiKey,
    normalizedIncomingAiPreferences.ollamaUrl,
    normalizedIncomingAiPreferences.selectedModel,
    normalizedIncomingAiPreferences.thinkingEnabled,
    normalizedIncomingAiPreferences.thinkingLevel,
    open,
  ])

  useEffect(() => {
    if (open) setTelegramTokenDraft(telegramPreferences.botToken)
  }, [open, telegramPreferences.botToken])

  useEffect(() => {
    if (!open) setIsFinanceDeleteConfirmationOpen(false)
  }, [open])

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

  useEffect(() => {
    if (!isModelMenuOpen) {
      return
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !modelSelectRef.current?.contains(event.target)) {
        setIsModelMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [isModelMenuOpen])

  const commitAiPreferences = () => {
    const normalized = normalizeAiSettingsInput({
      ollamaUrl: ollamaUrlDraft,
      apiKey: apiKeyDraft,
      selectedModel: selectedModelDraft,
      thinkingEnabled: thinkingEnabledDraft,
      thinkingLevel: thinkingLevelDraft,
    })

    setOllamaUrlDraft(normalized.ollamaUrl)
    setApiKeyDraft(normalized.apiKey)
    setSelectedModelDraft(normalized.selectedModel)
    setThinkingEnabledDraft(normalized.thinkingEnabled)
    setThinkingLevelDraft(normalized.thinkingLevel)
    onAiPreferencesChange(normalized)
  }

  // Save pending changes when modal closes
  useEffect(() => {
    if (!open) {
      console.log('[SettingsModal] Modal closing, committing changes...')
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

  const handleClearFinanceData = async () => {
    if (!activeLibrary || isClearingFinanceData) return
    setIsFinanceDeleteConfirmationOpen(false)
    setIsClearingFinanceData(true)
    setFinanceClearStatus({ tone: 'idle', message: 'Eliminando los datos financieros…' })
    try {
      await clearAllFinanceData(activeLibrary)
      notifyFinanceDataChanged()
      setFinanceClearStatus({ tone: 'success', message: 'Se eliminaron todos los datos financieros de esta biblioteca.' })
    } catch (error) {
      setFinanceClearStatus({
        tone: 'error',
        message: financeErrorMessage(error, 'No se pudieron eliminar los datos financieros.'),
      })
    } finally {
      setIsClearingFinanceData(false)
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
                <div className="notia-ai-model-select" ref={modelSelectRef}>
                  <button
                    type="button"
                    className="notia-ai-model-select-trigger"
                    aria-haspopup="listbox"
                    aria-expanded={isModelMenuOpen}
                    onClick={() => setIsModelMenuOpen((current) => !current)}
                    disabled={isLoadingModels || availableModels.length === 0}
                  >
                    <span>{selectedModelDraft || (isLoadingModels ? 'Cargando modelos...' : 'No hay modelos disponibles')}</span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                  {isModelMenuOpen ? (
                    <div className="notia-ai-model-select-menu" role="listbox" aria-label="Modelos de Ollama">
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
                    </div>
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
              <div className="notia-settings-card-label">Qwen3-ASR</div>
              <div className="notia-settings-card-value">{qwen3AsrPreferences.enabled ? 'Activo' : 'Desactivado'}</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Reconocimiento local GGUF mediante llama.cpp.</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Modelo</div>
              <select className="notia-settings-input" aria-label="Modelo de Qwen3-ASR" value={qwen3AsrPreferences.model}
                onChange={(event) => dispatch(setQwen3AsrSettings({ ...qwen3AsrPreferences, model: event.target.value as '0.6b' | '1.7b' }))}>
                <option value="0.6b">Qwen3-ASR 0.6B Q8</option><option value="1.7b">Qwen3-ASR 1.7B Q8</option>
              </select>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Dispositivo</div>
              <select className="notia-settings-input" aria-label="Dispositivo de Qwen3-ASR" value={qwen3AsrPreferences.device}
                onChange={(event) => dispatch(setQwen3AsrSettings({ ...qwen3AsrPreferences, device: event.target.value as 'cpu' | 'gpu' }))}>
                <option value="cpu">CPU</option>
                <option value="gpu">GPU (Vulkan)</option>
              </select>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Idioma</div>
              <input className="notia-settings-input" aria-label="Idioma de Qwen3-ASR" value={qwen3AsrPreferences.language}
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
              <select className="notia-settings-input" aria-label="Modelo de Qwen3-TTS" value={qwen3TtsPreferences.model}
                onChange={(event) => dispatch(setQwen3TtsSettings({ ...qwen3TtsPreferences, model: event.target.value as '0.6b' | '1.7b' }))}>
                <option value="0.6b">Qwen3-TTS 0.6B</option><option value="1.7b">Qwen3-TTS 1.7B</option>
              </select>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Dispositivo</div>
              <select className="notia-settings-input" aria-label="Dispositivo de Qwen3-TTS" value={qwen3TtsPreferences.device}
                onChange={() => dispatch(setQwen3TtsSettings({ ...qwen3TtsPreferences, device: 'cpu' }))}>
                <option value="cpu">Automático (CUDA en Windows, CPU como respaldo)</option>
              </select>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">Voz</div>
              <select className="notia-settings-input" aria-label="Voz de Qwen3-TTS" value={qwen3TtsPreferences.voice}
                onChange={(event) => dispatch(setQwen3TtsSettings({ ...qwen3TtsPreferences, voice: event.target.value }))}>
                {QWEN3_TTS_VOICES.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
              </select>
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
                  El token se guarda sin cifrar dentro de .notia/notiaConfig.json de esta biblioteca. No compartas ese archivo.
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
                    {isCheckingTelegram ? 'Probando...' : 'Probar y emparejar'}
                  </NotiaButton>
                  <NotiaButton variant={telegramPreferences.enabled ? 'primary' : 'secondary'}
                    disabled={!telegramTokenDraft.trim()}
                    onClick={() => onTelegramPreferencesChange({ ...telegramPreferences, botToken: telegramTokenDraft.trim(), enabled: !telegramPreferences.enabled })}>
                    {telegramPreferences.enabled ? 'Desactivar' : 'Activar'}
                  </NotiaButton>
                </div>
                <div className="notia-settings-status">{telegramStatus}</div>
              </div>
              <div className="notia-settings-card">
                <div className="notia-settings-card-label">Chat autorizado</div>
                <div className="notia-settings-card-value">
                  {telegramPreferences.authorizedPeer?.displayName ?? 'Ninguno'}
                </div>
                {telegramPreferences.pendingPeer ? (
                  <>
                    <div className="notia-settings-card-label notia-settings-card-label--spaced">
                      Solicitud de {telegramPreferences.pendingPeer.displayName} {telegramPreferences.pendingPeer.username ? `(@${telegramPreferences.pendingPeer.username})` : ''}.
                    </div>
                    <div className="notia-settings-actions">
                      <NotiaButton onClick={() => onTelegramPreferencesChange({ ...telegramPreferences, authorizedPeer: telegramPreferences.pendingPeer, pendingPeer: null })}>Autorizar</NotiaButton>
                      <NotiaButton variant="secondary" onClick={() => onTelegramPreferencesChange({ ...telegramPreferences, pendingPeer: null })}>Rechazar</NotiaButton>
                    </div>
                  </>
                ) : <div className="notia-settings-card-label notia-settings-card-label--spaced">Envia /start al bot y espera la solicitud.</div>}
                {telegramPreferences.authorizedPeer ? (
                  <div className="notia-settings-actions"><NotiaButton variant="secondary" onClick={() => onTelegramPreferencesChange({ ...telegramPreferences, authorizedPeer: null })}>Revocar acceso</NotiaButton></div>
                ) : null}
              </div>
            </>
          ) : activeSection === 'Finanzas' ? (
            <div className="notia-settings-card">
              <div className="notia-settings-card-label">Datos financieros de la biblioteca activa</div>
              <div className="notia-settings-card-value">{activeLibrary?.name ?? 'Sin biblioteca activa'}</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">
                Elimina cuentas, categorías, movimientos, tickets, productos y precios, sueldos, ahorro, cuotas, inversiones y sus archivos de extracción registrados. Esta acción no se puede deshacer.
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
              <div className="notia-settings-card-value">{backupPreferences.directoryPath || 'Desactivados'}</div>
              <div className="notia-settings-card-label notia-settings-card-label--spaced">
                Disponible solo en Windows. Guarda un ZIP de la biblioteca activa cada hora y conserva como máximo 2 días (48 backups).
              </div>
              <div className="notia-settings-actions">
                <NotiaButton variant="secondary" onClick={() => {
                  void pickDirectory('Elegí la carpeta para guardar los backups').then((selection) => {
                    if (selection) { onBackupPreferencesChange({ directoryPath: selection.path }); setBackupStatus('Carpeta de backups configurada.') }
                  }).catch((error: unknown) => setBackupStatus(error instanceof Error ? error.message : 'No se pudo elegir la carpeta.'))
                }}>Elegir carpeta</NotiaButton>
                <NotiaButton variant="secondary" disabled={!backupPreferences.directoryPath} onClick={() => { onBackupPreferencesChange({ directoryPath: '' }); setBackupStatus('Backups desactivados.') }}>Desactivar</NotiaButton>
              </div>
              <div className="notia-settings-status" role="status">{backupStatus}</div>
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
        message={`Se eliminarán definitivamente todos los datos financieros de ${activeLibrary?.name ?? 'la biblioteca activa'}. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar definitivamente"
        cancelLabel="Cancelar"
        tone="danger"
        onConfirm={() => { void handleClearFinanceData() }}
        onCancel={() => setIsFinanceDeleteConfirmationOpen(false)}
      />
    </NotiaModalShell>
  )
}
