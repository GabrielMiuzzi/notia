import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TaskItem } from '../../types/taskManagerTypes'
import { Icon } from './icons'
import { useTaskActions } from './taskInteractions'

interface SubtasksPanelProps {
  parent: TaskItem
  subtasks: TaskItem[]
  done: number
  total: number
  /** The card shows it inside; the list under the row, with tree lines. */
  variant: 'card' | 'list'
  /** Title shown for the parent (a pending rename included). */
  parentTitle: string
}

const BAR_DONE_MS = 950

/** Progress, one row per subtask with its checkbox, and «Agregar subtarea y Enter». */
export function SubtasksPanel({ parent, subtasks, done, total, variant, parentTitle }: SubtasksPanelProps) {
  const actions = useTaskActions()
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [barDone, setBarDone] = useState(false)
  const complete = total > 0 && done === total
  const wasComplete = useRef(complete)

  // Completing the last one makes the bar glow.
  useEffect(() => {
    const before = wasComplete.current
    wasComplete.current = complete
    if (!complete || before) return
    setBarDone(true)
    const timer = window.setTimeout(() => setBarDone(false), BAR_DONE_MS)
    return () => window.clearTimeout(timer)
  }, [complete])

  const add = () => {
    const title = draft.trim()
    if (!title || adding) return
    setAdding(true)
    void actions.send({ kind: 'add-subtask', taskPath: parent.filePath, title }, parent.filePath).then((ok) => {
      setAdding(false)
      if (ok) setDraft('')
    })
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      add()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }

  const percent = total ? (done / total) * 100 : 0
  const isList = variant === 'list'

  return (
    <div className={`tm-subs tm-subs--${variant}`}>
      <div className="tm-subs-head">
        <span className="tm-caps tm-subs-title">{isList ? `Subtareas de ${parentTitle}` : 'Subtareas'}</span>
        <span className="tm-bar tm-bar--subs">
          <span className={`tm-bar-fill${barDone ? ' is-done' : ''}`} style={{ width: `${percent.toFixed(1)}%` }} />
        </span>
        <span className={`tm-subs-count${complete ? ' is-complete' : ''}`}>{total ? `${done}/${total}` : '0/0'}</span>
      </div>
      {subtasks.map((subtask, index) => {
        const checked = subtask.state === 'Finalizada'
        return (
          <div key={subtask.filePath} className="tm-subrow" style={{ animationDelay: `${index * 35}ms` }}>
            {isList ? <span className="tm-subrow-guide" aria-hidden="true" /> : null}
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={subtask.title}
              className={`tm-checkbox${checked ? ' is-on' : ''}`}
              onClick={() => void actions.send({ kind: 'toggle-subtask', taskPath: subtask.filePath }, parent.filePath)}
            >
              {checked ? <Icon name="check" size={11} strokeWidth={3.6} className="tm-check-pop" /> : null}
            </button>
            <button
              type="button"
              className={`tm-subrow-text${checked ? ' is-done' : ''}`}
              title={subtask.title}
              onClick={() => actions.openTask(subtask)}
            >
              {subtask.title}
            </button>
            <button
              type="button"
              className="tm-icon-btn tm-sub-delete tm-sreveal"
              aria-label={`Eliminar subtarea ${subtask.title}`}
              onClick={() => void actions.send({ kind: 'delete-task', taskPath: subtask.filePath }, parent.filePath)}
            >
              {isList ? <Icon name="trash" size={13} /> : <Icon name="x" size={11} strokeWidth={2.4} />}
            </button>
          </div>
        )
      })}
      <label className="tm-subadd">
        <Icon name="plus" size={13} strokeWidth={2.4} />
        <input
          aria-label={isList ? `Agregar subtarea a ${parentTitle}` : 'Agregar subtarea'}
          placeholder="Agregar subtarea y Enter"
          value={draft}
          readOnly={adding}
          aria-busy={adding}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </label>
    </div>
  )
}
