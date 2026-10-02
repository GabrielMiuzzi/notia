// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { Provider } from 'react-redux'
import type { EditorView } from '@milkdown/kit/prose/view'

// The editor's view, taken when the plugin that buffers its changes starts.
const editor = vi.hoisted(() => ({ view: null as EditorView | null }))
vi.mock('./markdown/markdownChangeBuffer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./markdown/markdownChangeBuffer')>()
  return {
    ...actual,
    createMarkdownChangePlugin: (buffer: Parameters<typeof actual.createMarkdownChangePlugin>[0]) => {
      const plugin = actual.createMarkdownChangePlugin(buffer)
      const spec = plugin.spec as { view: (view: EditorView) => unknown }
      const startView = spec.view
      spec.view = (view) => {
        editor.view = view
        return startView(view)
      }
      return plugin
    },
  }
})
vi.mock('../../../services/transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/transport')>()),
  callBackend: vi.fn(async () => []),
  backendSupports: () => false,
}))

const { store } = await import('../../../store/index')
const { MarkdownView } = await import('./MarkdownView')
const { MARKDOWN_CHANGE_DEBOUNCE_MS } = await import('./markdown/markdownChangeBuffer')
const { flushPendingEditorChanges } = await import('../../../services/markdown/pendingEditorChanges')

const SOURCE = '---\ntitle: Nota\n---\n\nHola'

function renderNote(onSourceChange: (source: string, path: string) => void, onSelectionChange = vi.fn()) {
  return render(createElement(Provider, {
    store,
    children: createElement(MarkdownView, {
      source: SOURCE,
      documentPath: 'Notas/A.md',
      onSourceChange,
      wikiLinkTargets: [],
      onOpenLinkedFile: () => {},
      onSelectionChange,
      externalSourceUpdate: null,
      zoom: 1,
      onZoomChange: () => {},
    }),
  }))
}

async function openedView(): Promise<EditorView> {
  await vi.waitFor(() => expect(editor.view).not.toBeNull(), { timeout: 5000 })
  // Let the editor finish opening.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
  return editor.view!
}

function type(view: EditorView, text: string) {
  view.dispatch(view.state.tr.insertText(text, view.state.doc.content.size - 1))
}

describe('MarkdownView', () => {
  afterEach(() => {
    cleanup()
    editor.view = null
  })

  it('writes the note once typing pauses, with its frontmatter and its path', async () => {
    const onSourceChange = vi.fn()
    renderNote(onSourceChange)
    const view = await openedView()
    onSourceChange.mockClear()

    act(() => {
      type(view, ' mun')
      type(view, 'do')
    })
    expect(onSourceChange).not.toHaveBeenCalled()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, MARKDOWN_CHANGE_DEBOUNCE_MS + 100)) })
    expect(onSourceChange).toHaveBeenCalledExactlyOnceWith('---\ntitle: Nota\n---\n\nHola mundo\n', 'Notas/A.md')
  })

  it('hands over the last keystrokes when something asks and when it closes', async () => {
    const onSourceChange = vi.fn()
    const ui = renderNote(onSourceChange)
    const view = await openedView()
    onSourceChange.mockClear()

    act(() => type(view, ' mundo'))
    act(() => flushPendingEditorChanges())
    expect(onSourceChange).toHaveBeenLastCalledWith('---\ntitle: Nota\n---\n\nHola mundo\n', 'Notas/A.md')

    act(() => type(view, '!'))
    // Closing the tab (or switching to another) writes it to this note's path.
    ui.unmount()
    expect(onSourceChange).toHaveBeenLastCalledWith('---\ntitle: Nota\n---\n\nHola mundo!\n', 'Notas/A.md')
    expect(onSourceChange).toHaveBeenCalledTimes(2)
  })
})
