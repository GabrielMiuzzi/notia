const TASK_MANAGER_PUBLICATION_SETTINGS_STORAGE_KEY = 'notia:task-manager-publication-settings:v1'

export interface TaskManagerPublicationPreferences {
  publishedBoardNames: string[]
  port: number
  maxClients: number
}

export const DEFAULT_TASK_MANAGER_PUBLICATION_PREFERENCES: TaskManagerPublicationPreferences = {
  publishedBoardNames: [],
  port: 52471,
  maxClients: 64,
}

/**
 * Copy kept by older versions in the WebView: only the board names, port and
 * client limit move to the backend, which normalizes them. Older versions
 * also stored publication passwords, users and devices; they are dropped.
 */
export function loadTaskManagerPublicationPreferences(): unknown {
  try {
    const stored = JSON.parse(localStorage.getItem(TASK_MANAGER_PUBLICATION_SETTINGS_STORAGE_KEY) ?? 'null') as Record<string, unknown> | null
    return stored && typeof stored === 'object'
      ? { publishedBoardNames: stored.publishedBoardNames, port: stored.port, maxClients: stored.maxClients }
      : null
  } catch {
    return null
  }
}


/** Removes the WebView copy after the backend holds the preferences. */
export function clearLegacyTaskManagerPublicationPreferences(): void {
  try {
    localStorage.removeItem(TASK_MANAGER_PUBLICATION_SETTINGS_STORAGE_KEY)
  } catch {
    // A stale copy is ignored once the backend is initialized.
  }
}
