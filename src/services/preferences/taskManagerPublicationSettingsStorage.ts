const TASK_MANAGER_PUBLICATION_SETTINGS_STORAGE_KEY = 'notia:task-manager-publication-settings:v1'

export interface TaskManagerPublicationPreferences {
  publishedBoardNames: string[]
  passwordHash: string | null
  accessUsers: TaskManagerPublicationAccessUser[]
  approvedDevices: PublishedTaskManagerDevice[]
  port: number
  maxClients: number
}

export interface TaskManagerPublicationAccessUser { username: string, passwordHash: string }
export interface PublishedTaskManagerDevice { id: string, name: string, username: string }

export const DEFAULT_TASK_MANAGER_PUBLICATION_PREFERENCES: TaskManagerPublicationPreferences = {
  publishedBoardNames: [],
  passwordHash: null,
  accessUsers: [],
  approvedDevices: [],
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

function isPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('$notia-pbkdf2-sha256$')
}

function normalizeAccessUsers(value: unknown): TaskManagerPublicationAccessUser[] {
  if (!Array.isArray(value)) return []

  const users = value.flatMap((user): TaskManagerPublicationAccessUser[] => {
    if (!user || typeof user !== 'object') return []
    const { username, passwordHash } = user as { username?: unknown, passwordHash?: unknown }
    const normalizedUsername = typeof username === 'string' ? username.trim() : ''
    return normalizedUsername && isPasswordHash(passwordHash)
      ? [{ username: normalizedUsername.slice(0, 64), passwordHash }]
      : []
  })
  return Array.from(new Map(users.map((user) => [user.username.toLowerCase(), user])).values())
}

export function normalizeTaskManagerPublicationPreferences(value: unknown): TaskManagerPublicationPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_TASK_MANAGER_PUBLICATION_PREFERENCES
  const input = value as { publishedBoardNames?: unknown, passwordHash?: unknown, accessUsers?: unknown, approvedDevices?: unknown, port?: unknown, maxClients?: unknown }
  const passwordHash = isPasswordHash(input.passwordHash) ? input.passwordHash : null
  const approvedDevices = Array.isArray(input.approvedDevices)
    ? input.approvedDevices.flatMap((device): PublishedTaskManagerDevice[] => {
      if (!device || typeof device !== 'object') return []
      const { id, name, username } = device as { id?: unknown, name?: unknown, username?: unknown }
      return typeof id === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(id) && typeof name === 'string' && name.trim() && typeof username === 'string' && username.trim()
        ? [{ id, name: name.trim().slice(0, 80), username: username.trim().slice(0, 64) }]
        : []
    })
    : []
  const port = typeof input.port === 'number' && Number.isInteger(input.port) && input.port >= 1024 && input.port <= 65535 ? input.port : 52471
  const maxClients = typeof input.maxClients === 'number' && Number.isInteger(input.maxClients) && input.maxClients >= 1 && input.maxClients <= 64
    ? input.maxClients
    : 64
  return {
    publishedBoardNames: normalizeBoardNames(input.publishedBoardNames),
    passwordHash,
    accessUsers: normalizeAccessUsers(input.accessUsers),
    approvedDevices: Array.from(new Map(approvedDevices.map((device) => [device.id, device])).values()),
    port,
    maxClients,
  }
}

export function loadTaskManagerPublicationPreferences(): TaskManagerPublicationPreferences {
  try {
    return normalizeTaskManagerPublicationPreferences(JSON.parse(localStorage.getItem(TASK_MANAGER_PUBLICATION_SETTINGS_STORAGE_KEY) ?? 'null'))
  } catch {
    return DEFAULT_TASK_MANAGER_PUBLICATION_PREFERENCES
  }
}

export function saveTaskManagerPublicationPreferences(preferences: TaskManagerPublicationPreferences): void {
  const normalized = normalizeTaskManagerPublicationPreferences(preferences)
  // Access-user hashes belong to the active library, not browser-global storage.
  const browserPreferences = { ...normalized, accessUsers: undefined }
  localStorage.setItem(TASK_MANAGER_PUBLICATION_SETTINGS_STORAGE_KEY, JSON.stringify(browserPreferences))
}
