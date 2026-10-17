import type { Group, TaskItem, TaskPriority } from '../../types/taskManagerTypes'

/*
 * What the board and the list show of the tasks the backend projects:
 * grouping into columns, the running clock and the labels of the time ring.
 * Presentation only; Rust decides every result.
 */

export const UNGROUPED_NAME = 'Sin grupo'
/** Column key of «Sin grupo»; no configured column can be called like this. */
export const UNGROUPED_KEY = '\u0000sin-grupo'
/** The card leaves (finish, cancel, delete) in this time before the intent goes. */
export const LEAVE_MS = 320
export const FLASH_MS = 1000
/** Length of the r=11 ring of the time circle. */
export const RING_CIRCUMFERENCE = 69.12
const HOUR_MS = 3_600_000

export type PriorityTone = 'overdue' | 'urgent' | 'high' | 'medium' | 'low' | 'none'

export interface PriorityOption {
  name: TaskPriority
  description: string
  key: string
  tone: PriorityTone
}

/** In the order of the picker; keys 1–5. */
export const PRIORITY_OPTIONS: readonly PriorityOption[] = [
  { name: 'Atrasado', description: 'Ya se pasó de su fecha', key: '1', tone: 'overdue' },
  { name: 'Urgente', description: 'Requiere atención inmediata', key: '2', tone: 'urgent' },
  { name: 'Alta', description: 'Va primero en la fila', key: '3', tone: 'high' },
  { name: 'Media', description: 'Ritmo normal', key: '4', tone: 'medium' },
  { name: 'Baja', description: 'Cuando haya tiempo', key: '5', tone: 'low' },
]

export function priorityTone(priority: TaskPriority | ''): PriorityTone {
  return PRIORITY_OPTIONS.find((option) => option.name === priority)?.tone ?? 'none'
}

export function priorityLabel(priority: TaskPriority | ''): string {
  return priority || 'Sin prioridad'
}

export function isRunning(task: TaskItem): boolean {
  return task.state === 'En progreso'
}

export function isBlocked(task: TaskItem): boolean {
  return task.state === 'Bloqueada'
}

export function isPending(task: TaskItem): boolean {
  return task.state === 'Pendiente'
}

/** Dedicated hours with the running time folded in. */
export function liveDedicatedHours(task: TaskItem, nowMs: number): number {
  const base = task.dedicatedHours > 0 ? task.dedicatedHours : 0
  if (!isRunning(task) || !task.startedAtUnixMs) return base
  return base + Math.max(0, nowMs - task.startedAtUnixMs) / HOUR_MS
}

/** «6», «1,5»: one decimal, comma. */
export function formatHourNumber(hours: number): string {
  return (Math.round(hours * 10) / 10).toString().replace('.', ',')
}

export function formatHours(hours: number): string {
  return `${formatHourNumber(hours)} h`
}

/** «m:ss» since the task started running; empty when it is not running. */
export function formatElapsed(task: TaskItem, nowMs: number): string {
  if (!isRunning(task) || !task.startedAtUnixMs) return ''
  const seconds = Math.max(0, Math.floor((nowMs - task.startedAtUnixMs) / 1000))
  const rest = seconds % 60
  return `${Math.floor(seconds / 60)}:${rest < 10 ? '0' : ''}${rest}`
}

/** A step of the time popover: never below zero, two decimals. */
export function stepHours(value: number, delta: number): number {
  return Math.max(0, Math.round((value + delta) * 100) / 100)
}

export interface TimeSummary {
  spent: number
  estimate: number
  hasEstimate: boolean
  over: boolean
  /** Spent over estimate, 0 without an estimate. */
  ratio: number
  /** Ring offset of the fill circle. */
  ringOffset: number
  ringVisible: boolean
  percentText: string
  longLabel: string
  spentLabel: string
  estimateLabel: string
  spentShort: string
  estimateShort: string
  barPercent: number
  aria: string
}

