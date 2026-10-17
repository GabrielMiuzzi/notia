import type { TaskBoardExecuteResult, TaskBoardIntent } from '../../services/taskManagerService'
import type { Board, Group, TaskItem } from '../../types/taskManagerTypes'

/** What the board and the list ask of the shell. */
export interface TaskBoardActions {
  /** Sends an intent; resolves with the backend answer, rejects with an Error whose message the parent already shows. */
  onIntent: (intent: TaskBoardIntent) => Promise<TaskBoardExecuteResult>
  onOpenTask: (task: TaskItem) => void
  onEditSource: (task: TaskItem) => void
  onComment: (task: TaskItem) => void
  onOpenPeoplePanel: (tab: 'people' | 'projects') => void
}

/** Data both views render. */
export interface TaskViewDataProps extends TaskBoardActions {
  board: Board
  /** Columns of this board in order. */
  groups: Group[]
  /** Open tasks of this board already filtered by the shell (roots and subtasks). */
  tasks: TaskItem[]
  /** Every open task of the board, unfiltered, for subtask counts and the Mover a counts. */
  allTasks: TaskItem[]
  searchActive: boolean
  showDescriptions: boolean
  collapsed: Record<string, boolean | undefined>
  onToggleCollapsed: (groupName: string, collapsed: boolean) => void
  flashTaskId: string | null
  canEdit: boolean
  /** «+» and «Agregar tarea»: the shell creates «Nueva tarea» (Media) and flashes it. */
  onCreateTask: (groupName: string) => void
}

export type PopKind = 'project' | 'people' | 'time'
export type MenuView = 'menu' | 'move' | 'prio' | 'block-note'
export type LeaveKind = 'finish' | 'cancel' | 'delete'

/** Where a fixed menu hangs from, in viewport coordinates. */
export interface MenuAnchor {
  top: number
  bottom: number
  left: number
  right: number
}

export interface MenuState {
  path: string
  view: MenuView
  anchor: MenuAnchor
  /** `end` aligns the menu's right edge with the trigger (kebab); `start` its left edge (chip). */
  align: 'start' | 'end'
  trigger: HTMLElement | null
}

/** A column a task can be moved to, for «Mover a». */
export interface MoveTarget {
  key: string
  name: string
  color: string
  count: number
}
