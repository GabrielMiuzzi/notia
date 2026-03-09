import { useState } from 'react'
import { X } from 'lucide-react'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'

type SettingsSection = 'General' | 'Panel desplegable' | 'Librerias'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  explorerRefreshIntervalMs: number
  onExplorerRefreshIntervalMsChange: (value: number) => void
}

const SECTIONS: SettingsSection[] = ['General', 'Panel desplegable', 'Librerias']
const PROJECT_VERSION = '0.0.0'
const REFRESH_INTERVAL_MIN_SECONDS = 1
const REFRESH_INTERVAL_MAX_SECONDS = 30

export function SettingsModal({
  open,
  onClose,
  explorerRefreshIntervalMs,
  onExplorerRefreshIntervalMsChange,
}: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('General')
  const runtimeDevice = getRuntimeDevice()
  const refreshIntervalSeconds = Math.round(explorerRefreshIntervalMs / 1000)

  if (!open) {
    return null
  }

  return (
    <div className="notia-modal-backdrop" onClick={onClose}>
      <div
        className="notia-settings-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="notia-settings-content">
          <div className="notia-settings-header">
            <h2>Configuraciones</h2>
            <button
              type="button"
              className="notia-settings-close"
              title="Cerrar"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          <div className="notia-settings-body">
            {activeSection === 'General' ? (
              <div className="notia-settings-card">
                <div className="notia-settings-card-label">Version del proyecto</div>
                <div className="notia-settings-card-value">v{PROJECT_VERSION}</div>
                <div className="notia-settings-card-label notia-settings-card-label--spaced">
                  Dispositivo
                </div>
                <div className="notia-settings-card-value">{runtimeDevice}</div>
              </div>
            ) : activeSection === 'Panel desplegable' ? (
              <div className="notia-settings-card">
                <div className="notia-settings-card-label">Refresco automatico del panel</div>
                <div className="notia-settings-card-value">{refreshIntervalSeconds}s</div>
                <div className="notia-settings-card-label notia-settings-card-label--spaced">
                  Intervalo de escaneo (1s a 30s)
                </div>
                <div className="notia-settings-slider-wrap">
                  <input
                    type="range"
                    min={REFRESH_INTERVAL_MIN_SECONDS}
                    max={REFRESH_INTERVAL_MAX_SECONDS}
                    step={1}
                    value={refreshIntervalSeconds}
                    onChange={(event) => {
                      const seconds = Number(event.target.value)
                      onExplorerRefreshIntervalMsChange(seconds * 1000)
                    }}
                  />
                </div>
              </div>
            ) : (
              <div>Seccion: {activeSection}</div>
            )}
          </div>
        </div>
        <aside className="notia-settings-menu">
          {SECTIONS.map((section) => (
            <button
              key={section}
              type="button"
              className={`notia-settings-menu-item ${
                section === activeSection ? 'notia-settings-menu-item--active' : ''
              }`}
              onClick={() => setActiveSection(section)}
            >
              {section}
            </button>
          ))}
        </aside>
      </div>
    </div>
  )
}
