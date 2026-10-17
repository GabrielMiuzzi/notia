import type { CSSProperties } from 'react'
import type { TaskItem } from '../../types/taskManagerTypes'
import { FixedMenu } from './FixedMenu'
import { Icon, type IconName } from './icons'
import { assignedNames, formatHourNumber, isBlocked, isRunning, priorityLabel, priorityTone } from './taskDisplay'
import { useTaskActions } from './taskInteractions'
import type { MenuState, MoveTarget } from './taskViewTypes'

interface TaskMenuProps {
  task: TaskItem
  menu: MenuState
  /** Column the task is in, for the header dot and «Mover a». */
  column: MoveTarget | null
  targets: MoveTarget[]
  expanded: boolean
  subtaskHint: string
}

type MenuEntry =
  | { kind: 'separator'; id: string }
  | {
    kind: 'item'
    id: string
    label: string
    icon: IconName
    run: () => void
    tone?: 'teal' | 'teal-icon' | 'coral'
    hint?: string
    hintTone?: string
    arrow?: boolean
  }

/** The ⋯ menu of a task, with the «Mover a» submenu. */
export function TaskMenu({ task, menu, column, targets, expanded, subtaskHint }: TaskMenuProps) {
  const actions = useTaskActions()
  const close = () => actions.closeMenu(true)
  const run = (action: () => void) => () => {
    close()
    action()
  }
  const openPop = (kind: 'people' | 'project' | 'time') => () => {
    actions.closeMenu(false)
    actions.openPop(task, kind)
  }
  const path = task.filePath
  const people = assignedNames(task)
  const entries: MenuEntry[] = []
  const item = (entry: Omit<Extract<MenuEntry, { kind: 'item' }>, 'kind'>) => entries.push({ kind: 'item', ...entry })
  const separator = (id: string) => entries.push({ kind: 'separator', id: `sep-${id}` })

  if (isRunning(task)) {
    item({ id: 'pause', label: 'Pausar', icon: 'pause', run: run(() => void actions.send({ kind: 'pause-task', taskPath: path }, path)) })
    item({ id: 'finish', label: 'Finalizar', icon: 'check', tone: 'teal', run: () => actions.leave(task, 'finish') })
  } else if (isBlocked(task)) {
    item({ id: 'unblock', label: 'Desbloquear', icon: 'play', run: run(() => void actions.send({ kind: 'unblock-task', taskPath: path }, path)) })
  } else {
    item({ id: 'start', label: 'Iniciar', icon: 'play', tone: 'teal-icon', run: run(() => void actions.send({ kind: 'start-task', taskPath: path }, path)) })
    item({ id: 'finish', label: 'Finalizar', icon: 'check', run: () => actions.leave(task, 'finish') })
  }
  separator('state')
  item({
    id: 'rename',
    label: 'Renombrar',
    icon: 'pencil',
    run: () => {
      actions.closeMenu(false)
      actions.startRename(task)
    },
  })
  item({
    id: 'priority',
    label: 'Prioridad',
    icon: 'flag',
    hint: priorityLabel(task.priority),
    hintTone: priorityTone(task.priority),
    arrow: true,
    run: () => actions.showMenuView('prio'),
  })
  item({ id: 'move', label: 'Mover a', icon: 'move', hint: column?.name ?? '', arrow: true, run: () => actions.showMenuView('move') })
  separator('move')
  item({ id: 'people', label: 'Asignar personas', icon: 'people', hint: people.length ? String(people.length) : '', run: openPop('people') })
  item({ id: 'project', label: 'Cambiar proyecto', icon: 'folder', hint: task.project ?? '', run: openPop('project') })
  item({
    id: 'time',
    label: 'Estimar tiempo',
    icon: 'clock',
    hint: task.estimatedHours > 0 ? `${formatHourNumber(task.estimatedHours)} h` : '',
    run: openPop('time'),
  })
  item({
    id: 'subtasks',
    label: expanded ? 'Ocultar subtareas' : 'Subtareas',
    icon: 'checklist',
    hint: subtaskHint,
    run: run(() => actions.toggleExpanded(task)),
  })
  separator('edit')
  item({ id: 'duplicate', label: 'Duplicar', icon: 'copy', run: run(() => void actions.send({ kind: 'duplicate-task', taskPath: path }, path)) })
  separator('duplicate')
  if (isBlocked(task)) {
    item({ id: 'block-note', label: 'Motivo del bloqueo', icon: 'alert', run: () => actions.showMenuView('block-note') })
  }
  item({ id: 'source', label: 'Editar nota', icon: 'note', run: run(() => actions.editSource(task)) })
  item({ id: 'comment', label: 'Agregar comentario', icon: 'commentPlain', run: run(() => actions.comment(task)) })
  separator('notes')
  item({ id: 'cancel', label: 'Desestimar', icon: 'cancel', hint: 'a Canceladas', run: () => actions.leave(task, 'cancel') })
  item({ id: 'delete', label: 'Eliminar', icon: 'trash', tone: 'coral', run: () => actions.leave(task, 'delete') })

  const isMove = menu.view === 'move'
  return (
    <FixedMenu
      anchor={menu.anchor}
      align={menu.align}
      width={264}
      estimatedHeight={isMove ? 60 + targets.length * 36 : 500}
      role="menu"
      ariaLabel={`Opciones de ${task.title}`}
      trigger={menu.trigger}
      focusKey={menu.view}
      onClose={actions.closeMenu}
      onEscape={isMove ? () => actions.showMenuView('menu') : undefined}
      className="tm-task-menu"
    >
      {isMove ? (
        <>
          <button type="button" role="menuitem" className="tm-mi tm-fmenu-back" onClick={() => actions.showMenuView('menu')}>
            <Icon name="chevronLeft" size={12} strokeWidth={2.6} />
            Mover a
          </button>
          {targets.map((target) => {
            const current = target.key === column?.key
            return (
              <button
                key={target.key}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                data-autofocus={current ? true : undefined}
                className={`tm-mi${current ? ' is-selected' : ''}`}
                onClick={() => {
                  close()
                  if (!current) actions.moveTo(task, target.name)
                }}
              >
                <span className="tm-square" style={{ '--tm-dot': target.color } as CSSProperties} />
                <span className="tm-grow tm-ellipsis">{target.name}</span>
                <span className="tm-mi-count">{target.count}</span>
                {current ? <Icon name="check" size={14} strokeWidth={2.6} className="tm-check" /> : null}
              </button>
            )
          })}
        </>
      ) : (
        <>
          <span className="tm-fmenu-head">
            <span
              className={`tm-dot tm-dot--8${column?.color ? '' : ' is-empty'}`}
              style={column?.color ? ({ '--tm-dot': column.color } as CSSProperties) : undefined}
            />
            <span className="tm-ellipsis">{task.title}</span>
          </span>
          {entries.map((entry) => (entry.kind === 'separator' ? (
            <span key={entry.id} className="tm-fmenu-sep" role="separator" />
          ) : (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className={`tm-mi${entry.tone ? ` is-${entry.tone}` : ''}`}
              aria-haspopup={entry.arrow ? 'menu' : undefined}
              onClick={entry.run}
            >
              <Icon name={entry.icon} size={15} className="tm-mi-icon" />
              <span className="tm-grow">{entry.label}</span>
              {entry.hint ? (
                <span className={`tm-mi-hint tm-ellipsis${entry.hintTone ? ` tm-tone-${entry.hintTone}` : ''}`}>{entry.hint}</span>
              ) : null}
              {entry.arrow ? <Icon name="chevronRight" size={12} strokeWidth={2.4} className="tm-mi-arrow" /> : null}
            </button>
          )))}
        </>
      )}
    </FixedMenu>
  )
}
