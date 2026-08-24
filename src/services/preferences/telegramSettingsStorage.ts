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
}

export const DEFAULT_TELEGRAM_PREFERENCES: TelegramPreferences = {
  enabled: false,
  botToken: '',
  authorizedPeer: null,
  pendingPeer: null,
  updateOffset: 0,
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
  }
}
