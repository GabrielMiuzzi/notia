// A view asks the side chat for something: show a message in its composer
// for the person to review and send (`compose`; `null` only focuses the
// composer and keeps what it has), send a message in a new chat with an agent
// (`send`, the ask box of Home) or open a chat (`open`). When the side chat
// is not mounted yet, the last request waits until it subscribes.

export type ChatPanelRequest =
  | { kind: 'compose'; text: string | null }
  | { kind: 'send'; text: string; agentFileName: string | null }
  | { kind: 'open'; filePath: string; agentFileName: string | null }

type ChatPanelRequestListener = (request: ChatPanelRequest) => void

const listeners = new Set<ChatPanelRequestListener>()
let pendingRequest: ChatPanelRequest | null = null

export function requestChatPanel(request: ChatPanelRequest): void {
  if (listeners.size === 0) {
    pendingRequest = request
    return
  }
  for (const listener of listeners) listener(request)
}

export function requestChatComposerText(text: string | null): void {
  requestChatPanel({ kind: 'compose', text })
}

export function subscribeToChatPanelRequests(listener: ChatPanelRequestListener): () => void {
  listeners.add(listener)
  if (pendingRequest) {
    const request = pendingRequest
    pendingRequest = null
    listener(request)
  }
  return () => {
    listeners.delete(listener)
  }
}
