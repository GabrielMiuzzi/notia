import { useEffect, useRef, useState } from 'react'
import { useAppSelector } from '../../store/hooks'
import { selectSettingsActiveSection } from '../../features/ui/uiSelectors'
import { Brain, ChevronDown, Eye, Wrench, X } from 'lucide-react'
import {
  clampOcrDebounceMs,
  INKDOC_OCR_DEBOUNCE_MAX_MS,
  INKDOC_OCR_DEBOUNCE_MIN_MS,
  normalizeServiceUrl,
} from '../../modules/inkdoc/settings'
import type { InkdocPreferences } from '../../services/preferences/inkdocSettingsStorage'
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

type SettingsSection = 'General' | 'Panel desplegable' | 'InkDocs' | 'IA'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  explorerRefreshIntervalMs: number
  onExplorerRefreshIntervalMsChange: (value: number) => void
  inkdocPreferences: InkdocPreferences
  onInkdocPreferencesChange: (value: InkdocPreferences) => void
  aiPreferences: AiPreferences
  onAiPreferencesChange: (value: AiPreferences) => void
}

const SECTIONS: SettingsSection[] = ['General', 'Panel desplegable', 'InkDocs', 'IA']
const VALID_SETTINGS_SECTIONS = new Set<SettingsSection>(SECTIONS)

export function SettingsModal({
  open,
  onClose,
  explorerRefreshIntervalMs,
  onExplorerRefreshIntervalMsChange,
  inkdocPreferences,
  onInkdocPreferencesChange,
  aiPreferences,
  onAiPreferencesChange,
}: SettingsModalProps) {
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
  const [inkmathServiceUrlDraft, setInkmathServiceUrlDraft] = useState(inkdocPreferences.inkmathServiceUrl)
  const [ollamaUrlDraft, setOllamaUrlDraft] = useState(normalizedIncomingAiPreferences.ollamaUrl)
  const [apiKeyDraft, setApiKeyDraft] = useState(normalizedIncomingAiPreferences.apiKey)
  const [selectedModelDraft, setSelectedModelDraft] = useState(normalizedIncomingAiPreferences.selectedModel)
  const [thinkingEnabledDraft, setThinkingEnabledDraft] = useState(normalizedIncomingAiPreferences.thinkingEnabled)
  const [thinkingLevelDraft, setThinkingLevelDraft] = useState(normalizedIncomingAiPreferences.thinkingLevel)
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
  const ocrDebounceMs = clampOcrDebounceMs(inkdocPreferences.inkmathDebounceMs)
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

    setInkmathServiceUrlDraft(inkdocPreferences.inkmathServiceUrl)
  }, [inkdocPreferences.inkmathServiceUrl, open])

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

  const commitInkMathServiceUrl = () => {
    const normalized = normalizeServiceUrl(inkmathServiceUrlDraft)
    setInkmathServiceUrlDraft(normalized)
    onInkdocPreferencesChange({
      ...inkdocPreferences,
      inkmathServiceUrl: normalized,
    })
  }

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
      commitInkMathServiceUrl()
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
          ) : activeSection === 'InkDocs' ? (
            <>
              <div className="notia-settings-card">
                <div className="notia-settings-card-label">Backend de InkMath</div>
                <div className="notia-settings-card-value">
                  {normalizeServiceUrl(inkdocPreferences.inkmathServiceUrl)}
                </div>
                <div className="notia-settings-card-label notia-settings-card-label--spaced">
                  URL del servicio OCR para el canvas matemático de InkDocs
                </div>
                <div className="notia-settings-input-wrap">
                  <input
                    className="notia-settings-input"
                    type="text"
                    value={inkmathServiceUrlDraft}
                    onChange={(event) => {
                      setInkmathServiceUrlDraft(event.target.value)
                    }}
                    onBlur={commitInkMathServiceUrl}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitInkMathServiceUrl()
                      }
                    }}
                    placeholder="http://127.0.0.1:8767"
                  />
                </div>
              </div>
              <div className="notia-settings-card">
                <div className="notia-settings-card-label">Debounce OCR</div>
                <div className="notia-settings-card-value">{ocrDebounceLabel}</div>
                <div className="notia-settings-card-label notia-settings-card-label--spaced">
                  Tiempo de espera antes de enviar el dibujo al backend
                </div>
                <div className="notia-settings-slider-wrap">
                  <input
                    type="range"
                    min={INKDOC_OCR_DEBOUNCE_MIN_MS}
                    max={INKDOC_OCR_DEBOUNCE_MAX_MS}
                    step={50}
                    value={ocrDebounceMs}
                    onChange={(event) => {
                      onInkdocPreferencesChange({
                        ...inkdocPreferences,
                        inkmathDebounceMs: clampOcrDebounceMs(Number(event.target.value)),
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
          ) : (
            <div>Seccion: {activeSection}</div>
          )}
        </div>
      </div>
      <aside className="notia-settings-menu">
        {SECTIONS.map((section) => (
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
    </NotiaModalShell>
  )
}
