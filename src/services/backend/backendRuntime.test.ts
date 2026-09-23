import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

import { createBackendEventCursor, type BackendEventEnvelope } from './backendRuntime'

function event(requestId: string, sequence: number): BackendEventEnvelope {
  return { protocolVersion: 2, requestId, sequence, event: { type: 'assistant-delta', delta: `d${sequence}` } }
}

describe('createBackendEventCursor', () => {
  it('applies each sequence once even when live emit and replay overlap', () => {
    const cursor = createBackendEventCursor('request-1')
    const applied = [1, 2, 2, 3, 1, 4].filter((sequence) => cursor.accept(event('request-1', sequence)))
    expect(applied).toEqual([1, 2, 3, 4])
    expect(cursor.lastSequence).toBe(4)
  })

  it('ignores events of other requests', () => {
    const cursor = createBackendEventCursor('request-1')
    expect(cursor.accept(event('request-2', 1))).toBe(false)
    expect(cursor.lastSequence).toBe(0)
  })
})
