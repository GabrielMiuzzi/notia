import { declaredMermaidConfig, renderMermaid } from '../mermaid/engines/mermaidEngine'
import { drawXGraphForExport } from '../../services/markdown/xgraphPreviewRuntime'
import { svgToPng } from '../../services/markdown/svgRaster'

/*
 * Pictures of a note's diagrams for its PDF. Rust says which code blocks
 * are diagrams; this module only draws each one as the note shows it in
 * the light theme (the one for white paper) and hands Rust the PNG and its
 * size. A Mermaid diagram that declares its own colors keeps them, over the
 * background it declares: made for a dark background, it stays readable on
 * paper. A diagram that cannot be drawn is left out, and the PDF keeps its
 * code.
 */

export type DiagramKind = 'mermaid' | 'xgraph'

export interface DiagramSource {
  kind: DiagramKind
  source: string
}

export interface DiagramPicture extends DiagramSource {
  /** The PNG, in base64. */
  png: string
  /** Its size as shown, in CSS pixels. */
  width: number
  height: number
}

/** The size an SVG is drawn at: its `viewBox`. */
function svgSize(svg: SVGSVGElement): { width: number; height: number } | null {
  const box = svg.viewBox.baseVal
  if (box && box.width > 0 && box.height > 0) return { width: box.width, height: box.height }
  const width = Number.parseFloat(svg.getAttribute('width') ?? '')
  const height = Number.parseFloat(svg.getAttribute('height') ?? '')
  return width > 0 && height > 0 ? { width, height } : null
}

/** The app's background in the dark theme, read from its tokens. */
function darkThemeBackground(): string {
  const shell = document.createElement('div')
  shell.className = 'notia-app-shell'
  shell.style.cssText = 'position:fixed;left:-20000px;top:0;width:1px;height:1px;visibility:hidden'
  document.body.append(shell)
  try {
    return getComputedStyle(shell).getPropertyValue('--color-app-bg').trim()
  } finally {
    shell.remove()
  }
}

/**
 * What the diagram is drawn over: the background it declares, the dark
 * theme's for a diagram that asks for the dark theme, or the paper.
 */
function mermaidBackground(config: Record<string, unknown>): string {
  const variables = (typeof config.themeVariables === 'object' && config.themeVariables !== null ? config.themeVariables : {}) as Record<string, unknown>
  const declared = typeof variables.background === 'string' ? variables.background.trim() : ''
  const dark = config.theme === 'dark' || variables.darkMode === true
  const background = declared || (dark ? darkThemeBackground() : '')
  return background && CSS.supports('color', background) ? background : 'transparent'
}

async function drawMermaid(source: string): Promise<DiagramPicture | null> {
  const { svg } = await renderMermaid({ code: source, theme: 'light' })
  if (!svg) return null
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  if (!(parsed instanceof SVGSVGElement)) return null
  const size = svgSize(parsed)
  if (!size) return null
  // An image needs a fixed size: Mermaid draws at 100 % of its container.
  parsed.setAttribute('width', String(size.width))
  parsed.setAttribute('height', String(size.height))
  parsed.style.removeProperty('max-width')
  const background = mermaidBackground(await declaredMermaidConfig(source))
  const png = await svgToPng(new XMLSerializer().serializeToString(parsed), size.width, size.height, background)
  return png ? { kind: 'mermaid', source, png, ...size } : null
}

async function drawXGraph(source: string): Promise<DiagramPicture | null> {
  const drawing = await drawXGraphForExport(source)
  if (!drawing) return null
  const png = await svgToPng(drawing.svg, drawing.width, drawing.height, drawing.background)
  return png ? { kind: 'xgraph', source, png, width: drawing.width, height: drawing.height } : null
}

/** Draws the diagrams one after the other; the ones that fail are left out. */
export async function drawDiagramPictures(sources: DiagramSource[]): Promise<DiagramPicture[]> {
  const pictures: DiagramPicture[] = []
  for (const diagram of sources) {
    try {
      const picture = diagram.kind === 'mermaid' ? await drawMermaid(diagram.source) : await drawXGraph(diagram.source)
      if (picture) pictures.push(picture)
    } catch {
      // Invalid code: the PDF shows it as code, as the note does.
    }
  }
  return pictures
}
