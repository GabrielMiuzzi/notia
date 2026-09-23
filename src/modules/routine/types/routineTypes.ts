/** Contrato del panel de Rutina que calcula el backend Rust (`routine_get_dashboard`). */

export type RoutineTaskColor = 'urgent' | 'high' | 'medium' | 'low'
export type RoutineAccent = 'slate' | 'medium' | 'high' | 'teal' | 'gold' | 'violet' | 'urgent'

export interface RoutineContext {
  libraryPath: string
  androidDirectoryUri?: string
  actorLibraryUserId: string
  source: 'app'
}

export interface RoutineNav {
  routines: number
  activeTasks: number
  bestStreak: number
  todayDone: number
  todayTotal: number
  todayPct: number | null
  bestDayPct: number | null
  weekPct: number | null
  monthPct: number | null
  wheelAverage: string
}

export interface RoutineSummary {
  id: string
  name: string
  accent: RoutineAccent
  taskCount: number
  deleteBlockedReason: string | null
}

export interface RoutineTask {
  id: string
  routineId: string
  name: string
  category: string
  allDays: boolean
  days: number[]
  daysLabel: string
  notes: string
  paused: boolean
  color: RoutineTaskColor
  streak: number
}

export interface RoutineHeatmapRow {
  taskId: string
  name: string
  color: RoutineTaskColor
  streak: number
  cells: Array<{ day: number; state: 'done' | 'missed' | 'future' | 'notApplicable'; isToday: boolean }>
}

export interface RoutineDayPct {
  day: number
  pct: number
}

export interface RoutineWeekDay {
  date: string
  dayName: string
  dateLabel: string
  isToday: boolean
  isWeekend: boolean
  isEditable: boolean
  done: number
  total: number
  pct: number | null
  tasks: Array<{ taskId: string; routineId: string; name: string; completed: boolean }>
}

export interface RoutineWeek {
  /** `null` en la semana que combina todas las rutinas. */
  routineId: string | null
  pct: number | null
  days: RoutineWeekDay[]
}

export interface RoutineDashboard {
  today: string
  monthLabel: string
  categories: string[]
  nav: RoutineNav
  routines: RoutineSummary[]
  tasks: RoutineTask[]
  heatmap: { daysInMonth: number; rows: RoutineHeatmapRow[] }
  calendar: {
    leadingBlanks: number
    days: Array<{ day: number; isToday: boolean; pct: number | null; level: number | null }>
  }
  evolution: { current: RoutineDayPct[]; previous: RoutineDayPct[]; bestDay: RoutineDayPct | null }
  weekly: {
    weeks: Array<{ label: string; currentPct: number | null; previousPct: number | null; isCurrentWeek: boolean }>
    bestStreak: number
    monthDone: number
    monthTotal: number
    monthPct: number | null
  }
  wheel: {
    axes: Array<{ category: string; current: number; previous: number; goal: number; goalPct: number }>
    average: string
  }
  currentWeek: {
    rangeLabel: string
    all: RoutineWeek
    routines: RoutineWeek[]
  }
}

/** Intención enviada a Rust; el backend valida y decide el resultado. */
export type RoutineMutation =
  | { type: 'saveRoutine'; id: string | null; name: string }
  | { type: 'deleteRoutine'; id: string }
  | {
      type: 'saveTask'
      id: string | null
      routineId: string
      name: string
      category: string
      /** `null` significa todos los días; lunes = 0. */
      days: number[] | null
      notes: string
    }
  | { type: 'setTaskStatus'; id: string; status: 'active' | 'paused' }
  | { type: 'deleteTask'; id: string }
  | { type: 'restoreTask'; id: string }
  | { type: 'reorderTasks'; routineId: string; orderedTaskIds: string[] }
  | { type: 'setCompletion'; taskId: string; date: string; completed: boolean }
  | { type: 'setGoal'; category: string; goal: number }

export interface RoutineMutationResponse {
  outcome: { changed: boolean; entityId: string | null; summary: string }
  dashboard: RoutineDashboard
}
