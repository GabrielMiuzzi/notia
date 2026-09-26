import { createRoot } from 'react-dom/client'
import { ChatMarkdownMessage } from '../../chat/ChatMarkdownMessage'

/** Read-only Markdown inside a node view (reusable content), drawn like chat answers. */
export function mountMarkdownPreview(host: HTMLElement, markdown: string): () => void {
  const root = createRoot(host)
  root.render(<ChatMarkdownMessage source={markdown} />)
  // ProseMirror may remove the view while React renders; unmount after that.
  return () => queueMicrotask(() => root.unmount())
}
