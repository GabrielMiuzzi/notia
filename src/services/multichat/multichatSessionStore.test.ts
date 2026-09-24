import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearMultichatPanelContext, getMultichatPanelContext, setMultichatPanelContext } from './multichatSessionStore'
import { subscribeMultichatPanelContext } from './multichatSessionStore'

describe('multichatSessionStore', () => {
  beforeEach(() => {
    clearMultichatPanelContext()
  })

  it('keeps the open room in memory only and clears it when the room closes', () => {
    setMultichatPanelContext({ roomId: 'room-1', label: 'Multichat' })
    expect(getMultichatPanelContext()?.roomId).toBe('room-1')
    clearMultichatPanelContext('other-room')
    expect(getMultichatPanelContext()?.roomId).toBe('room-1')
    clearMultichatPanelContext('room-1')
    expect(getMultichatPanelContext()).toBeNull()
  })

  it('notifies the independent panel subscriber when the room changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeMultichatPanelContext(listener)

    setMultichatPanelContext({ roomId: 'room-2', label: 'Multichat' })
    clearMultichatPanelContext('room-2')
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(2)
  })
})
