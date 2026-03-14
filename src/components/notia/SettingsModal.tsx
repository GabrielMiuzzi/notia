import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { clampOcrDebounceMs, INKDOC_OCR_DEBOUNCE_MAX_MS, INKDOC_OCR_DEBOUNCE_MIN_MS, normalizeServiceUrl } from '../../modules/inkdoc/settings'
import type { InkdocPreferences } from '../../services/preferences/inkdocSettingsStorage'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import { getExplorerRefreshIntervalBounds } from '../../services/preferences/explorerPanelStorage'
import { getAppVersion } from '../../services/runtime/appVersion'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'

type SettingsSection = 'General' | 'Panel desplegable' | 'InkDocs'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  explorerRefreshIntervalMs: number
  onExplorerRefreshIntervalMsChange: (value: number) => void
  inkdocPreferences: InkdocPreferences
  onInkdocPreferencesChange: (value: InkdocPreferences) => void
}

const SECTIONS: SettingsSection[] = ['General', 'Panel desplegable', 'InkDocs']

export function SettingsModal({
  open,
  onClose,
  explorerRefreshIntervalMs,
  onExplorerRefreshIntervalMsChange,
  inkdocPreferences,
  onInkdocPreferencesChange,
}: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('General')
  const [inkmathServiceUrlDraft, setInkmathServiceUrlDraft] = useState(inkdocPreferences.inkmathServiceUrl)
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

  useEffect(() => {
    if (!open) {
      return
    }

    setInkmathServiceUrlDraft(inkdocPreferences.inkmathServiceUrl)
  }, [inkdocPreferences.inkmathServiceUrl, open])

  const commitInkMathServiceUrl = () => {
    const normalized = normalizeServiceUrl(inkmathServiceUrlDraft)
    setInkmathServiceUrlDraft(normalized)
    onInkdocPreferencesChange({
      ...inkdocPreferences,
      inkmathServiceUrl: normalized,
    })
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
                  <div className="notia-settings-card-value">{normalizeServiceUrl(inkdocPreferences.inkmathServiceUrl)}</div>
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
