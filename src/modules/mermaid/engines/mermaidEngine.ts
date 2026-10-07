import type { MermaidRenderResult } from '../types/mermaidTypes'

// ── Cancelación ─────────────────────────────────────────────
export class MermaidRenderCancelledError extends Error {
  constructor(message = 'Mermaid render cancelled') {
    super(message)
    this.name = 'MermaidRenderCancelledError'
  }
}

export function isMermaidRenderCancelledError(error: unknown): error is MermaidRenderCancelledError {
  return error instanceof MermaidRenderCancelledError
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new MermaidRenderCancelledError()
  }
}

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
      background: '#eef1f6',
      primaryColor: '#ffffff',
      primaryTextColor: '#16202e',
      primaryBorderColor: '#0d9488',
      secondaryColor: '#f7f9fc',
      secondaryTextColor: '#16202e',
      secondaryBorderColor: '#3b5fe0',
      tertiaryColor: '#f7f9fc',
      tertiaryTextColor: '#16202e',
      tertiaryBorderColor: '#7c3aed',
      lineColor: '#6b7686',
      textColor: '#16202e',
      nodeBorder: '#0d9488',
      clusterBkg: '#f7f9fc',
      clusterBorder: '#dce1ea',
      defaultLinkColor: '#6b7686',
      titleColor: '#16202e',
      edgeLabelBackground: '#f7f9fc',
      nodeTextColor: '#16202e',
      darkMode: false,
    }
  }
  return {
    background: '#0f1420',
    primaryColor: '#1b2438',
    primaryTextColor: '#edf0f5',
    primaryBorderColor: '#4fd1c5',
    secondaryColor: '#29334a',
    secondaryTextColor: '#edf0f5',
    secondaryBorderColor: '#6c8eff',
    tertiaryColor: '#161d2e',
    tertiaryTextColor: '#edf0f5',
    tertiaryBorderColor: '#a78bfa',
    lineColor: '#8892a6',
    textColor: '#edf0f5',
    nodeBorder: '#4fd1c5',
    clusterBkg: '#161d2e',
    clusterBorder: '#29334a',
    defaultLinkColor: '#8892a6',
    titleColor: '#edf0f5',
    edgeLabelBackground: '#29334a',
    nodeTextColor: '#edf0f5',
    darkMode: true,
  }
}

// Caché LRU con límite por cantidad y tamaño estimado de SVG
interface LruCacheEntry<T> {
  value: T
  weight: number
  lastAccessedAt: number
}

class WeightedLruCache<T> {
  private entries = new Map<string, LruCacheEntry<T>>()
  private totalWeight = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight: number,
    private readonly weigh: (value: T) => number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    entry.lastAccessedAt = performance.now()
    return entry.value
  }

  set(key: string, value: T): void {
    const weight = this.weigh(value)

    // Si una sola entrada excede el límite total, no almacenarla
    if (weight > this.maxWeight) {
      return
    }

    const now = performance.now()
    if (this.entries.has(key)) {
      const old = this.entries.get(key)!
      this.totalWeight -= old.weight
    }

    this.entries.set(key, { value, weight, lastAccessedAt: now })
    this.totalWeight += weight
    this.evictIfNeeded()
  }

  clear(): void {
    this.entries.clear()
    this.totalWeight = 0
  }

  invalidateByPattern(pattern: RegExp): void {
    for (const [key, entry] of this.entries) {
      if (pattern.test(key)) {
        this.entries.delete(key)
        this.totalWeight -= entry.weight
      }
    }
    if (this.totalWeight < 0) {
      this.totalWeight = 0
    }
  }

  private evictIfNeeded(): void {
    while (
      this.entries.size > this.maxEntries ||
      (this.totalWeight > this.maxWeight && this.entries.size > 0)
    ) {
      let oldestKey: string | null = null
      let oldestTime = Infinity
      for (const [key, entry] of this.entries) {
        if (entry.lastAccessedAt < oldestTime) {
          oldestTime = entry.lastAccessedAt
          oldestKey = key
        }
      }
      if (!oldestKey) break
      const removed = this.entries.get(oldestKey)!
      this.entries.delete(oldestKey)
      this.totalWeight -= removed.weight
    }
    if (this.totalWeight < 0) {
      this.totalWeight = 0
    }
  }
}

const DEFAULT_MAX_CACHE_ENTRIES = 20
const DEFAULT_MAX_CACHE_WEIGHT_BYTES = 5 * 1024 * 1024 // 5 MB
const ANDROID_MAX_CACHE_ENTRIES = 10
const ANDROID_MAX_CACHE_WEIGHT_BYTES = 2 * 1024 * 1024 // 2 MB

function resolveMermaidCacheLimits(): { maxEntries: number; maxWeight: number } {
  const isAndroid = /Android/i.test(navigator.userAgent)
  if (isAndroid) {
    return { maxEntries: ANDROID_MAX_CACHE_ENTRIES, maxWeight: ANDROID_MAX_CACHE_WEIGHT_BYTES }
  }
  return { maxEntries: DEFAULT_MAX_CACHE_ENTRIES, maxWeight: DEFAULT_MAX_CACHE_WEIGHT_BYTES }
}

function weighMermaidRenderResult(result: MermaidRenderResult): number {
  return result.svg?.length ?? 0
}

