import { useEffect, useId, useRef } from 'react'
import type { GraphContextChip } from '../GraphTopBar'
import {
  DEFAULT_GRAPH_FORCES,
  GRAPH_FORCE_LIMITS,
  GRAPH_FORCE_ROWS,
  type GraphForces,
  type GraphPreferences,
} from '../useGraphPreferences'

interface GraphPhoneViewSheetProps {
  chips: GraphContextChip[]
  onToggleChip: (key: string) => void
  preferences: GraphPreferences
  onChange: (change: Partial<GraphPreferences>) => void
  /** Notes without links in the library. */
  orphanCount: number
  onClose: () => void
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="notia-gv-phone-switch-row" onClick={() => onChange(!checked)}>
      <span className="notia-gv-phone-switch-text">
        <span>{label}</span>
        <span className="notia-gv-phone-switch-hint">{hint}</span>
      </span>
      <span className="notia-gv-phone-switch" aria-hidden="true"><span /></span>
    </button>
  )
}

/** The view of the graph on a phone: tags shown, names, orphans, folder zones and forces. */
export function GraphPhoneViewSheet({ chips, onToggleChip, preferences, onChange, orphanCount, onClose }: GraphPhoneViewSheetProps) {
  const titleId = useId()
  const sheetRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    sheetRef.current?.focus()
  }, [])
  const setForce = (key: keyof GraphForces, value: number) => onChange({ forces: { ...preferences.forces, [key]: value } })
  return (
    <>
      <button type="button" className="notia-gv-phone-scrim" aria-label="Cerrar vista y filtros" onClick={onClose} />
      <section
        ref={sheetRef}
        className="notia-gv-phone-view"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <div className="notia-gv-phone-grip" aria-hidden="true"><span /></div>
        <div className="notia-gv-phone-view-head">
          <h3 id={titleId}>Vista del grafo</h3>
          <button type="button" className="notia-gv-phone-done" onClick={onClose}>Listo</button>
        </div>

        <p className="notia-gv-phone-label notia-gv-phone-label--first">Etiquetas</p>
        <div className="notia-gv-phone-chips" role="group" aria-label="Etiquetas">
          {chips.map((chip) => (
            <button key={chip.key} type="button" className="notia-gv-phone-chip" aria-pressed={!chip.hidden} onClick={() => onToggleChip(chip.key)}>
              <span
                className="notia-gv-phone-chip-dot"
                style={{ borderColor: chip.color, background: chip.hidden ? 'transparent' : chip.color }}
                aria-hidden="true"
              />
              <span>{chip.name}</span>
              <span className="notia-gv-phone-chip-count">{chip.count}</span>
            </button>
          ))}
        </div>

        <p className="notia-gv-phone-label">Mostrar</p>
        <div className="notia-gv-phone-names">
          <span>Nombres</span>
          <div className="notia-gv-phone-segmented" role="group" aria-label="Nombres">
            <button type="button" aria-pressed={preferences.labels === 'auto'} onClick={() => onChange({ labels: 'auto' })}>Auto</button>
            <button type="button" aria-pressed={preferences.labels === 'all'} onClick={() => onChange({ labels: 'all' })}>Todos</button>
          </div>
        </div>
        <SwitchRow
          label="Notas huérfanas"
          hint={orphanCount === 1 ? '1 nota sin enlaces' : `${orphanCount} notas sin enlaces`}
          checked={preferences.showOrphans}
          onChange={(showOrphans) => onChange({ showOrphans })}
        />
        <SwitchRow
          label="Zonas por carpeta"
          hint="Agrupa y rodea cada carpeta"
          checked={preferences.showFolders}
          onChange={(showFolders) => onChange({ showFolders })}
        />

        <div className="notia-gv-phone-forces-head">
          <span className="notia-gv-phone-label-text">Fuerzas</span>
          <button type="button" className="notia-gv-phone-reset" onClick={() => onChange({ forces: DEFAULT_GRAPH_FORCES })}>Restablecer</button>
        </div>
        <div className="notia-gv-phone-forces">
          {GRAPH_FORCE_ROWS.map((row) => {
            const [min, max] = GRAPH_FORCE_LIMITS[row.key]
            const value = preferences.forces[row.key]
            return (
              <label key={row.key} className="notia-gv-phone-force">
                <span className="notia-gv-phone-force-head">
                  <span>{row.name}</span>
                  <span className="notia-gv-phone-force-value">{row.format(value)}</span>
                </span>
                <input type="range" min={min} max={max} value={value} onChange={(event) => setForce(row.key, Number(event.target.value))} />
              </label>
            )
          })}
        </div>
        <p className="notia-gv-phone-hint">
          Pellizcá para hacer zoom y arrastrá el fondo para moverte. Arrastrá un nodo para fijarlo; tocalo dos veces para liberarlo.
        </p>
      </section>
    </>
  )
}
