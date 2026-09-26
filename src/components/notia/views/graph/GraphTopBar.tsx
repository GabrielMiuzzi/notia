/** A context chip of the top bar: its notes can be shown or hidden. */
export interface GraphContextChip {
  key: string
  name: string
  color: string
  count: number
  hidden: boolean
}

interface GraphTopBarProps {
  visibleNotes: number
  visibleLinks: number
  isLocal: boolean
  canShowLocal: boolean
  onShowGlobal: () => void
  onShowLocal: () => void
  chips: GraphContextChip[]
  onToggleChip: (key: string) => void
}

function GraphMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="10" cy="18" r="2.5" />
      <path d="M8.2 7.1l7.4 0.6M7 8.3l2.2 7.4M16.6 10.1l-4.9 6" />
    </svg>
  )
}

/** Title with what is shown, global or local graph, and the context chips. */
export function GraphTopBar({
  visibleNotes,
  visibleLinks,
  isLocal,
  canShowLocal,
  onShowGlobal,
  onShowLocal,
  chips,
  onToggleChip,
}: GraphTopBarProps) {
  return (
    <header className="notia-gv-topbar">
      <div className="notia-gv-title">
        <span className="notia-gv-title-mark"><GraphMark /></span>
        <h2>Grafo</h2>
        <span className="notia-gv-mono notia-gv-muted">
          {visibleNotes} {visibleNotes === 1 ? 'nota' : 'notas'} · {visibleLinks} {visibleLinks === 1 ? 'enlace' : 'enlaces'}
        </span>
      </div>
      <div className="notia-gv-segmented" role="group" aria-label="Alcance del grafo">
        <button type="button" aria-pressed={!isLocal} onClick={onShowGlobal}>Global</button>
        <button
          type="button"
          aria-pressed={isLocal}
          disabled={!canShowLocal}
          title={canShowLocal ? 'La nota elegida y sus conexiones' : 'Elegí una nota para ver su grafo local'}
          onClick={onShowLocal}
        >
          Local
        </button>
      </div>
      <div className="notia-gv-chips" role="group" aria-label="Etiquetas">
        <span className="notia-gv-chips-label">Etiquetas</span>
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className="notia-gv-chip"
            aria-pressed={!chip.hidden}
            title={chip.hidden ? `Mostrar ${chip.name}` : `Ocultar ${chip.name}`}
            onClick={() => onToggleChip(chip.key)}
          >
            <span className="notia-gv-chip-dot" style={{ borderColor: chip.color, background: chip.hidden ? 'transparent' : chip.color }} aria-hidden="true" />
            <span>{chip.name}</span>
            <span className="notia-gv-mono notia-gv-muted">{chip.count}</span>
          </button>
        ))}
      </div>
    </header>
  )
}
