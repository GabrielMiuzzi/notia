import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearMultichatPanelContext, getMultichatPanelContext, setMultichatPanelContext } from './multichatSessionStore'
import { subscribeMultichatPanelContext } from './multichatSessionStore'

describe('multichatSessionStore', () => {
  beforeEach(() => {
    clearMultichatPanelContext()
  })

  it('keeps context in memory only and clears it when the room closes', () => {
    setMultichatPanelContext({
      roomId: 'room-1',
      label: 'Multichat',
      dynamicName: 'Debate',
      agentNames: ['A'],
      contextContent: 'Contexto',
      messages: Array.from({ length: 40 }, (_, index) => ({ speaker: 'user' as const, name: 'Usuario', content: `m${index}` })),
    })
    expect(getMultichatPanelContext()?.roomId).toBe('room-1')
    expect(getMultichatPanelContext()?.messages).toHaveLength(40)
    expect(getMultichatPanelContext()?.contextContent).toBe('Contexto')
    clearMultichatPanelContext('other-room')
    expect(getMultichatPanelContext()?.roomId).toBe('room-1')
    clearMultichatPanelContext('room-1')
    expect(getMultichatPanelContext()).toBeNull()
  })

  it('notifies the independent panel subscriber when context changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeMultichatPanelContext(listener)

    setMultichatPanelContext({ roomId: 'room-2', label: 'Multichat', dynamicName: 'Debate', agentNames: ['A', 'B'], contextContent: '', messages: [] })
    clearMultichatPanelContext('room-2')
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(2)
  })
})
