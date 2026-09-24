import { lazy, Suspense, useRef, useState } from 'react'
import { NotiaButton } from '../../../../components/common/NotiaButton'
import { useWikiLinkTargets } from '../../../../components/notia/hooks/useWikiLinkTargets'
import type { LibraryContext } from '../../../../services/contexts/libraryContexts'
import type { NotiaFileNode } from '../../../../types/notia'
import type { TaskItem } from '../../types/taskManagerTypes'
import { TaskManagerModal } from '../common/TaskManagerModal'

// The same editor as the notes, loaded on demand: the published Task Manager
// page only downloads Milkdown when someone opens a task.
const MarkdownView = lazy(async () => {
  const module = await import('../../../../components/notia/views/MarkdownView')
  return { default: module.MarkdownView }
})

/** The dialog loads the link targets once; there is no tree to watch. */
const NO_TREE: NotiaFileNode[] = []
const DEFAULT_ZOOM = 1
const noop = () => {}

export interface TaskSourceDialogState {
  task: TaskItem
  /** Markdown as it was read, to know whether there are unsaved changes. */
  originalSource: string
  source: string
  isLoading: boolean
  isSaving: boolean
  loadError: string | null
}

interface TaskSourceDialogProps {
  state: TaskSourceDialogState
  libraryId?: string
  contexts?: readonly LibraryContext[]
  onSourceChange: (source: string) => void
  onSave: () => void
  onClose: () => void
  onOpenLinkedFile?: (path: string) => void
}

export function TaskSourceDialog({ state, libraryId, contexts, onSourceChange, onSave, onClose, onOpenLinkedFile }: TaskSourceDialogProps) {
  const wikiLinkTargets = useWikiLinkTargets(libraryId, NO_TREE)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [notice, setNotice] = useState<string | null>(null)
  // Milkdown rewrites the Markdown in its own style when it opens (list
  // markers, spacing, frontmatter). That first rewrite is the starting point:
  // only changes after the person touches the editor count as unsaved.
  const [baseline, setBaseline] = useState(state.originalSource)
  const hasInteractedRef = useRef(false)
  const markInteracted = () => { hasInteractedRef.current = true }
  const isDirty = state.source !== baseline
  const canEdit = !state.isLoading && state.loadError === null

  // Opening a link leaves the Task Manager, which would drop unsaved edits.
  const openLinkedFile = (path: string) => {
    if (!onOpenLinkedFile) return
    if (isDirty) {
      setNotice('Guardá o descartá los cambios antes de abrir un enlace.')
      return
    }
    onClose()
    onOpenLinkedFile(path)
  }

  return (
    <TaskManagerModal open onClose={onClose} size="xl" fill panelClassName="tareas-source-dialog">
      <div className="tareas-dialog-header">
        <h2>{state.task.title || state.task.fileName}</h2>
      </div>
      <div
        className="tareas-source-dialog-body"
        onKeyDownCapture={markInteracted}
        onPointerDownCapture={markInteracted}
        onPasteCapture={markInteracted}
        onDropCapture={markInteracted}
      >
        {state.isLoading ? (
          <p className="tareas-source-dialog-status" role="status">Cargando la tarea…</p>
        ) : state.loadError !== null ? (
          <p className="tareas-source-dialog-status tareas-source-dialog-status--error" role="alert">{state.loadError}</p>
        ) : (
          <Suspense fallback={<p className="tareas-source-dialog-status" role="status">Preparando el editor…</p>}>
            <MarkdownView
              source={state.source}
              documentPath={state.task.filePath}
              libraryId={libraryId}
              lockedContextTag={state.task.contexto || undefined}
              contexts={contexts}
              onSourceChange={(source) => {
                if (!hasInteractedRef.current) setBaseline(source)
                setNotice(null)
                onSourceChange(source)
              }}
              wikiLinkTargets={wikiLinkTargets}
              onOpenLinkedFile={openLinkedFile}
              onSelectionChange={noop}
              externalSourceUpdate={null}
              zoom={zoom}
              onZoomChange={setZoom}
            />
          </Suspense>
        )}
      </div>
      {notice ? <p className="tareas-source-dialog-notice" role="status">{notice}</p> : null}
      <div className="tareas-dialog-actions">
        <NotiaButton onClick={onClose}>Cancelar</NotiaButton>
        <NotiaButton variant="primary" onClick={onSave} disabled={!canEdit || state.isSaving || !isDirty}>
          {state.isSaving ? 'Guardando…' : 'Guardar'}
        </NotiaButton>
      </div>
    </TaskManagerModal>
  )
}
