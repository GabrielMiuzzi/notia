import { APP_STORAGE_KEY } from '../constants/taskManagerConstants'
import type { TaskManagerSettings } from '../types/taskManagerTypes'
import { createDefaultTaskManagerSettings, normalizeTaskManagerSettings } from '../utils/settings'

export function loadTaskManagerSettings(): TaskManagerSettings {
  try {
    const rawValue = window.localStorage.getItem(APP_STORAGE_KEY)
    if (!rawValue) {
      return createDefaultTaskManagerSettings()
    }

    return normalizeTaskManagerSettings(JSON.parse(rawValue))
  } catch {
    return createDefaultTaskManagerSettings()
  }
}

export function saveTaskManagerSettings(settings: TaskManagerSettings): void {
  try {
    window.localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage failures are non-fatal.
  }
}
