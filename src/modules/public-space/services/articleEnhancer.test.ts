// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XGRAPH_FRAME_URL, enhanceArticle, splitHastLines } from './articleEnhancer'

const mocks = vi.hoisted(() => ({
  mermaidMissing: false,
  mermaid: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string, source: string) => ({ svg: `<svg data-id="${id}"><title>${source.length}</title></svg>` })),
  },
  katex: {
    render: vi.fn((tex: string, element: HTMLElement, options: { displayMode: boolean }) => {
      element.innerHTML = `<span class="katex" data-display="${options.displayMode}">${tex}</span>`
    }),
  },
}))

vi.mock('mermaid', () => ({
  // The chunk that did not download: reading the module fails.
  get default() {
    if (mocks.mermaidMissing) throw new TypeError('Failed to fetch dynamically imported module')
    return mocks.mermaid
  },
}))
vi.mock('katex', () => ({ default: mocks.katex }))
vi.mock('katex/dist/katex.min.css', () => ({}))

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
  mocks.mermaidMissing = false
  mocks.mermaid.initialize.mockClear()
  mocks.mermaid.render.mockClear()
  mocks.katex.render.mockClear()
})

describe('enhanceArticle', () => {
  it('draws each diagram with the palette theme and keeps its source for the other theme', async () => {
    root.innerHTML = '<pre class="ps-mermaid">graph TD\n  A--&gt;B</pre><p>Texto</p><pre class="ps-mermaid">pie\n  "a": 1</pre>'

    await enhanceArticle(root, true)

    const figures = root.querySelectorAll<HTMLElement>('.ps-diagram')
    expect(figures).toHaveLength(2)
    expect(root.querySelector('pre.ps-mermaid')).toBeNull()
    expect(figures[0].dataset.source).toBe('graph TD\n  A-->B')
    expect(figures[0].querySelector('svg')).not.toBeNull()
    expect(mocks.mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: expect.objectContaining({ darkMode: true, noteBkgColor: '#29334a' }),
    }))

    await enhanceArticle(root, false)

    expect(mocks.mermaid.render).toHaveBeenCalledTimes(4)
    expect(mocks.mermaid.render.mock.calls[2][1]).toBe('graph TD\n  A-->B')
    expect(mocks.mermaid.initialize.mock.calls.at(-1)?.[0]).toMatchObject({ themeVariables: { darkMode: false } })
    expect(root.querySelectorAll('.ps-diagram')).toHaveLength(2)
    expect(root.querySelector('p')?.textContent).toBe('Texto')
  })

  it('keeps the code of a diagram Mermaid cannot draw, with the reason over it', async () => {
    mocks.mermaid.render.mockRejectedValueOnce(new Error('Parse error'))
    root.innerHTML = '<pre class="ps-mermaid">malformado</pre>'

    await enhanceArticle(root, true)

    const pre = root.querySelector<HTMLElement>('pre.ps-mermaid')
    expect(pre?.classList.contains('ps-diagram-error')).toBe(true)
    expect(pre?.dataset.error).toMatch(/No se pudo dibujar el diagrama/)
    expect(pre?.textContent).toBe('malformado')
  })

  it('renders each formula once, so a theme change does not break it', async () => {
    root.innerHTML = '<span class="ps-math">a^2</span><div class="ps-math ps-math-display">x</div>'

    await enhanceArticle(root, true)
    await enhanceArticle(root, false)

    expect(mocks.katex.render).toHaveBeenCalledTimes(2)
    expect(mocks.katex.render.mock.calls[1][2]).toMatchObject({ displayMode: true })
    expect(root.querySelector('.ps-math')?.textContent).toBe('a^2')
  })

  it('shows the code with the reason when the viewer does not load, and still renders the formulas', async () => {
    mocks.mermaidMissing = true
    root.innerHTML = '<pre class="ps-mermaid">graph TD</pre><span class="ps-math">b</span>'

    await enhanceArticle(root, true)

    const pre = root.querySelector<HTMLElement>('pre.ps-mermaid')
    expect(pre?.classList.contains('ps-diagram-error')).toBe(true)
    expect(pre?.textContent).toBe('graph TD')
    expect(mocks.katex.render).toHaveBeenCalledTimes(1)
  })
})

