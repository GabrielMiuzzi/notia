/**
 * The frame that draws one XGraph board of a public page. The page opens it
 * sandboxed and without an origin, sends the board's code and the colours of
 * its theme, and the frame writes the same document the editor draws boards
 * with (`createXGraphDocument`), so the note's JavaScript runs only here.
 */

import { createXGraphDocument, type XGraphTheme } from './engines/markdown/xgraphEngine'
import runtimeUrl from '../node_modules/jsxgraph/distrib/jsxgraphcore.js?url'
import stylesheetUrl from '../node_modules/jsxgraph/distrib/jsxgraph.css?url'

interface DrawMessage {
  type: 'notia-xgraph-draw'
  code: string
  theme?: XGraphTheme
}

function isDrawMessage(value: unknown): value is DrawMessage {
  const message = value as Partial<DrawMessage> | null
  return Boolean(message) && message?.type === 'notia-xgraph-draw' && typeof message.code === 'string'
}

/** `crypto.randomUUID` needs a secure context; the site is plain HTTP on the network. */
function nonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || !isDrawMessage(event.data)) return
  const html = createXGraphDocument(
    event.data.code,
    new URL(runtimeUrl, window.location.href).href,
    new URL(stylesheetUrl, window.location.href).href,
    nonce(),
    event.data.theme,
  )
  document.open()
  document.write(html)
  document.close()
})

window.parent.postMessage({ type: 'notia-xgraph-ready' }, '*')
