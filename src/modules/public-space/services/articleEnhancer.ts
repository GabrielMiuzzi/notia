/**
 * Visual touches of a page the server already wrote: tabs that switch,
 * code colours and the buttons of its frame (numbers, wrap, copy), KaTeX
 * formulas, Mermaid diagrams and XGraph boards. Nothing here decides what
 * the page contains: the server writes every block and its frame.
 *
 * It runs again on the same article when the visitor changes the theme, so
 * every touch is applied once and only the diagrams and boards are drawn again.
 */

import { adaptBlockColours, buildMermaidThemeVariables } from '../../mermaid/engines/mermaidTheme'
import type { XGraphTheme } from '../../../engines/markdown/xgraphEngine'

type HastNode =
  | { type: 'text'; value: string }
  | { type: 'element'; tagName: string; properties?: { className?: string[] | string }; children: HastNode[] }
  | { type: 'root'; children: HastNode[] }

function appendHast(parent: Node, nodes: HastNode[]): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      parent.appendChild(document.createTextNode(node.value))
    } else if (node.type === 'element') {
      const element = document.createElement(node.tagName)
      const className = node.properties?.className
      if (className) element.className = Array.isArray(className) ? className.join(' ') : className
      appendHast(element, node.children)
      parent.appendChild(element)
    } else {
      appendHast(parent, node.children)
    }
  }
}

/**
 * The highlighted nodes cut at each newline, one list per line. A token that
 * spans lines (a block comment) is repeated on each of them.
 */
export function splitHastLines(nodes: HastNode[]): HastNode[][] {
  const lines: HastNode[][] = [[]]
  const merge = (pieces: HastNode[][], wrap: (children: HastNode[]) => HastNode) => {
    pieces.forEach((children, index) => {
      if (index > 0) lines.push([])
      if (children.length > 0) lines[lines.length - 1].push(wrap(children))
    })
  }
  for (const node of nodes) {
    if (node.type === 'text') {
      merge(node.value.split('\n').map((value) => (value ? [{ type: 'text', value } as HastNode] : [])), (children) => children[0])
    } else if (node.type === 'element') {
      merge(splitHastLines(node.children), (children) => ({ ...node, children }))
    } else {
      splitHastLines(node.children).forEach((children, index) => {
        if (index > 0) lines.push([])
        lines[lines.length - 1].push(...children)
      })
    }
  }
  return lines
}

let highlighterPromise: Promise<{ highlight: (code: string, language: string) => HastNode; registered: (language: string) => boolean }> | null = null

function loadHighlighter() {
  highlighterPromise ??= Promise.all([import('refractor'), import('refractor/jsx'), import('refractor/tsx')]).then(([common, jsx, tsx]) => {
    common.refractor.register(jsx.default)
    common.refractor.register(tsx.default)
    return common.refractor as unknown as { highlight: (code: string, language: string) => HastNode; registered: (language: string) => boolean }
  })
  return highlighterPromise
}

const LANGUAGE_ALIASES: Record<string, string> = { js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', html: 'markup', xml: 'markup', 'c++': 'cpp', py: 'python', yml: 'yaml' }

function codeLines(code: Element): HTMLElement[] {
  return Array.from(code.querySelectorAll<HTMLElement>(':scope > .ps-line'))
}

/** Colours each line of the code blocks, keeping one line per row for the numbers and the wrap. */
async function highlightCode(root: HTMLElement): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre.ps-code > code[class*="language-"]:not([data-highlighted])'))
  if (blocks.length === 0) return
  const highlighter = await loadHighlighter()
  for (const code of blocks) {
    code.dataset.highlighted = 'true'
    const declared = /language-([\w+#-]+)/.exec(code.className)?.[1]?.toLowerCase() ?? ''
    const language = LANGUAGE_ALIASES[declared] ?? declared
    const lines = codeLines(code)
    if (!language || lines.length === 0 || !highlighter.registered(language)) continue
    const tree = highlighter.highlight(lines.map((line) => line.textContent ?? '').join('\n'), language)
    const highlighted = splitHastLines('children' in tree ? tree.children : [])
    if (highlighted.length !== lines.length) continue
    lines.forEach((line, index) => {
      line.textContent = ''
      appendHast(line, highlighted[index])
    })
  }
}

/** `navigator.clipboard` only exists in secure contexts, and the site is plain HTTP on the network. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Falls back to the selection below.
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  area.remove()
  return copied
}

function onCodeButton(button: HTMLButtonElement): void {
  const block = button.closest<HTMLElement>('.ps-code-block')
  const action = button.dataset.action
  if (!block || !action) return
  if (action === 'numbers' || action === 'wrap') {
    const next = button.getAttribute('aria-pressed') !== 'true'
    button.setAttribute('aria-pressed', String(next))
    block.dataset[action] = String(next)
    return
  }
  if (action !== 'copy') return
  const code = block.querySelector('pre.ps-code > code')
  const text = code ? codeLines(code).map((line) => line.textContent ?? '').join('\n') : ''
  const label = button.querySelector('span')
  void copyText(text).then((copied) => {
    if (!label) return
    label.textContent = copied ? 'Copiado' : 'No se pudo copiar'
    window.setTimeout(() => { label.textContent = 'Copiar' }, 1600)
  })
}

/** One listener for the article: its content changes with each page, the element stays. */
function wireCodeButtons(root: HTMLElement): void {
  if (root.dataset.codeWired) return
  root.dataset.codeWired = 'true'
  root.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button.ps-code-button')
    if (button && root.contains(button)) onCodeButton(button)
  })
}

