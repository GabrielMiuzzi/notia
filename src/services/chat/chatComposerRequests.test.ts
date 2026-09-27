import { describe, expect, it, vi } from 'vitest'
import { requestChatComposerText, requestChatPanel, subscribeToChatPanelRequests } from './chatComposerRequests'

describe('chatComposerRequests', () => {
  it('delivers a request made before the chat subscribes, only once', () => {
    requestChatComposerText('Cargar un ticket')
    const first = vi.fn()
    const unsubscribe = subscribeToChatPanelRequests(first)
    expect(first).toHaveBeenCalledWith({ kind: 'compose', text: 'Cargar un ticket' })
    unsubscribe()

    const second = vi.fn()
    subscribeToChatPanelRequests(second)()
    expect(second).not.toHaveBeenCalled()
  })

  it('keeps a focus-only request pending too', () => {
    requestChatComposerText(null)
    const listener = vi.fn()
    subscribeToChatPanelRequests(listener)()
    expect(listener).toHaveBeenCalledWith({ kind: 'compose', text: null })
  })

  it('sends later requests to the subscribed chat', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToChatPanelRequests(listener)
    requestChatComposerText('Sí, es ese')
    requestChatPanel({ kind: 'send', text: '¿Qué tengo hoy?', agentFileName: 'finanzas.md' })
    expect(listener).toHaveBeenNthCalledWith(1, { kind: 'compose', text: 'Sí, es ese' })
    expect(listener).toHaveBeenNthCalledWith(2, { kind: 'send', text: '¿Qué tengo hoy?', agentFileName: 'finanzas.md' })
    unsubscribe()
  })

  it('keeps only the last request made while no chat listens', () => {
    requestChatComposerText('Primero')
    requestChatPanel({ kind: 'open', filePath: 'chat/Pendientes.md', agentFileName: null })
    const listener = vi.fn()
    subscribeToChatPanelRequests(listener)()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ kind: 'open', filePath: 'chat/Pendientes.md', agentFileName: null })
  })
})
