// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codeBlockKind, decorateCodeBlocks, type CodeBlockChromeOptions } from './codeBlockChrome'

/** A code block as Crepe draws it: the bar, the editor and the preview. */
function codeBlock(language: string, preview = ''): HTMLElement {
  const block = document.createElement('div')
  block.className = 'milkdown-code-block'
  block.innerHTML = `<div class="tools"><div><button class="language-button">${language}</button></div><div class="tools-button-group"><button class="copy-button">Copiar</button></div></div><div class="codemirror-host"></div><div class="preview-panel"><div class="preview">${preview}</div></div>`
  document.body.append(block)
  return block
}

const options = {
  isMathLanguage: (language: string) => language === 'latex',
  exportDiagram: vi.fn<CodeBlockChromeOptions['exportDiagram']>(async () => 'C:/lib/a - diagrama.svg'),
}

afterEach(() => {
  document.body.replaceChildren()
  options.exportDiagram.mockClear()
})

describe('codeBlockChrome', () => {
  it('tells code, formulas and diagrams apart', () => {
    expect(codeBlockKind(codeBlock('javascript'), options.isMathLanguage)).toBe('code')
    expect(codeBlockKind(codeBlock('LaTeX'), options.isMathLanguage)).toBe('latex')
    expect(codeBlockKind(codeBlock('mermaid', '<div class="notia-mermaid-inline-host"></div>'), options.isMathLanguage)).toBe('mermaid')
    expect(codeBlockKind(codeBlock('xgraph', '<div class="notia-xgraph-host"></div>'), options.isMathLanguage)).toBe('xgraph')
  })

  it('gives code «Números» and «Ajustar», kept on the block', () => {
    const block = codeBlock('rust')
    decorateCodeBlocks(document.body, options)
    decorateCodeBlocks(document.body, options)
    const toggles = block.querySelectorAll<HTMLButtonElement>('.notia-code-toggle')
    expect([...toggles].map((toggle) => toggle.textContent)).toEqual(['Números', 'Ajustar'])
    expect(block.dataset.notiaNumbers).toBe('true')
    toggles[0]?.click()
    toggles[1]?.click()
    expect(block.dataset.notiaNumbers).toBe('false')
    expect(block.dataset.notiaWrap).toBe('true')
  })

  it('switches a Mermaid block between code, split and view, and exports its SVG', async () => {
    const block = codeBlock('mermaid', '<div class="notia-mermaid-inline-host"><svg><g></g></svg></div>')
    decorateCodeBlocks(document.body, options)
    expect(block.dataset.notiaView).toBe('split')
    const view = [...block.querySelectorAll<HTMLButtonElement>('.notia-code-segment')].find((button) => button.textContent === 'Vista')
    view?.click()
    expect(block.dataset.notiaView).toBe('preview')
    expect(view?.getAttribute('aria-checked')).toBe('true')
    block.querySelector<HTMLButtonElement>('.notia-code-export')?.click()
    await vi.waitFor(() => expect(options.exportDiagram).toHaveBeenCalled())
    expect(options.exportDiagram.mock.calls[0]?.[0]).toBe('svg')
    expect(String(options.exportDiagram.mock.calls[0]?.[1])).toContain('<svg')
  })

  it('drops the controls of the old kind when a block changes language', () => {
    const block = codeBlock('rust')
    decorateCodeBlocks(document.body, options)
    const button = block.querySelector('.language-button')
    if (button) button.textContent = 'latex'
    decorateCodeBlocks(document.body, options)
    expect(block.querySelector('.notia-code-toggles')).toBeNull()
    expect(block.dataset.notiaKind).toBe('latex')
  })
})
