import type { ReactNode } from 'react'
import { FileText, X } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import { NotiaModalShell } from '../NotiaModalShell'
import { SettingsSwitch } from '../settings/SettingsControls'
import { useEditorPreferences } from '../hooks/useEditorPreferences'
import type { PageMarginsId, PageOrientation } from '../../../services/preferences/editorPreferences'
import '../settings/settings.css'
import './editorSettings.css'

/** The pen options live in the editor's pen bar; the dialog has the page. */
export type EditorSettingsTab = 'page'

interface EditorSettingsModalProps {
  open: boolean
  tab: EditorSettingsTab
  onTabChange: (tab: EditorSettingsTab) => void
  onClose: () => void
  /** Page mode of the open note (its `pageMode` property); `null` without a note. */
  pageMode: boolean | null
  onTogglePageMode: () => void
}

/** Largest side of the paper icon in the format tiles. */
const PAPER_ICON_SIZE = 30

const ORIENTATIONS: ReadonlyArray<{ id: PageOrientation; label: string }> = [
  { id: 'portrait', label: 'Vertical' },
  { id: 'landscape', label: 'Horizontal' },
]
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: ReadonlyArray<{ id: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="notia-editor-settings-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <NotiaButton
          key={option.id}
          variant="ghost"
          role="radio"
          aria-checked={value === option.id}
          className="notia-editor-settings-segment"
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </NotiaButton>
      ))}
    </div>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="notia-editor-settings-group">
      <p className="notia-editor-settings-group-label">{label}</p>
      {children}
    </div>
  )
}

function PageTab({ pageMode, onTogglePageMode }: Pick<EditorSettingsModalProps, 'pageMode' | 'onTogglePageMode'>) {
  const { editorPage, editorPageSetup, updatePage } = useEditorPreferences()
  if (!editorPage || !editorPageSetup) {
    return <p className="notia-editor-settings-loading" role="status">Cargando la configuración…</p>
  }
  return (
    <div className="notia-editor-settings-section">
      <div className="notia-editor-settings-lead">
        <div>
          <h3>Modo página</h3>
          <p>Divide esta nota en hojas A3, como en un procesador de texto. Se guarda en la nota, así que cada nota abre como la dejaste; sin activarlo, la nota es una sola hoja del ancho de un A3, sin fin hacia abajo. La orientación y los márgenes valen para todas las notas en modo página.</p>
        </div>
        <SettingsSwitch label="Modo página" checked={pageMode === true} disabled={pageMode === null} onChange={onTogglePageMode} />
      </div>

      <div className="notia-editor-settings-options" data-dimmed={pageMode !== true || undefined}>
        <Group label="Tamaño">
          <div className="notia-editor-settings-formats" role="radiogroup" aria-label="Tamaño de página">
            {editorPageSetup.formats.map((format) => {
              const scale = PAPER_ICON_SIZE / Math.max(format.widthMm, format.heightMm)
              return (
                <NotiaButton
                  key={format.id}
                  variant="ghost"
                  role="radio"
                  aria-checked={editorPage.format === format.id}
                  className="notia-editor-settings-format"
                  onClick={() => updatePage({ format: format.id })}
                >
                  <span className="notia-editor-settings-paper" aria-hidden="true">
                    <span style={{ width: Math.round(format.widthMm * scale), height: Math.round(format.heightMm * scale) }} />
                  </span>
                  <span className="notia-editor-settings-format-text">
                    <strong>{format.label}</strong>
                    <span>{Math.round(format.widthMm)} × {Math.round(format.heightMm)} mm</span>
                  </span>
                </NotiaButton>
              )
            })}
          </div>
        </Group>
        <div className="notia-editor-settings-pair">
          <Group label="Orientación">
            <Segmented label="Orientación" options={ORIENTATIONS} value={editorPage.orientation} onChange={(orientation) => updatePage({ orientation })} />
          </Group>
          <Group label="Márgenes">
            <Segmented<PageMarginsId>
              label="Márgenes"
              options={editorPageSetup.margins}
              value={editorPage.margins}
              onChange={(margins) => updatePage({ margins })}
            />
          </Group>
        </div>
        <div className="notia-editor-settings-toggle-row">
          <span>Mostrar número de página</span>
          <SettingsSwitch label="Mostrar número de página" checked={editorPage.pageNumbers} onChange={(pageNumbers) => updatePage({ pageNumbers })} />
        </div>
      </div>
    </div>
  )
}

/** Editor settings: page mode with its A3 page setup. */
export function EditorSettingsModal({ open, tab, onTabChange, onClose, pageMode, onTogglePageMode }: EditorSettingsModalProps) {
  const { error } = useEditorPreferences()
  return (
    <NotiaModalShell open={open} onClose={onClose} size="lg" panelClassName="notia-editor-settings">
      <div className="notia-editor-settings-header">
        <h2>Configuración</h2>
        <NotiaButton variant="ghost" className="notia-editor-settings-close" aria-label="Cerrar" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </NotiaButton>
      </div>
      <div className="notia-editor-settings-layout">
        <nav className="notia-editor-settings-nav" aria-label="Secciones">
          <NotiaButton variant="ghost" className="notia-editor-settings-tab" aria-current={tab === 'page' ? 'page' : undefined} onClick={() => onTabChange('page')}>
            <FileText size={15} aria-hidden="true" />
            Página
          </NotiaButton>
        </nav>
        <div className="notia-editor-settings-content">
          {error ? <p className="notia-editor-settings-error" role="alert">{error}</p> : null}
          <PageTab pageMode={pageMode} onTogglePageMode={onTogglePageMode} />
        </div>
      </div>
    </NotiaModalShell>
  )
}
