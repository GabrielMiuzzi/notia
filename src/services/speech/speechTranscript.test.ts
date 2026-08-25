import { describe, expect, it } from 'vitest'
import { formatDiarizedTranscript, mergeVoiceTextIntoDraft } from './speechTranscript'

describe('formatDiarizedTranscript', () => {
  it('omite etiquetas para una sola voz', () => {
    expect(formatDiarizedTranscript({ text: '  Hola mundo. ', speakerCount: 1, segments: [] }))
      .toBe('Hola mundo.')
  })

  it('asigna etiquetas estables por primera aparicion y agrupa segmentos contiguos', () => {
    expect(formatDiarizedTranscript({
      text: '',
      speakerCount: 2,
      segments: [
        { id: '1', startMs: 0, endMs: 100, speakerId: 'b', text: 'Hola', isFinal: true },
        { id: '2', startMs: 100, endMs: 200, speakerId: 'b', text: '¿como estas?', isFinal: true },
        { id: '3', startMs: 200, endMs: 300, speakerId: 'a', text: 'Bien.', isFinal: true },
      ],
    })).toBe('Hablante 1: Hola ¿como estas?\n\nHablante 2: Bien.')
  })
})

describe('mergeVoiceTextIntoDraft', () => {
  it('conserva el borrador anterior', () => {
    expect(mergeVoiceTextIntoDraft('Contexto previo', 'Texto dictado')).toBe('Contexto previo\nTexto dictado')
  })
})
