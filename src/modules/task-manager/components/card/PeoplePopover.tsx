import { useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import type { Board, TaskItem } from '../../types/taskManagerTypes'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { Popover } from './Popover'
import { assignedNames } from './taskDisplay'
import { useTaskActions } from './taskInteractions'

interface PeoplePopoverProps {
  task: TaskItem
  board: Board
  anchorRef: RefObject<HTMLElement | null>
  offset: number
}

/** «Asignar personas»: several people of the board; each tap sends the new list. */
export function PeoplePopover({ task, board, anchorRef, offset }: PeoplePopoverProps) {
  const actions = useTaskActions()
  const [query, setQuery] = useState('')
  // The list sent last: taps in a row build on it, not on the reload.
  const [selected, setSelected] = useState<string[]>(() => assignedNames(task))
  const needle = query.trim().toLowerCase()
  const options = board.members.filter((member) => !needle || member.name.toLowerCase().includes(needle))

  const close = () => {
    actions.closePop()
    anchorRef.current?.focus()
  }

  const toggle = (name: string) => {
    const chosen = new Set(selected)
    if (chosen.has(name)) chosen.delete(name)
    else chosen.add(name)
    const ordered = [
      ...board.members.filter((member) => chosen.has(member.name)).map((member) => member.name),
      ...selected.filter((person) => chosen.has(person) && !board.members.some((member) => member.name === person)),
    ]
    setSelected(ordered)
    void actions.send({ kind: 'set-task-people', taskPath: task.filePath, people: ordered }, task.filePath)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    if (options.length) toggle(options[0].name)
    else close()
  }

  return (
    <Popover
      ariaLabel="Asignar personas"
      anchorRef={anchorRef}
      side="left"
      offset={offset}
      width={252}
      onClose={actions.closePop}
      onKeyDown={handleKeyDown}
    >
      <label className="tm-pop-search">
        <Icon name="search" size={14} />
        <input
          data-autofocus
          aria-label="Buscar persona"
          placeholder="Buscar persona"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {options.map((member) => {
        const on = selected.includes(member.name)
        return (
          <button
            key={member.name}
            type="button"
            className="tm-mi tm-pop-person"
            aria-pressed={on}
            onClick={() => toggle(member.name)}
          >
            <span className={`tm-checkbox tm-checkbox--sm${on ? ' is-on' : ''}`} aria-hidden="true">
              {on ? <Icon name="check" size={11} strokeWidth={3.4} /> : null}
            </span>
            <Avatar initials={member.initials} color={member.color} />
            <span className="tm-ellipsis tm-grow">{member.name}</span>
            {member.isMe ? <span className="tm-pop-me">vos</span> : null}
          </button>
        )
      })}
      {options.length === 0 ? <span className="tm-pop-empty">Nadie coincide con la búsqueda</span> : null}
      <div className="tm-pop-footer">
        <button type="button" className="tm-mi tm-pop-footer-btn" onClick={() => actions.openPeoplePanel('people')}>
          <Icon name="personPlus" size={13} strokeWidth={2.2} />
          Agregar al tablero
        </button>
        <button type="button" className="tm-btn-primary tm-pop-done" onClick={close}>Listo</button>
      </div>
    </Popover>
  )
}
