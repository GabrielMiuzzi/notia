/** Contrato del panel de Acciones IA: los DTO que arma Rust (`ai_actions`). */

export type AiActionKind = 'reminder' | 'one-shot' | 'recurring'
export type RepeatUnit = 'minutes' | 'hours' | 'days' | 'weeks'
export type DashboardFilter = 'all' | AiActionKind
export type StatusTone = 'done' | 'next' | 'pending' | 'scheduled' | 'failed' | 'paused' | 'running' | 'skipped'

export interface AiActionsContext {
  libraryId: string
  libraryPath: string
  androidDirectoryUri: string | null
  actorLibraryUserId: string
}

export interface StatusChip {
  tone: StatusTone
  label: string
}

export interface ActionCard {
  id: string
  name: string
  prompt: string
  kind: AiActionKind
  enabled: boolean
  when: string
  nextLabel: string | null
  runsLabel: string | null
  status: StatusChip
  retryRunId: string | null
}

export interface ActionColumn {
  kind: AiActionKind
  title: string
  subtitle: string
  cards: ActionCard[]
}

export interface TimelineItem {
  time: string
  actionId: string
  name: string
  kind: AiActionKind
  kindLabel: string
  tone: StatusTone
  note: string | null
}

export type TimelineEntry = { type: 'now'; time: string } | { type: 'item'; item: TimelineItem }

export interface NextRun {
  actionId: string
  time: string
  inLabel: string
  name: string
  kindLabel: string
}

export interface Metrics {
  doneToday: number
  failedToday: number
  pendingToday: number
  pendingUntil: string | null
  recurringActive: number
  recurringTotal: number
  recurringPaused: number
  next: NextRun | null
}

export interface KindCounts {
  all: number
  reminder: number
  oneShot: number
  recurring: number
}

export interface DayProgress {
  done: number
  total: number
  percent: number
}

export interface AiActionsDashboard {
  titleDate: string
  shortDate: string
  nowTime: string
  filter: DashboardFilter
  metrics: Metrics
  counts: KindCounts
  columns: ActionColumn[]
  timeline: TimelineEntry[]
  progress: DayProgress
}

/** El formulario tal como se escribe; Rust valida cada campo. */
export interface AiActionInput {
  kind: AiActionKind | null
  name: string
  prompt: string
  date: string | null
  time: string | null
  every: string | null
  unit: RepeatUnit | null
  weekdays: number[]
  from: string | null
  to: string | null
}

export interface FieldError {
  field: string
  message: string
}

export interface ActionPreview {
  errors: FieldError[]
  summary: string
  when: string | null
  upcoming: string[]
}

export interface ActionForm {
  input: AiActionInput
  builtin: boolean
}

export interface RunRow {
  id: string
  when: string
  trigger: string
  status: StatusChip
  note: string | null
}

export interface AiActionsError {
  code: 'validation' | 'not-found' | 'forbidden' | 'unavailable' | 'storage'
  message: string
  fields: FieldError[]
}
