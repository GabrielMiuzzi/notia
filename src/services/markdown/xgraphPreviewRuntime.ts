import { createXGraphDocument, type XGraphTheme } from '../../engines/markdown/xgraphEngine'
import jsxGraphRuntimeUrl from '../../../node_modules/jsxgraph/distrib/jsxgraphcore.js?url'
import jsxGraphStylesheetUrl from '../../../node_modules/jsxgraph/distrib/jsxgraph.css?url'

const XGRAPH_HOST_SELECTOR = '.notia-xgraph-host'
/** A board drawn for an export, in CSS pixels: about the sheet's text width and the editor frame's height. */
const EXPORT_BOARD = { width: 960, height: 480 }
const EXPORT_TIMEOUT_MS = 6000

/** The frame's document for a board, with the theme of the block around it. */
function frameDocument(code: string, theme: XGraphTheme | undefined, textInSvg = false): string {
  return createXGraphDocument(
    code,
    new URL(jsxGraphRuntimeUrl, document.baseURI).href,
    new URL(jsxGraphStylesheetUrl, document.baseURI).href,
    crypto.randomUUID().replaceAll('-', ''),
    theme,
    textInSvg,
  )
}

/** The board's colors, read from the theme tokens around the block. */
function boardTheme(host: HTMLElement): XGraphTheme | undefined {
  const style = getComputedStyle(host)
  const token = (name: string) => style.getPropertyValue(name).trim()
  const theme = {
    background: token('--notia-el-well') || token('--color-app-bg'),
    text: token('--color-muted-text'),
    axis: token('--color-muted-text'),
    grid: token('--color-card-bg'),
    curve: token('--color-accent-text'),
    point: token('--color-amber'),
  }
  return Object.values(theme).every(Boolean) ? theme : undefined
}

export function observeXGraphPreviews(root: HTMLElement): () => void {
  const mounted = new Map<HTMLElement, () => void>()
  const mount = (host: HTMLElement) => {
    let disposed = false
    const timer = window.setTimeout(() => {
      void Promise.resolve().then(() => {
        if (disposed || !host.isConnected) return
        const frame = document.createElement('iframe')
        frame.title = 'Visualizador JSXGraph'
        frame.className = 'notia-xgraph-frame'
        frame.setAttribute('sandbox', 'allow-scripts')
        frame.setAttribute('referrerpolicy', 'no-referrer')
        frame.srcdoc = frameDocument(decodeURIComponent(host.dataset.xgraphCode ?? ''), boardTheme(host))
        host.replaceChildren(frame)
      }).catch(() => {
        if (disposed || !host.isConnected) return
        host.textContent = 'No se pudo cargar XGraph. Volvé a abrir la nota para reintentar.'
        host.setAttribute('role', 'alert')
      })
    }, 300)
    mounted.set(host, () => {
      disposed = true
      window.clearTimeout(timer)
      host.replaceChildren()
    })
  }
  const visible = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue
      visible.unobserve(entry.target)
      mount(entry.target)
    }
  }, { rootMargin: '200px' })
  const forgetRemoved = () => {
    for (const [host, dispose] of mounted) {
      if (root.contains(host)) continue
      visible.unobserve(host)
      dispose()
      mounted.delete(host)
    }
  }
  const watch = (host: HTMLElement) => {
    if (mounted.has(host)) return
    mounted.set(host, () => {})
    visible.observe(host)
  }
  const watchWithin = (element: HTMLElement) => {
    if (element.matches(XGRAPH_HOST_SELECTOR)) watch(element)
    element.querySelectorAll<HTMLElement>(XGRAPH_HOST_SELECTOR).forEach(watch)
  }
  // Only what each change brings or takes is looked at: typing a line does
  // not search the whole note for boards.
  const observer = new MutationObserver((records) => {
    let removed = false
    for (const record of records) {
      if (record.removedNodes.length > 0) removed = true
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) watchWithin(node)
      })
    }
    if (removed && mounted.size > 0) forgetRemoved()
  })
  observer.observe(root, { childList: true, subtree: true })
  root.querySelectorAll<HTMLElement>(XGRAPH_HOST_SELECTOR).forEach(watch)
  return () => {
    observer.disconnect()
    visible.disconnect()
    mounted.forEach((dispose) => dispose())
    mounted.clear()
  }
}

export interface XGraphDrawing {
  svg: string
  width: number
  height: number
  background: string
}

/** The light theme's board colors, read from its tokens, as a note shows them in the light theme. */
function lightBoardTheme(): XGraphTheme | undefined {
  const shell = document.createElement('div')
  shell.className = 'notia-app-shell notia-theme-light'
  shell.style.cssText = 'position:fixed;left:-20000px;top:0;width:1px;height:1px;visibility:hidden'
  const host = document.createElement('div')
  host.className = 'notia-xgraph-host'
  shell.append(host)
  document.body.append(shell)
  try {
    return boardTheme(host)
  } finally {
    shell.remove()
  }
}

/**
 * Draws a board off screen with the light theme, as the note shows it, and
 * returns its drawing for an export; `null` when it does not answer.
 */
export function drawXGraphForExport(code: string): Promise<XGraphDrawing | null> {
  const theme = lightBoardTheme()
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${EXPORT_BOARD.width}px;height:${EXPORT_BOARD.height}px;border:0;pointer-events:none`
  const id = crypto.randomUUID()
  return new Promise<XGraphDrawing | null>((resolve) => {
    const timer = window.setTimeout(() => finish(null), EXPORT_TIMEOUT_MS)
    function finish(drawing: XGraphDrawing | null) {
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      frame.remove()
      resolve(drawing)
    }
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; id?: string; svg?: string } | null
      if (event.source !== frame.contentWindow || data?.type !== 'notia-xgraph-svg' || data.id !== id) return
      finish(data.svg ? { svg: data.svg, ...EXPORT_BOARD, background: theme?.background ?? '#ffffff' } : null)
    }
    window.addEventListener('message', onMessage)
    // The board is drawn by the time the frame has loaded.
    frame.addEventListener('load', () => {
      frame.contentWindow?.postMessage({ type: 'notia-xgraph-export', id }, '*')
    }, { once: true })
    frame.srcdoc = frameDocument(code, theme, true)
    document.body.append(frame)
  })
}
