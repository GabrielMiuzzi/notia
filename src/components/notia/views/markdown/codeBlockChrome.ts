/*
 * Controls the design canvas adds to Crepe's code blocks (Elementos ·
 * Código). Crepe draws the bar (language, copy, show/hide code) with Vue;
 * this module adds what depends on the kind of block:
 *
 * - code: «Números» and «Ajustar», which only change how the block is shown;
 * - Mermaid: «Código · Dividido · Vista» and «Exportar SVG»;
 * - XGraph: its caption and «PNG».
 *
 * The state lives in `data-*` attributes of the block, so it survives Vue
 * redrawing the bar; the mutation observer of the editor calls
 * `decorateCodeBlocks` again after every change.
 */

export type CodeBlockKind = 'code' | 'latex' | 'mermaid' | 'xgraph'
export type DiagramFormat = 'svg' | 'png'

export interface CodeBlockChromeOptions {
  isMathLanguage: (language: string) => boolean
  /** Saves a diagram next to the note; resolves with where it went. */
  exportDiagram: (format: DiagramFormat, data: string) => Promise<string>
}

const CHROME_CLASS = 'notia-code-chrome'

const ICONS = {
  numbers: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 4h7M6.5 8h7M6.5 12h7"/><path d="M2.5 3.5h1v1.5M2.5 7.5h1.5l-1.5 1.5h1.5M2.5 11.5h1.5v2h-1.5"/></svg>',
  wrap: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4h11M2.5 8h9a2 2 0 010 4H8M9.5 10.5L8 12l1.5 1.5M2.5 12h3"/></svg>',
  download: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M5 7.5l3 3 3-3M3 13.5h10"/></svg>',
}

const MERMAID_VIEWS: Array<[string, string]> = [['code', 'Código'], ['split', 'Dividido'], ['preview', 'Vista']]

function languageOf(block: HTMLElement): string {
  return block.querySelector<HTMLElement>('.language-button')?.textContent?.toLowerCase().trim() ?? ''
}

export function codeBlockKind(block: HTMLElement, isMathLanguage: (language: string) => boolean): CodeBlockKind {
  if (block.querySelector('.notia-xgraph-host')) return 'xgraph'
  if (block.querySelector('.notia-mermaid-inline-host')) return 'mermaid'
  return isMathLanguage(languageOf(block)) ? 'latex' : 'code'
}

function button(className: string, label: string, icon: string | null, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = `notia-code-button ${className}`
  element.innerHTML = icon ?? ''
  const text = document.createElement('span')
  text.textContent = label
  element.append(text)
  // The press must not move the editor's selection into the block.
  element.addEventListener('mousedown', (event) => event.preventDefault())
  element.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
  return element
}

function setLabel(element: HTMLElement, label: string): void {
  const text = element.querySelector('span:last-child')
  if (text) text.textContent = label
}

/** A toggle kept in a `data-*` attribute of the block. */
function toggle(block: HTMLElement, key: 'notiaNumbers' | 'notiaWrap', label: string, title: string, icon: string, initial: boolean): HTMLButtonElement {
  if (block.dataset[key] === undefined) block.dataset[key] = String(initial)
  const element = button('notia-code-toggle', label, icon, () => {
    const next = block.dataset[key] !== 'true'
    block.dataset[key] = String(next)
    element.setAttribute('aria-pressed', String(next))
  })
  element.title = title
  element.setAttribute('aria-pressed', block.dataset[key] ?? String(initial))
  return element
}

function exportButton(format: DiagramFormat, read: () => Promise<string | null>, options: CodeBlockChromeOptions): HTMLButtonElement {
  const label = format === 'svg' ? 'Exportar SVG' : 'PNG'
  const element = button('notia-code-export', label, ICONS.download, () => {
    element.disabled = true
    void read()
      .then((data) => {
        if (!data) throw new Error('El diagrama todavía no está listo.')
        return options.exportDiagram(format, data)
      })
      .then(() => setLabel(element, 'Exportado'))
      .catch(() => setLabel(element, 'No se pudo exportar'))
      .finally(() => {
        element.disabled = false
        window.setTimeout(() => setLabel(element, label), 1800)
      })
  })
  element.title = format === 'svg' ? 'Guardar el diagrama como SVG junto a la nota' : 'Guardar el gráfico como PNG junto a la nota'
  return element
}

