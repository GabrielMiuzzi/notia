import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildQwen3TtsSpeechChunks, speakWithQwen3Tts, stopQwen3TtsSpeech } from './qwen3TtsRuntime'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => [0, 1, 2]) }))

describe('buildQwen3TtsSpeechChunks', () => {
  it('converts a long Markdown answer into bounded natural speech chunks', () => {
    const answer = Array.from({ length: 30 }, (_, index) => `## Tarea ${index + 1}\n- **Estado:** Pendiente.\n- [Detalle](https://example.com): trabajo asignado al equipo.`).join('\n\n')
    const chunks = buildQwen3TtsSpeechChunks(answer, 180)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 180)).toBe(true)
    expect(chunks.join(' ')).not.toMatch(/[*#\[\]|]/)
    expect(chunks.join(' ')).toContain('Tarea 1')
  })

  it('stops the active audio and rejects the pending speech queue when the call ends', async () => {
    const pause = vi.fn()
    const load = vi.fn()
    const play = vi.fn(async () => undefined)
    class FakeAudio {
      onended: (() => void) | null = null
      onerror: (() => void) | null = null
      pause = pause
      load = load
      play = play
      removeAttribute = vi.fn()
    }
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })

    const speech = speakWithQwen3Tts('Una respuesta que se está reproduciendo.', {
      model: '0.6b', device: 'cpu',
      enabled: true, voice: 'serena', language: 'es', speed: 1, pauseDetectionMs: 1_200, greeting: 'Hola',
    })
    await vi.waitFor(() => expect(play).toHaveBeenCalledOnce())
    stopQwen3TtsSpeech()

    await expect(speech).rejects.toThrow('cancelada')
    expect(pause).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledOnce()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