export function summarizeTime(spent: number, estimateHours: number): TimeSummary {
  const estimate = estimateHours > 0 ? estimateHours : 0
  const hasEstimate = estimate > 0
  const ratio = hasEstimate ? spent / estimate : 0
  const over = hasEstimate && spent > estimate + 0.0001
  const percent = Math.round(ratio * 100)
  return {
    spent,
    estimate,
    hasEstimate,
    over,
    ratio,
    ringOffset: hasEstimate ? RING_CIRCUMFERENCE * (1 - Math.min(1, ratio)) : RING_CIRCUMFERENCE,
    ringVisible: hasEstimate && spent > 0,
    percentText: hasEstimate ? String(percent) : '–',
    longLabel: hasEstimate ? (over ? `+${formatHours(spent - estimate)} excedido` : `${percent}% del estimado`) : 'Sin estimar',
    spentLabel: formatHours(spent),
    estimateLabel: hasEstimate ? formatHours(estimate) : 'sin estimar',
    spentShort: formatHourNumber(spent),
    estimateShort: hasEstimate ? `${formatHourNumber(estimate)} h` : '—',
    barPercent: Math.min(100, ratio * 100),
    aria: hasEstimate
      ? `Tiempo: ${formatHours(spent)} dedicadas de ${formatHours(estimate)} estimadas. Editar`
      : `Sin estimación (${formatHours(spent)} dedicadas). Estimar`,
  }
}

