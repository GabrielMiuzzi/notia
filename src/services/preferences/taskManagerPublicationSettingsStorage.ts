const TASK_MANAGER_PUBLICATION_SETTINGS_STORAGE_KEY = 'notia:task-manager-publication-settings:v1'

export interface TaskManagerPublicationPreferences {
  publishedBoardNames: string[]
  passwordHash: string | null
  approvedDevices: PublishedTaskManagerDevice[]
  port: number
}

export interface PublishedTaskManagerDevice { id: string, name: string }

export const DEFAULT_TASK_MANAGER_PUBLICATION_PREFERENCES: TaskManagerPublicationPreferences = {
  publishedBoardNames: [],
  passwordHash: null,
  approvedDevices: [],
  port: 52471,
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
  const input = value as { publishedBoardNames?: unknown, passwordHash?: unknown, approvedDevices?: unknown, port?: unknown }
  const passwordHash = typeof input.passwordHash === 'string' && input.passwordHash.startsWith('$notia-pbkdf2-sha256$')
    ? input.passwordHash
    : null
  const approvedDevices = Array.isArray(input.approvedDevices)
    ? input.approvedDevices.flatMap((device): PublishedTaskManagerDevice[] => {
      if (!device || typeof device !== 'object') return []
      const { id, name } = device as { id?: unknown, name?: unknown }
      return typeof id === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(id) && typeof name === 'string' && name.trim()
        ? [{ id, name: name.trim().slice(0, 80) }]
        : []
    })
    : []
  const port = typeof input.port === 'number' && Number.isInteger(input.port) && input.port >= 1024 && input.port <= 65535 ? input.port : 52471
  return { publishedBoardNames: normalizeBoardNames(input.publishedBoardNames), passwordHash, approvedDevices: Array.from(new Map(approvedDevices.map((device) => [device.id, device])).values()), port }
}

export function loadTaskManagerPublicationPreferences(): TaskManagerPublicationPreferences {
  try {
    return normalizeTaskManagerPublicationPreferences(JSON.parse(localStorage.getItem(TASK_MANAGER_PUBLICATION_SETTINGS_STORAGE_KEY) ?? 'null'))
  } catch {
    return DEFAULT_TASK_MANAGER_PUBLICATION_PREFERENCES
  }
}

export function saveTaskManagerPublicationPreferences(preferences: TaskManagerPublicationPreferences): void {
  localStorage.setItem(TASK_MANAGER_PUBLICATION_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeTaskManagerPublicationPreferences(preferences)))
}
