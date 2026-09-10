import type { TaskManagerPublicationStatusSnapshot } from './taskManagerPublicationRuntime'

export const TASK_MANAGER_PUBLICATION_TELEMETRY_KEY = 'task-manager:publication-telemetry:v1'
export const TASK_MANAGER_PUBLICATION_TELEMETRY_VERSION = 1 as const
const MAX_TELEMETRY_SAMPLES = 128

export interface TaskManagerPublicationTelemetrySample {
  recordedAt: number
  publicationEpoch: string
  revision: number
  sequence: number
  authenticatedSessions: number
  websocketSessions: number
  maxAuthenticatedSessions: number
  maxWebsocketSessions: number
  websocketFramesReceived: number
  websocketFramesSent: number
  websocketBytesReceived: number
  websocketBytesSent: number
  droppedEvents: number
  resyncRequired: number
  conflicts: number
  mutationsApplied: number
  mutationErrors: number
  aiStreamCancellations: number
  lastChangeAtUnixMs: number | null
  mutationLatencySamples: number
  mutationLatencyLastMs: number | null
  mutationLatencyP95Ms: number | null
  recoveryRequired: boolean
}

export interface TaskManagerPublicationTelemetry {
  version: typeof TASK_MANAGER_PUBLICATION_TELEMETRY_VERSION
  samples: TaskManagerPublicationTelemetrySample[]
}

function emptyTelemetry(): TaskManagerPublicationTelemetry {
  return { version: TASK_MANAGER_PUBLICATION_TELEMETRY_VERSION, samples: [] }
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseNullableNonNegativeInteger(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : isSafeNonNegativeInteger(value) ? value : null
}

function normalizeSample(value: unknown): TaskManagerPublicationTelemetrySample | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<TaskManagerPublicationTelemetrySample>
  const integerFields = [
    'recordedAt', 'revision', 'sequence', 'authenticatedSessions', 'websocketSessions',
    'maxAuthenticatedSessions', 'maxWebsocketSessions', 'websocketFramesReceived',
    'websocketFramesSent', 'websocketBytesReceived', 'websocketBytesSent', 'droppedEvents',
    'resyncRequired', 'conflicts', 'mutationsApplied', 'mutationErrors', 'aiStreamCancellations',
    'mutationLatencySamples',
  ] as const
  if (typeof candidate.publicationEpoch !== 'string' || candidate.publicationEpoch.length === 0 || candidate.publicationEpoch.length > 128) {
    return null
  }
  if (typeof candidate.recoveryRequired !== 'boolean') return null
  if (!integerFields.every((field) => isSafeNonNegativeInteger(candidate[field]))) return null
  return {
    recordedAt: candidate.recordedAt as number,
    publicationEpoch: candidate.publicationEpoch,
    revision: candidate.revision as number,
    sequence: candidate.sequence as number,
    authenticatedSessions: candidate.authenticatedSessions as number,
    websocketSessions: candidate.websocketSessions as number,
    maxAuthenticatedSessions: candidate.maxAuthenticatedSessions as number,
    maxWebsocketSessions: candidate.maxWebsocketSessions as number,
    websocketFramesReceived: candidate.websocketFramesReceived as number,
    websocketFramesSent: candidate.websocketFramesSent as number,
    websocketBytesReceived: candidate.websocketBytesReceived as number,
    websocketBytesSent: candidate.websocketBytesSent as number,
    droppedEvents: candidate.droppedEvents as number,
    resyncRequired: candidate.resyncRequired as number,
    conflicts: candidate.conflicts as number,
    mutationsApplied: candidate.mutationsApplied as number,
    mutationErrors: candidate.mutationErrors as number,
    aiStreamCancellations: candidate.aiStreamCancellations as number,
    lastChangeAtUnixMs: parseNullableNonNegativeInteger(candidate.lastChangeAtUnixMs),
    mutationLatencySamples: candidate.mutationLatencySamples as number,
    mutationLatencyLastMs: parseNullableNonNegativeInteger(candidate.mutationLatencyLastMs),
    mutationLatencyP95Ms: parseNullableNonNegativeInteger(candidate.mutationLatencyP95Ms),
    recoveryRequired: candidate.recoveryRequired,
  }
}

