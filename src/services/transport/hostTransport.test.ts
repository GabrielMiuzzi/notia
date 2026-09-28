import { afterEach, describe, expect, it, vi } from 'vitest'

const { invoke, convertFileSrc } = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string, protocol?: string) => `http://${protocol ?? 'asset'}.localhost/${encodeURIComponent(path)}`),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

import { createHostTransport } from './hostTransport'
import { APP_INVOKE_COMMAND } from './tauriTransport'

afterEach(() => {
  invoke.mockReset()
})

describe('createHostTransport', () => {
  const transport = createHostTransport({ hostPlatform: 'windows', hostOnlyCommands: ['start_speech_session', 'library_pick_directory'] })

  it('is remote for the interface and hides what only the host offers', () => {
    expect(transport.kind).toBe('remote')
    expect(transport.platform()).toBe('windows')
    expect(transport.supports('start_speech_session')).toBe(false)
    expect(transport.supports('speech_remote_audio')).toBe(true)
    expect(createHostTransport({ hostPlatform: null, hostOnlyCommands: [] }).platform()).toBe('unknown')
  })

  it('still calls the backend of this device, which reaches the host', async () => {
    invoke.mockResolvedValue({ ok: true })
    await transport.call('finance_overview', { payload: { month: '2026-09' } })
    expect(invoke).toHaveBeenCalledWith(APP_INVOKE_COMMAND, { command: 'finance_overview', args: { payload: { month: '2026-09' } } })
  })

  it('serves the files of the host through its own scheme', () => {
    expect(transport.fileUrl('C:/Notas/foto 1.png')).toBe('http://notiahost.localhost/C%3A%2FNotas%2Ffoto%201.png')
  })
})
