import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TaskItem, TaskPriority } from '../../types/taskManagerTypes'
import { FixedMenu } from './FixedMenu'
import { Icon } from './icons'
import { PRIORITY_OPTIONS } from './taskDisplay'
import { useTaskActions } from './taskInteractions'
import type { MenuState } from './taskViewTypes'

interface PriorityPickerProps {
  task: TaskItem
  menu: MenuState
}

/** The four priorities with their description; keys 1–4 pick one. */
export function PriorityPicker({ task, menu }: PriorityPickerProps) {
  const actions = useTaskActions()

  const pick = (priority: TaskPriority) => {
    actions.closeMenu(true)
    if (priority === task.priority) return
    void actions.send({ kind: 'change-priority', taskPath: task.filePath, priority }, task.filePath)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const option = PRIORITY_OPTIONS.find((candidate) => candidate.key === event.key)
    if (!option) return
    event.preventDefault()
    pick(option.name)
  }

  const hasCurrent = PRIORITY_OPTIONS.some((option) => option.name === task.priority)
  return (
    <FixedMenu
      anchor={menu.anchor}
      align={menu.align}
      width={260}
      estimatedHeight={240}
      role="menu"
      ariaLabel={`Prioridad de ${task.title}`}
      trigger={menu.trigger}
      focusKey="prio"
      onClose={actions.closeMenu}
      onKeyDown={handleKeyDown}
      className="tm-prio-menu"
    >
      <span className="tm-caps tm-fmenu-caption">Prioridad</span>
      {PRIORITY_OPTIONS.map((option, index) => {
        const current = option.name === task.priority
        return (
          <button
            key={option.name}
            type="button"
            role="menuitemradio"
            aria-checked={current}
            data-autofocus={current || (!hasCurrent && index === 0) ? true : undefined}
            className={`tm-mi tm-prio-option${current ? ' is-selected' : ''}`}
            onClick={() => pick(option.name)}
          >
            <span className="tm-prio-chip tm-prio-chip--picker" data-tone={option.tone}>
              <span className="tm-prio-dot" />
              {option.name}
            </span>
            <span className="tm-grow tm-ellipsis tm-prio-desc">{option.description}</span>
            {current ? <Icon name="check" size={14} strokeWidth={2.6} className="tm-check" /> : null}
            <kbd className="tm-key">{option.key}</kbd>
          </button>
        )
      })}
    </FixedMenu>
  )
}
