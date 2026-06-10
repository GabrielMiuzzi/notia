import type { MermaidRenderResult, MermaidDiagram, MermaidEdgeType, ParsedEdgeLine } from '../types/mermaidTypes'

// ── Estado global singleton ─────────────────────────────────
let mermaidInstance: typeof import('mermaid').default | null = null
let initPromise: Promise<void> | null = null
let lastInitTheme: string | null = null
let iconPacksRegistered = false

// ── Theme variables that harmonise with Notia dark/light ────
export interface MermaidThemeVariables {
  background: string
  primaryColor: string
  primaryTextColor: string
  primaryBorderColor: string
  secondaryColor: string
  secondaryTextColor: string
  secondaryBorderColor: string
  tertiaryColor: string
  tertiaryTextColor: string
  tertiaryBorderColor: string
  lineColor: string
  textColor: string
  nodeBorder: string
  clusterBkg: string
  clusterBorder: string
  defaultLinkColor: string
  titleColor: string
  edgeLabelBackground: string
  nodeTextColor: string
  darkMode: boolean
}

export function buildMermaidInitConfig(appTheme: string): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    themeVariables: buildMermaidThemeVariables(appTheme),
  }
}

export function buildMermaidThemeVariables(appTheme: string): MermaidThemeVariables {
  if (appTheme === 'light') {
    return {
      background: '#f5f4ff',
      primaryColor: '#ffffff',
      primaryTextColor: '#3b3d57',
      primaryBorderColor: '#d1cce8',
      secondaryColor: '#e4e0f6',
      secondaryTextColor: '#3b3d57',
      secondaryBorderColor: '#d1cce8',
      tertiaryColor: '#bd93f9',
      tertiaryTextColor: '#3b3d57',
      tertiaryBorderColor: '#7a7ea8',
      lineColor: '#7a7ea8',
      textColor: '#3b3d57',
      nodeBorder: '#d1cce8',
      clusterBkg: '#e4e0f6',
      clusterBorder: '#d1cce8',
      defaultLinkColor: '#7a7ea8',
      titleColor: '#3b3d57',
      edgeLabelBackground: '#e4e0f6',
      nodeTextColor: '#3b3d57',
      darkMode: false,
    }
  }
  return {
    background: '#282a36',
    primaryColor: '#3a3d4f',
    primaryTextColor: '#f8f8f2',
    primaryBorderColor: '#6272a4',
    secondaryColor: '#44475a',
    secondaryTextColor: '#f8f8f2',
    secondaryBorderColor: '#6272a4',
    tertiaryColor: '#6272a4',
    tertiaryTextColor: '#f8f8f2',
    tertiaryBorderColor: '#bd93f9',
    lineColor: '#8b9bbd',
    textColor: '#f8f8f2',
    nodeBorder: '#6272a4',
    clusterBkg: '#3a3d4f',
    clusterBorder: '#6272a4',
    defaultLinkColor: '#8b9bbd',
    titleColor: '#f8f8f2',
    edgeLabelBackground: '#44475a',
    nodeTextColor: '#f8f8f2',
    darkMode: true,
  }
}

// Caché por sesión: hash del código → resultado renderizado
const renderCache = new Map<string, MermaidRenderResult>()

// Hash rápido para strings (FNV-1a 32-bit) — suficiente para caché en memoria
function quickHash(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
  }
  return (h >>> 0).toString(36)
}

function cacheKey(code: string, theme: string, configHash: string): string {
  return `${quickHash(code)}_${quickHash(theme)}_${configHash}`
}