function mermaidSvg(block: HTMLElement): Promise<string | null> {
  const svg = block.querySelector<SVGSVGElement>('.notia-mermaid-inline-host svg')
  if (!svg) return Promise.resolve(null)
  const copy = svg.cloneNode(true) as SVGSVGElement
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return Promise.resolve(new XMLSerializer().serializeToString(copy))
}

/** Asks the XGraph frame for its drawing and turns it into a PNG. */
function xgraphPng(block: HTMLElement): Promise<string | null> {
  const frame = block.querySelector<HTMLIFrameElement>('.notia-xgraph-frame')
  const target = frame?.contentWindow
  if (!frame || !target) return Promise.resolve(null)
  const id = crypto.randomUUID()
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => finish(null), 4000)
    function finish(value: string | null) {
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(value)
    }
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; id?: string; svg?: string } | null
      if (event.source !== target || data?.type !== 'notia-xgraph-svg' || data.id !== id || !data.svg) return
      // The PNG keeps the board's background, as it shows in the note.
      const board = block.querySelector<HTMLElement>('.preview')
      const background = board ? getComputedStyle(board).backgroundColor : '#ffffff'
      void svgToPng(data.svg, frame?.clientWidth ?? 720, frame?.clientHeight ?? 300, background).then(finish)
    }
    window.addEventListener('message', onMessage)
    target.postMessage({ type: 'notia-xgraph-export', id }, '*')
  })
}

function svgToPng(svg: string, width: number, height: number, background: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        resolve(null)
        return
      }
      context.fillStyle = background
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''))
    }
    image.onerror = () => resolve(null)
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

function segmented(block: HTMLElement): HTMLElement {
  const group = document.createElement('span')
  group.className = `${CHROME_CLASS} notia-code-segmented`
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-label', 'Qué mostrar')
  MERMAID_VIEWS.forEach(([view, label]) => {
    const option = button('notia-code-segment', label, null, () => {
      block.dataset.notiaView = view
      group.querySelectorAll('[role="radio"]').forEach((item) => {
        item.setAttribute('aria-checked', String(item === option))
      })
    })
    option.setAttribute('role', 'radio')
    option.setAttribute('aria-checked', String((block.dataset.notiaView ?? 'split') === view))
    group.append(option)
  })
  return group
}

function caption(text: string): HTMLElement {
  const element = document.createElement('span')
  element.className = `${CHROME_CLASS} notia-code-caption`
  element.textContent = text
  return element
}

function decorate(block: HTMLElement, options: CodeBlockChromeOptions): void {
  const tools = block.querySelector<HTMLElement>(':scope > .tools')
  const group = tools?.querySelector<HTMLElement>('.tools-button-group')
  if (!tools || !group) return
  const kind = codeBlockKind(block, options.isMathLanguage)
  if (block.dataset.notiaKind !== kind) {
    block.dataset.notiaKind = kind
    block.querySelectorAll(`.${CHROME_CLASS}`).forEach((element) => element.remove())
  }
  if (kind === 'code' && !group.querySelector('.notia-code-toggles')) {
    const toggles = document.createElement('span')
    toggles.className = `${CHROME_CLASS} notia-code-toggles`
    toggles.append(
      toggle(block, 'notiaNumbers', 'Números', 'Números de línea', ICONS.numbers, true),
      toggle(block, 'notiaWrap', 'Ajustar', 'Ajustar líneas', ICONS.wrap, false),
    )
    group.prepend(toggles)
  }
  if (kind === 'mermaid') {
    if (!block.dataset.notiaView) block.dataset.notiaView = 'split'
    if (!tools.querySelector('.notia-code-segmented')) tools.firstElementChild?.after(segmented(block))
    if (!group.querySelector('.notia-code-export')) {
      const exporter = exportButton('svg', () => mermaidSvg(block), options)
      exporter.classList.add(CHROME_CLASS)
      group.append(exporter)
    }
  }
  if (kind === 'xgraph') {
    if (!tools.querySelector('.notia-code-caption')) tools.firstElementChild?.after(caption('Gráfico interactivo'))
    if (!group.querySelector('.notia-code-export')) {
      const exporter = exportButton('png', () => xgraphPng(block), options)
      exporter.classList.add(CHROME_CLASS)
      group.append(exporter)
    }
  }
}

export function decorateCodeBlocks(root: HTMLElement, options: CodeBlockChromeOptions): void {
  root.querySelectorAll<HTMLElement>('.milkdown-code-block').forEach((block) => decorate(block, options))
}
