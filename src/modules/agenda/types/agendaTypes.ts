/** Contrato de la Agenda que arma el backend Rust (`agenda_get_view`, `agenda_apply_mutation`). */

export type AgendaPriority = 'urgent' | 'high' | 'medium' | 'low'

/** Inamovible, trasladable, puente turístico o no laborable (incluye los días que solo cierran los bancos). */
export type AgendaHolidayKind = 'fixed' | 'move' | 'bridge' | 'nonwork'

export interface AgendaContext {
  libraryPath: string
  androidDirectoryUri?: string
  actorLibraryUserId: string
}

/** Qué día y qué mes muestra la vista; `null` deja que Rust use hoy. */
export interface AgendaViewRequest {
  selectedDate: string | null
  month: string | null
}

export interface AgendaMonthCell {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  hasEvents: boolean
  holidayName: string
  holidayKind: AgendaHolidayKind | null
  holidayTitle: string
  ariaLabel: string
}

export interface AgendaMonth {
  key: string
  label: string
  prevMonth: string
  nextMonth: string
  weekdays: string[]
  cells: AgendaMonthCell[]
}

export interface AgendaWeekDay {
  date: string
  shortName: string
  day: number
  longLabel: string
  isToday: boolean
  isSelected: boolean
}

export interface AgendaEvent {
  id: string
  date: string
  startMinute: number
  endMinute: number
  title: string
  priority: AgendaPriority
  priorityLabel: string
  timeLabel: string
  whenLabel: string
}

/** Evento de la semana: los superpuestos comparten el ancho en `lanes` carriles. */
export interface AgendaWeekEvent extends AgendaEvent {
  lane: number
  lanes: number
  overlapLabel: string
  tooltip: string
  ariaLabel: string
}

export interface AgendaWeek {
  label: string
  prevDate: string
  nextDate: string
  days: AgendaWeekDay[]
  events: AgendaWeekEvent[]
}

export interface AgendaNextHoliday {
  date: string
  name: string
  kind: AgendaHolidayKind
  countdownLabel: string
  dateLabel: string
  kindLabel: string
}

export interface AgendaHolidays {
  next: AgendaNextHoliday | null
  afterLabel: string
  emptyLabel: string
}

export interface AgendaTimeSlot {
  minute: number
  label: string
  isHour: boolean
}

export interface AgendaPriorityOption {
  key: AgendaPriority
  label: string
}

export interface AgendaNote {
  id: string
  text: string
  done: boolean
}

export interface AgendaView {
  today: string
  todayLabel: string
  summaryLabel: string
  selectedDate: string
  slotMinutes: number
  month: AgendaMonth
  week: AgendaWeek
  timeSlots: AgendaTimeSlot[]
  priorities: AgendaPriorityOption[]
  defaultPriority: AgendaPriority
  upcoming: { events: AgendaEvent[]; total: number; label: string }
  notes: { items: AgendaNote[]; pending: number; pendingLabel: string }
  holidays: AgendaHolidays
}

export interface AgendaSlotInput {
  date: string
  minute: number
}

export type AgendaMutation =
  | { type: 'scheduleEvents'; slots: AgendaSlotInput[]; title: string; priority: AgendaPriority }
  | { type: 'deleteEvent'; id: string }
  | { type: 'addNote'; text: string }
  | { type: 'setNoteDone'; id: string; done: boolean }
  | { type: 'deleteNote'; id: string }

export interface AgendaMutationOutcome {
  changed: boolean
  entityIds: string[]
  summary: string
}

export interface AgendaMutationResponse {
  outcome: AgendaMutationOutcome
  view: AgendaView
}
