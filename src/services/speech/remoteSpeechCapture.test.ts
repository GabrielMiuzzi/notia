import { describe, expect, it } from 'vitest'
import { bytesToBase64, encodePcm16 } from './remoteSpeechCapture'

describe('remoteSpeechCapture', () => {
  it('encodes samples as little-endian 16-bit PCM, clamping the range', () => {
    const bytes = encodePcm16(new Float32Array([0, 0.5, -1, 2]))
    const view = new DataView(bytes.buffer)
    expect(bytes).toHaveLength(8)
    expect(view.getInt16(0, true)).toBe(0)
    expect(view.getInt16(2, true)).toBe(16383)
    expect(view.getInt16(4, true)).toBe(-32768)
    expect(view.getInt16(6, true)).toBe(32767)
  })

  it('encodes bytes as Base64', () => {
    expect(bytesToBase64(new Uint8Array([0, 0x40, 0xff]))).toBe('AED/')
    expect(bytesToBase64(new Uint8Array())).toBe('')
  })
})