export function normalizeTaskManagerPublicationTelemetry(value: unknown): TaskManagerPublicationTelemetry {
  if (!value || typeof value !== 'object') return emptyTelemetry()
  const candidate = value as { version?: unknown; samples?: unknown }
  if (candidate.version !== TASK_MANAGER_PUBLICATION_TELEMETRY_VERSION || !Array.isArray(candidate.samples)) {
    return emptyTelemetry()
  }
  return {
    version: TASK_MANAGER_PUBLICATION_TELEMETRY_VERSION,
    samples: candidate.samples.flatMap((sample) => {
      const normalized = normalizeSample(sample)
      return normalized ? [normalized] : []
    }).slice(-MAX_TELEMETRY_SAMPLES),
  }
}

export function loadTaskManagerPublicationTelemetry(): TaskManagerPublicationTelemetry {
  if (typeof window === 'undefined') return emptyTelemetry()
  try {
    const rawValue = window.localStorage.getItem(TASK_MANAGER_PUBLICATION_TELEMETRY_KEY)
    return rawValue ? normalizeTaskManagerPublicationTelemetry(JSON.parse(rawValue)) : emptyTelemetry()
  } catch {
    return emptyTelemetry()
  }
}

function toTelemetrySample(snapshot: TaskManagerPublicationStatusSnapshot, recordedAt: number): TaskManagerPublicationTelemetrySample {
  return {
    recordedAt,
    publicationEpoch: snapshot.publicationEpoch,
    revision: snapshot.revision,
    sequence: snapshot.sequence,
    authenticatedSessions: snapshot.authenticatedSessions,
    websocketSessions: snapshot.websocketSessions,
    maxAuthenticatedSessions: snapshot.maxAuthenticatedSessions,
    maxWebsocketSessions: snapshot.maxWebsocketSessions,
    websocketFramesReceived: snapshot.websocketFramesReceived,
    websocketFramesSent: snapshot.websocketFramesSent,
    websocketBytesReceived: snapshot.websocketBytesReceived,
    websocketBytesSent: snapshot.websocketBytesSent,
    droppedEvents: snapshot.droppedEvents,
    resyncRequired: snapshot.resyncRequired,
    conflicts: snapshot.conflicts,
    mutationsApplied: snapshot.mutationsApplied,
    mutationErrors: snapshot.mutationErrors,
    aiStreamCancellations: snapshot.aiStreamCancellations,
    lastChangeAtUnixMs: snapshot.lastChangeAtUnixMs,
    mutationLatencySamples: snapshot.mutationLatencySamples,
    mutationLatencyLastMs: snapshot.mutationLatencyLastMs,
    mutationLatencyP95Ms: snapshot.mutationLatencyP95Ms,
    recoveryRequired: snapshot.recoveryRequired,
  }
}

export function recordTaskManagerPublicationTelemetry(
  snapshot: TaskManagerPublicationStatusSnapshot,
  recordedAt = Date.now(),
): TaskManagerPublicationTelemetry {
  const current = loadTaskManagerPublicationTelemetry()
  const sample = toTelemetrySample(snapshot, recordedAt)
  const previous = current.samples[current.samples.length - 1]
  const isDuplicate = previous
    && JSON.stringify({ ...previous, recordedAt: 0 }) === JSON.stringify({ ...sample, recordedAt: 0 })
  const next = isDuplicate ? current : {
    version: TASK_MANAGER_PUBLICATION_TELEMETRY_VERSION,
    samples: [...current.samples, sample].slice(-MAX_TELEMETRY_SAMPLES),
  }
  if (typeof window !== 'undefined' && !isDuplicate) {
    try {
      window.localStorage.setItem(TASK_MANAGER_PUBLICATION_TELEMETRY_KEY, JSON.stringify(next))
    } catch {
      // La telemetría es diagnóstica; un storage lleno no debe interrumpir la publicación.
    }
  }
  return next
}
