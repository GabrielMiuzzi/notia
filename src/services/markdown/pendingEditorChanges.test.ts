import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPendingEditorChanges, registerPendingEditorChanges } from './pendingEditorChanges'

describe('pendingEditorChanges', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('asks every open editor for its pending text, until it closes', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unregisterFirst = registerPendingEditorChanges(first)
    const unregisterSecond = registerPendingEditorChanges(second)
    flushPendingEditorChanges()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    unregisterFirst()
    flushPendingEditorChanges()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    unregisterSecond()
  })

  it('lets the other editors hand over their text when one fails', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unregisterBroken = registerPendingEditorChanges(() => { throw new Error('serializer') })
    const working = vi.fn()
    const unregisterWorking = registerPendingEditorChanges(working)
    flushPendingEditorChanges()
    expect(working).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
    unregisterBroken()
    unregisterWorking()
  })
})
