import { ExternalLink, LocateFixed, MessageSquarePlus, X } from 'lucide-react'
import type { LibraryGraphNode, LibraryGraphSummary } from '../../../../types/graph/libraryGraph'

export interface GraphContextLook {
  name: string
  color: string
}

interface GraphInspectorProps {
  libraryName: string
  selected: LibraryGraphNode | null
  nodeByPath: ReadonlyMap<string, LibraryGraphNode>
  summary: LibraryGraphSummary
  lookOf: (node: LibraryGraphNode) => GraphContextLook
  contextLooks: Array<GraphContextLook & { count: number }>
  isLocal: boolean
  onToggleLocal: () => void
  onClose: () => void
  onOpen: (path: string) => void
  onPick: (path: string) => void
  /** The side chat's context, when the view has one. */
  chat: { isIncluded: boolean; onToggle: () => void } | null
}

function NoteRow({ node, look, onPick }: { node: LibraryGraphNode; look: GraphContextLook; onPick: (path: string) => void }) {
  return (
    <button type="button" className="notia-gv-row" onClick={() => onPick(node.path)}>
      <span className="notia-gv-dot" style={{ background: look.color }} aria-hidden="true" />
      <span className="notia-gv-row-label">{node.label}</span>
      <span className="notia-gv-mono notia-gv-muted" aria-label={`${node.degree} enlaces`}>{node.degree}</span>
    </button>
  )
}

/** Detail of the selected note, or a summary of the library. */
export function GraphInspector({
  libraryName,
  selected,
  nodeByPath,
  summary,
  lookOf,
  contextLooks,
  isLocal,
  onToggleLocal,
  onClose,
  onOpen,
  onPick,
  chat,
}: GraphInspectorProps) {
  if (selected) {
    const look = lookOf(selected)
    const connections = selected.neighbors.flatMap((path) => nodeByPath.get(path) ?? [])
    return (
      <aside className="notia-gv-card notia-gv-inspector" aria-label={`Detalle de ${selected.label}`}>
        <div className="notia-gv-inspector-head">
          <div className="notia-gv-inspector-bar">
            <span className="notia-gv-tag">
              <span className="notia-gv-dot" style={{ background: look.color }} aria-hidden="true" />
              {look.name}
            </span>
            <button type="button" className="notia-gv-icon-button" aria-label="Cerrar detalle" onClick={onClose}>
              <X size={13} aria-hidden="true" />
            </button>
          </div>
          <h3 className="notia-gv-inspector-title">{selected.label}</h3>
          <p className="notia-gv-mono notia-gv-muted notia-gv-inspector-meta">
            <span>{selected.folder ? `${libraryName} / ${selected.folder}` : libraryName}</span>
            <span className="notia-gv-meta-dot" aria-hidden="true" />
            <span>{selected.degree === 1 ? '1 enlace' : `${selected.degree} enlaces`}</span>
          </p>
          <div className="notia-gv-actions">
            <button type="button" className="notia-gv-button notia-gv-button--primary" onClick={() => onOpen(selected.path)}>
              <ExternalLink size={14} aria-hidden="true" />
              Abrir nota
            </button>
            {chat ? (
              <button type="button" className="notia-gv-button" aria-pressed={chat.isIncluded} onClick={chat.onToggle}>
                <MessageSquarePlus size={14} aria-hidden="true" />
                {chat.isIncluded ? 'Quitar del chat' : 'Sumar al chat'}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className={`notia-gv-button notia-gv-button--wide${isLocal ? ' is-active' : ''}`}
            aria-pressed={isLocal}
            onClick={onToggleLocal}
          >
            <LocateFixed size={14} aria-hidden="true" />
            {isLocal ? 'Volver al grafo global' : 'Ver grafo local'}
          </button>
        </div>
        <div className="notia-gv-inspector-section">
          <p className="notia-gv-section-title">
            <span>Conexiones</span>
            <span className="notia-gv-mono">{connections.length}</span>
          </p>
          {connections.map((node) => <NoteRow key={node.path} node={node} look={lookOf(node)} onPick={onPick} />)}
          {connections.length === 0 ? <p className="notia-gv-empty">Esta nota no tiene enlaces todavía.</p> : null}
        </div>
      </aside>
    )
  }

  const top = summary.topConnected.flatMap((path) => nodeByPath.get(path) ?? [])
  return (
    <aside className="notia-gv-card notia-gv-inspector notia-gv-inspector--summary" aria-label={`Resumen de ${libraryName}`}>
      <div className="notia-gv-inspector-section notia-gv-summary">
        <div>
          <h3 className="notia-gv-summary-title">Resumen de {libraryName}</h3>
          <p className="notia-gv-muted">Tocá un nodo para ver sus conexiones.</p>
        </div>
        <div className="notia-gv-stats">
          <div><strong className="notia-gv-mono">{summary.notes}</strong><span>notas</span></div>
          <div><strong className="notia-gv-mono">{summary.links}</strong><span>enlaces</span></div>
          <div><strong className="notia-gv-mono">{summary.orphans}</strong><span>huérfanas</span></div>
        </div>
        {contextLooks.length > 0 ? (
          <div className="notia-gv-bars">
            <p className="notia-gv-section-title"><span>Por etiqueta</span></p>
            {contextLooks.map((context) => (
              <div key={context.name} className="notia-gv-bar-row">
                <span>{context.name}</span>
                <span className="notia-gv-bar" aria-hidden="true">
                  <span style={{ width: `${summary.notes > 0 ? Math.round((context.count / summary.notes) * 100) : 0}%`, background: context.color }} />
                </span>
                <span className="notia-gv-mono notia-gv-muted">{context.count}</span>
              </div>
            ))}
          </div>
        ) : null}
        {top.length > 0 ? (
          <div>
            <p className="notia-gv-section-title"><span>Más conectadas</span></p>
            {top.map((node) => <NoteRow key={node.path} node={node} look={lookOf(node)} onPick={onPick} />)}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
