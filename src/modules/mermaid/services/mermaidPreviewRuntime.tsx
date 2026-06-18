import ReactDOM from 'react-dom/client'
import { InlineMermaidPreview } from '../components/InlineMermaidPreview'

const mountMap = new WeakMap<HTMLElement, ReactDOM.Root>()

export function mountInlineMermaidPreview(container: HTMLElement, code: string, storageKey: string): void {
  if (mountMap.has(container)) {
    return
  }

  const root = ReactDOM.createRoot(container)
  mountMap.set(container, root)
  root.render(<InlineMermaidPreview code={code} storageKey={storageKey} />)
}

export function unmountInlineMermaidPreview(container: HTMLElement): void {
  const root = mountMap.get(container)
  if (root) {
    root.unmount()
    mountMap.delete(container)
  }
}
