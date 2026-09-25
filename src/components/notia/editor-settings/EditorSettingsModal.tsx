import type { ReactNode } from 'react'
import { FileText, PenLine, X } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import { NotiaModalShell } from '../NotiaModalShell'
import { SettingsSwitch } from '../settings/SettingsControls'
import { useEditorPreferences } from '../hooks/useEditorPreferences'
import type {
  PageMarginsId,
  PageOrientation,
  PenColor,
  PenPreferences,
  PenSideButton,
  PenTool,
} from '../../../services/preferences/editorPreferences'
import '../settings/settings.css'
import './editorSettings.css'

export type EditorSettingsTab = 'page' | 'pen'

interface EditorSettingsModalProps {
  open: boolean
  tab: EditorSettingsTab
  onTabChange: (tab: EditorSettingsTab) => void
  onClose: () => void
}

/** Largest side of the paper icon in the format tiles. */
const PAPER_ICON_SIZE = 30

const ORIENTATIONS: ReadonlyArray<{ id: PageOrientation; label: string }> = [
  { id: 'portrait', label: 'Vertical' },
  { id: 'landscape', label: 'Horizontal' },
]
const PEN_TOOLS: ReadonlyArray<{ id: PenTool; label: string }> = [
  { id: 'fountain', label: 'Pluma' },
  { id: 'pencil', label: 'Lápiz' },
  { id: 'marker', label: 'Marcador' },
]
const PEN_COLORS: ReadonlyArray<{ id: PenColor; label: string }> = [
  { id: 'ink', label: 'Tinta' },
  { id: 'teal', label: 'Teal' },
  { id: 'blue', label: 'Azul' },
  { id: 'red', label: 'Rojo' },
  { id: 'orange', label: 'Naranja' },
  { id: 'yellow', label: 'Amarillo' },
]
const SIDE_BUTTON: ReadonlyArray<{ id: PenSideButton; label: string }> = [
  { id: 'eraser', label: 'Borrador' },
  { id: 'select', label: 'Selección' },
  { id: 'none', label: 'Sin acción' },
]
const PEN_TOGGLES = [
  { key: 'pressure', label: 'Sensibilidad a la presión', description: 'El grosor varía según la fuerza del trazo' },
  { key: 'palmRejection', label: 'Rechazo de palma', description: 'Ignora la mano apoyada sobre la pantalla' },
  { key: 'penOnly', label: 'Dibujar solo con lápiz', description: 'El dedo desplaza la página en lugar de dibujar' },
] as const

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

function PageTab() {
  const { editorPage, editorPageSetup, updatePage } = useEditorPreferences()
  if (!editorPage || !editorPageSetup) {
    return <p className="notia-editor-settings-loading" role="status">Cargando la configuración…</p>
  }
  return (
    <div className="notia-editor-settings-section">
      <div className="notia-editor-settings-lead">
        <div>
          <h3>Modo página</h3>
          <p>Divide el documento en hojas de tamaño fijo, como en un procesador de texto. Desactivado, el documento sigue siendo un lienzo continuo.</p>
        </div>
        <SettingsSwitch label="Modo página" checked={editorPage.pageMode} onChange={(pageMode) => updatePage({ pageMode })} />
      </div>

      <div className="notia-editor-settings-options" data-dimmed={!editorPage.pageMode || undefined}>
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

function PenTab() {
  const { pen, updatePen } = useEditorPreferences()
  if (!pen) {
    return <p className="notia-editor-settings-loading" role="status">Cargando la configuración…</p>
  }
  const isMarker = pen.tool === 'marker'
  return (
    <div className="notia-editor-settings-section">
      <div className="notia-editor-settings-title">
        <h3>Lápiz</h3>
        <span className="notia-editor-settings-soon">Próximamente</span>
      </div>
      <div className="notia-editor-settings-preview" data-color={pen.color} aria-hidden="true">
        <svg viewBox="0 0 380 70" fill="none" preserveAspectRatio="xMidYMid meet">
          <path
            d="M20 44 C 70 8, 120 70, 175 36 S 280 16, 360 40"
            strokeWidth={pen.thickness}
            strokeOpacity={isMarker ? 0.45 : 1}
            strokeLinecap={isMarker ? 'square' : 'round'}
          />
        </svg>
      </div>
      <Group label="Herramienta predeterminada">
        <Segmented label="Herramienta predeterminada" options={PEN_TOOLS} value={pen.tool} onChange={(tool) => updatePen({ tool })} />
      </Group>
      <Group label="Color">
        <div className="notia-editor-settings-colors" role="radiogroup" aria-label="Color del trazo">
          {PEN_COLORS.map((color) => (
            <NotiaButton
              key={color.id}
              variant="ghost"
              role="radio"
              aria-checked={pen.color === color.id}
              aria-label={color.label}
              title={color.label}
              className="notia-editor-settings-color"
              data-color={color.id}
              onClick={() => updatePen({ color: color.id })}
            >
              <span aria-hidden="true" />
            </NotiaButton>
          ))}
        </div>
      </Group>
      <div className="notia-editor-settings-pair notia-editor-settings-pair--even">
        <label className="notia-editor-settings-range">
          <span><span>Grosor</span><output>{pen.thickness} px</output></span>
          <input type="range" min={1} max={14} value={pen.thickness} onChange={(event) => updatePen({ thickness: Number(event.target.value) })} />
        </label>
        <label className="notia-editor-settings-range">
          <span><span>Suavizado del trazo</span><output>{pen.smoothing}%</output></span>
          <input type="range" min={0} max={100} value={pen.smoothing} onChange={(event) => updatePen({ smoothing: Number(event.target.value) })} />
        </label>
      </div>
      <div className="notia-editor-settings-list">
        {PEN_TOGGLES.map((toggle) => (
          <div key={toggle.key} className="notia-editor-settings-list-row">
            <div>
              <p>{toggle.label}</p>
              <span>{toggle.description}</span>
            </div>
            <SettingsSwitch label={toggle.label} checked={pen[toggle.key]} onChange={(checked) => updatePen({ [toggle.key]: checked } as Partial<PenPreferences>)} />
          </div>
        ))}
      </div>
      <Group label="Botón lateral del lápiz">
        <Segmented label="Botón lateral del lápiz" options={SIDE_BUTTON} value={pen.sideButton} onChange={(sideButton) => updatePen({ sideButton })} />
      </Group>
    </div>
  )
}

/** Editor settings: page mode with its page setup, and the pen. */
export function EditorSettingsModal({ open, tab, onTabChange, onClose }: EditorSettingsModalProps) {
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
          <NotiaButton variant="ghost" className="notia-editor-settings-tab" aria-current={tab === 'pen' ? 'page' : undefined} onClick={() => onTabChange('pen')}>
            <PenLine size={15} aria-hidden="true" />
            Lápiz
          </NotiaButton>
        </nav>
        <div className="notia-editor-settings-content">
          {error ? <p className="notia-editor-settings-error" role="alert">{error}</p> : null}
          {tab === 'page' ? <PageTab /> : <PenTab />}
        </div>
      </div>
    </NotiaModalShell>
  )
}