/** A code block as the server writes it (`render/code.rs`). */
function codeBlock(language: string, lines: string[]): string {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<div class="ps-code-block" data-numbers="true" data-wrap="false"><div class="ps-code-head"><span class="ps-code-lang">${language}</span><div class="ps-code-tools">`
    + '<button type="button" class="ps-code-button" data-action="numbers" aria-pressed="true"><span>Números</span></button>'
    + '<button type="button" class="ps-code-button" data-action="wrap" aria-pressed="false"><span>Ajustar</span></button>'
    + '<button type="button" class="ps-code-button" data-action="copy"><span>Copiar</span></button></div></div>'
    + `<pre class="ps-code" data-lang="${language}"><code class="language-${language}">${lines.map((line) => `<span class="ps-line">${escape(line)}</span>`).join('')}</code></pre></div>`
}

describe('splitHastLines', () => {
  it('cuts highlighted nodes at each newline and repeats a token that spans lines', () => {
    const lines = splitHastLines([
      { type: 'element', tagName: 'span', properties: { className: ['token', 'comment'] }, children: [{ type: 'text', value: '/* uno\ndos */' }] },
      { type: 'text', value: '\n\nx' },
    ])
    expect(lines).toHaveLength(4)
    expect(lines[0]).toEqual([{ type: 'element', tagName: 'span', properties: { className: ['token', 'comment'] }, children: [{ type: 'text', value: '/* uno' }] }])
    expect(lines[1]).toEqual([{ type: 'element', tagName: 'span', properties: { className: ['token', 'comment'] }, children: [{ type: 'text', value: 'dos */' }] }])
    expect(lines[2]).toEqual([])
    expect(lines[3]).toEqual([{ type: 'text', value: 'x' }])
  })
})

describe('code blocks', () => {
  it('colours each line in place, keeping one row per line', async () => {
    root.innerHTML = codeBlock('c', ['/* a', 'b */', '', 'int x = 1;'])

    await enhanceArticle(root, true)

    const lines = root.querySelectorAll('.ps-line')
    expect(lines).toHaveLength(4)
    expect(lines[0].querySelector('.token.comment')?.textContent).toBe('/* a')
    expect(lines[1].querySelector('.token.comment')?.textContent).toBe('b */')
    expect(lines[2].textContent).toBe('')
    expect(lines[3].querySelector('.token.keyword')?.textContent).toBe('int')
    expect(Array.from(lines, (line) => line.textContent).join('\n')).toBe('/* a\nb */\n\nint x = 1;')
  })

  it('switches numbers and wrap, and copies the code without a secure context', async () => {
    root.innerHTML = codeBlock('c', ['int a;', 'int b;'])
    await enhanceArticle(root, true)
    await enhanceArticle(root, false)
    const block = root.querySelector<HTMLElement>('.ps-code-block')!
    const button = (action: string) => root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!

    button('numbers').click()
    button('wrap').click()
    expect(block.dataset.numbers).toBe('false')
    expect(button('numbers').getAttribute('aria-pressed')).toBe('false')
    expect(block.dataset.wrap).toBe('true')
    expect(button('wrap').getAttribute('aria-pressed')).toBe('true')

    let copied = ''
    const execCommand = vi.fn(() => {
      copied = document.querySelector('textarea')?.value ?? ''
      return true
    })
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    button('copy').click()
    await vi.waitFor(() => expect(button('copy').textContent).toBe('Copiado'))
    expect(execCommand).toHaveBeenCalledTimes(1)
    expect(copied).toBe('int a;\nint b;')
    expect(document.querySelector('textarea')).toBeNull()
  })
})

describe('XGraph boards', () => {
  it('draws each board in a sandboxed frame that gets the code once it is ready, and again for the other theme', async () => {
    root.innerHTML = '<div class="ps-xgraph"><pre class="ps-xgraph-source">board.create(\'point\', [1, 2]);</pre></div>'

    await enhanceArticle(root, true)

    const frame = root.querySelector<HTMLIFrameElement>('.ps-xgraph-frame')!
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('src')).toBe(XGRAPH_FRAME_URL)
    expect(root.querySelector('.ps-xgraph-source')?.textContent).toBe("board.create('point', [1, 2]);")

    const board = frame.contentWindow!
    const postMessage = vi.spyOn(board, 'postMessage').mockImplementation(() => {})
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'notia-xgraph-ready' }, source: board }))
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'notia-xgraph-draw', code: "board.create('point', [1, 2]);", theme: expect.objectContaining({ curve: expect.any(String) }) }),
      '*',
    )

    // A message from anything else draws nothing.
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'notia-xgraph-ready' }, source: window }))
    expect(postMessage).toHaveBeenCalledTimes(1)

    await enhanceArticle(root, true)
    expect(root.querySelector('.ps-xgraph-frame')).toBe(frame)
    await enhanceArticle(root, false)
    expect(root.querySelectorAll('.ps-xgraph-frame')).toHaveLength(1)
    expect(root.querySelector('.ps-xgraph-frame')).not.toBe(frame)
  })
})