/** The Markdown excerpt of a ticket as plain text for a 2-line clamp. */
export function plainTextPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ')
    .replace(/^\s{0,3}(?:#{1,6}|>+|[-*+](?:\s+\[[ xX]\])?|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** People assigned to a task, by name. */
export function assignedNames(task: TaskItem): string[] {
  if (task.people?.length) return task.people.map((person) => person.name)
  return task.assignees ?? []
}

export interface BoardColumnModel {
  /** Collapsed state, drop target and React key. */
  key: string
  name: string
  /** Group a drop sends: '' for «Sin grupo». */
  groupName: string
  /** Null for «Sin grupo». */
  group: Group | null
  color: string
  count: number
  /** Root tasks shown, in board order. */
  tasks: TaskItem[]
  /** Every open root task of the column, unfiltered, in board order. */
  allRoots: TaskItem[]
}

/** A drop sent to the backend, shown in place until it answers. */
export interface PendingPlacement {
  taskPath: string
  column: string
  orderedPaths: string[]
}

export interface BoardModel {
  columns: BoardColumnModel[]
  subtasksByParent: ReadonlyMap<string, TaskItem[]>
  taskByPath: ReadonlyMap<string, TaskItem>
  /** Column key of each root task. */
  columnOfTask: ReadonlyMap<string, string>
}

function isRoot(task: TaskItem): boolean {
  return !task.parentTaskName.trim()
}

function isOpen(task: TaskItem): boolean {
  return task.state !== 'Finalizada' && task.state !== 'Cancelada'
}

function byOrder(left: TaskItem, right: TaskItem): number {
  return left.order - right.order
}

function bucketRoots(tasks: TaskItem[], columnKeyOf: (task: TaskItem) => string): Map<string, TaskItem[]> {
  const buckets = new Map<string, TaskItem[]>()
  for (const task of tasks) {
    if (!isRoot(task) || !isOpen(task)) continue
    const key = columnKeyOf(task)
    const list = buckets.get(key)
    if (list) list.push(task)
    else buckets.set(key, [task])
  }
  for (const list of buckets.values()) list.sort(byOrder)
  return buckets
}

/** Shows a drop in its destination column, in the order sent. */
function placePending(buckets: Map<string, TaskItem[]>, pending: PendingPlacement): void {
  let moved: TaskItem | undefined
  for (const [key, list] of buckets) {
    const kept = list.filter((task) => {
      if (task.filePath !== pending.taskPath) return true
      moved = task
      return false
    })
    buckets.set(key, kept)
  }
  // Only what this list already shows: a hidden task stays hidden.
  const present = new Map((buckets.get(pending.column) ?? []).map((task) => [task.filePath, task]))
  if (moved) present.set(moved.filePath, moved)
  buckets.set(pending.column, pending.orderedPaths.flatMap((path) => present.get(path) ?? []))
}

/**
 * Columns of the board with their root tasks; subtasks go under their parent.
 * Tasks whose group is not a column go to «Sin grupo», first, only when there are any.
 */
export function buildBoardModel(
  groups: Group[],
  tasks: TaskItem[],
  allTasks: TaskItem[],
  pending: PendingPlacement | null,
): BoardModel {
  const names = new Set(groups.map((group) => group.name))
  const columnKeyOf = (task: TaskItem) => (names.has(task.group) ? task.group : UNGROUPED_KEY)
  const everything = allTasks.length ? allTasks : tasks
  const taskByPath = new Map<string, TaskItem>()
  for (const task of everything) taskByPath.set(task.filePath, task)
  for (const task of tasks) if (!taskByPath.has(task.filePath)) taskByPath.set(task.filePath, task)

  const visible = bucketRoots(tasks, columnKeyOf)
  const full = bucketRoots(everything, columnKeyOf)
  if (pending) {
    placePending(visible, pending)
    placePending(full, pending)
  }

  const columnOfTask = new Map<string, string>()
  for (const [key, list] of full) for (const task of list) columnOfTask.set(task.filePath, key)
  for (const [key, list] of visible) for (const task of list) if (!columnOfTask.has(task.filePath)) columnOfTask.set(task.filePath, key)

  const columns: BoardColumnModel[] = groups.map((group) => {
    const shown = visible.get(group.name) ?? []
    return {
      key: group.name,
      name: group.name,
      groupName: group.name,
      group,
      color: group.color,
      count: group.taskCount,
      tasks: shown,
      allRoots: full.get(group.name) ?? shown,
    }
  })
  const ungroupedShown = visible.get(UNGROUPED_KEY) ?? []
  const ungroupedAll = full.get(UNGROUPED_KEY) ?? ungroupedShown
  if (ungroupedShown.length || ungroupedAll.length) {
    columns.unshift({
      key: UNGROUPED_KEY,
      name: UNGROUPED_NAME,
      groupName: '',
      group: null,
      color: '',
      count: ungroupedAll.length,
      tasks: ungroupedShown,
      allRoots: ungroupedAll,
    })
  }

  const parentByName = new Map<string, TaskItem>()
  for (const task of taskByPath.values()) {
    if (isRoot(task)) parentByName.set(task.fileName.trim().toLowerCase(), task)
  }
  const subtasksByParent = new Map<string, TaskItem[]>()
  for (const task of everything) {
    if (isRoot(task) || task.state === 'Cancelada') continue
    const parent = parentByName.get(task.parentTaskName.trim().toLowerCase())
    if (!parent) continue
    const list = subtasksByParent.get(parent.filePath)
    if (list) list.push(task)
    else subtasksByParent.set(parent.filePath, [task])
  }
  for (const list of subtasksByParent.values()) list.sort(byOrder)

  return { columns, subtasksByParent, taskByPath, columnOfTask }
}

/** Done and total subtasks: the backend's counts, or the listed ones. */
export function subtaskProgress(task: TaskItem, subtasks: readonly TaskItem[]): { done: number; total: number } {
  if (typeof task.subtaskTotal === 'number') {
    return { done: task.subtaskDone ?? 0, total: task.subtaskTotal }
  }
  return { done: subtasks.filter((subtask) => subtask.state === 'Finalizada').length, total: subtasks.length }
}

/**
 * Order of the destination column after a drop at `visibleIndex` among the
 * other shown tasks. Hidden tasks (search, filters) keep their places. Null
 * when the task would stay where it is.
 */
export function placementOrder(column: BoardColumnModel, draggedPath: string, visibleIndex: number): string[] | null {
  const others = column.allRoots.filter((task) => task.filePath !== draggedPath)
  const shownOthers = column.tasks.filter((task) => task.filePath !== draggedPath)
  let insertAt = others.length
  if (visibleIndex < shownOthers.length) {
    const before = others.findIndex((task) => task.filePath === shownOthers[Math.max(0, visibleIndex)].filePath)
    if (before >= 0) insertAt = before
  } else if (shownOthers.length) {
    const after = others.findIndex((task) => task.filePath === shownOthers[shownOthers.length - 1].filePath)
    if (after >= 0) insertAt = after + 1
  }
  const ordered = others.map((task) => task.filePath)
  ordered.splice(insertAt, 0, draggedPath)
  const current = column.allRoots.map((task) => task.filePath)
  if (current.length === ordered.length && current.every((path, index) => path === ordered[index])) return null
  return ordered
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
