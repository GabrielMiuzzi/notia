import { APP_STORAGE_KEY } from '../constants/taskManagerConstants'

/*
 * Board preferences of this device: only the active tab. Boards, groups,
 * tasks and the Pomodoro timer come from the backend.
 */

function readStored(): Record<string, unknown> | null {
  try {
    const rawValue = window.localStorage.getItem(APP_STORAGE_KEY)
    const parsed = rawValue ? JSON.parse(rawValue) as unknown : null
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function loadActiveTaskTab(): string {
  const activeTab = readStored()?.activeTab
  return typeof activeTab === 'string' ? activeTab : ''
}

export function saveActiveTaskTab(activeTab: string): void {
  try {
    const stored = readStored()
    window.localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(
      stored?.pomodoro ? { activeTab, pomodoro: stored.pomodoro } : { activeTab },
    ))
  } catch {
    // Storage failures are non-fatal.
  }
}

/** Timer older versions kept on this device, for the backend to adopt once. */
export function loadLegacyPomodoroState(): unknown {
  return readStored()?.pomodoro ?? null
}

export function clearLegacyPomodoroState(): void {
  try {
    window.localStorage.setItem(APP_STORAGE_KEY, JSON.stringify({ activeTab: loadActiveTaskTab() }))
  } catch {
    // Storage failures are non-fatal.
  }
}

export type TaskBoardViewMode = 'board' | 'list' | 'management'

const VIEW_STORAGE_KEY = 'task-manager:board-views:v1'

interface BoardViewPreferences {
  mode?: TaskBoardViewMode
  /** Columns folded by the person, by view; empty columns fold by default. */
  collapsedBoard?: Record<string, boolean>
  collapsedList?: Record<string, boolean>
}

function readViews(): Record<string, BoardViewPreferences> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIEW_STORAGE_KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, BoardViewPreferences> : {}
  } catch {
    return {}
  }
}

/** How a board was last shown on this device and which columns were folded. */
export function loadBoardViewPreferences(board: string): BoardViewPreferences {
  return readViews()[board] ?? {}
}

export function saveBoardViewPreferences(board: string, preferences: BoardViewPreferences): void {
  try {
    const views = readViews()
    views[board] = { ...views[board], ...preferences }
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(views))
  } catch {
    // Storage failures are non-fatal.
  }
}