function wireTabs(root: HTMLElement): void {
  for (const tabs of Array.from(root.querySelectorAll<HTMLElement>('.ps-tabs:not([data-wired])'))) {
    tabs.dataset.wired = 'true'
    const buttons = Array.from(tabs.querySelectorAll<HTMLButtonElement>(':scope > .ps-tabs-list > .ps-tab'))
    const panels = Array.from(tabs.querySelectorAll<HTMLElement>(':scope > .ps-tab-panel'))
    const select = (index: number) => {
      buttons.forEach((button, position) => {
        button.setAttribute('aria-selected', String(position === index))
        button.tabIndex = position === index ? 0 : -1
      })
      panels.forEach((panel, position) => { panel.hidden = position !== index })
    }
    buttons.forEach((button, index) => {
      button.tabIndex = index === 0 ? 0 : -1
      button.addEventListener('click', () => select(index))
      button.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        if (!step) return
        event.preventDefault()
        const next = (index + step + buttons.length) % buttons.length
        select(next)
        buttons[next]?.focus()
      })
    })
  }
}

async function renderMath(root: HTMLElement): Promise<void> {
  const formulas = Array.from(root.querySelectorAll<HTMLElement>('.ps-math:not([data-rendered])'))
  if (formulas.length === 0) return
  const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')])
  for (const formula of formulas) {
    formula.dataset.rendered = 'true'
    const tex = formula.textContent ?? ''
    try {
      katex.render(tex, formula, { displayMode: formula.classList.contains('ps-math-display'), throwOnError: false, output: 'html' })
    } catch {
      formula.textContent = tex
    }
  }
}

const DIAGRAM_ERROR = 'No se pudo dibujar el diagrama; este es su código.'

/** The source stays visible, with the reason over it. */
function markDiagramError(source: HTMLElement): void {
  source.classList.add('ps-diagram-error')
  source.dataset.error = DIAGRAM_ERROR
}

// Mermaid's render reads and writes global state, so two renders at once
// corrupt each other. Every diagram render goes through this one chain, which
// also serialises the two runs React StrictMode fires on mount.
let diagramChain: Promise<unknown> = Promise.resolve()
let diagramCounter = 0

async function drawDiagrams(targets: HTMLElement[], theme: 'dark' | 'light'): Promise<void> {
  let mermaid: typeof import('mermaid').default
  try {
    mermaid = (await import('mermaid')).default
  } catch {
    // The viewer did not load (a rebuilt site renames its files, or the network dropped): the code stays readable.
    targets.filter((target) => target.isConnected && !target.classList.contains('ps-diagram')).forEach(markDiagramError)
    return
  }
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: buildMermaidThemeVariables(theme) })
  for (const target of targets) {
    if (!target.isConnected || target.dataset.renderedTheme === theme) continue
    const drawn = target.classList.contains('ps-diagram')
    const source = drawn ? target.dataset.source ?? '' : target.textContent ?? ''
    try {
      const { svg } = await mermaid.render(`ps-diagram-${(diagramCounter += 1)}`, source)
      const figure = drawn ? target : document.createElement('div')
      figure.className = 'ps-diagram'
      figure.dataset.source = source
      figure.dataset.renderedTheme = theme
      figure.innerHTML = adaptBlockColours(svg, theme === 'dark')
      if (!drawn) target.replaceWith(figure)
    } catch {
      if (!drawn) markDiagramError(target)
    }
  }
}

