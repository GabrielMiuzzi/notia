import { describe, expect, it } from 'vitest'
import {
  createTableCellBlockMarker,
  extendTableCellSchemaWithBlocks,
  parseTableCellBlockMarker,
  transformTableCellBlockMarkers,
} from './tableCellBlocks'

describe('tableCellBlocks', () => {
  it('round-trips a block node through a Markdown-safe marker', () => {
    const node = {
      type: 'code_block',
      attrs: { language: 'xgraph' },
      content: [{ type: 'text', text: 'board.create("point", [1, 2])' }],
    }

    const marker = createTableCellBlockMarker(node)

    expect(marker).toMatch(/^<!--notia-table-block:.*-->$/)
    expect(parseTableCellBlockMarker(marker)).toEqual(node)
  })

  it('restores markers only inside GFM table cells', () => {
    const marker = createTableCellBlockMarker({
      type: 'image_block',
      attrs: { src: 'file:///local/image.png' },
    })
    const tree = {
      type: 'root',
      children: [
        { type: 'html', value: marker },
        {
          type: 'table',
          children: [
            {
              type: 'tableRow',
              children: [
                { type: 'tableCell', children: [{ type: 'html', value: marker }] },
                { type: 'tableCell', children: [{ type: 'text', value: 'Texto' }] },
              ],
            },
          ],
        },
      ],
    }

    transformTableCellBlockMarkers(tree)

    expect(tree.children?.[0]).toMatchObject({ type: 'html', value: marker })
    expect(tree.children?.[1]?.children?.[0]?.children?.[0]?.children?.[0]).toMatchObject({
      type: 'notiaTableBlock',
      data: { node: { type: 'image_block' } },
    })
  })

  it('rejects malformed or oversized markers', () => {
    expect(parseTableCellBlockMarker('<!--notia-table-block:not-json-->')).toBeNull()
    expect(parseTableCellBlockMarker(`<!--notia-table-block:${'x'.repeat(500_001)}-->`)).toBeNull()
  })

  it('changes table cells to block content without replacing their contracts', () => {
    const parseMarkdown = {
      match: () => true,
      runner: () => undefined,
    }
    const toMarkdown = {
      match: () => true,
      runner: () => undefined,
    }
    const schema = extendTableCellSchemaWithBlocks({
      content: 'paragraph',
      parseMarkdown,
      toMarkdown,
    })

    expect(schema.content).toBe('block+')
    expect(schema.parseMarkdown.match({ type: 'tableCell' })).toBe(true)
    expect(schema.toMarkdown.match({ type: 'table_cell' } as never)).toBe(true)
    expect(schema.parseMarkdown.runner).not.toBe(parseMarkdown.runner)
    expect(schema.toMarkdown.runner).not.toBe(toMarkdown.runner)
  })
})
