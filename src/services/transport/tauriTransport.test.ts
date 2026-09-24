import { afterEach, describe, expect, it, vi } from 'vitest'

const { invoke, listen, convertFileSrc } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  convertFileSrc: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc }))
vi.mock('@tauri-apps/api/event', () => ({ listen }))

import { APP_INVOKE_COMMAND, tauriTransport } from './tauriTransport'

afterEach(() => {
  invoke.mockReset()
  listen.mockReset()
  convertFileSrc.mockReset()
})

describe('tauriTransport', () => {
  it('sends every command through the single app_invoke entry point', async () => {
    invoke.mockResolvedValue({ ok: true })
    await expect(tauriTransport.call('finance_dollar_quotes')).resolves.toEqual({ ok: true })
    await tauriTransport.call('calendar_argentina_holidays', { year: 2026 })
    expect(invoke).toHaveBeenNthCalledWith(1, APP_INVOKE_COMMAND, { command: 'finance_dollar_quotes', args: {} })
    expect(invoke).toHaveBeenNthCalledWith(2, APP_INVOKE_COMMAND, { command: 'calendar_argentina_holidays', args: { year: 2026 } })
  })

  it('keeps the backend error as the rejection', async () => {
    invoke.mockRejectedValue({ code: 'invalidInput', message: 'Año inválido.' })
    await expect(tauriTransport.call('calendar_argentina_holidays', { year: 1 }))
      .rejects.toEqual({ code: 'invalidInput', message: 'Año inválido.' })
  })

  it('hands event payloads to the handler', async () => {
    const stop = vi.fn()
    listen.mockImplementation(async (_event: string, callback: (message: { payload: unknown }) => void) => {
      callback({ payload: 'library-1' })
      return stop
    })
    const handler = vi.fn()
    await expect(tauriTransport.subscribe('notia:library-changed', handler)).resolves.toBe(stop)
    expect(handler).toHaveBeenCalledWith('library-1')
  })

  it('is the local backend and offers every command', () => {
    expect(tauriTransport.kind).toBe('local')
    expect(tauriTransport.supports('start_speech_session')).toBe(true)
  })

  it('falls back to a file URL outside the host', () => {
    convertFileSrc.mockImplementation(() => { throw new Error('no host') })
    expect(tauriTransport.fileUrl('C:\\Notas\\foto 1.png')).toBe('file:///C:/Notas/foto%201.png')
  })
})
