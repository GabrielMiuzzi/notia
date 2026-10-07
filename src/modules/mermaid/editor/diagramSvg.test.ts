// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { linkEndAt, selectionAt, selectionElements } from './diagramSvg'
import type { MermaidModel } from './mermaidEditorTypes'

function drawing(html: string): HTMLElement {
  const container = document.createElement('div')
  container.innerHTML = `<svg>${html}</svg>`
  return container
}

const flowchart = { kind: 'flowchart' } as MermaidModel

describe('diagram SVG mapping', () => {
  it('finds flowchart nodes by id and links by their order in the source', () => {
    const container = drawing(`
      <g class="node" id="mermaid-1-flowchart-pedido-0"><rect></rect></g>
      <g class="node" id="mermaid-1-flowchart-stock_ok-1"><text>¿Hay stock?</text></g>
      <path class="flowchart-link" data-id="L_pedido_stock_ok_0"></path>
      <path class="flowchart-link" data-id="L_stock_ok_fin_0"></path>
      <g class="edgeLabel"><g class="label" data-id="L_stock_ok_fin_0"><span>sí</span></g></g>`)
    expect(selectionAt(container, container.querySelector('text')!, 'flowchart', flowchart)).toEqual({ kind: 'node', key: 'stock_ok' })
    const label = container.querySelector('span')!
    expect(selectionAt(container, label, 'flowchart', flowchart)).toEqual({ kind: 'edge', key: '1' })
    expect(selectionAt(container, container.querySelector('svg')!, 'flowchart', flowchart)).toBeNull()

    const edge = selectionElements(container, 'flowchart', { kind: 'edge', key: '1' })
    expect(edge).toHaveLength(2)
    expect(edge[1].classList.contains('edgeLabel')).toBe(true)
    expect(selectionElements(container, 'flowchart', { kind: 'node', key: 'pedido' })).toHaveLength(1)
  })

  it('leaves start and end pseudo-states out of the selection but lets links end on them', () => {
    const state = { kind: 'state' } as MermaidModel
    const container = drawing(`
      <g class="node" id="mermaid-2-state-root_start-0"><circle></circle></g>
      <g class="node" id="mermaid-2-state-SprintActual-3"><rect></rect></g>`)
    const start = container.querySelector('circle')!
    expect(selectionAt(container, start, 'state', state)).toBeNull()
    expect(linkEndAt(container, start, 'state', state)).toBe('[*]')
    expect(linkEndAt(container, container.querySelector('rect')!, 'state', state)).toBe('SprintActual')
  })

  it('maps sequence messages by order and participants by alias or bottom label', () => {
    const sequence = {
      kind: 'sequence',
      participants: [{ alias: 'U', label: 'Usuario' }, { alias: 'M', label: 'Munin' }],
    } as unknown as MermaidModel
    const container = drawing(`
      <g data-id="U"><rect class="actor"></rect></g>
      <g><rect class="actor"></rect><text class="actor">Munin</text></g>
      <line class="messageLine0"></line>
      <text class="messageText">Abrir</text>
      <line class="messageLine1"></line>
      <text class="messageText">nonce</text>`)
    const lines = container.querySelectorAll('line')
    expect(selectionAt(container, lines[1], 'sequence', sequence)).toEqual({ kind: 'message', key: '1' })
    expect(selectionAt(container, container.querySelectorAll('.messageText')[0], 'sequence', sequence)).toEqual({ kind: 'message', key: '0' })
    expect(selectionAt(container, container.querySelector('[data-id="U"] rect')!, 'sequence', sequence)).toEqual({ kind: 'participant', key: 'U' })
    expect(selectionAt(container, container.querySelector('text.actor')!, 'sequence', sequence)).toEqual({ kind: 'participant', key: 'M' })
    expect(selectionElements(container, 'sequence', { kind: 'message', key: '1' })).toEqual([lines[1], container.querySelectorAll('.messageText')[1]])
  })
})
