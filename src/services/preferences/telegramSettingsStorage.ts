import type { TelegramDocument, TelegramPhoto } from '../telegram/telegramRuntime'
import type { AgentPlanStepStatus } from '../../types/ai/agentContracts'

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
const TELEGRAM_PENDING_AGENT_REQUESTS_PREFIX = 'notia:telegram-pending-agent-requests:v1:'
const TELEGRAM_STORED_REQUEST_LIMIT = 11

export type TelegramAgentRequestScope = 'finance' | 'library'
export interface TelegramPersistedPlan {
  steps: Array<{ id: string; status: AgentPlanStepStatus }>
}
export type TelegramPendingAgentRequestStatus = 'queued' | 'active' | 'interrupted'
export interface TelegramPendingAgentRequest {
  text: string
  actorUserId: number
  scope: TelegramAgentRequestScope
  attachment: { kind: 'photo'; value: TelegramPhoto } | { kind: 'pdf'; value: TelegramDocument } | null
  requestId?: string
  progressMessageId?: number
  progressMessageRetryCount?: number
  plan?: TelegramPersistedPlan
  status?: TelegramPendingAgentRequestStatus
}

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

function normalizePendingAttachment(value: unknown): TelegramPendingAgentRequest['attachment'] | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { kind?: unknown; value?: Record<string, unknown> }
  const attachment = candidate.value
  if (!attachment || typeof attachment.fileId !== 'string' || !attachment.fileId.trim()) return undefined
  const fileId = attachment.fileId.trim().slice(0, 512)
  const fileSize = Number.isSafeInteger(attachment.fileSize) && (attachment.fileSize as number) >= 0
    ? attachment.fileSize as number
    : undefined
  if (candidate.kind === 'photo') {
    if (!Number.isSafeInteger(attachment.width) || !Number.isSafeInteger(attachment.height)) return undefined
    return {
      kind: 'photo',
      value: { fileId, fileSize, width: attachment.width as number, height: attachment.height as number },
    }
  }
  if (candidate.kind === 'pdf') {
    return {
      kind: 'pdf',
      value: {
        fileId,
        fileSize,
        fileName: typeof attachment.fileName === 'string' ? attachment.fileName.slice(0, 255) : undefined,
        mimeType: typeof attachment.mimeType === 'string' ? attachment.mimeType.slice(0, 120) : undefined,
      },
    }
  }
  return undefined
}

const TELEGRAM_PLAN_STATUSES = new Set<AgentPlanStepStatus>([
  'pending', 'in-progress', 'blocked', 'completed', 'failed', 'skipped', 'cancelled',
])

function normalizePendingPlan(value: unknown): TelegramPersistedPlan | undefined {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { steps?: unknown }).steps)) return undefined
  const steps = (value as { steps: unknown[] }).steps.slice(0, 20).flatMap((step) => {
    if (!step || typeof step !== 'object') return []
    const candidate = step as { id?: unknown; status?: unknown }
    if (typeof candidate.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(candidate.id)) return []
    if (typeof candidate.status !== 'string' || !TELEGRAM_PLAN_STATUSES.has(candidate.status as AgentPlanStepStatus)) return []
    return [{ id: candidate.id, status: candidate.status as AgentPlanStepStatus }]
  })
  return steps.length > 0 ? { steps } : undefined
}

export function normalizeTelegramPendingAgentRequests(value: unknown): TelegramPendingAgentRequest[] {
  if (!Array.isArray(value)) return []
  const requests: TelegramPendingAgentRequest[] = []
  for (const entry of value.slice(0, TELEGRAM_STORED_REQUEST_LIMIT)) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<TelegramPendingAgentRequest>
    const attachment = normalizePendingAttachment(candidate.attachment)
    if (attachment === undefined
      || (candidate.text !== undefined && typeof candidate.text !== 'string')
      || !Number.isSafeInteger(candidate.actorUserId)
      || (candidate.scope !== 'finance' && candidate.scope !== 'library')) continue
    const requestId = typeof candidate.requestId === 'string'
      && /^[A-Za-z0-9_-]{1,64}$/.test(candidate.requestId)
      ? candidate.requestId
      : undefined
    const progressMessageId = Number.isSafeInteger(candidate.progressMessageId)
      && (candidate.progressMessageId as number) > 0
      ? candidate.progressMessageId as number
      : undefined
    const progressMessageRetryCount = Number.isSafeInteger(candidate.progressMessageRetryCount)
      && (candidate.progressMessageRetryCount as number) >= 0
      ? Math.min(3, candidate.progressMessageRetryCount as number)
      : 0
    const plan = normalizePendingPlan(candidate.plan)
    const status = candidate.status === 'active' || candidate.status === 'interrupted'
      ? candidate.status
      : 'queued'
    requests.push({
      // Text is retained only by the in-memory queue. Durable recovery keeps
      // the request envelope but never writes the original prompt or private
      // user content to localStorage.
      text: typeof candidate.text === 'string' ? candidate.text.slice(0, 50_000) : '',
      actorUserId: candidate.actorUserId as number,
      scope: candidate.scope,
      attachment,
      ...(requestId ? { requestId } : {}),
      ...(progressMessageId ? { progressMessageId } : {}),
      progressMessageRetryCount,
      ...(plan ? { plan } : {}),
      status,
    })
  }
  return requests
}

export function loadTelegramPendingAgentRequests(scopeId: string): TelegramPendingAgentRequest[] {
  if (typeof window === 'undefined' || !scopeId.trim()) return []
  try {
    const raw = window.localStorage.getItem(`${TELEGRAM_PENDING_AGENT_REQUESTS_PREFIX}${scopeId}`)
    return raw
      ? normalizeTelegramPendingAgentRequests(JSON.parse(raw)).map((request) => request.status === 'active'
        ? { ...request, status: 'interrupted' }
        : request)
      : []
  } catch {
    return []
  }
}

export function saveTelegramPendingAgentRequests(scopeId: string, requests: TelegramPendingAgentRequest[]): boolean {
  if (typeof window === 'undefined' || !scopeId.trim()) return false
  try {
    const key = `${TELEGRAM_PENDING_AGENT_REQUESTS_PREFIX}${scopeId}`
    const normalized = normalizeTelegramPendingAgentRequests(requests)
    const durableMetadata = normalized.map((request) => {
      const metadata = { ...request }
      Reflect.deleteProperty(metadata, 'text')
      return metadata
    })
    if (durableMetadata.length === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(durableMetadata))
    return true
  } catch {
    return false
  }
}
