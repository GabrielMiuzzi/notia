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
