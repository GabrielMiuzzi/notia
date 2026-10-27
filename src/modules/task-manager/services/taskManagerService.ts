import { callBackend as callTransport } from '../../../services/transport'
import type {
  TaskArchive,
  TaskBoardPlan,
  TaskBoardPlanPreview,
  TaskColumnKind,
  TaskColumnKindOption,
  TaskPaletteColor,
} from '../types/taskBoardTypes'
import type { ManagementRequest, ManagementView } from '../types/managementTypes'
import type {
  Board,
  Group,
  PomodoroDurations,
  PomodoroPhase,
  PomodoroLogEntry,
  PomodoroState,
  TaskItem,
  TaskPriority,
  TaskState,
} from '../types/taskManagerTypes'

/**
 * Task Manager client. The Rust backend resolves every intent, applies the
 * board rules, writes the workspace and announces the change; this module
 * only carries intents and views across the command boundary.
 */

export interface TaskManagerBackendContext {
  libraryId: string
  libraryUserId: string
}

/** Board view rendered by the interface, as projected by the backend. */
export interface TaskManagerSnapshot {
  generation: number
  boards: Board[]
  groups: Group[]
  tasks: TaskItem[]
  pomodoroEntries: PomodoroLogEntry[]
  /** Ticket paths of each panel (board name, finished or cancelled). */
  panelPaths: Record<string, string[]>
  /** Rows of Completadas and Canceladas, newest first. */
  archive: TaskArchive
  finishedCount: number
  cancelledCount: number
  /** Colors boards, people and projects can take. */
  palette: TaskPaletteColor[]
  columnKinds: TaskColumnKindOption[]
}

export const EMPTY_TASK_MANAGER_SNAPSHOT: TaskManagerSnapshot = {
  generation: 0,
  boards: [],
  groups: [],
  tasks: [],
  pomodoroEntries: [],
  panelPaths: {},
  archive: { finished: [], cancelled: [] },
  finishedCount: 0,
  cancelledCount: 0,
  palette: [],
  columnKinds: [],
}

export type TaskBoardIntent =
  | {
    kind: 'create-task'
    board: string
    title: string
    detail: string
    group: string
    priority: TaskPriority | null
    state: TaskState
    parentTaskName: string
    endDate: string
    dynamicEndDate: boolean
    estimatedHours: number
    project: string
    assignees: string[]
  }
  | {
    kind: 'edit-task'
    taskPath: string
    title: string
    detail: string
    state: TaskState
    priority: TaskPriority | null
    group: string
    endDate: string
    dynamicEndDate: boolean
    estimatedHours: number
    parentTaskName: string
    project: string
    assignees: string[]
  }
  | { kind: 'change-state'; taskPath: string; state: TaskState }
  | { kind: 'change-priority'; taskPath: string; priority: TaskPriority }
  | { kind: 'set-dedicated-hours'; taskPath: string; hours: number }
  | { kind: 'mark-urgent'; taskPath: string }
  | { kind: 'delete-task'; taskPath: string }
  | { kind: 'add-comment'; taskPath: string; comment: string }
  | { kind: 'place-task'; taskPath: string; orderedPaths: string[]; group: string; parentTaskName: string }
  | { kind: 'create-board'; name: string; color: string; activityHoursPerDay: number; contexto: string; plan?: TaskBoardPlan }
  | { kind: 'update-board'; previousName: string; name: string; color: string; activityHoursPerDay: number; contexto: string; plan?: TaskBoardPlan }
  | { kind: 'delete-board'; name: string }
  | { kind: 'create-group'; board: string; name: string; color: string; columnKind?: TaskColumnKind }
  | { kind: 'update-group'; previousBoard: string; previousName: string; name: string; color: string; columnKind?: TaskColumnKind }
  | { kind: 'delete-group'; board: string; name: string }
  | { kind: 'reorder-groups'; board: string; groupNames: string[] }
  // Card actions. Finish, cancel and delete answer with an undo token.
  | { kind: 'start-task'; taskPath: string }
  | { kind: 'pause-task'; taskPath: string }
  | { kind: 'finish-task'; taskPath: string }
  | { kind: 'cancel-task'; taskPath: string }
  | { kind: 'unblock-task'; taskPath: string }
  | { kind: 'rename-task'; taskPath: string; title: string }
  /** Appends the task to the end of a column (Bloqueado blocks it). */
  | { kind: 'move-task'; taskPath: string; group: string }
  | { kind: 'duplicate-task'; taskPath: string }
  /** An empty project takes it out; an unknown one is created in the board. */
  | { kind: 'set-task-project'; taskPath: string; project: string }
  | { kind: 'set-task-people'; taskPath: string; people: string[] }
  /** Hours in steps the time popover offers; a running task keeps running. */
  | { kind: 'set-task-time'; taskPath: string; estimatedHours?: number; dedicatedHours?: number }
  | { kind: 'set-block-note'; taskPath: string; note: string }
  | { kind: 'add-subtask'; taskPath: string; title: string }
  | { kind: 'toggle-subtask'; taskPath: string }
  /** Tasks this one waits for; a cycle is rejected. */
  | { kind: 'set-dependencies'; taskPath: string; dependencyPaths: string[] }
  | { kind: 'restore-tasks'; taskPaths: string[] }
  | { kind: 'delete-tasks'; taskPaths: string[] }
  | { kind: 'undo'; token: string }
  // People and projects of a board.
  | { kind: 'add-board-member'; board: string; name: string }
  | { kind: 'remove-board-member'; board: string; name: string }
  | { kind: 'add-board-project'; board: string; name: string; color: string }
  | { kind: 'remove-board-project'; board: string; name: string }
  | { kind: 'move-group'; board: string; name: string; direction: 'left' | 'right' }