// ── Icon pack registration (lazy + singleton) ──────────────
async function registerIconPacks() {
  if (iconPacksRegistered || !mermaidInstance) return
  try {
    const mm = mermaidInstance as unknown as {
      registerIconPacks?: (packs: { name: string; icons: unknown }[]) => Promise<void> | void
    }
    if (typeof mm.registerIconPacks !== 'function') {
      console.warn('[mermaidEngine] registerIconPacks not available')
      return
    }

    const [
      faModule,
      faSolidModule,
      faBrandsModule,
      gcpModule,
      simpleIconsModule,
    ] = await Promise.all([
      import('@iconify-json/fa').then((m) => (m as { icons?: { prefix: string } }).icons).catch(() => null),
      import('@iconify-json/fa-solid').then((m) => (m as { icons?: { prefix: string } }).icons).catch(() => null),
      import('@iconify-json/fa-brands').then((m) => (m as { icons?: { prefix: string } }).icons).catch(() => null),
      import('@iconify-json/gcp').then((m) => (m as { icons?: { prefix: string } }).icons).catch(() => null),
      import('@iconify-json/simple-icons').then((m) => (m as { icons?: { prefix: string } }).icons).catch(() => null),
    ])

    const packs: { name: string; icons: unknown }[] = []
    if (faModule) packs.push({ name: 'fa', icons: faModule })
    if (faSolidModule) packs.push({ name: 'fa-solid', icons: faSolidModule })
    if (faBrandsModule) packs.push({ name: 'fa-brands', icons: faBrandsModule })
    if (gcpModule) packs.push({ name: 'gcp', icons: gcpModule })
    if (simpleIconsModule) packs.push({ name: 'simple-icons', icons: simpleIconsModule })

    if (packs.length > 0) {
      await mm.registerIconPacks(packs)
      iconPacksRegistered = true
      console.info('[mermaidEngine] Icon packs registered:', packs.map((p) => p.name).join(', '))
    }
  } catch (e) {
    console.warn('[mermaidEngine] Failed to register icon packs:', e)
  }
}

// ── Inicialización lazy ────────────────────────────────────
async function initMermaid(theme: string, config?: string) {
  if (initPromise && lastInitTheme === theme) return initPromise

  initPromise = (async () => {
    try {
      const mermaidModule = await import('mermaid')
      mermaidInstance = (mermaidModule.default || mermaidModule) as typeof import('mermaid').default

      const appTheme = theme === 'dark' ? 'dark' : 'light'
      const themeVariables = buildMermaidThemeVariables(appTheme)

      let parsedConfig: Record<string, unknown> = { theme: 'base', themeVariables }
      if (config) {
        try {
          const userConfig = JSON.parse(config) as Record<string, unknown>
          parsedConfig = { ...userConfig, theme: 'base', themeVariables }
        } catch {
          // ignore invalid config
        }
      }

      mermaidInstance.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        ...parsedConfig,
      })

      lastInitTheme = theme

      // Icon packs en paralelo, sin bloquear el primer render
      void registerIconPacks()
    } catch (e) {
      console.error('[mermaidEngine] init failed:', e)
      throw e
    }
  })()

  return initPromise
}

// ── Detección de diagram type ───────────────────────────────
function detectDiagramType(code: string): string {
  const c = code.toLowerCase()
  if (c.includes('flowchart') || c.includes('graph')) return 'flowchart'
  if (c.includes('sequencediagram')) return 'sequenceDiagram'
  if (c.includes('classdiagram')) return 'classDiagram'
  if (c.includes('statediagram')) return 'stateDiagram'
  if (c.includes('erdiagram')) return 'erDiagram'
  if (c.includes('gantt')) return 'gantt'
  if (c.includes('pie')) return 'pie'
  if (c.includes('gitgraph')) return 'gitGraph'
  if (c.includes('mindmap')) return 'mindmap'
  return 'unknown'
}

// ── Render público ────────────────────────────────────────
export interface MermaidRenderOptions {
  code: string
  theme: string
  config?: string
}

