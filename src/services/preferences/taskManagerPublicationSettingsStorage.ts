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

function normalizeBoardNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)))
}

export function normalizeTaskManagerPublicationPreferences(value: unknown): TaskManagerPublicationPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_TASK_MANAGER_PUBLICATION_PREFERENCES
  const input = value as { publishedBoardNames?: unknown, port?: unknown, maxClients?: unknown }
  const port = typeof input.port === 'number' && Number.isInteger(input.port) && input.port >= 1024 && input.port <= 65535 ? input.port : 52471
  const maxClients = typeof input.maxClients === 'number' && Number.isInteger(input.maxClients) && input.maxClients >= 1 && input.maxClients <= 64 ? input.maxClients : 64
  return { publishedBoardNames: normalizeBoardNames(input.publishedBoardNames), port, maxClients }
}

/** Copy kept by older versions in the WebView; read once to migrate it. */
export function loadTaskManagerPublicationPreferences(): TaskManagerPublicationPreferences {
  try {
    // Older versions stored publication passwords, access users and approved
    // devices here. They are deliberately ignored by this boundary.
    return normalizeTaskManagerPublicationPreferences(JSON.parse(localStorage.getItem(TASK_MANAGER_PUBLICATION_SETTINGS_STORAGE_KEY) ?? 'null'))
  } catch {
    return DEFAULT_TASK_MANAGER_PUBLICATION_PREFERENCES
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
