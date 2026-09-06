import { createXGraphDocument } from '../../engines/markdown/xgraphEngine'
import jsxGraphRuntimeUrl from '../../../node_modules/jsxgraph/distrib/jsxgraphcore.js?url'
import jsxGraphStylesheetUrl from '../../../node_modules/jsxgraph/distrib/jsxgraph.css?url'

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
        frame.srcdoc = createXGraphDocument(
          decodeURIComponent(host.dataset.xgraphCode ?? ''),
          new URL(jsxGraphRuntimeUrl, document.baseURI).href,
          new URL(jsxGraphStylesheetUrl, document.baseURI).href,
          crypto.randomUUID().replaceAll('-', ''),
        )
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
  const sync = () => {
    for (const [host, dispose] of mounted) {
      if (root.contains(host)) continue
      visible.unobserve(host)
      dispose()
      mounted.delete(host)
    }
    root.querySelectorAll<HTMLElement>('.notia-xgraph-host').forEach((host) => {
      if (mounted.has(host)) return
      mounted.set(host, () => {})
      visible.observe(host)
    })
  }
  const observer = new MutationObserver(sync)
  observer.observe(root, { childList: true, subtree: true })
  sync()
  return () => {
    observer.disconnect()
    visible.disconnect()
    mounted.forEach((dispose) => dispose())
    mounted.clear()
  }
}