export async function renderMermaid({
  code,
  theme,
  config,
}: MermaidRenderOptions): Promise<MermaidRenderResult> {
  const trimmed = code.trim()
  if (!trimmed) {
    return { svg: '', bindFunctions: undefined, diagramType: 'empty' }
  }

  // 1. Caché
  const key = cacheKey(trimmed, theme, config || '')
  const cached = renderCache.get(key)
  if (cached) {
    return cached
  }

  // 2. Inicialización lazy
  await initMermaid(theme, config)
  if (!mermaidInstance) throw new Error('Mermaid not initialized')

  // 3. Validación rápida (skip si ya validamos antes)
  // Nota: mermaid.parse() es síncrono en v11+ pero retorna Promise
  // Lo mantenemos asíncrono por compatibilidad
  await mermaidInstance.parse(trimmed)

  // 4. Render
  const id = `notia-md-${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
  const { svg, bindFunctions } = await mermaidInstance.render(id, trimmed)

  const diagramType = detectDiagramType(trimmed)
  const result: MermaidRenderResult = { svg, bindFunctions, diagramType }

  // 5. Guardar en caché (limitar tamaño a 20 entries)
  if (renderCache.size >= 20) {
    const firstKey = renderCache.keys().next().value
    if (firstKey) renderCache.delete(firstKey)
  }
  renderCache.set(key, result)

  return result
}

// ── Warmup (precalentar sin código) ───────────────────────
export function warmupMermaid(theme: string, config?: string): void {
  void initMermaid(theme, config)
}

// ── Invalidar caché ─────────────────────────────────────────
export function invalidateMermaidCache(): void {
  renderCache.clear()
}

// ── Stubs para compatibilidad con useMermaidEditor ──────────
export function parseMermaidSource(_source: string): MermaidDiagram {
  return { nodes: [], edges: [] }
}

export function serializeMermaidDiagram(_diagram: MermaidDiagram): string {
  return ''
}

export function buildDefaultMermaidDiagram(): MermaidDiagram {
  return { nodes: [], edges: [] }
}

export function createNode(shape: string, _x: number, _y: number, label?: string) {
  return {
    id: `n${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    label: label || shape,
    shape: shape as 'rect' | 'circle' | 'diamond' | 'cylinder',
    x: 0,
    y: 0,
    width: 120,
    height: 60,
  }
}

export function createEdge(from: string, to: string, label?: string) {
  return { id: `e${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`, from, to, label }
}

/** Extrae el ID real de un nodo desde su id de SVG renderizado por Mermaid.
 *  Mermaid v11 genera ids como: {renderId}-flowchart-{nodeId}-{index}
 *  Esta función extrae el {nodeId} original del código fuente. */
export function extractMermaidNodeId(rawId: string): string {
  if (!rawId) return ''
  const v11 = rawId.match(/-flowchart-(.+)-\d+$/)
  if (v11) return v11[1]
  const old = rawId.match(/^flowchart-(.+)-\d+$/)
  if (old) return old[1]
  return rawId
}

/** Elimina flechas que contienen IDs generados por Mermaid en el SVG.
 *  Estos IDs (p. ej. notia-md-xxx-flowchart-A-0) nunca deben estar en el
 *  código fuente; si están, Mermaid crea nodos implícitos fantasma. */
export function sanitizeMermaidCode(code: string): string {
  const lines = code.split('\n')
  const cleaned = lines.filter((line) => {
    const trimmed = line.trim()
    // Solo revisar líneas que son flechas
    if (!/(--?>|==?>|-.->)/.test(trimmed)) return true
    // Rechazar IDs de renderizado de Mermaid
    if (/\bnotia-md-[^\s]*-flowchart-[^\s]+-\d+\b/.test(trimmed)) return false
    if (/\bflowchart-[^\s]+-\d+\b/.test(trimmed)) return false
    return true
  })
  return cleaned.join('\n')
}

/** Verifica si una flecha entre dos nodos ya existe en el código Mermaid. */
export function edgeExistsInCode(code: string, from: string, to: string): boolean {
  const lines = code.split('\n')
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const arrowRe = new RegExp(
    `^\\s*${esc(from)}\\s*(--?>|==?>|-.->)\\s*${esc(to)}\\s*$`,
  )
  return lines.some((line) => arrowRe.test(line))
}

/** Actualiza el texto (label) de un nodo en el código Mermaid.
 *  Soporta sintaxis v11: id@{ shape: ... }, id@{ icon: ... },
 *  y sintaxis legacy: id["text"], id((text)), id{text}, id[/text/], etc. */
