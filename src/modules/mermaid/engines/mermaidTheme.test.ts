import { describe, expect, it } from 'vitest'
import { adaptBlockColour, adaptBlockColours, buildMermaidThemeVariables } from './mermaidTheme'

describe('buildMermaidThemeVariables', () => {
  it('gives sequence notes the palette instead of the yellow Mermaid hard-codes', () => {
    const dark = buildMermaidThemeVariables('dark')
    expect(dark.darkMode).toBe(true)
    expect(dark.noteBkgColor).toBe('#29334a')
    expect(dark.noteTextColor).toBe('#edf0f5')
    expect(dark.noteBorderColor).toBe('#ffb86b')
    expect(dark.activationBkgColor).toBe('#29334a')

    const light = buildMermaidThemeVariables('light')
    expect(light.darkMode).toBe(false)
    expect(light.noteBkgColor).toBe('#f7f9fc')
    expect(light.noteTextColor).toBe('#16202e')
    expect(light.noteBorderColor).toBe('#d97706')
  })

  it('colours pie slices and git branches with the accents and labels them readably', () => {
    const dark = buildMermaidThemeVariables('dark')
    expect([dark.pie1, dark.pie2, dark.pie3]).toEqual(['#4fd1c5', '#6c8eff', '#ffb86b'])
    expect(dark.pie12).toBe('#1b2438')
    expect(dark.pieSectionTextColor).toBe('#0f1420')
    expect(dark.pieStrokeColor).toBe('#0f1420')
    expect(dark.git0).toBe('#4fd1c5')
    expect(dark.git7).toBe('#d9b44a')
    expect(dark.gitBranchLabel7).toBe('#0f1420')

    const light = buildMermaidThemeVariables('light')
    expect(light.pie1).toBe('#0d9488')
    expect(light.pieSectionTextColor).toBe('#ffffff')
  })

  it('replaces the Gantt greys and treats anything but dark as light', () => {
    const light = buildMermaidThemeVariables('system')
    expect(light.darkMode).toBe(false)
    expect(light.gridColor).toBe('#dce1ea')
    expect(light.doneTaskBkgColor).toBe('#dce1ea')
    expect(light.critBkgColor).toBe('#dc2626')
    expect(light.todayLineColor).toBe('#db2777')
  })
})

describe('adaptBlockColours', () => {
  it('turns pale blocks dark on the dark page, keeping their hue, and leaves fitting colours alone', () => {
    expect(adaptBlockColour('rgb(238, 245, 255)', true)).toBe('rgb(33, 44, 59)')
    expect(adaptBlockColour('rgb(240, 250, 240)', true)).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
    const [r, g, b] = adaptBlockColour('rgb(240, 250, 240)', true)!.match(/\d+/g)!.map(Number)
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
    expect(adaptBlockColour('rgba(255, 245, 238, 0.5)', true)).toMatch(/^rgba\(\d+, \d+, \d+, 0\.5\)$/)
    expect(adaptBlockColour('#fff', true)).toBe('rgb(46, 46, 46)')
    expect(adaptBlockColour('rgb(30, 40, 60)', true)).toBeNull()
    expect(adaptBlockColour('rgb(238, 245, 255)', false)).toBeNull()
    expect(adaptBlockColour('rgb(30, 40, 60)', false)).toMatch(/^rgb\(/)
    expect(adaptBlockColour('aqua', true)).toBeNull()
  })

  it('changes only the fill of the sequence blocks in an SVG', () => {
    const svg = '<svg><rect x="0" fill="rgb(238, 245, 255)" stroke="none" class="rect"></rect><rect class="note" fill="rgb(238, 245, 255)"></rect></svg>'
    const adapted = adaptBlockColours(svg, true)
    expect(adapted).toContain('<rect x="0" fill="rgb(33, 44, 59)" stroke="none" class="rect">')
    expect(adapted).toContain('<rect class="note" fill="rgb(238, 245, 255)">')
    expect(adaptBlockColours(svg, false)).toBe(svg)
  })
})
