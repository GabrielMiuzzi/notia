import { useRef, type PointerEvent } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import type { LibraryGraphNode } from '../../../../../types/graph/libraryGraph'
import type { GraphContextLook } from '../GraphInspector'
import { ChevronIcon, CloseIcon, LocalGraphIcon, OpenNoteIcon } from './graphPhoneIcons'

/** A vertical drag of the sheet's head longer than this expands or shrinks it. */
const SWIPE_PX = 24

interface GraphPhoneNoteSheetProps {
  libraryName: string
  selected: LibraryGraphNode
  look: GraphContextLook
  connections: LibraryGraphNode[]
  lookOf: (node: LibraryGraphNode) => GraphContextLook
  /** Height of the sheet, in pixels (its top hairline aside). */
  height: number
  isExpanded: boolean
  onExpandedChange: (expanded: boolean) => void
  isLocal: boolean
  onToggleLocal: () => void
  onClose: () => void
  onOpen: (path: string) => void
  onPick: (path: string) => void
  /** The side chat's context, when the view has one. */
  chat: { isIncluded: boolean; onToggle: () => void } | null
}

function linksText(degree: number): string {
  return degree === 1 ? '1 enlace' : `${degree} enlaces`
}

/**
 * The selected note as a bottom sheet: it peeks with the note and its
 * actions, and expands (tap or swipe its head) to list the connections.
 */
export function GraphPhoneNoteSheet({
  libraryName,
  selected,
  look,
  connections,
  lookOf,
  height,
  isExpanded,
  onExpandedChange,
  isLocal,
  onToggleLocal,
  onClose,
  onOpen,
  onPick,
  chat,
}: GraphPhoneNoteSheetProps) {
  const swipeRef = useRef<{ pointerId: number; y: number } | null>(null)
  const swipedRef = useRef(false)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    swipeRef.current = { pointerId: event.pointerId, y: event.clientY }
    swipedRef.current = false
  }
  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipeRef.current
    swipeRef.current = null
    if (!start || start.pointerId !== event.pointerId) return
    const distance = event.clientY - start.y
    if (Math.abs(distance) < SWIPE_PX) return
    // A swipe is not a tap on the button it started on.
    swipedRef.current = true
    if (distance < 0 && !isExpanded) onExpandedChange(true)
    if (distance > 0 && isExpanded) onExpandedChange(false)
  }

  return (
    <section className="notia-gv-phone-sheet" style={{ height }} aria-label={`Detalle de ${selected.label}`}>
      <div
        className="notia-gv-phone-sheet-head"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { swipeRef.current = null }}
        onClickCapture={(event) => {
          if (!swipedRef.current) return
          swipedRef.current = false
          event.stopPropagation()
          event.preventDefault()
        }}
      >
        <button
          type="button"
          className="notia-gv-phone-handle"
          aria-label={isExpanded ? 'Achicar detalle' : 'Expandir detalle'}
          aria-expanded={isExpanded}
          onClick={() => onExpandedChange(!isExpanded)}
        >
          <span aria-hidden="true" />
        </button>
        <div className="notia-gv-phone-sheet-body">
          <div className="notia-gv-phone-sheet-bar">
            <span className="notia-gv-phone-tag">
              <span className="notia-gv-phone-tag-dot" style={{ background: look.color }} aria-hidden="true" />
              {look.name}
            </span>
            {chat ? (
              <button
                type="button"
                className="notia-gv-phone-icon notia-gv-phone-icon--muted"
                aria-label={chat.isIncluded ? 'Quitar del chat' : 'Sumar al chat'}
                aria-pressed={chat.isIncluded}
                onClick={chat.onToggle}
              >
                <MessageSquarePlus size={16} strokeWidth={2.2} aria-hidden="true" />
              </button>
            ) : null}
            <button type="button" className="notia-gv-phone-icon notia-gv-phone-icon--muted notia-gv-phone-close" aria-label="Cerrar detalle" onClick={onClose}>
              <CloseIcon size={16} strokeWidth={2.2} />
            </button>
          </div>
          <h3 className="notia-gv-phone-sheet-title">{selected.label}</h3>
          <p className="notia-gv-phone-sheet-meta">
            {selected.folder ? `${libraryName} / ${selected.folder}` : libraryName} · {linksText(selected.degree)}
          </p>
          <div className="notia-gv-phone-sheet-actions">
            <button type="button" className="notia-gv-phone-button notia-gv-phone-button--primary" onClick={() => onOpen(selected.path)}>
              <OpenNoteIcon />
              Abrir nota
            </button>
            <button type="button" className="notia-gv-phone-button" aria-pressed={isLocal} onClick={onToggleLocal}>
              <LocalGraphIcon size={16} />
              {isLocal ? 'Ver global' : 'Grafo local'}
            </button>
          </div>
        </div>
      </div>
      <div className="notia-gv-phone-connections">
        <p className="notia-gv-phone-section">
          <span>Conexiones</span>
          <span className="notia-gv-phone-section-count">{connections.length}</span>
        </p>
        {connections.map((node) => (
          <button key={node.path} type="button" className="notia-gv-phone-connection" onClick={() => onPick(node.path)}>
            <span className="notia-gv-phone-dot" style={{ background: lookOf(node).color }} aria-hidden="true" />
            <span className="notia-gv-phone-connection-label">{node.label}</span>
            <span className="notia-gv-phone-connection-degree">{node.degree}</span>
            <ChevronIcon />
          </button>
        ))}
        {connections.length === 0 ? <p className="notia-gv-phone-empty notia-gv-phone-empty--connections">Esta nota no tiene enlaces todavía.</p> : null}
      </div>
    </section>
  )
}
