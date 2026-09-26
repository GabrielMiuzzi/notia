import { useId, useState } from 'react'
import { Maximize, Minus, Plus, SlidersHorizontal } from 'lucide-react'
import {
  DEFAULT_GRAPH_FORCES,
  GRAPH_FORCE_LIMITS,
  type GraphForces,
  type GraphPreferences,
} from './useGraphPreferences'

interface GraphDockProps {
  zoomPercent: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onFit: () => void
  preferences: GraphPreferences
  onChange: (change: Partial<GraphPreferences>) => void
}

const FORCE_ROWS: Array<{ key: keyof GraphForces; name: string; format: (value: number) => string }> = [
  { key: 'repulsion', name: 'Repulsión', format: (value) => `−${value}` },
  { key: 'linkDistance', name: 'Distancia de enlace', format: (value) => String(value) },
  { key: 'cohesion', name: 'Cohesión por carpeta', format: (value) => (value / 100).toFixed(2) },
]

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="notia-gv-switch" onClick={() => onChange(!checked)}>
      <span className="notia-gv-switch-track" aria-hidden="true"><span /></span>
      {label}
    </button>
  )
}

/** Zoom, names, orphans, folder halos and the forces of the layout. */
export function GraphDock({ zoomPercent, onZoomIn, onZoomOut, onZoomReset, onFit, preferences, onChange }: GraphDockProps) {
  const [isForcesOpen, setIsForcesOpen] = useState(false)
  const forcesId = useId()
  const setForce = (key: keyof GraphForces, value: number) => onChange({ forces: { ...preferences.forces, [key]: value } })
  return (
    <>
      <div className="notia-gv-card notia-gv-dock" role="toolbar" aria-label="Vista del grafo">
        <button type="button" className="notia-gv-icon-button" aria-label="Alejar" onClick={onZoomOut}>
          <Minus size={14} aria-hidden="true" />
        </button>
        <button type="button" className="notia-gv-zoom" aria-label="Restablecer zoom" title="Restablecer zoom" onClick={onZoomReset}>
          {zoomPercent}%
        </button>
        <button type="button" className="notia-gv-icon-button" aria-label="Acercar" onClick={onZoomIn}>
          <Plus size={14} aria-hidden="true" />
        </button>
        <button type="button" className="notia-gv-icon-button" aria-label="Encuadrar todo" title="Encuadrar todo" onClick={onFit}>
          <Maximize size={14} aria-hidden="true" />
        </button>
        <span className="notia-gv-divider" aria-hidden="true" />
        <span className="notia-gv-muted notia-gv-dock-label">Nombres</span>
        <div className="notia-gv-segmented notia-gv-segmented--small" role="group" aria-label="Nombres">
          <button type="button" aria-pressed={preferences.labels === 'auto'} onClick={() => onChange({ labels: 'auto' })}>Auto</button>
          <button type="button" aria-pressed={preferences.labels === 'all'} onClick={() => onChange({ labels: 'all' })}>Todos</button>
        </div>
        <span className="notia-gv-divider" aria-hidden="true" />
        <Switch label="Huérfanas" checked={preferences.showOrphans} onChange={(showOrphans) => onChange({ showOrphans })} />
        <Switch label="Carpetas" checked={preferences.showFolders} onChange={(showFolders) => onChange({ showFolders })} />
        <span className="notia-gv-divider" aria-hidden="true" />
        <button
          type="button"
          className="notia-gv-text-button"
          aria-pressed={isForcesOpen}
          aria-expanded={isForcesOpen}
          aria-controls={isForcesOpen ? forcesId : undefined}
          onClick={() => setIsForcesOpen((open) => !open)}
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          Fuerzas
        </button>
      </div>
      {isForcesOpen ? (
        <div id={forcesId} className="notia-gv-card notia-gv-forces" role="group" aria-label="Fuerzas del grafo">
          <div className="notia-gv-forces-head">
            <span>Fuerzas del grafo</span>
            <button type="button" className="notia-gv-text-button notia-gv-muted" onClick={() => onChange({ forces: DEFAULT_GRAPH_FORCES })}>
              Restablecer
            </button>
          </div>
          {FORCE_ROWS.map((row) => {
            const [min, max] = GRAPH_FORCE_LIMITS[row.key]
            const value = preferences.forces[row.key]
            return (
              <label key={row.key} className="notia-gv-force">
                <span>
                  <span>{row.name}</span>
                  <span className="notia-gv-mono notia-gv-muted">{row.format(value)}</span>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  value={value}
                  onChange={(event) => setForce(row.key, Number(event.target.value))}
                />
              </label>
            )
          })}
          <p className="notia-gv-muted notia-gv-forces-hint">Arrastrá un nodo para fijarlo en su lugar; doble clic lo libera.</p>
        </div>
      ) : null}
    </>
  )
}
