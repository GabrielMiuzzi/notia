/**
 * Management screen as the Rust backend builds it
 * (`backend-core/src/task_management_view.rs`). Every date, label, slack and
 * pixel position comes ready: the interface only paints these values.
 */

export type ManagementRangeMode = 'auto' | 'sprints' | 'division'
export type ManagementGroupBy = 'task' | 'person'

/** What the screen asks Rust for (`ManagementRequest`). */
export interface ManagementRequest {
  /** Divisions after (or before) the current one. */
  divisionOffset: number
  rangeMode: ManagementRangeMode
  groupBy: ManagementGroupBy
}

export type ManagementKpiKind = 'range' | 'team-load' | 'most-loaded' | 'finish'
/** Color of a value: primary text, teal, amber or coral. */
export type ManagementTone = 'primary' | 'teal' | 'amber' | 'coral'

export interface ManagementKpi {
  kind: ManagementKpiKind
  label: string
  value: string
  sub: string
  tone: ManagementTone
}

export interface DivisionTab {
  /** «Q1». */
  label: string
  /** «1 oct – 31 dic». */
  tooltip: string
  /** Offset to request to show this division. */
  offset: number
  selected: boolean
  /** Today falls in it. */
  current: boolean
}

export interface DivisionPicker {
  /** «Q4 2026». */
  title: string
  /** «2026» or «2026/27». */
  fiscalYearLabel: string
  tabs: DivisionTab[]
  previousOffset: number
  nextOffset: number
  /** «Hoy» shows only away from the current division. */
  showToday: boolean
}

export interface RangeModeOption {
  mode: ManagementRangeMode
  /** «Auto · Q», «Auto · 3 sprints», «Sprints», «Q completo». */
  label: string
  tooltip: string
  selected: boolean
}

export interface ManagementRange {
  /** «Q4 2026», «Sprints 20–22» or «Sprint 21». */
  title: string
  /** «Gantt · Sprint 21 · Q4 2026». */
  heading: string
  /** «12 oct – 25 oct · ajustado a los sprints con tareas». */
  subtitle: string
  wholeDivision: boolean
  days: number
  modes: RangeModeOption[]
}

export interface GroupByOption {
  groupBy: ManagementGroupBy
  label: string
  selected: boolean
}

export interface GanttMonth {
  x: number
  width: number
  /** «octubre 2026», «noviembre». */
  label: string
}

export type SprintBandKind = 'current' | 'next' | 'other'

export interface GanttSprint {
  x: number
  width: number
  /** «Sprint 21 · actual» when wide enough, otherwise «S21». */
  label: string
  /** «Sprint 21 · 12 oct – 25 oct». */
  tooltip: string
  kind: SprintBandKind
}

export interface GanttTick {
  x: number
  width: number
  /** «lun» or «sem». */
  top: string
  /** «19» or «19 oct». */
  bottom: string
  today: boolean
  weekend: boolean
}

export interface GanttSpan {
  x: number
  width: number
}

export type GanttRowKind = 'task' | 'person'

/** A person as an avatar; `color` is null without a board color or for «Sin asignar». */
export interface PersonChip {
  name: string
  initials: string
  color: string | null
}

export interface GanttSegment {
  x: number
  width: number
  top: number
  height: number
  tooltip: string
}

export interface GanttBar {
  taskPath: string
  letter: string
  x: number
  width: number
  top: number
  height: number
  /** «A · 7 h», or «A · título» by person. */
  label: string
  tooltip: string
  critical: boolean
  blocked: boolean
  /** The task starts before the range. */
  clippedLeft: boolean
  /** The task ends after the range. */
  clippedRight: boolean
  delayMs: number
  /** Waiting for a person, before the bar. */
  wait: GanttSegment | null
  /** Slack, after the bar up to the late finish. */
  slack: GanttSegment | null
}

export interface GanttRow {
  key: string
  kind: GanttRowKind
  height: number
  /** Task rows: letter of the task. */
  letter: string | null
  critical: boolean
  /** Task title, or person name with « (vos)». */
  title: string
  /** «lun 19 oct · 09:00 → mar 20 oct · 15:00» or «2 tareas · 8 h en Q4». */
  sub: string
  /** Task rows: up to three people. */
  avatars: PersonChip[]
  /** Person rows: the person. */
  person: PersonChip | null
  /** Person rows: the «Sin asignar» row. */
  unassigned: boolean
  /** Tasks of the row, for the shared highlight. */
  taskPaths: string[]
  bars: GanttBar[]
}

