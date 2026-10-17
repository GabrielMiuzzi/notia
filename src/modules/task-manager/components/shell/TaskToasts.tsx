import { useEffect } from 'react'
import { UNDO_TOAST_MS, type TaskUndoToast } from '../../hooks/useTaskManager'
import { ShellIcon, type ShellIconName } from './shellIcons'

const UNDO_COPY: Record<TaskUndoToast['kind'], { label: string; icon: ShellIconName }> = {
  finish: { label: 'Tarea finalizada', icon: 'check' },
  cancel: { label: 'Tarea desestimada · pasó a Canceladas', icon: 'circleSlash' },
  delete: { label: 'Tarea eliminada', icon: 'trash' },
}

interface TaskToastsProps {
  undo: TaskUndoToast | null
  onUndo: () => void
  onDismissUndo: () => void
  error: string | null
  onDismissError: () => void
  /** What the Pomodoro tells when a phase ends. */
  notice: string | null
  onDismissNotice: () => void
}

/** The finish/cancel/delete notice with «Deshacer», and the errors. */
export function TaskToasts({ undo, onUndo, onDismissUndo, error, onDismissError, notice, onDismissNotice }: TaskToastsProps) {
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(onDismissNotice, 4000)
    return () => window.clearTimeout(timer)
  }, [notice, onDismissNotice])

  useEffect(() => {
    if (!undo) return undefined
    const timer = window.setTimeout(onDismissUndo, UNDO_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [onDismissUndo, undo])

  useEffect(() => {
    if (!error) return undefined
    const timer = window.setTimeout(onDismissError, 6000)
    return () => window.clearTimeout(timer)
  }, [error, onDismissError])

  return (
    <div className="tm-toasts">
      {notice ? (
        <div className="tm-toast tm-toast--finish" role="status">
          <span className="tm-toast-icon"><ShellIcon name="stopwatch" size={14} strokeWidth={2.4} /></span>
          <span className="tm-toast-text"><strong>{notice}</strong></span>
          <button type="button" className="tm-toast-close" aria-label="Cerrar aviso" onClick={onDismissNotice}>
            <ShellIcon name="close" size={12} />
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="tm-toast tm-toast--error" role="alert">
          <span className="tm-toast-icon"><ShellIcon name="close" size={14} strokeWidth={2.4} /></span>
          <span className="tm-toast-text"><strong>{error}</strong></span>
          <button type="button" className="tm-toast-close" aria-label="Cerrar aviso" onClick={onDismissError}>
            <ShellIcon name="close" size={12} />
          </button>
        </div>
      ) : null}
      {undo ? (
        <div key={undo.id} className={`tm-toast tm-toast--${undo.kind}`} role="status">
          <span className="tm-toast-icon"><ShellIcon name={UNDO_COPY[undo.kind].icon} size={14} strokeWidth={2.4} /></span>
          <span className="tm-toast-text">
            <strong>{UNDO_COPY[undo.kind].label}</strong>
            <small>{undo.title}</small>
          </span>
          <button type="button" className="tm-toast-undo" onClick={onUndo}>Deshacer</button>
          <button type="button" className="tm-toast-close" aria-label="Cerrar aviso" onClick={onDismissUndo}>
            <ShellIcon name="close" size={12} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
