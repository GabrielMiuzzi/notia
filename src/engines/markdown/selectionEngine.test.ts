import { describe, expect, it } from 'vitest'
import { EditorState } from '@milkdown/kit/prose/state'
import { TextSelection } from '@milkdown/kit/prose/state'
import { Schema } from '@milkdown/kit/prose/model'
import { buildMarkdownSelectionContext } from './selectionEngine'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: { attrs: { level: { default: 1 } }, content: 'inline*', group: 'block' },
    code_block: { attrs: { language: { default: '' }, params: { default: '' } }, content: 'text*', group: 'block', code: true },
    text: { group: 'inline' },
  },
})

describe('buildMarkdownSelectionContext', () => {
  it('identifies the selected block and its Markdown type', () => {
    const doc = schema.node('doc', null, [
      schema.nodes.heading.create({ level: 2 }, schema.text('Título')),
      schema.nodes.paragraph.create(null, schema.text('Contenido')),
    ])
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) })

    expect(buildMarkdownSelectionContext(state, '/vault/nota.md')).toMatchObject({
      documentPath: '/vault/nota.md',
      blocks: [{ index: 0, type: 'encabezado H2', text: 'Título' }],
    })
  })

  it('reports every top-level block in a multi-block selection', () => {
    const doc = schema.node('doc', null, [
      schema.nodes.paragraph.create(null, schema.text('Uno')),
      schema.nodes.code_block.create({ language: '', params: '' }, schema.text('dos')),
    ])
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    })

    expect(buildMarkdownSelectionContext(state, '/vault/nota.md').blocks.map((block) => block.type))
      .toEqual(['párrafo', 'bloque de código'])
  })
})
