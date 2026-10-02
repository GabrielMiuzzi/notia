// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { $prose, replaceAll } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  createMarkdownChangeBuffer,
  createMarkdownChangePlugin,
  isMarkdownChange,
  MARKDOWN_CHANGE_DEBOUNCE_MS,
  MARKDOWN_CHANGE_MAX_WAIT_MS,
} from './markdownChangeBuffer'

function textBuffer() {
  const emit = vi.fn<(markdown: string) => void>()
  const serialize = vi.fn((doc: string) => doc)
  const buffer = createMarkdownChangeBuffer<string>({ isSame: (left, right) => left === right, serialize, emit })
  buffer.reset('Hola')
  return { buffer, emit, serialize }
}

describe('createMarkdownChangeBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the last change once, when the editing pauses', () => {
    const { buffer, emit, serialize } = textBuffer()
    buffer.schedule('Hola m')
    vi.advanceTimersByTime(MARKDOWN_CHANGE_DEBOUNCE_MS - 50)
    buffer.schedule('Hola mu')
    vi.advanceTimersByTime(MARKDOWN_CHANGE_DEBOUNCE_MS - 1)
    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(serialize).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledExactlyOnceWith('Hola mu')
  })

  it('hands over what is pending at once, and nothing is lost or written twice', () => {
    const { buffer, emit } = textBuffer()
    buffer.schedule('Hola mundo')
    expect(buffer.hasPending()).toBe(true)
    buffer.flush()
    expect(emit).toHaveBeenCalledExactlyOnceWith('Hola mundo')
    expect(buffer.hasPending()).toBe(false)
    vi.advanceTimersByTime(MARKDOWN_CHANGE_MAX_WAIT_MS)
    buffer.flush()
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('writes nothing for a change that leaves the note as it was', () => {
    const { buffer, emit, serialize } = textBuffer()
    buffer.schedule('Hola!')
    buffer.schedule('Hola')
    vi.advanceTimersByTime(MARKDOWN_CHANGE_DEBOUNCE_MS)
    expect(serialize).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('still writes while typing goes on without pauses', () => {
    const { buffer, emit } = textBuffer()
    let text = 'Hola'
    for (let elapsed = 0; elapsed < MARKDOWN_CHANGE_MAX_WAIT_MS; elapsed += 100) {
      text += 'a'
      buffer.schedule(text)
      vi.advanceTimersByTime(100)
    }
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]?.[0].startsWith('Holaaaa')).toBe(true)
  })

  it('forgets what was pending when the note is replaced', () => {
    const { buffer, emit } = textBuffer()
    buffer.schedule('Hola local')
    buffer.reset('Texto de afuera')
    vi.advanceTimersByTime(MARKDOWN_CHANGE_MAX_WAIT_MS)
    buffer.flush()
    expect(emit).not.toHaveBeenCalled()
    buffer.schedule('Texto de afuera')
    buffer.flush()
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('isMarkdownChange', () => {
  const transaction = (docChanged: boolean, storedMarksSet: boolean, addToHistory?: boolean) => ({
    docChanged,
    storedMarksSet,
    getMeta: (key: string) => (key === 'addToHistory' ? addToHistory : undefined),
  })

  it('counts the changes Milkdown counted', () => {
    expect(isMarkdownChange(transaction(true, false))).toBe(true)
    expect(isMarkdownChange(transaction(false, true))).toBe(true)
    expect(isMarkdownChange(transaction(false, false))).toBe(false)
    // The shared room's remote edits and the page breaks stay out of the history.
    expect(isMarkdownChange(transaction(true, false, false))).toBe(false)
  })
})

describe('createMarkdownChangePlugin', () => {
  let editor: Editor | null = null

  afterEach(async () => {
    await editor?.destroy()
    editor = null
  })

  async function open(markdown: string) {
    const emit = vi.fn<(markdown: string) => void>()
    const buffer = createMarkdownChangeBuffer<ProseNode>({
      isSame: (left, right) => left === right || left.eq(right),
      serialize: (doc) => editor!.action((ctx) => ctx.get(serializerCtx)(doc)),
      emit,
    })
    editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, document.createElement('div'))
        ctx.set(defaultValueCtx, markdown)
      })
      .use(commonmark)
      .use($prose(() => createMarkdownChangePlugin(buffer)))
      .create()
    const view = editor.action((ctx) => ctx.get(editorViewCtx))
    return { buffer, emit, view }
  }

  it('hands over the latest text, whatever the person typed last', async () => {
    const { buffer, emit, view } = await open('Hola')
    view.dispatch(view.state.tr.insertText(' mun', view.state.doc.content.size - 1))
    view.dispatch(view.state.tr.insertText('do', view.state.doc.content.size - 1))
    expect(emit).not.toHaveBeenCalled()
    buffer.flush()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]?.[0].trim()).toBe('Hola mundo')
  })

  it('leaves out what is not the person’s change', async () => {
    const { buffer, emit, view } = await open('Hola')
    view.dispatch(view.state.tr.insertText('!', view.state.doc.content.size - 1).setMeta('addToHistory', false))
    expect(buffer.hasPending()).toBe(false)
    buffer.flush()
    expect(emit).not.toHaveBeenCalled()
  })

  it('writes nothing for a change that leaves the text as it was', async () => {
    const { buffer, emit, view } = await open('Hola')
    view.dispatch(view.state.tr.addStoredMark(view.state.schema.marks.strong!.create()))
    expect(buffer.hasPending()).toBe(true)
    buffer.flush()
    expect(emit).not.toHaveBeenCalled()
  })

  it('drops the pending text when the note is replaced from outside', async () => {
    const { buffer, emit } = await open('Hola')
    const view = editor!.action((ctx) => ctx.get(editorViewCtx))
    view.dispatch(view.state.tr.insertText(' local', view.state.doc.content.size - 1))
    editor!.action(replaceAll('Texto de afuera', true))
    expect(buffer.hasPending()).toBe(false)
    buffer.flush()
    expect(emit).not.toHaveBeenCalled()
  })

  it('writes at once when the editor loses focus', async () => {
    const { emit, view } = await open('Hola')
    view.dispatch(view.state.tr.insertText(' mundo', view.state.doc.content.size - 1))
    view.dom.dispatchEvent(new FocusEvent('blur'))
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]?.[0].trim()).toBe('Hola mundo')
  })
})
