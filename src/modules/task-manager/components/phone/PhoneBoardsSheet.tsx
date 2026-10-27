import type { Board } from '../../types/taskManagerTypes'
import { PhoneSheet, PhoneSheetTitle } from './PhoneSheet'
import { PhoneIcon } from './phoneIcons'

interface PhoneBoardsSheetProps {
  boards: Board[]
  activeBoard: string
  /** «Editar tablero» and «Nuevo tablero»: none on a published board. */
  onEditBoard?: () => void
  onNewBoard?: () => void
  onSelect: (name: string) => void
  onClose: () => void
}

function activeLabel(board: Board): string {
  const count = board.counts.active
  if (count === 0) return 'Sin tareas activas'
  return count === 1 ? '1 tarea activa' : `${count} tareas activas`
}

/** «Tableros»: change the board, and edit or create one. */
export function PhoneBoardsSheet({ boards, activeBoard, onEditBoard, onNewBoard, onSelect, onClose }: PhoneBoardsSheetProps) {
  return (
    <PhoneSheet label="Tableros" onClose={onClose}>
      <PhoneSheetTitle title="Tableros" />
      <div className="tmp-group" role="radiogroup" aria-label="Tableros">
        {boards.map((board) => {
          const current = board.name === activeBoard
          return (
            <button
              key={board.name}
              type="button"
              role="radio"
              aria-checked={current}
              className={`tmp-row tmp-row--board${current ? ' is-current' : ''}`}
              onClick={() => onSelect(board.name)}
            >
              <span className="tmp-board-initial">{board.name.slice(0, 1)}</span>
              <span className="tmp-row-text">
                <span className="tmp-row-title">{board.name}</span>
                <span className="tmp-row-sub">{activeLabel(board)}</span>
              </span>
              {current ? <PhoneIcon name="check" size={17} strokeWidth={2.6} className="tmp-tick" /> : null}
            </button>
          )
        })}
      </div>
      {onEditBoard || onNewBoard ? (
        <div className="tmp-sheet-pair">
          {onEditBoard ? (
            <button type="button" className="tmp-btn tmp-btn--outline" onClick={onEditBoard}>
              <PhoneIcon name="pencil" size={15} className="tmp-accent" />
              Editar tablero
            </button>
          ) : null}
          {onNewBoard ? (
            <button type="button" className="tmp-btn tmp-btn--outline" onClick={onNewBoard}>
              <PhoneIcon name="plus" size={15} strokeWidth={2.2} className="tmp-muted" />
              Nuevo tablero
            </button>
          ) : null}
        </div>
      ) : null}
    </PhoneSheet>
  )
}
