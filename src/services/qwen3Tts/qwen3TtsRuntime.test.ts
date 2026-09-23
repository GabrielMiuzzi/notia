import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveQwen3TtsPlaybackRate, speakWithQwen3Tts, stopQwen3TtsSpeech } from './qwen3TtsRuntime'

// The speech plan (markup removal and chunks) is covered in Rust
// (`backend-core::speech_text`).
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args: { markdown?: string }) => (
    command === 'qwen3_tts_speech_plan' ? [args.markdown] : [0, 1, 2]
  )),
}))

describe('qwen3TtsRuntime', () => {
  it('corrige el ritmo lento del modelo sin superar el rango permitido', () => {
    expect(resolveQwen3TtsPlaybackRate(1)).toBeCloseTo(1.12)
    expect(resolveQwen3TtsPlaybackRate(1.8)).toBe(1.8)
    expect(resolveQwen3TtsPlaybackRate(0.7)).toBeCloseTo(0.784)
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