export function updateNodeLabelInCode(code: string, nodeId: string, newLabel: string): string {
  if (!nodeId) return code
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return code
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      // Skip arrows
      if (/^\s*\w+\s*(--?>|==?>|-.->)/.test(trimmed)) return line
      if (!trimmed.includes(nodeId)) return line

      // v11+ icon syntax:  id@{ icon: "fa:home", form: "square", label: "old" }
      const iconRe = new RegExp(
        `^(\\s*${esc(nodeId)}\\s*@\\{[^}]*label\\s*:\\s*)"([^"]*)"(\\s*[,}].*)$`,
      )
      const iconMatch = line.match(iconRe)
      if (iconMatch) {
        return `${iconMatch[1]}"${newLabel}"${iconMatch[3]}`
      }

      // v11+ shape syntax (no icon):  id@{ shape: rect }  or  id@{ shape: rect, label: "x" }
      // If it has @{ but no label field, inject label:
      const shapeRe = new RegExp(`^(\\s*${esc(nodeId)}\\s*@\\{)(\\s*[^}]*)(\\}.*)$`)
      const shapeMatch = line.match(shapeRe)
      if (shapeMatch) {
        const inner = shapeMatch[2].trim()
        if (inner.includes('label')) {
          // Replace existing label
          const withLabel = inner.replace(
            /(label\s*:\s*)"[^"]*"/,
            `$1"${newLabel}"`,
          )
          return `${shapeMatch[1]}${withLabel}${shapeMatch[3]}`
        }
        // Insert label before closing brace
        const sep = inner.endsWith(',') || inner === '' ? '' : ', '
        return `${shapeMatch[1]}${inner}${sep} label: "${newLabel}"${shapeMatch[3]}`
      }

      // Legacy bracket shapes: id["text"], id((text)), id{text}, id[/text/], id[\text\], etc.
      const legacyRe = new RegExp(
        `^(\\s*${esc(nodeId)})(\\[["']?[^\]]*["']?\\]|\\(\\([^\\)]*\\)\\)|\\{[^}]*\\}|\\[[^\]]*\\]|\\[\\\\[^\\]]*\\\\\\]|\\[/[^/]*/\\]|\\[\\\\[^\\]]*/\\]|\\[^\s]*\\([^\\)]*\\)).*$`,
      )
      const legacyMatch = line.match(legacyRe)
      if (legacyMatch) {
        const fullBracket = legacyMatch[2]
        const open = fullBracket[0]
        const close = fullBracket[fullBracket.length - 1]
        // Replace content inside brackets, keep quotes if they existed
        const hadQuotes =
          (fullBracket.length > 2 && fullBracket[1] === '"' && fullBracket[fullBracket.length - 2] === '"') ||
          (fullBracket.length > 2 && fullBracket[1] === "'" && fullBracket[fullBracket.length - 2] === "'")
        if (hadQuotes) {
          return line.replace(fullBracket, `${open}"${newLabel}"${close}`)
        }
        return line.replace(fullBracket, `${open}${newLabel}${close}`)
      }

      // Plain node definition: id --> ... or id alone
      // If the line is just "id" or "id someText", replace/append text
      const plainRe = new RegExp(`^(\\s*${esc(nodeId)})(\\s+.*)?$`)
      const plainMatch = line.match(plainRe)
      if (plainMatch) {
        if (plainMatch[2]) {
          return line.replace(plainMatch[2], ` "${newLabel}"`)
        }
        return `${line} "${newLabel}"`
      }

      return line
    })
    .join('\n')
}

/* ── Edge parsing and editing (pure engine) ───────────────── */

const EDGE_LINE_RE = /^(\s*)(\S+?)\s*(--[-]*[>ox]?|==[=]*[>ox]?|-\.[-.]*[>ox]?|~~~)\s*(?:\|([^|]*)\|)?\s*(\S+)\s*(.*)$/

function inferEdgeType(operator: string): MermaidEdgeType {
  const op = operator.trim()
  if (op === '~~~') return 'invisible'
  if (op === '--o') return 'circle'
  if (op === '--x') return 'cross'
  if (op.startsWith('==')) {
    return op.includes('>') ? 'thickArrow' : 'thick'
  }
  if (op.startsWith('-.')) {
    return op.includes('>') ? 'dottedArrow' : 'dotted'
  }
  if (op.startsWith('--')) {
    return op.includes('>') ? 'arrow' : 'open'
  }
  return 'arrow'
}

/** Parse every edge line in the Mermaid code, skipping comments and linkStyle directives. */
export function parseEdgeLines(code: string): ParsedEdgeLine[] {
  const lines = code.split('\n')
  const edges: ParsedEdgeLine[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('%%')) continue
    if (/^linkStyle\s+\d+/i.test(trimmed)) continue

    const match = trimmed.match(EDGE_LINE_RE)
    if (!match) continue

    const from = match[2]
    const operator = match[3]
    const label = match[4]?.trim() || undefined
    const to = match[5]

    edges.push({
      index: edges.length,
      from,
      to,
      type: inferEdgeType(operator),
      label,
      raw: line,
    })
  }

  return edges
}

