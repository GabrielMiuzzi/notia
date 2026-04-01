import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
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
import { checkAiHealth } from '../../services/ai/aiRuntime'
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
  const [activeSection, setActiveSection] = useState<SettingsSection>('General')
  const [inkmathServiceUrlDraft, setInkmathServiceUrlDraft] = useState(inkdocPreferences.inkmathServiceUrl)
  const [ollamaUrlDraft, setOllamaUrlDraft] = useState(normalizedIncomingAiPreferences.ollamaUrl)
  const [apiKeyDraft, setApiKeyDraft] = useState(normalizedIncomingAiPreferences.apiKey)
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
    ? `Intervalo de escaneo (0 = manual, ${refreshBounds.minSeconds}s a ${refreshBounds.maxSeconds}s)`
    : `Intervalo de escaneo (${refreshBounds.minSeconds}s a ${refreshBounds.maxSeconds}s)`
  const ocrDebounceMs = clampOcrDebounceMs(inkdocPreferences.inkmathDebounceMs)
  const ocrDebounceLabel = `${ocrDebounceMs} ms`
  const normalizedAiPreferences = normalizeAiSettingsInput({
    ollamaUrl: ollamaUrlDraft,
    apiKey: apiKeyDraft,
  })

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
  }, [normalizedIncomingAiPreferences.apiKey, normalizedIncomingAiPreferences.ollamaUrl, open])

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
    })

    setOllamaUrlDraft(normalized.ollamaUrl)
    setApiKeyDraft(normalized.apiKey)
    onAiPreferencesChange(normalized)
  }

  const handleCheckAiConnection = async () => {
    const normalized = normalizeAiSettingsInput({
      ollamaUrl: ollamaUrlDraft,
      apiKey: apiKeyDraft,
    })

    setOllamaUrlDraft(normalized.ollamaUrl)
    setApiKeyDraft(normalized.apiKey)
    onAiPreferencesChange(normalized)
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
              <div className="notia-settings-card-label">Refresco automatico del panel</div>
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
