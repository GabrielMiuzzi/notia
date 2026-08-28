import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildQwen3TtsSpeechChunks, resolveQwen3TtsPlaybackRate, speakWithQwen3Tts, stopQwen3TtsSpeech, takeQwen3TtsStreamChunk } from './qwen3TtsRuntime'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => [0, 1, 2]) }))

describe('buildQwen3TtsSpeechChunks', () => {
  it('corrige el ritmo lento del modelo sin superar el rango permitido', () => {
    expect(resolveQwen3TtsPlaybackRate(1)).toBeCloseTo(1.12)
    expect(resolveQwen3TtsPlaybackRate(1.8)).toBe(1.8)
    expect(resolveQwen3TtsPlaybackRate(0.7)).toBeCloseTo(0.784)
  })

  it('converts a long Markdown answer into bounded natural speech chunks', () => {
    const answer = Array.from({ length: 30 }, (_, index) => `## Tarea ${index + 1}\n- **Estado:** Pendiente.\n- [Detalle](https://example.com): trabajo asignado al equipo.`).join('\n\n')
    const chunks = buildQwen3TtsSpeechChunks(answer, 180)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 180)).toBe(true)
    expect(['*', '#', '[', ']', '|'].some((symbol) => chunks.join(' ').includes(symbol))).toBe(false)
    expect(chunks.join(' ')).toContain('Tarea 1')
  })

  it('emite oraciones completas del stream y elimina marcas de Markdown', () => {
    const streamed = takeQwen3TtsStreamChunk('## Resumen\n**Esta es una oración completa para comenzar a hablar.** Sigue en curso')
    expect(streamed.chunk).toContain('oración completa')
    expect(streamed.remaining).toContain('Sigue en curso')
    expect(buildQwen3TtsSpeechChunks(`${streamed.chunk}<strong>Importante</strong>`).join(' ')).toBe(
      'Resumen Esta es una oración completa para comenzar a hablar. Importante',
    )
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
