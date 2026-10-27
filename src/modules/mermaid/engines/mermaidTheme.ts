/**
 * Mermaid theme variables that follow Notia's palette, for Mermaid's `base`
 * theme. Mermaid derives most colours from the primary, secondary and
 * tertiary trio, but hard-codes others (yellow notes, grey Gantt grid and done
 * tasks, black pie strokes) and builds the pie and git colours from the
 * primary colour, which in the dark theme is navy. Those are set here so every
 * diagram type reads in both themes. The `.mmd` editor, the preview inside
 * Markdown notes, the exports and the public sites share these variables.
 */

export type MermaidThemeVariables = Record<string, string | boolean>

interface Palette {
  page: string
  panel: string
  elevated: string
  hairline: string
  text: string
  muted: string
  teal: string
  periwinkle: string
  amber: string
  sage: string
  violet: string
  pink: string
  coral: string
  gold: string
  slate: string
  /** Text over an accent colour (pie slices, git branches, sequence numbers). */
  onAccent: string
}

const DARK: Palette = {
  page: '#0f1420',
  panel: '#161d2e',
  elevated: '#1b2438',
  hairline: '#29334a',
  text: '#edf0f5',
  muted: '#8892a6',
  teal: '#4fd1c5',
  periwinkle: '#6c8eff',
  amber: '#ffb86b',
  sage: '#6fcf97',
  violet: '#a78bfa',
  pink: '#f28cb1',
  coral: '#ff6b6b',
  gold: '#d9b44a',
  slate: '#64748b',
  onAccent: '#0f1420',
}

const LIGHT: Palette = {
  page: '#eef1f6',
  panel: '#f7f9fc',
  elevated: '#ffffff',
  hairline: '#dce1ea',
  text: '#16202e',
  muted: '#6b7686',
  teal: '#0d9488',
  periwinkle: '#3b5fe0',
  amber: '#d97706',
  sage: '#16a34a',
  violet: '#7c3aed',
  pink: '#db2777',
  coral: '#dc2626',
  gold: '#b08900',
  slate: '#64748b',
  onAccent: '#ffffff',
}

/** The accent order of pie slices and git branches. */
function accents(p: Palette): string[] {
  return [p.teal, p.periwinkle, p.amber, p.sage, p.violet, p.pink, p.coral, p.gold, p.slate, p.muted, p.hairline, p.elevated]
}

/** `appTheme` is `dark` or `light`; anything else counts as light. */
export function buildMermaidThemeVariables(appTheme: string): MermaidThemeVariables {
  const dark = appTheme === 'dark'
  const p = dark ? DARK : LIGHT
  const soft = dark ? p.hairline : p.panel
  const variables: MermaidThemeVariables = {
    darkMode: dark,
    background: p.page,
    primaryColor: p.elevated,
    primaryTextColor: p.text,
    primaryBorderColor: p.teal,
    secondaryColor: soft,
    secondaryTextColor: p.text,
    secondaryBorderColor: p.periwinkle,
    tertiaryColor: p.panel,
    tertiaryTextColor: p.text,
    tertiaryBorderColor: p.violet,
    lineColor: p.muted,
    textColor: p.text,
    nodeBorder: p.teal,
    clusterBkg: p.panel,
    clusterBorder: p.hairline,
    defaultLinkColor: p.muted,
    titleColor: p.text,
    edgeLabelBackground: soft,
    nodeTextColor: p.text,
    // Sequence diagrams: Mermaid's notes are yellow with dark text whatever the theme.
    noteBkgColor: soft,
    noteTextColor: p.text,
    noteBorderColor: p.amber,
    activationBkgColor: soft,
    activationBorderColor: p.teal,
    sequenceNumberColor: p.onAccent,
    // Gantt: greys, `red` and `navy` by default.
    gridColor: p.hairline,
    altSectionBkgColor: p.panel,
    excludeBkgColor: p.panel,
    doneTaskBkgColor: p.hairline,
    doneTaskBorderColor: p.muted,
    critBkgColor: p.coral,
    critBorderColor: p.coral,
    todayLineColor: p.pink,
    vertLineColor: p.periwinkle,
    taskTextClickableColor: p.teal,
    // Pie: black strokes and slices derived from the primary colour by default.
    pieStrokeColor: p.page,
    pieOuterStrokeColor: p.hairline,
    pieTitleTextColor: p.text,
    pieLegendTextColor: p.text,
    pieSectionTextColor: p.onAccent,
    // Git graph: branch colours derived from the primary colour by default.
    commitLabelColor: p.text,
    commitLabelBackground: soft,
    tagLabelColor: p.text,
    tagLabelBackground: p.elevated,
    tagLabelBorder: p.teal,
    // Architecture: grey edges and black group borders by default.
    archEdgeColor: p.muted,
    archEdgeArrowColor: p.muted,
    archGroupBorderColor: p.hairline,
  }
  accents(p).forEach((colour, index) => {
    variables[`pie${index + 1}`] = colour
    if (index < 8) {
      variables[`git${index}`] = colour
      variables[`gitBranchLabel${index}`] = p.onAccent
    }
  })
  return variables
}

