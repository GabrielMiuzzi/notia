// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'
import type { EditorView } from '@milkdown/kit/prose/view'
import { buildWikiLinkLookup } from '../../../../engines/markdown/wikiLinkEngine'
import { configureWikiLinkSerializer, resolveClickedWikiLinkPath } from './wikiLinkPlugin'

const note = (name: string) => ({
  path: `C:/lib/${name}.md`, name, title: name, relativePath: name, relativePathWithExtension: `${name}.md`, wikiLink: name,
})
const lookup = buildWikiLinkLookup([note('Alfa'), note('Beta')])

let editor: Editor | null = null

async function open(markdown: string): Promise<EditorView> {
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, document.createElement('div'))
      ctx.set(defaultValueCtx, markdown)
      configureWikiLinkSerializer(ctx)
    })
    .use(commonmark)
    .use(gfm)
    .create()
  return editor.action((ctx) => ctx.get(editorViewCtx))
}

function positionOf(view: EditorView, text: string): number {
  let from = -1
  view.state.doc.descendants((node, pos) => {
    if (from >= 0 || !node.isText) return from < 0
    const index = node.text?.indexOf(text) ?? -1
    if (index >= 0) from = pos + index
    return false
  })
  if (from < 0) throw new Error(`"${text}" not found`)
  return from
}

function link(): HTMLElement {
  const span = document.createElement('span')
  span.className = 'notia-wikilink-token notia-wikilink-token--resolved'
  return span
}

afterEach(async () => {
  await editor?.destroy()
  editor = null
})

describe('resolveClickedWikiLinkPath', () => {
  it('opens the note only when the click lands on the link', async () => {
    const view = await open('Ver [[Alfa]]')
    const end = positionOf(view, '[[Alfa]]') + '[[Alfa]]'.length
    const paragraph = view.dom.querySelector('p')
    // Past the end of the line ProseMirror reports the position after `]]`.
    expect(resolveClickedWikiLinkPath(view.state, end, paragraph, lookup)).toBeNull()
    expect(resolveClickedWikiLinkPath(view.state, end, link(), lookup)).toBe('C:/lib/Alfa.md')
    expect(resolveClickedWikiLinkPath(view.state, positionOf(view, 'Alfa'), link(), lookup)).toBe('C:/lib/Alfa.md')
  })

  it('opens the link that was clicked when two touch', async () => {
    const view = await open('[[Alfa]][[Beta]]')
    const boundary = positionOf(view, '[[Beta]]')
    expect(resolveClickedWikiLinkPath(view.state, boundary, link(), lookup)).toBe('C:/lib/Beta.md')
    expect(resolveClickedWikiLinkPath(view.state, boundary - 1, link(), lookup)).toBe('C:/lib/Alfa.md')
  })

  it('ignores links to notes that do not exist', async () => {
    const view = await open('Ver [[Gamma]]')
    expect(resolveClickedWikiLinkPath(view.state, positionOf(view, 'Gamma'), link(), lookup)).toBeNull()
  })
})

describe('configureWikiLinkSerializer', () => {
  it('saves wikilinks without escaping their brackets', async () => {
    const source = [
      'Ver [[Alfa]]',
      '',
      'Otra [[Beta|alias]] y [texto] suelto',
      '',
      '| Nota | Link |',
      '| - | - |',
      String.raw`| 1 | [[Beta\|alias]] |`,
      '',
    ].join('\n')
    const view = await open(source)
    view.dispatch(view.state.tr.insertText(' y más', positionOf(view, '[[Alfa]]') + '[[Alfa]]'.length))
    const markdown = editor?.action(getMarkdown()) ?? ''
    expect(markdown).toContain('Ver [[Alfa]] y más')
    // A lone bracket keeps its escape; only whole wikilinks lose it.
    expect(markdown).toContain(String.raw`Otra [[Beta|alias]] y \[texto] suelto`)
    expect(markdown).toContain(String.raw`[[Beta\|alias]]`)
    expect(markdown).not.toContain(String.raw`\[\[`)
  })
})
