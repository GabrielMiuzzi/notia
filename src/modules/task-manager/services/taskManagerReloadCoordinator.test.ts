import { describe, expect, it } from 'vitest'
import {
  drainTaskManagerReloadQueue,
  getTaskManagerReloadRetryDelay,
  type TaskManagerReloadDrainState,
} from './taskManagerReloadCoordinator'

describe('taskManagerReloadCoordinator', () => {
  it('starts another drain when a change arrives while the previous drain is completing', async () => {
    const state: TaskManagerReloadDrainState = { pending: true, inFlight: null }
    let releaseFirstDrain: (() => void) | undefined
    let drainCount = 0
    const createDrain = async () => {
      drainCount += 1
      state.pending = false
      if (drainCount === 1) {
        await new Promise<void>((resolve) => { releaseFirstDrain = resolve })
      }
    }

    const firstCaller = drainTaskManagerReloadQueue(state, createDrain)
    await Promise.resolve()
    expect(drainCount).toBe(1)

    state.pending = true
    const secondCaller = drainTaskManagerReloadQueue(state, createDrain)
    releaseFirstDrain?.()
    await Promise.all([firstCaller, secondCaller])
    expect(drainCount).toBe(2)
    expect(state.pending).toBe(false)
    expect(state.inFlight).toBeNull()
  })

  it('coalesces concurrent callers into one active drain', async () => {
    const state: TaskManagerReloadDrainState = { pending: true, inFlight: null }
    let release: (() => void) | undefined
    let drainCount = 0
    const createDrain = async () => {
      drainCount += 1
      state.pending = false
      await new Promise<void>((resolve) => { release = resolve })
    }

    const callers = Array.from({ length: 20 }, () => drainTaskManagerReloadQueue(state, createDrain))
    await Promise.resolve()
    expect(drainCount).toBe(1)
    release?.()
    await Promise.all(callers)
    expect(state.inFlight).toBeNull()
  })

  it('does not lose a long sequence of changes at consecutive completion boundaries', async () => {
    const state: TaskManagerReloadDrainState = { pending: true, inFlight: null }
    let drainCount = 0

    await drainTaskManagerReloadQueue(state, async () => {
      drainCount += 1
      state.pending = false
      await Promise.resolve()
      if (drainCount < 100) state.pending = true
    })

    expect(drainCount).toBe(100)
    expect(state.pending).toBe(false)
    expect(state.inFlight).toBeNull()
  })

  it('uses bounded exponential backoff for transient snapshot failures', () => {
    expect(Array.from({ length: 10 }, (_, attempt) => getTaskManagerReloadRetryDelay(attempt))).toEqual([
      250,
      500,
      1_000,
      2_000,
      4_000,
      8_000,
      10_000,
      10_000,
      10_000,
      10_000,
    ])
    expect(getTaskManagerReloadRetryDelay(Number.NaN)).toBe(250)
  })
})