const renderCache = (() => {
  const { maxEntries, maxWeight } = resolveMermaidCacheLimits()
  return new WeightedLruCache<MermaidRenderResult>(maxEntries, maxWeight, weighMermaidRenderResult)
})()

// Hash rápido para strings (FNV-1a 32-bit) — suficiente para caché en memoria y claves de localStorage
export function quickHash(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
  }
  return (h >>> 0).toString(36)
}

// ── Estado global singleton ─────────────────────────────────
let mermaidInstance: typeof import('mermaid').default | null = null
let initPromise: Promise<void> | null = null
let lastInitTheme: string | null = null
let iconPacksRegistered = false

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
const MAX_INIT_RETRIES = 2

async function importMermaidWithRetry(retriesLeft: number, signal?: AbortSignal): Promise<unknown> {
  throwIfAborted(signal)
  try {
    return await import('mermaid')
  } catch (error) {
    if (retriesLeft > 0) {
      import('../../../services/runtime/notiaLogger').then(({ notiaLog }) => {
        notiaLog('mermaid', 'initMermaid import retry', { retriesLeft }, 'warn')
      }).catch(() => {})
      return importMermaidWithRetry(retriesLeft - 1, signal)
    }
    throw error
  }
}

/** Mermaid's own themes, by the name the editor uses; any other value is Notia's palette (`dark`, or light). */
const BUILTIN_THEMES: Record<string, string> = {
  'mermaid-dark': 'dark',
  'mermaid-default': 'default',
  'mermaid-neutral': 'neutral',
  'mermaid-forest': 'forest',
}

async function initMermaid(theme: string, config?: string, signal?: AbortSignal) {
  const initKey = `${theme}|${config ?? ''}`
  if (initPromise && lastInitTheme === initKey) {
    throwIfAborted(signal)
    return initPromise
  }

  initPromise = (async () => {
    try {
      throwIfAborted(signal)
      const mermaidModule = (await importMermaidWithRetry(MAX_INIT_RETRIES, signal)) as {
        default?: typeof import('mermaid').default
      }
      throwIfAborted(signal)
      mermaidInstance = (mermaidModule.default || mermaidModule) as typeof import('mermaid').default

      const builtin = BUILTIN_THEMES[theme]
      const themeConfig: Record<string, unknown> = builtin
        ? { theme: builtin, themeVariables: {} }
        : { theme: 'base', themeVariables: buildMermaidThemeVariables(theme === 'dark' ? 'dark' : 'light') }

      let parsedConfig: Record<string, unknown> = { look: 'classic', ...themeConfig }
      if (config) {
        try {
          const userConfig = JSON.parse(config) as Record<string, unknown>
          parsedConfig = { look: 'classic', ...userConfig, ...themeConfig }
        } catch {
          // ignore invalid config
        }
      }

      throwIfAborted(signal)
      mermaidInstance.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        ...parsedConfig,
      })

      lastInitTheme = initKey

      // Icon packs en paralelo, sin bloquear el primer render
      void registerIconPacks()
    } catch (e) {
      // Resetear el singleton para permitir recuperación en reintentos futuros
      initPromise = null
      lastInitTheme = null
      import('../../../services/runtime/notiaLogger').then(({ notiaLog }) => {
        notiaLog('mermaid', 'initMermaid failed', { error: String(e) }, 'error')
      }).catch(() => {
        console.error('[mermaidEngine] init failed:', e)
      })
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
  abortSignal?: AbortSignal
}

export async function renderMermaid({
  code,
  theme,
  config,
  abortSignal,
}: MermaidRenderOptions): Promise<MermaidRenderResult> {
  const trimmed = code.trim()
  if (!trimmed) {
    return { svg: '', bindFunctions: undefined, diagramType: 'empty' }
  }

  throwIfAborted(abortSignal)

  // 1. Caché
  const key = cacheKey(trimmed, theme, config || '')
  const cached = renderCache.get(key)
  if (cached) {
    return cached
  }

  throwIfAborted(abortSignal)

  // 2. Inicialización lazy
  await initMermaid(theme, config, abortSignal)
  if (!mermaidInstance) throw new Error('Mermaid not initialized')

  throwIfAborted(abortSignal)

  // 3. Validación rápida (skip si ya validamos antes)
  // Nota: mermaid.parse() es síncrono en v11+ pero retorna Promise
  // Lo mantenemos asíncrono por compatibilidad
  await mermaidInstance.parse(trimmed)

  throwIfAborted(abortSignal)

  // 4. Render
  const id = `notia-md-${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
  const { svg, bindFunctions } = await mermaidInstance.render(id, trimmed)

  throwIfAborted(abortSignal)

  const diagramType = detectDiagramType(trimmed)
  const result: MermaidRenderResult = { svg, bindFunctions, diagramType }

  // 5. Guardar en caché
  renderCache.set(key, result)

  return result
}

// ── Warmup (precalentar sin código) ───────────────────────
export function warmupMermaid(theme: string, config?: string, signal?: AbortSignal): void {
  void initMermaid(theme, config, signal)
}

// ── Invalidar caché ─────────────────────────────────────────
export function invalidateMermaidCache(): void {
  renderCache.clear()
}

export function invalidateMermaidCacheByPattern(pattern: RegExp): void {
  renderCache.invalidateByPattern(pattern)
}
