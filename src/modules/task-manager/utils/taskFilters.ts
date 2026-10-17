import type { TaskArchiveRow } from '../types/taskBoardTypes'
import type { TaskItem, TaskPriority, TaskState } from '../types/taskManagerTypes'

/*
 * Filters of the board and the lists. They only choose which tickets the
 * view shows: the tickets, their order and every change stay with Rust.
 */

export interface TaskFilters {
  /** Words of the title, the detail, the project or the people. */
  query: string
  state: TaskState | ''
  priority: TaskPriority | ''
  project: string
  person: string
  /** Column of origin, in Completadas and Canceladas. */
  group: string
}

export const NO_TASK_FILTERS: TaskFilters = { query: '', state: '', priority: '', project: '', person: '', group: '' }

export function hasTaskFilters(filters: TaskFilters): boolean {
  return Boolean(filters.query.trim() || filters.state || filters.priority || filters.project || filters.person || filters.group)
}

/** Text compared without case or accents. */
function folded(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** The values of the tickets, once each (ignoring case), in alphabetical order. */
function distinct(values: Iterable<string>): string[] {
  const byKey = new Map<string, string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed && !byKey.has(folded(trimmed))) byKey.set(folded(trimmed), trimmed)
  }
  return [...byKey.values()].sort((left, right) => left.localeCompare(right, 'es'))
}

/** Projects and people the tickets use, for the filters and the task dialog. */
export function taskFilterOptions(tasks: readonly TaskItem[]): { projects: string[]; people: string[] } {
  return {
    projects: distinct(tasks.map((task) => task.project ?? '')),
    people: distinct(tasks.flatMap((task) => task.assignees ?? [])),
  }
}

function matches(task: TaskItem, filters: TaskFilters): boolean {
  if (filters.state && task.state !== filters.state) return false
  if (filters.priority && task.priority !== filters.priority) return false
  if (filters.project && folded(task.project ?? '') !== folded(filters.project)) return false
  const people = task.assignees ?? []
  if (filters.person && !people.some((person) => folded(person) === folded(filters.person))) return false
  const words = folded(filters.query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = folded([task.title, task.preview, task.detail, task.project ?? '', ...people].join(' '))
  return words.every((word) => text.includes(word))
}

/** The parent a subtask names, as the board finds it: by file name or title. */
function parentKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * The tickets the filters keep. A ticket stays when it matches or when one
 * of its subtasks does; the subtasks of a ticket that stays stay with it.
 */
export function filterTasks(tasks: readonly TaskItem[], filters: TaskFilters): TaskItem[] {
  if (!hasTaskFilters(filters)) return tasks as TaskItem[]
  const parentOf = (task: TaskItem) => (task.parentTaskName.trim() ? parentKey(task.parentTaskName) : null)
  const kept = new Set<string>()
  for (const task of tasks) {
    if (!matches(task, filters)) continue
    kept.add(task.filePath)
    const parent = parentOf(task)
    if (parent) {
      for (const candidate of tasks) {
        if (parentKey(candidate.fileName) === parent || parentKey(candidate.title) === parent) kept.add(candidate.filePath)
      }
    }
  }
  const keptParents = new Set(
    tasks.filter((task) => kept.has(task.filePath) && !task.parentTaskName.trim())
      .flatMap((task) => [parentKey(task.fileName), parentKey(task.title)]),
  )
  return tasks.filter((task) => kept.has(task.filePath) || (parentOf(task) !== null && keptParents.has(parentOf(task)!)))
}

/** Values the finished or cancelled rows use, for their filters. */
export function archiveFilterOptions(rows: readonly TaskArchiveRow[]): { groups: string[]; projects: string[]; people: string[] } {
  return {
    groups: distinct(rows.map((row) => row.group)),
    projects: distinct(rows.map((row) => row.project ?? '')),
    people: distinct(rows.flatMap((row) => row.assignees)),
  }
}

/** The finished or cancelled rows the search and filters keep. */
export function filterArchiveRows(rows: readonly TaskArchiveRow[], filters: TaskFilters): TaskArchiveRow[] {
  if (!hasTaskFilters(filters)) return rows as TaskArchiveRow[]
  const words = folded(filters.query).split(/\s+/).filter(Boolean)
  return rows.filter((row) => {
    if (filters.priority && row.priority !== filters.priority) return false
    if (filters.group && folded(row.group) !== folded(filters.group)) return false
    if (filters.project && folded(row.project ?? '') !== folded(filters.project)) return false
    if (filters.person && !row.assignees.some((person) => folded(person) === folded(filters.person))) return false
    const text = folded([row.title, row.group, row.project ?? '', ...row.assignees].join(' '))
    return words.every((word) => text.includes(word))
  })
}
