import { describe, expect, it } from 'vitest'
import { mergeVoiceTextIntoDraft } from './speechTranscript'

// Speaker labels and renames are covered in Rust (`backend-core::speech_text`).
describe('mergeVoiceTextIntoDraft', () => {
  it('conserva el borrador anterior', () => {
    expect(mergeVoiceTextIntoDraft('Contexto previo', 'Texto dictado')).toBe('Contexto previo\nTexto dictado')
  })
})
