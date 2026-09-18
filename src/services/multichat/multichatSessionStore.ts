import type { MultichatPanelContext } from '../../types/multichat'

let activeContext: MultichatPanelContext | null = null
const listeners = new Set<() => void>()

export function getMultichatPanelContext(): MultichatPanelContext | null {
  return activeContext
}

export function setMultichatPanelContext(context: MultichatPanelContext | null): void {
  activeContext = context
  listeners.forEach((listener) => listener())
}

export function subscribeMultichatPanelContext(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearMultichatPanelContext(roomId?: string): void {
  if (!roomId || activeContext?.roomId === roomId) setMultichatPanelContext(null)
}
