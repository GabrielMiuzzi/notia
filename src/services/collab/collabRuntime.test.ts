import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64 } from './collabRuntime'

describe('collab base64', () => {
  it('round-trips binary updates, large ones included', () => {
    const small = new Uint8Array([0, 1, 2, 250, 255])
    expect(bytesToBase64(small)).toBe('AAEC+v8=')
    expect(Array.from(base64ToBytes(bytesToBase64(small)))).toEqual(Array.from(small))
    const large = new Uint8Array(100_000).map((_, index) => index % 256)
    expect(base64ToBytes(bytesToBase64(large))).toEqual(large)
  })
})
