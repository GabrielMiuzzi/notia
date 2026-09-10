import { describe, expect, it, vi } from 'vitest'
import type { TaskManagerPublicationStatusSnapshot } from './taskManagerPublicationRuntime'
import {
  loadTaskManagerPublicationTelemetry,
  normalizeTaskManagerPublicationTelemetry,
  recordTaskManagerPublicationTelemetry,
} from './taskManagerPublicationTelemetry'

function createSnapshot(overrides: Partial<TaskManagerPublicationStatusSnapshot> = {}): TaskManagerPublicationStatusSnapshot {
  return {
    active: true,
    authenticatedSessions: 1,
    websocketSessions: 1,
    maxAuthenticatedSessions: 64,
    maxWebsocketSessions: 64,
    publicationEpoch: 'epoch-1',
    revision: 2,
    sequence: 2,
    lastOperationId: null,
    lastActorId: null,
    websocketFramesReceived: 3,
    websocketFramesSent: 4,
    websocketBytesReceived: 100,
    websocketBytesSent: 200,
    droppedEvents: 0,
    resyncRequired: 0,
    conflicts: 0,
    mutationsApplied: 1,
    mutationErrors: 0,
    aiStreamCancellations: 0,
    lastChangeAtUnixMs: 1_000,
    mutationLatencySamples: 1,
    mutationLatencyLastMs: 25,
    mutationLatencyP95Ms: 25,
    recoveryRequired: false,
    ...overrides,
  }
}

function installMemoryStorage(): void {
  const values = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })
}

describe('taskManagerPublicationTelemetry', () => {
  it('normalizes malformed samples and keeps a bounded history', () => {
    const samples = Array.from({ length: 140 }, (_, index) => ({
      ...createSnapshot({ revision: index, sequence: index }),
      recordedAt: index,
    }))
    const normalized = normalizeTaskManagerPublicationTelemetry({ version: 1, samples })

    expect(normalized.samples).toHaveLength(128)
    expect(normalized.samples[0]?.revision).toBe(12)
    expect(normalizeTaskManagerPublicationTelemetry({ version: 99, samples })).toEqual({ version: 1, samples: [] })
  })

  it('persists safe metric snapshots and avoids duplicate samples', () => {
    installMemoryStorage()
    const snapshot = createSnapshot()

    expect(recordTaskManagerPublicationTelemetry(snapshot, 2_000).samples).toHaveLength(1)
    expect(recordTaskManagerPublicationTelemetry(snapshot, 3_000).samples).toHaveLength(1)
    expect(recordTaskManagerPublicationTelemetry({ ...snapshot, revision: 3, sequence: 3 }, 4_000).samples).toHaveLength(2)
    expect(loadTaskManagerPublicationTelemetry().samples).toHaveLength(2)
  })
})
