export interface TelegramPeer {
  chatId: number
  userId: number
  displayName: string
  username: string
}

export interface TelegramPreferences {
  enabled: boolean
  botToken: string
  authorizedPeer: TelegramPeer | null
  pendingPeer: TelegramPeer | null
  updateOffset: number
  processedUpdateIds: number[]
}

export const DEFAULT_TELEGRAM_PREFERENCES: TelegramPreferences = {
  enabled: false,
  botToken: '',
  authorizedPeer: null,
  pendingPeer: null,
  updateOffset: 0,
  processedUpdateIds: [],
}

const TELEGRAM_UPDATE_CHECKPOINT_PREFIX = 'notia:telegram-update-checkpoint:v1:'

export interface TelegramUpdateCheckpoint {
  updateOffset: number
  processedUpdateIds: number[]
}

function normalizePeer(value: unknown): TelegramPeer | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<TelegramPeer>
  if (!Number.isSafeInteger(candidate.chatId) || !Number.isSafeInteger(candidate.userId)) return null
  return {
    chatId: candidate.chatId as number,
    userId: candidate.userId as number,
    displayName: typeof candidate.displayName === 'string' ? candidate.displayName.slice(0, 160) : '',
    username: typeof candidate.username === 'string' ? candidate.username.slice(0, 64) : '',
  }
}

export function normalizeTelegramPreferences(value: unknown): TelegramPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_TELEGRAM_PREFERENCES
  const candidate = value as Partial<TelegramPreferences>
  return {
    enabled: candidate.enabled === true,
    botToken: typeof candidate.botToken === 'string' ? candidate.botToken.trim().slice(0, 256) : '',
    authorizedPeer: normalizePeer(candidate.authorizedPeer),
    pendingPeer: normalizePeer(candidate.pendingPeer),
    updateOffset: Number.isSafeInteger(candidate.updateOffset) && (candidate.updateOffset as number) >= 0
      ? candidate.updateOffset as number : 0,
    processedUpdateIds: Array.isArray(candidate.processedUpdateIds)
      ? candidate.processedUpdateIds.filter((id): id is number => Number.isSafeInteger(id) && id >= 0).slice(-500)
      : [],
  }
}

export function rememberTelegramUpdate(preferences: TelegramPreferences, updateId: number): TelegramPreferences {
  if (preferences.processedUpdateIds.includes(updateId)) return preferences
  return { ...preferences, processedUpdateIds: [...preferences.processedUpdateIds, updateId].slice(-500) }
}

export function mergeTelegramUpdateCheckpoint(
  preferences: TelegramPreferences,
  checkpoint: TelegramUpdateCheckpoint | null,
): TelegramPreferences {
  if (!checkpoint) return preferences
  const processedUpdateIds = [...new Set([
    ...preferences.processedUpdateIds,
    ...checkpoint.processedUpdateIds,
  ])].slice(-500)
  return {
    ...preferences,
    updateOffset: Math.max(preferences.updateOffset, checkpoint.updateOffset),
    processedUpdateIds,
  }
}

export function loadTelegramUpdateCheckpoint(scopeId: string): TelegramUpdateCheckpoint | null {
  if (typeof window === 'undefined' || !scopeId.trim()) return null
  try {
    const raw = window.localStorage.getItem(`${TELEGRAM_UPDATE_CHECKPOINT_PREFIX}${scopeId}`)
    if (!raw) return null
    const candidate = JSON.parse(raw) as Partial<TelegramUpdateCheckpoint>
    return {
      updateOffset: Number.isSafeInteger(candidate.updateOffset) && (candidate.updateOffset as number) >= 0
        ? candidate.updateOffset as number
        : 0,
      processedUpdateIds: Array.isArray(candidate.processedUpdateIds)
        ? candidate.processedUpdateIds.filter((id): id is number => Number.isSafeInteger(id) && id >= 0).slice(-500)
        : [],
    }
  } catch {
    return null
  }
}

export function saveTelegramUpdateCheckpoint(scopeId: string, preferences: TelegramPreferences): void {
  if (typeof window === 'undefined' || !scopeId.trim()) return
  const checkpoint: TelegramUpdateCheckpoint = {
    updateOffset: preferences.updateOffset,
    processedUpdateIds: preferences.processedUpdateIds.slice(-500),
  }
  try {
    window.localStorage.setItem(`${TELEGRAM_UPDATE_CHECKPOINT_PREFIX}${scopeId}`, JSON.stringify(checkpoint))
  } catch {
    // The library config remains the fallback if WebView storage is unavailable.
  }
}
