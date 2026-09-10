import { APP_STORAGE_KEY } from '../constants/taskManagerConstants'
import type { TaskManagerSettings } from '../types/taskManagerTypes'
import { createDefaultTaskManagerSettings, normalizeTaskManagerSettings } from '../utils/settings'

let lastPublishedSharedSettings: string | undefined

function sharedSettingsFingerprint(settings: TaskManagerSettings): string {
  return JSON.stringify({ boards: settings.boards, groups: settings.groups })
}

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

export function saveTaskManagerSettings(settings: TaskManagerSettings, options?: { syncPublication?: boolean }): void {
  try {
    window.localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage failures are non-fatal.
  }
  if (typeof window === 'undefined' || !window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
    return
  }
  const fingerprint = sharedSettingsFingerprint(settings)
  if (options?.syncPublication === false) {
    lastPublishedSharedSettings = fingerprint
    return
  }
  if (lastPublishedSharedSettings === fingerprint) {
    return
  }
  const bridge = (window as Window & {
    __TAURI_INTERNALS__?: {
      invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
    }
  }).__TAURI_INTERNALS__
  if (!bridge) {
    return
  }
  lastPublishedSharedSettings = fingerprint
  void bridge.invoke('update_task_manager_publication_settings', {
    settings: {
      boards: settings.boards,
      groups: settings.groups,
    },
  }).catch((error: unknown) => {
    lastPublishedSharedSettings = undefined
    console.warn('[task-manager] no se pudieron sincronizar los settings publicados', error)
  })
}
