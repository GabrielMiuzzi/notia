import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TaskItem } from '../../types/taskManagerTypes'
import { FixedMenu } from './FixedMenu'
import { useTaskActions } from './taskInteractions'
import type { MenuState } from './taskViewTypes'

interface BlockNotePopoverProps {
  task: TaskItem
  menu: MenuState
}

/** «Motivo del bloqueo»: the note a blocked task shows in its coral box. */
export function BlockNotePopover({ task, menu }: BlockNotePopoverProps) {
  const actions = useTaskActions()
  const [note, setNote] = useState(task.blockNote ?? '')

  const save = () => {
    actions.closeMenu(true)
    const next = note.trim()
    if (next === (task.blockNote ?? '').trim()) return
    void actions.send({ kind: 'set-block-note', taskPath: task.filePath, note: next }, task.filePath)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      save()
    }
  }

  return (
    <FixedMenu
      anchor={menu.anchor}
      align={menu.align}
      width={280}
      estimatedHeight={220}
      role="dialog"
      ariaLabel="Motivo del bloqueo"
      trigger={menu.trigger}
      focusKey="block-note"
      onClose={actions.closeMenu}
      onKeyDown={handleKeyDown}
      className="tm-block-note"
    >
      <label className="tm-block-note-label">
        <span className="tm-caps">Motivo del bloqueo</span>
        <textarea
          data-autofocus
          className="tm-scroll"
          rows={4}
          value={note}
          placeholder="Qué está esperando la tarea"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="tm-block-note-actions">
        <button type="button" className="tm-ghost-btn" onClick={() => actions.closeMenu(true)}>Cancelar</button>
        <button type="button" className="tm-btn-primary" onClick={save}>Guardar</button>
      </div>
    </FixedMenu>
  )
}