/** Compute the edge index (0-based) used by Mermaid linkStyle. */
export function getEdgeIndexInCode(
  code: string,
  fromNodeId: string,
  toNodeId: string,
): number {
  if (!fromNodeId || !toNodeId) return -1
  const edges = parseEdgeLines(code)
  const target = edges.find((e) => e.from === fromNodeId && e.to === toNodeId)
  return target?.index ?? -1
}

/** Build a single edge line with the given type and optional label. */
function buildEdgeSyntax(
  from: string,
  to: string,
  type: MermaidEdgeType,
  label?: string,
): string {
  const esc = (s: string) => s.replace(/"/g, '\\"')
  const pipeLabel = label ? `|"${esc(label)}"|` : ''

  switch (type) {
    case 'arrow':       return `${from} -->${pipeLabel} ${to}`
    case 'open':        return `${from} ---${pipeLabel} ${to}`
    case 'dottedArrow': return `${from} -.->${pipeLabel} ${to}`
    case 'dotted':      return `${from} -.-.${pipeLabel} ${to}`
    case 'thickArrow':  return `${from} ==>${pipeLabel} ${to}`
    case 'thick':       return `${from} ===${pipeLabel} ${to}`
    case 'circle':      return `${from} --o${pipeLabel} ${to}`
    case 'cross':       return `${from} --x${pipeLabel} ${to}`
    case 'invisible':   return `${from} ~~~${pipeLabel} ${to}`
    default:            return `${from} -->${pipeLabel} ${to}`
  }
}

/** Replace the arrow type of an existing edge while preserving its label. */
export function updateEdgeTypeInCode(
  code: string,
  fromNodeId: string,
  toNodeId: string,
  newType: MermaidEdgeType,
): string {
  if (!fromNodeId || !toNodeId) return code
  const edges = parseEdgeLines(code)
  const target = edges.find((e) => e.from === fromNodeId && e.to === toNodeId)
  if (!target) return code

  const newLine = buildEdgeSyntax(fromNodeId, toNodeId, newType, target.label)
  return code.replace(target.raw, newLine)
}

/** Set or update the label of an existing edge. Empty string removes the label. */
export function updateEdgeLabelInCode(
  code: string,
  fromNodeId: string,
  toNodeId: string,
  newLabel: string,
): string {
  if (!fromNodeId || !toNodeId) return code
  const edges = parseEdgeLines(code)
  const target = edges.find((e) => e.from === fromNodeId && e.to === toNodeId)
  if (!target) return code

  const label = newLabel.trim() || undefined
  const newLine = buildEdgeSyntax(fromNodeId, toNodeId, target.type, label)
  return code.replace(target.raw, newLine)
}

/** Add or update a linkStyle declaration for the edge color.
 *  If a linkStyle for the same index already exists, it updates only the stroke color,
 *  preserving other properties (stroke-width, etc.). */
export function updateEdgeColorInCode(
  code: string,
  fromNodeId: string,
  toNodeId: string,
  color: string,
): string {
  if (!fromNodeId || !toNodeId || !color) return code
  const edges = parseEdgeLines(code)
  const target = edges.find((e) => e.from === fromNodeId && e.to === toNodeId)
  if (!target) return code

  const edgeIndex = target.index
  const lines = code.split('\n')
  const linkStyleRe = new RegExp(`^(\\s*)linkStyle\\s+${edgeIndex}\\b(.*)$`)

  let replaced = false
  const newLines = lines.map((line) => {
    const match = line.match(linkStyleRe)
    if (!match) return line
    replaced = true
    const indent = match[1]
    const rest = match[2] || ''
    const newRest = rest.includes('stroke:')
      ? rest.replace(/stroke:[^,]+/, `stroke:${color}`)
      : rest.trim()
        ? `${rest.trim()},stroke:${color}`
        : ` stroke:${color}`
    return `${indent}linkStyle ${edgeIndex}${newRest}`
  })

  if (!replaced) {
    newLines.push(`linkStyle ${edgeIndex} stroke:${color}`)
  }

  return newLines.join('\n')
}
