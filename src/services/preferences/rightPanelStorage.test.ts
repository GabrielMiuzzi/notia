import { describe, expect, it } from 'vitest'
import { clampRightPanelWidth } from './rightPanelStorage'

describe('clampRightPanelWidth', () => {
  it('keeps the panel within its minimum and the available workspace width', () => {
    expect(clampRightPanelWidth(200, 1200)).toBe(320)
    expect(clampRightPanelWidth(800, 900)).toBe(660)
    expect(clampRightPanelWidth(500, 1200)).toBe(500)
  })
})
