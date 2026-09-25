// A view asks the side chat to show a message in its composer. The person
// reviews it and sends it; nothing is sent from here. `null` only focuses
// the composer and keeps what it has. When the side chat is not mounted
// yet, the last request waits until it subscribes.

type ComposerRequestListener = (text: string | null) => void

const listeners = new Set<ComposerRequestListener>()
let pendingText: string | null | undefined

export function requestChatComposerText(text: string | null): void {
  if (listeners.size === 0) {
    pendingText = text
    return
  }
  for (const listener of listeners) listener(text)
}

export function subscribeToChatComposerRequests(listener: ComposerRequestListener): () => void {
  listeners.add(listener)
  if (pendingText !== undefined) {
    const text = pendingText
    pendingText = undefined
    listener(text)
  }
  return () => {
    listeners.delete(listener)
  }
}
