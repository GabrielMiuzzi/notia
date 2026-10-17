import { useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import type { Board, TaskItem } from '../../types/taskManagerTypes'
import { Icon } from './icons'
import { Popover } from './Popover'
import { useTaskActions } from './taskInteractions'

interface ProjectPopoverProps {
  task: TaskItem
  board: Board
  anchorRef: RefObject<HTMLElement | null>
  offset: number
}

interface ProjectOption {
  name: string
  value: string
  color: string | null
}

/** «Elegir proyecto»: the board's projects, «Sin proyecto» and «Crear proyecto “…”». */
export function ProjectPopover({ task, board, anchorRef, offset }: ProjectPopoverProps) {
  const actions = useTaskActions()
  const [query, setQuery] = useState('')
  const typed = query.trim()
  const needle = typed.toLowerCase()
  const current = task.project ?? ''
  const options: ProjectOption[] = [
    { name: 'Sin proyecto', value: '', color: null },
    ...board.projects.map((project) => ({ name: project.name, value: project.name, color: project.color })),
  ].filter((option) => !needle || option.name.toLowerCase().includes(needle))
  const canCreate = Boolean(needle) && !board.projects.some((project) => project.name.toLowerCase() === needle)

  const pick = (value: string) => {
    actions.closePop()
    anchorRef.current?.focus()
    if (value === current) return
    void actions.send({ kind: 'set-task-project', taskPath: task.filePath, project: value }, task.filePath).then((ok) => {
      if (ok) actions.flashTask(task.filePath)
    })
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    if (canCreate) pick(typed)
    else if (options.length) pick(options[0].value)
  }

  return (
    <Popover
      ariaLabel="Elegir proyecto"
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
          aria-label="Buscar o crear proyecto"
          placeholder="Buscar o crear proyecto"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {options.map((option) => {
        const selected = option.value === current
        return (
          <button
            key={option.value || '\u0000none'}
            type="button"
            className={`tm-mi tm-pop-option${selected ? ' is-selected' : ''}${option.value ? '' : ' is-none'}`}
            aria-pressed={selected}
            onClick={() => pick(option.value)}
          >
            <span
              className={`tm-dot${option.color ? '' : ' is-empty'}`}
              style={option.color ? ({ '--tm-dot': option.color } as CSSProperties) : undefined}
            />
            <span className="tm-ellipsis">{option.name}</span>
            {selected ? <Icon name="check" size={14} strokeWidth={2.6} className="tm-check" /> : null}
          </button>
        )
      })}
      {canCreate ? (
        <button type="button" className="tm-mi tm-pop-create" onClick={() => pick(typed)}>
          <Icon name="plus" size={14} strokeWidth={2.4} />
          <span className="tm-ellipsis">Crear proyecto “{typed}”</span>
        </button>
      ) : null}
      <button type="button" className="tm-mi tm-pop-footer-link" onClick={() => actions.openPeoplePanel('projects')}>
        <Icon name="gear" size={13} />
        Administrar proyectos del tablero
      </button>
    </Popover>
  )
}
