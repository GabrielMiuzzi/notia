import type { TaskItem } from '../../types/taskManagerTypes'
import { BlockNotePopover } from './BlockNotePopover'
import { PriorityPicker } from './PriorityPicker'
import { TaskMenu } from './TaskMenu'
import { subtaskProgress, type BoardModel } from './taskDisplay'
import type { TaskUiState } from './taskInteractions'
import type { MoveTarget } from './taskViewTypes'

interface TaskMenuLayerProps {
  ui: TaskUiState
  model: BoardModel
  targets: MoveTarget[]
}

const NO_SUBTASKS: TaskItem[] = []

/** The fixed menu of the view, whichever is open: ⋯, Mover a, Prioridad or Motivo del bloqueo. */
export function TaskMenuLayer({ ui, model, targets }: TaskMenuLayerProps) {
  const menu = ui.menu
  const task = menu ? model.taskByPath.get(menu.path) : undefined
  if (!menu || !task) return null
  if (menu.view === 'prio') return <PriorityPicker task={task} menu={menu} />
  if (menu.view === 'block-note') return <BlockNotePopover task={task} menu={menu} />
  const columnKey = model.columnOfTask.get(task.filePath)
  const column = model.columns.find((candidate) => candidate.key === columnKey)
  const subtasks = model.subtasksByParent.get(task.filePath) ?? NO_SUBTASKS
  const { done, total } = subtaskProgress(task, subtasks)
  return (
    <TaskMenu
      task={task}
      menu={menu}
      column={column ? { key: column.key, name: column.name, color: column.color, count: column.count } : null}
      targets={targets}
      expanded={ui.expanded.has(task.filePath)}
      subtaskHint={total ? `${done}/${total}` : ''}
    />
  )
}
