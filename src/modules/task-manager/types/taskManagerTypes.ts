import type { TASK_PRIORITIES, TASK_STATES } from '../constants/taskManagerConstants'
import type {
  TaskBoardCounts,
  TaskBoardMember,
  TaskBoardPlan,
  TaskBoardProject,
  TaskColumnKind,
  TaskPersonChip,
} from './taskBoardTypes'

export interface Board {
  name: string
  color: string
  activityHoursPerDay: number
  contexto?: string
  /** Workday, sprints and divisions (defaults when never saved). */
  plan: TaskBoardPlan
  members: TaskBoardMember[]
  projects: TaskBoardProject[]
  counts: TaskBoardCounts
  /** Color the next person or project of the board gets. */
  nextMemberColor: string
  nextProjectColor: string
}

export interface Group {
  name: string
  color: string
  board?: string
  kind: TaskColumnKind
  /** «Sprint 21 · 12 oct – 25 oct» for sprint and division columns. */
  hint?: string
  /** Open root tasks of the column. */
  taskCount: number
}

export type TaskState = (typeof TASK_STATES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export interface TaskFrontmatter {
  id?: string
  tarea?: string
  detalle?: string
  estado?: string
  fechaInicio?: string
  fechaFin?: string
  fechaFinDinamica?: boolean | string
  tablero?: string
  contexto?: string
  equipo?: string
  prioridad?: string
  dedicado?: number | string
  estimacion?: number | string
  desvio?: number | string
  parent?: string
  childs?: string[] | string
  tags?: string[] | string
  dependencies?: string[] | string
  checklist?: string[] | string
  relatedDocuments?: string[] | string
  relatedTasks?: string[] | string
  order?: number | string
}

export interface TaskItem {
  id?: string
  /** Logical path, the identity of every intent. */
  filePath: string
  /** Path the explorer shows, to open the ticket. */
  path: string
  fileName: string
  title: string
  detail: string
  state: TaskState
  startDate: string
  endDate: string
  dynamicEndDate: boolean
  board: string
  group: string
  priority: TaskPriority | ''
  dedicatedHours: number
  estimatedHours: number
  deviationHours: number
  parentTaskName: string
  order: number
  preview: string
  contexto?: string
  relatedDocuments?: string[]
  relatedTasks?: string[]
  /** Project the ticket belongs to (Remesas, Corresponsalías…). */
  project?: string
  /** People the ticket is assigned to. */
  assignees?: string[]
  /** Board color of the project; null without a project. */
  projectColor?: string | null
  /** Assigned people with their board colors and initials. */
  people?: TaskPersonChip[]
  /** When the running time started (ms since the epoch); null when stopped. */
  startedAtUnixMs?: number | null
  /** Why the task is blocked; empty without a note. */
  blockNote?: string
  /** Logical paths of the tasks this one waits for. */
  dependencies?: string[]
  /** Subtasks of a root task: done and total. */
  subtaskDone?: number
  subtaskTotal?: number
}

export interface TaskFormData {
  title: string
  detail: string
  state: TaskState
  endDate: string
  dynamicEndDate: boolean
  board: string
  group: string
  priority: TaskPriority | ''
  estimatedHours: number
  parentTaskName: string
  contexto?: string
  project: string
  assignees: string[]
}

export type TaskCreationRequest =
  | { kind: 'task'; group?: string }
  | { kind: 'subtask'; parentTaskName: string; group?: string }

export type PomodoroPhase = 'work' | 'short-break' | 'long-break'
export type PomodoroRunState = 'idle' | 'running' | 'paused'

export interface PomodoroDurations {
  workMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  /** Work phases before a long break, 2 to 8. */
  cycles: number
}

export interface PomodoroState {
  phase: PomodoroPhase
  runState: PomodoroRunState
  remainingSeconds: number
  endTimestamp: number | null
  completedWorkCycles: number
  selectedTaskPath: string | null
  isDeviationActive: boolean
  deviationStartedAt: number | null
  deviationBaseRemainingSeconds: number
  phaseDeviationSeconds: number
  durations: PomodoroDurations
}

export interface PomodoroLogEntry {
  id: string
  date: string
  time: string
  type: string
  durationChoice: string
  task: string
  durationMinutes: number
  deviationHours: number
  finalized: boolean
}

export interface TaskManagerSettings {
  activeVaultPath: string | null
  boards: Board[]
  groups: Group[]
  pomodoro: PomodoroState
  activeTab: string
}

export interface TaskManagerVaultRef {
  path: string
  androidTreeUri?: string
  libraryId?: string
  libraryUserId?: string
}

// The local application currently operates as the library owner. Rust still
// validates this identity against the selected library before every mutation.
export const TASK_MANAGER_LOCAL_LIBRARY_USER_ID = 'user-owner'

export interface MarkdownFileDocument {
  path: string
  content: string
}

export interface BoardSummary {
  board: Board
  activeTasks: number
  completedTasks: number
  cancelledTasks: number
}

export interface TaskManagerChatContext {
  scopeKey: string
  filePaths: string[]
}