/**
 * Draws each `pre.ps-mermaid` as a figure that keeps its source, and draws
 * the figures again (for the other theme) when the article is enhanced again.
 */
function renderDiagrams(root: HTMLElement, dark: boolean): Promise<void> {
  const theme = dark ? 'dark' : 'light'
  const targets = Array.from(root.querySelectorAll<HTMLElement>('pre.ps-mermaid, .ps-diagram'))
    .filter((target) => target.dataset.renderedTheme !== theme)
  if (targets.length === 0) return Promise.resolve()
  const run = diagramChain.then(() => drawDiagrams(targets, theme))
  diagramChain = run.catch(() => undefined)
  return run
}

/** The frame the server serves for one board; the page never runs the board's code. */
export const XGRAPH_FRAME_URL = '/xgraph-frame'

interface PendingBoard {
  code: string
  theme: XGraphTheme
}

/** What each frame draws once it says it is ready. */
const pendingBoards = new WeakMap<HTMLIFrameElement, PendingBoard>()
let listeningToBoards = false

function listenToBoards(): void {
  if (listeningToBoards) return
  listeningToBoards = true
  window.addEventListener('message', (event) => {
    const data = event.data as { type?: unknown } | null
    if (!event.source || data?.type !== 'notia-xgraph-ready') return
    // The frame that sent it, among the page's boards.
    const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe.ps-xgraph-frame')).find((candidate) => candidate.contentWindow === event.source)
    const board = frame ? pendingBoards.get(frame) : undefined
    if (!frame?.contentWindow || !board) return
    // The frame has no origin, so the message cannot name one; the code is part of the public page.
    frame.contentWindow.postMessage({ type: 'notia-xgraph-draw', code: board.code, theme: board.theme }, '*')
  })
}

/** The board's colours from the page's theme, as the editor takes them from its own. */
function boardTheme(root: HTMLElement): XGraphTheme {
  const style = getComputedStyle(root)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    background: token('--ps-panel', '#161d2e'),
    text: token('--ps-muted', '#8892a6'),
    axis: token('--ps-muted', '#8892a6'),
    grid: token('--ps-hairline', '#29334a'),
    curve: token('--ps-accent', '#4fd1c5'),
    point: token('--ps-warning', '#ffb86b'),
  }
}

/** Puts each XGraph board in its sandboxed frame, again with the other colours when the theme changes. */
function renderBoards(root: HTMLElement, dark: boolean): void {
  const hosts = Array.from(root.querySelectorAll<HTMLElement>('.ps-xgraph'))
  if (hosts.length === 0) return
  listenToBoards()
  const theme = dark ? 'dark' : 'light'
  const colours = boardTheme(root)
  for (const host of hosts) {
    if (host.dataset.renderedTheme === theme) continue
    const source = host.querySelector<HTMLElement>('.ps-xgraph-source')
    const code = host.dataset.source ?? source?.textContent ?? ''
    host.dataset.source = code
    host.dataset.renderedTheme = theme
    const frame = document.createElement('iframe')
    frame.className = 'ps-xgraph-frame'
    frame.title = 'Gráfico interactivo XGraph'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    frame.setAttribute('loading', 'lazy')
    host.querySelector('.ps-xgraph-frame')?.remove()
    pendingBoards.set(frame, { code, theme: colours })
    frame.src = XGRAPH_FRAME_URL
    host.appendChild(frame)
  }
}

/** Applies the touches to the article just written, or draws its diagrams and boards again for the theme. */
export async function enhanceArticle(root: HTMLElement, dark: boolean): Promise<void> {
  wireTabs(root)
  wireCodeButtons(root)
  renderBoards(root, dark)
  // One touch failing to load leaves the others in place.
  await Promise.allSettled([highlightCode(root), renderMath(root), renderDiagrams(root, dark)])
}
