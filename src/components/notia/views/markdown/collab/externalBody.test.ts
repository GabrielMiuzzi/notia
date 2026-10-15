// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { collab, collabServiceCtx } from '@milkdown/plugin-collab'
import { getMarkdown } from '@milkdown/kit/utils'
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import { replaceEditorBody } from './externalBody'

const editors: Editor[] = []

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()))
  document.body.replaceChildren()
})

async function makeEditor(markdown: string, doc?: Doc, template = true): Promise<Editor> {
  const root = document.createElement('div')
  document.body.append(root)
  let builder = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, markdown)
    })
    .use(commonmark)
  if (doc) builder = builder.use(collab)
  const editor = await builder.create()
  editors.push(editor)
  if (doc) {
    editor.action((ctx) => {
      const service = ctx.get(collabServiceCtx).bindDoc(doc)
      if (template) service.applyTemplate(markdown)
      service.connect()
    })
  }
  return editor
}

const markdownOf = (editor: Editor) => editor.action(getMarkdown()).trim()
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('replaceEditorBody', () => {
  it('replaces the body of an editor alone', async () => {
    const editor = await makeEditor('Texto viejo')
    expect(replaceEditorBody(editor, 'Texto nuevo', 'alone')).toBe(true)
    expect(markdownOf(editor)).toBe('Texto nuevo')
  })

  it('keeps the change in a shared room, where a new editor state brought the old text back', async () => {
    const doc = new Doc()
    const editor = await makeEditor('Texto viejo', doc)
    expect(replaceEditorBody(editor, 'Texto nuevo', 'saver')).toBe(true)
    await settle()
    expect(markdownOf(editor)).toBe('Texto nuevo')
    expect(doc.getXmlFragment('prosemirror').toString()).toBe('<paragraph>Texto nuevo</paragraph>')
  })

  it('reaches the other windows of the room once, through the window that saves', async () => {
    const saverDoc = new Doc()
    const followerDoc = new Doc()
    // The room relays every update to the other window.
    saverDoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'room') applyUpdate(followerDoc, update, 'room')
    })
    followerDoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'room') applyUpdate(saverDoc, update, 'room')
    })
    const saver = await makeEditor('Texto viejo', saverDoc)
    applyUpdate(followerDoc, encodeStateAsUpdate(saverDoc), 'room')
    const follower = await makeEditor('Texto viejo', followerDoc, false)
    await settle()
    expect(markdownOf(follower)).toBe('Texto viejo')

    // Both windows hear the agent's edit; only the one that saves applies it.
    expect(replaceEditorBody(follower, 'Texto nuevo', 'follower')).toBe(false)
    expect(replaceEditorBody(saver, 'Texto nuevo', 'saver')).toBe(true)
    await settle()
    expect(markdownOf(saver)).toBe('Texto nuevo')
    expect(markdownOf(follower)).toBe('Texto nuevo')
  })
})
