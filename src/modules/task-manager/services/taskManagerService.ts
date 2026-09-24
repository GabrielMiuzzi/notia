import { callBackend as callTransport } from '../../../services/transport'
import type {
  Board,
  Group,
  PomodoroDurations,
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
}

export const EMPTY_TASK_MANAGER_SNAPSHOT: TaskManagerSnapshot = {
  generation: 0,
  boards: [],
  groups: [],
  tasks: [],
  pomodoroEntries: [],
  panelPaths: {},
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
  }
  | { kind: 'change-state'; taskPath: string; state: TaskState }
  | { kind: 'change-priority'; taskPath: string; priority: TaskPriority }
  | { kind: 'set-dedicated-hours'; taskPath: string; hours: number }
  | { kind: 'mark-urgent'; taskPath: string }
  | { kind: 'delete-task'; taskPath: string }
  | { kind: 'add-comment'; taskPath: string; comment: string }
  | { kind: 'place-task'; taskPath: string; orderedPaths: string[]; group: string; parentTaskName: string }
  | { kind: 'create-board'; name: string; color: string; activityHoursPerDay: number; contexto: string }
  | { kind: 'update-board'; previousName: string; name: string; color: string; activityHoursPerDay: number; contexto: string }
  | { kind: 'delete-board'; name: string }
  | { kind: 'create-group'; board: string; name: string; color: string }
  | { kind: 'update-group'; previousBoard: string; previousName: string; name: string; color: string }
  | { kind: 'delete-group'; board: string; name: string }
  | { kind: 'reorder-groups'; board: string; groupNames: string[] }

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

export interface PomodoroResult {
  state: PomodoroState
  /** The event changed the log or the task hours. */
  changed: boolean
  /** The timer moved but its event could not be logged. */
  recordError?: string
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

export async function executeTaskBoardIntent(
  context: TaskManagerBackendContext,
  intent: TaskBoardIntent,
): Promise<boolean> {
  const result = await callBackend<{ changed: boolean }>('task_manager_board_execute', {
    payload: { context, intent },
  })
  return result.changed
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

export function readTaskMarkdownSource(
  context: TaskManagerBackendContext,
  taskPath: string,
): Promise<{ content: string; revision: string }> {
  return callBackend('task_manager_read_ticket_source', { payload: { context, logicalPath: taskPath } })
}

export async function writeTaskMarkdownSource(
  context: TaskManagerBackendContext,
  taskPath: string,
  content: string,
  expectedRevision: string | undefined,
): Promise<void> {
  if (!expectedRevision) {
    throw new Error('La tarea cambió en otra sesión. Recargá el ticket antes de guardar.')
  }
  await callBackend('task_manager_write_ticket_source', {
    payload: { context, logicalPath: taskPath, content, expectedRevision },
  })
}
