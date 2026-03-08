import { useState } from 'react'
import { X } from 'lucide-react'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'

type SettingsSection = 'General' | 'Librerias'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const SECTIONS: SettingsSection[] = ['General', 'Librerias']
const PROJECT_VERSION = '0.0.0'

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('General')
  const runtimeDevice = getRuntimeDevice()

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
