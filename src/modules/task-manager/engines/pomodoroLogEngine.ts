import type { PomodoroLogEntry } from '../types/taskManagerTypes'

export function getEntriesByDate(entries: PomodoroLogEntry[], localDateText: string): PomodoroLogEntry[] {
  return entries.filter((entry) => entry.date === localDateText)
}

export function toLocalDateText(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
