// @vitest-environment happy-dom
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { Provider } from 'react-redux'

const documents = vi.hoisted(() => ({ writeLibraryDocument: vi.fn() }))
vi.mock('../../../services/libraries/libraryDocumentRuntime', () => documents)

const { store } = await import('../../../store/index')
const { activateSpecialTab, addOpenTab, GYM_WORKSPACE_TAB_PATH, HEALTH_WORKSPACE_TAB_PATH, resetTabs, setActiveTabPath, updateTabSource } = await import('../../../features/documents/documentsSlice')
const { registerPendingEditorChanges } = await import('../../../services/markdown/pendingEditorChanges')
const { useTabManager } = await import('./useTabManager')

function openNote(path: string, source: string) {
  store.dispatch(addOpenTab({
    document: { path, name: path, extension: 'md', viewKind: 'markdown', source },
    saveStatus: 'idle',
    latestSavedSource: source,
  }))
}

function sourceOf(path: string): string | undefined {
  const tab = store.getState().documents.openTabs.find((item) => item.document.path === path)
  return tab && 'source' in tab.document ? tab.document.source : undefined
}

function renderTabManager() {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(Provider, { store, children })
  return renderHook(() => useTabManager({
    clearPendingTextSaveByPath: () => {},
    bumpLibraryIndexRevision: () => {},
    resetColdPassSession: () => {},
    activeLibraryId: 'lib',
  }), { wrapper })
}

describe('useTabManager and the editor’s pending text', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    store.dispatch(resetTabs())
    documents.writeLibraryDocument.mockReset()
  })

  it('saves the text the editor still held, even when it was the only change', async () => {
    openNote('A.md', 'Hola')
    // The editor holds « mundo» until typing pauses.
    cleanups.push(registerPendingEditorChanges(() => store.dispatch(updateTabSource({ path: 'A.md', source: 'Hola mundo' }))))
    documents.writeLibraryDocument.mockResolvedValue({ ok: true, revision: 'r2' })
    const { result } = renderTabManager()

    let saved = false
    await act(async () => {
      saved = await result.current.persistDirtyTextDocuments()
    })

    expect(saved).toBe(true)
    expect(documents.writeLibraryDocument).toHaveBeenCalledExactlyOnceWith('lib', 'A.md', 'Hola mundo', {})
  })

  it('writes the text to the note it belongs to, not to the tab that is active now', () => {
    openNote('A.md', 'Hola')
    openNote('B.md', 'Otra')
    store.dispatch(setActiveTabPath('B.md'))
    const { result } = renderTabManager()

    act(() => {
      // The editor of A closes after B became the active tab.
      result.current.handleTextDocumentChange('Hola mundo', 'A.md')
      // Editors without a path still write the active tab.
      result.current.handleTextDocumentChange('Otra cosa')
    })

    expect(sourceOf('A.md')).toBe('Hola mundo')
    expect(sourceOf('B.md')).toBe('Otra cosa')
  })
})

describe('useTabManager and the module tabs', () => {
  afterEach(() => {
    store.dispatch(resetTabs())
  })

  it('closes Gimnasio without Salud open', async () => {
    store.dispatch(activateSpecialTab('gym'))
    const { result } = renderTabManager()

    await act(async () => {
      await result.current.closeTabByPath(GYM_WORKSPACE_TAB_PATH)
    })

    expect(store.getState().documents.specialTabs.gym).toBe(false)
  })

  it('does not bring Gimnasio back when another tab closes', async () => {
    store.dispatch(activateSpecialTab('health'))
    store.dispatch(activateSpecialTab('gym'))
    const { result } = renderTabManager()

    await act(async () => {
      await result.current.closeTabByPath(GYM_WORKSPACE_TAB_PATH)
    })
    await act(async () => {
      await result.current.closeTabByPath(HEALTH_WORKSPACE_TAB_PATH)
    })

    expect(store.getState().documents.specialTabs.gym).toBe(false)
    expect(store.getState().documents.specialTabs.health).toBe(false)
  })
})