/** `[r, g, b, alpha]` of a CSS colour written as hex, `rgb()` or `rgba()`; `null` for anything else. */
function parseColour(value: string): [number, number, number, number] | null {
  const text = value.trim().toLowerCase()
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(text)?.[1]
  if (hex) {
    const full = hex.length <= 4 ? hex.split('').map((digit) => digit + digit).join('') : hex
    const channel = (index: number) => parseInt(full.slice(index * 2, index * 2 + 2), 16)
    return [channel(0), channel(1), channel(2), full.length === 8 ? channel(3) / 255 : 1]
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(text)
  if (!rgb) return null
  const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4])
  const channels = [rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, parseFloat(part)))
  return [channels[0], channels[1], channels[2], Math.min(1, alpha)]
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const [red, green, blue] = [r / 255, g / 255, b / 255]
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  const hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0) : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4
  return [hue * 60, saturation, lightness]
}

function fromHsl(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const base = lightness - chroma / 2
  const sector = Math.floor(hue / 60) % 6
  const [r, g, b] = [[chroma, second, 0], [second, chroma, 0], [0, chroma, second], [0, second, chroma], [second, 0, chroma], [chroma, 0, second]][sector]
  return [r, g, b].map((channel) => Math.round((channel + base) * 255)) as [number, number, number]
}

/**
 * The colour a block (`rect rgb(…)` of a sequence diagram) takes in the
 * theme. An author writes pale colours for a white page; on the dark page the
 * text is light and would vanish on them, so a light colour becomes a dark one
 * of the same hue (and a dark colour a pale one on the light page). `null`
 * keeps the colour: it already suits the theme, or it is not hex or `rgb()`.
 */
export function adaptBlockColour(colour: string, dark: boolean): string | null {
  const parsed = parseColour(colour)
  if (!parsed) return null
  const [r, g, b, alpha] = parsed
  const [hue, saturation, lightness] = toHsl(r, g, b)
  if (dark ? lightness <= 0.55 : lightness >= 0.4) return null
  const [red, green, blue] = dark ? fromHsl(hue, Math.min(saturation, 0.28), 0.18) : fromHsl(hue, Math.min(saturation, 0.6), 0.93)
  return alpha < 1 ? `rgba(${red}, ${green}, ${blue}, ${alpha})` : `rgb(${red}, ${green}, ${blue})`
}

/** The SVG of a diagram with its sequence blocks in colours that suit the theme (see `adaptBlockColour`). */
export function adaptBlockColours(svg: string, dark: boolean): string {
  return svg.replace(/<rect\b[^>]*\bclass="rect"[^>]*>/g, (tag) => tag.replace(/\bfill="([^"]*)"/, (attribute, colour: string) => {
    const adapted = adaptBlockColour(colour, dark)
    return adapted ? `fill="${adapted}"` : attribute
  }))
}
