import { describe, expect, it, vi } from 'vitest'
import { requestChatComposerText, subscribeToChatComposerRequests } from './chatComposerRequests'

describe('chatComposerRequests', () => {
  it('delivers a request made before the chat subscribes, only once', () => {
    requestChatComposerText('Cargar un ticket')
    const first = vi.fn()
    const unsubscribe = subscribeToChatComposerRequests(first)
    expect(first).toHaveBeenCalledWith('Cargar un ticket')
    unsubscribe()

    const second = vi.fn()
    subscribeToChatComposerRequests(second)()
    expect(second).not.toHaveBeenCalled()
  })

  it('keeps a focus-only request pending too', () => {
    requestChatComposerText(null)
    const listener = vi.fn()
    subscribeToChatComposerRequests(listener)()
    expect(listener).toHaveBeenCalledWith(null)
  })

  it('sends later requests to the subscribed composer', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToChatComposerRequests(listener)
    requestChatComposerText('Sí, es ese')
    expect(listener).toHaveBeenCalledWith('Sí, es ese')
    unsubscribe()
  })
})
