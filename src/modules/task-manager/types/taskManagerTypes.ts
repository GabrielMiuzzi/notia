import type { TASK_PRIORITIES, TASK_STATES } from '../constants/taskManagerConstants'

export interface Board {
  name: string
  color: string
  activityHoursPerDay: number
}

export interface Group {
  name: string
  color: string
  board?: string
}

export type TaskState = (typeof TASK_STATES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export interface TaskFrontmatter {
  tarea?: string
  detalle?: string
  estado?: string
  fechaInicio?: string
  fechaFin?: string
  fechaFinDinamica?: boolean | string
  tablero?: string
  equipo?: string
  prioridad?: string
  dedicado?: number | string
  estimacion?: number | string
  desvio?: number | string
  parent?: string
  childs?: string[] | string
  tags?: string[] | string
  order?: number | string
}

export interface TaskItem {
  filePath: string
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
}

export type PomodoroPhase = 'work' | 'short-break' | 'long-break'
export type PomodoroRunState = 'idle' | 'running' | 'paused'

export interface PomodoroDurations {
  workMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
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
