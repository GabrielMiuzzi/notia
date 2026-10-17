import { lazy, Suspense, useRef, useState } from 'react'
import { NotiaButton } from '../../../../components/common/NotiaButton'
import { flushPendingEditorChanges } from '../../../../services/markdown/pendingEditorChanges'
import type { TaskItem } from '../../types/taskManagerTypes'
import { TaskManagerModal } from '../common/TaskManagerModal'

// The notes' editor, loaded on demand as the task editor is.
const MarkdownView = lazy(async () => {
  const module = await import('../../../../components/notia/views/MarkdownView')
  return { default: module.MarkdownView }
})

interface TaskCommentDialogProps {
  task: TaskItem | null
  onClose: () => void
  /** Saves the comment (Markdown); resolves once it is saved. */
  onSubmit: (task: TaskItem, comment: string) => Promise<void>
}

const noop = () => undefined
const NO_LINK_TARGETS: never[] = []

/** A comment for a ticket, written in the same Markdown editor as the notes. */
export function TaskCommentDialog({ task, onClose, onSubmit }: TaskCommentDialogProps) {
  const [text, setText] = useState('')
  // The latest text, also the one a flush hands over in the same click.
  const textRef = useRef('')
  const [zoom, setZoom] = useState(1)

  const changeText = (next: string) => {
    textRef.current = next
    setText(next)
  }
  const [isSaving, setIsSaving] = useState(false)

  const close = () => {
    changeText('')
    onClose()
  }

  const submit = async () => {
    flushPendingEditorChanges()
    const comment = textRef.current.trim()
    if (!task || !comment || isSaving) return
    setIsSaving(true)
    try {
      await onSubmit(task, comment)
      changeText('')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <TaskManagerModal open={Boolean(task)} onClose={close} size="md">
      <div className="tareas-dialog-header">
        <h2>Agregar comentario</h2>
      </div>
      <div className="tareas-dialog-body tareas-comment-editor">
        {task ? (
          <Suspense fallback={<p className="tareas-source-dialog-status" role="status">Preparando el editor…</p>}>
            <MarkdownView
              key={task.filePath}
              source=""
              documentPath={task.filePath}
              onSourceChange={changeText}
              wikiLinkTargets={NO_LINK_TARGETS}
              onOpenLinkedFile={noop}
              onSelectionChange={noop}
              externalSourceUpdate={null}
              zoom={zoom}
              onZoomChange={setZoom}
            />
          </Suspense>
        ) : null}
      </div>
      {/* The editor writes its text once typing pauses: pressing a button takes what it still holds. */}
      <div className="tareas-dialog-actions" onPointerDownCapture={flushPendingEditorChanges}>
        <NotiaButton onClick={close} disabled={isSaving}>Cancelar</NotiaButton>
        <NotiaButton variant="primary" onClick={() => void submit()} disabled={!text.trim() || isSaving}>
          {isSaving ? 'Guardando…' : 'Guardar comentario'}
        </NotiaButton>
      </div>
    </TaskManagerModal>
  )
}