export interface GanttOutside {
  /** «2 tareas terminaron antes · 3 tareas están planificadas después de Q4.» */
  text: string
  /** «Ver Q1 2027 →» when some task comes later. */
  laterLabel: string | null
  nextOffset: number
}

export interface Gantt {
  /** Width of the timeline in px. */
  width: number
  pxPerDay: number
  /** Ticks per day (otherwise per week). */
  daily: boolean
  /** «Tarea» or «Persona». */
  headLabel: string
  /** «5 tareas» or «3 filas · 5 tareas». */
  countLabel: string
  groupOptions: GroupByOption[]
  months: GanttMonth[]
  sprints: GanttSprint[]
  ticks: GanttTick[]
  weekends: GanttSpan[]
  sprintLines: number[]
  /** The «now» line, when today is in the range. */
  nowX: number | null
  rows: GanttRow[]
  /** «No hay tareas planificadas en Q4 2026.» */
  noRowsLabel: string
  outside: GanttOutside | null
}

export interface CpmEndpoint {
  x: number
  y: number
  /** «Inicio» or «Fin». */
  label: string
  delayMs: number
}

export interface CpmNode {
  taskPath: string
  letter: string
  title: string
  /** «título · GA, DM». */
  tooltip: string
  x: number
  y: number
  level: number
  critical: boolean
  unestimated: boolean
  /** Values in working hours, comma decimals. */
  earlyStart: string
  duration: string
  earlyFinish: string
  lateStart: string
  slack: string
  lateFinish: string
  delayMs: number
}

export type CpmEdgeKind = 'dependency' | 'resource'

export interface CpmEdge {
  key: string
  /** Task path, or null for «Inicio». */
  from: string | null
  /** Task path, or null for «Fin». */
  to: string | null
  kind: CpmEdgeKind
  /** Both ends critical and back to back. */
  critical: boolean
  /** SVG cubic path. */
  d: string
  delayMs: number
}

export interface CpmNetwork {
  width: number
  height: number
  nodeWidth: number
  nodeHeight: number
  endpointSize: number
  start: CpmEndpoint | null
  finish: CpmEndpoint | null
  nodes: CpmNode[]
  edges: CpmEdge[]
}

export interface PredecessorCandidate {
  taskPath: string
  letter: string
  title: string
}

export interface CpmRow {
  taskPath: string
  letter: string
  title: string
  /** Column of the task and its color. */
  group: string
  groupColor: string
  /** «sin estimar (9 h por defecto)». */
  unestimatedNote: string | null
  people: PersonChip[]
  /** «Sin asignar» without people. */
  unassignedLabel: string | null
  /** «4 h». */
  remaining: string
  /** Letters of its planned dependencies. */
  predecessors: string[]
  /** Paths of all its dependencies: what to send back when editing. */
  dependencyPaths: string[]
  /** Candidates (by letter) that would close a cycle. */
  cycleLetters: string[]
  /** «Editar predecesoras de A». */
  editLabel: string
  /** «A empieza después de». */
  popoverTitle: string
  /** «Predecesoras de A». */
  popoverLabel: string
  popoverAbove: boolean
  startLabel: string
  /** «Espera a Gabriel». */
  waitLabel: string | null
  endLabel: string
  lateStartLabel: string
  /** «6 h». */
  slackLabel: string
  critical: boolean
  /** «Crítica» or «Con holgura». */
  routeLabel: string
  delayMs: number
}

export interface CpmTable {
  /** «Fechas calculadas con las horas restantes, la jornada de 9 h…». */
  description: string
  /** «Crearía un ciclo». */
  cycleNote: string
  /** Visible tasks that the popover offers as predecessors, by letter. */
  candidates: PredecessorCandidate[]
  rows: CpmRow[]
}

/** Everything the Management screen renders (`ManagementViewDto`). */
export interface ManagementView {
  /** The board has no active task to plan. */
  empty: boolean
  emptyLabel: string
  /** «9»: hours of the workday. */
  hoursPerDay: string
  divisionOffset: number
  rangeMode: ManagementRangeMode
  groupBy: ManagementGroupBy
  kpis: ManagementKpi[]
  divisions: DivisionPicker
  range: ManagementRange
  gantt: Gantt
  network: CpmNetwork
  table: CpmTable
  /** «B → E → F  ·  C», or «—». */
  criticalPath: string
}