/** What the person or the countdown asks of the Pomodoro timer. */
export type PomodoroAction =
  | { kind: 'read' }
  | { kind: 'start' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'reset' }
  | { kind: 'select-task'; taskPath: string | null }
  | { kind: 'set-durations'; durations: PomodoroDurations }
  | { kind: 'enter-deviation' }
  | { kind: 'exit-deviation' }
  | { kind: 'tick' }
  /** Ends the current phase now and moves to the next one, stopped. */
  | { kind: 'skip' }
  /** Picks a mode: the timer stops and starts that mode from the top. */
  | { kind: 'select-phase'; phase: PomodoroPhase }

/** A preset of durations the Pomodoro offers. */
export interface PomodoroPreset {
  name: string
  /** «Estándar · 25/5». */
  label: string
  description: string
  durations: PomodoroDurations
  active: boolean
}

/** Pomodoros of the device's day, for «Registros del día». */
export interface PomodoroToday {
  count: number
  focusMinutes: number
  /** Finished work phases per hour, 24 values. */
  byHour: number[]
  currentHour: number
}

export interface PomodoroResult {
  state: PomodoroState
  /** The event changed the log or the task hours. */
  changed: boolean
  /** The timer moved but its event could not be logged. */
  recordError?: string
  presets: PomodoroPreset[]
  /** Null on a published board, which does not read the log. */
  today: PomodoroToday | null
}

/** The backend rejects with its error object; surface its message. */
async function callBackend<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await callTransport<T>(command, args)
  } catch (error) {
    if (error instanceof Error) throw error
    const message = error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : typeof error === 'string' && error.trim()
        ? error
        : 'No se pudo completar la operación de Task Manager.'
    throw new Error(message)
  }
}

export function readTaskBoardView(context: TaskManagerBackendContext): Promise<TaskManagerSnapshot> {
  return callBackend<TaskManagerSnapshot>('task_manager_board_view', { payload: context })
}

/** What the backend answers to an intent. */
export interface TaskBoardExecuteResult {
  changed: boolean
  /** Finish, cancel and delete can be undone for 5 seconds with this token. */
  undo?: { token: string; kind: 'finish' | 'cancel' | 'delete'; title: string } | null
  /** Ticket id of a task the intent created, to highlight it. */
  focusTaskId?: string | null
}

