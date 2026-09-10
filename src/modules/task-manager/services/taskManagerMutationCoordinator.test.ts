import { describe, expect, it } from 'vitest'
import {
  enqueueTaskManagerMutation,
  type TaskManagerMutationContext,
} from './taskManagerMutationCoordinator'

describe('taskManagerMutationCoordinator', () => {
  it('serializes host mutations and continues after a failure', async () => {
    const events: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstReady = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = enqueueTaskManagerMutation(async (context) => {
      events.push(`start:${context.actorId}`)
      await firstReady
      events.push('fail:first')
      throw new Error('first failed')
    })
    const second = enqueueTaskManagerMutation(async () => {
      events.push('start:second')
      return 'second result'
    })

    await Promise.resolve()
    expect(events).toEqual(['start:host'])
    releaseFirst?.()
    await expect(first).rejects.toThrow('first failed')
    await expect(second).resolves.toBe('second result')
    expect(events).toEqual(['start:host', 'fail:first', 'start:second'])
  })

  it('assigns distinct opaque operation ids to queued host mutations', async () => {
    const contexts: TaskManagerMutationContext[] = []
    await Promise.all([
      enqueueTaskManagerMutation(async (context) => {
        contexts.push(context)
      }),
      enqueueTaskManagerMutation(async (context) => {
        contexts.push(context)
      }),
    ])

    expect(contexts).toHaveLength(2)
    expect(contexts[0]?.actorId).toBe('host')
    expect(contexts[1]?.actorId).toBe('host')
    expect(contexts[0]?.operationId).not.toBe(contexts[1]?.operationId)
  })
})
