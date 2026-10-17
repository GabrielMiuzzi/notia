/**
 * Board calendar, people, projects and planner views as the Rust backend
 * projects them (`backend-core/src/task_board_plan.rs`,
 * `task_planner.rs`, `task_management_view.rs`). The interface renders these
 * values; it never computes dates, slack or work order.
 */

/** Kind of a column for the planner (`TaskColumnKind`). */
export type TaskColumnKind =
  | 'notes'
  | 'current-sprint'
  | 'next-sprint'
  | 'next-division'
  | 'refine'
  | 'review'
  | 'blocked'
  | 'overdue'
  | 'custom'

/** Workday, sprints and divisions of a board (`TaskBoardPlanDto`). */
export interface TaskBoardPlan {
  /** Minutes since midnight, in steps of 30. */
  dayStartMinutes: number
  dayEndMinutes: number
  /** Monday first. */
  workDays: [boolean, boolean, boolean, boolean, boolean, boolean, boolean]
  sprintWeeks: number
  /** 0 is Monday, 4 is Friday. */
  sprintStartWeekday: number
  divisionsPerYear: number
  divisionPrefix: string
  yearStartMonth: number
}

export interface TaskBoardMember {
  name: string
  color: string
  initials: string
  isOwner: boolean
  /** The person looking at the board. */
  isMe: boolean
  taskCount: number
  /** «Vos · Propietario», «Propietario», «Miembro». */
  role: string
}

export interface TaskBoardProject {
  name: string
  color: string
  taskCount: number
}

export interface TaskBoardCounts {
  /** Open root tasks (not finished or cancelled). */
  active: number
  inProgress: number
  pending: number
}

/** A person shown on a task: name, initials and board color. */
export interface TaskPersonChip {
  name: string
  initials: string
  color: string
  isMe: boolean
}

export interface TaskPaletteColor {
  name: string
  color: string
}

/** Column kinds the column dialog offers, with their labels. */
export interface TaskColumnKindOption {
  kind: TaskColumnKind
  label: string
}

// ---------------------------------------------------------------------------
// Edit board preview (`task_manager_board_plan_preview`)
// ---------------------------------------------------------------------------

export interface WorkdayPreset {
  label: string
  startMinutes: number
  endMinutes: number
  workDays?: TaskBoardPlan['workDays']
  active: boolean
}

export interface TaskBoardPlanPreview {
  summary: string
  workday: {
    title: string
    hint: string
    daysTitle: string
    startLabel: string
    endLabel: string
    hoursPerDay: string
    hoursPerWeek: string
    nowFraction: number
    presets: WorkdayPreset[]
  }
  sprints: {
    weeksLabel: string
    yearNote: string
    rows: Array<{
      number: number
      label: string
      range: string
      badgeKind: 'current' | 'next' | 'later' | 'next-year'
      badge: string
    }>
  }
  divisions: {
    unit: string
    yearLabel: string
    todayLabel: string
    sprintLabel: string
    bars: Array<{ label: string; days: number; current: boolean; tooltip: string }>
    sprintTicks: number[]
    todayFraction: number
    months: string[]
    duration: string
    sprintsPerDivision: string
    current: string
  }
}

// ---------------------------------------------------------------------------
// Completadas y Canceladas
// ---------------------------------------------------------------------------

/** One row of the finished or cancelled table, newest first. */
export interface TaskArchiveRow {
  /** Logical path, the identity of every intent. */
  taskPath: string
  /** Path the explorer shows, to open the ticket. */
  path: string
  title: string
  board: string
  /** Column the task came from; empty, «Sin grupo». */
  group: string
  groupColor: string | null
  priority: 'Baja' | 'Media' | 'Alta' | 'Urgente' | 'Atrasado'
  project: string | null
  assignees: string[]
  /** «6 / 16 h»; null when there are no hours. */
  hoursLabel: string | null
  /** «12 oct – 25 oct»; null when there are no dates. */
  period: string | null
}

export interface TaskArchive {
  finished: TaskArchiveRow[]
  cancelled: TaskArchiveRow[]
}