export async function executeTaskBoardIntent(
  context: TaskManagerBackendContext,
  intent: TaskBoardIntent,
): Promise<TaskBoardExecuteResult> {
  return callBackend<TaskBoardExecuteResult>('task_manager_board_execute', {
    payload: { context, intent },
  })
}

/** Device date and time as `YYYY-MM-DDTHH:MM`, the «now» of the calendar. */
export function localNow(at: Date = new Date()): string {
  const { localDate, localTime } = localDateTime(at)
  return `${localDate}T${localTime}`
}

/** Management plan of a board: dates, slack, Gantt, network and table. */
export function readManagementView(
  context: TaskManagerBackendContext,
  board: string,
  request: ManagementRequest,
): Promise<ManagementView> {
  return callBackend<ManagementView>('task_manager_management_view', {
    payload: { context, board, request, localNow: localNow() },
  })
}

/** Preview of the settings «Editar tablero» is editing. */
export function readBoardPlanPreview(
  context: TaskManagerBackendContext,
  request: { boardName: string; contexto: string; plan: TaskBoardPlan },
): Promise<TaskBoardPlanPreview> {
  return callBackend<TaskBoardPlanPreview>('task_manager_board_plan_preview', {
    payload: { context, ...request, localNow: localNow() },
  })
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

/** The log is read in the device's own time zone. */
function localDateTime(at: Date): { localDate: string; localTime: string } {
  return {
    localDate: `${at.getFullYear()}-${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())}`,
    localTime: `${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`,
  }
}

/**
 * Runs an action of the user's timer. The backend keeps the timer, advances
 * its phases and logs each event with the device's local date and time.
 */
export function runPomodoroAction(
  context: TaskManagerBackendContext,
  action: PomodoroAction,
  legacyState?: unknown,
): Promise<PomodoroResult> {
  return callBackend<PomodoroResult>('task_manager_pomodoro', {
    payload: { context, ...localDateTime(new Date()), action, legacyState: legacyState ?? undefined },
  })
}

export function deletePomodoroEntry(context: TaskManagerBackendContext, entryId: string): Promise<boolean> {
  return callBackend<boolean>('task_manager_delete_pomodoro', { payload: { context, entryId } })
}

/** A comment of a ticket, as the phone's «Detalle de tarea» shows it. */
export interface TaskDetailComment {
  commentId: string
  author: string
  initials: string
  /** The author's board color; null for people outside the board. */
  color: string | null
  /** «ahora», «hace 5 min», «ayer 09:10», «12 oct». */
  when: string
  text: string
}

export interface TaskDetail {
  description: string
  comments: TaskDetailComment[]
}

/** Description and comments of a ticket (`task_detail_view` in Rust). */
export function readTaskDetail(context: TaskManagerBackendContext, taskPath: string): Promise<TaskDetail> {
  return callBackend<TaskDetail>('task_manager_task_detail', { payload: { context, logicalPath: taskPath } })
}

export function readTaskMarkdownSource(
  context: TaskManagerBackendContext,
  taskPath: string,
): Promise<{ content: string; revision: string }> {
  return callBackend('task_manager_read_ticket_source', { payload: { context, logicalPath: taskPath } })
}

/** Saves a ticket's Markdown; resolves with its new revision when the reply carries it. */
export async function writeTaskMarkdownSource(
  context: TaskManagerBackendContext,
  taskPath: string,
  content: string,
  expectedRevision: string | undefined,
): Promise<string | null> {
  if (!expectedRevision) {
    throw new Error('La tarea cambió en otra sesión. Recargá el ticket antes de guardar.')
  }
  const result = await callBackend<unknown>('task_manager_write_ticket_source', {
    payload: { context, logicalPath: taskPath, content, expectedRevision },
  })
  const revision = result && typeof result === 'object' && 'revision' in result ? result.revision : null
  return typeof revision === 'string' ? revision : null
}
