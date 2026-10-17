import { useCallback, useEffect, useRef, useState } from 'react'
import { MARKDOWN_AUTOSAVE_DEBOUNCE_MS } from '../../../components/notia/hooks/useTextDocumentAutosave'
import { flushPendingEditorChanges } from '../../../services/markdown/pendingEditorChanges'
import type { NotiaDocumentSaveStatus } from '../../../types/views/fileDocument'
import { readTaskMarkdownSource, writeTaskMarkdownSource, type TaskManagerBackendContext } from '../services/taskManagerService'
import type { TaskItem } from '../types/taskManagerTypes'

/*
 * The tickets a published Task Manager has open, as tabs, the way the app
 * opens notes: each one in the document view, saved by itself a moment
 * after the last change. Reads and writes go through the ticket commands of
 * the publication, which Rust checks against the published boards and the
 * ticket's revision.
 */

export interface PublishedTicketTab {
  /** Logical path of the ticket: its identity in the publication. */
  path: string
  title: string
  /** Context of the ticket's board; the note keeps it. */
  lockedContext?: string
  source: string
  saveStatus: NotiaDocumentSaveStatus
}

interface SavedState {
  source: string
  revision: string
}

const SAVE_ERROR = 'No se pudo guardar el ticket.'
const CONFLICT_ERROR = 'El ticket cambió en otra sesión. Cerralo y volvé a abrirlo para seguir.'

export function usePublishedTicketTabs(context: TaskManagerBackendContext | null, onError: (message: string) => void) {
  const [tabs, setTabs] = useState<PublishedTicketTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  /** What each ticket has saved, and its revision. */
  const savedRef = useRef(new Map<string, SavedState>())
  const timersRef = useRef(new Map<string, number>())
  const savingRef = useRef(new Map<string, Promise<void>>())
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const setStatus = (path: string, saveStatus: NotiaDocumentSaveStatus) => {
    setTabs((current) => current.map((tab) => (tab.path === path ? { ...tab, saveStatus } : tab)))
  }

  /** Saves what the tab shows, once at a time per ticket; a change in the meantime saves again. */
  const save = useCallback((path: string): Promise<void> => {
    const running = savingRef.current.get(path)
    if (running) return running.then(() => save(path))
    const tab = tabsRef.current.find((item) => item.path === path)
    const saved = savedRef.current.get(path)
    if (!context || !tab || !saved || tab.source === saved.source) return Promise.resolve()
    const source = tab.source
    setStatus(path, 'saving')
    const run = (async () => {
      try {
        const revision = await writeTaskMarkdownSource(context, path, source, saved.revision)
          ?? (await readTaskMarkdownSource(context, path)).revision
        savedRef.current.set(path, { source, revision })
        const latest = tabsRef.current.find((item) => item.path === path)
        setStatus(path, latest && latest.source !== source ? 'saving' : 'idle')
      } catch (error) {
        setStatus(path, 'error')
        const message = error instanceof Error ? error.message : ''
        onErrorRef.current(/cambi|conflict/i.test(message) ? CONFLICT_ERROR : SAVE_ERROR)
      } finally {
        savingRef.current.delete(path)
      }
    })()
    savingRef.current.set(path, run)
    return run
  }, [context])

  const schedule = useCallback((path: string) => {
    window.clearTimeout(timersRef.current.get(path))
    timersRef.current.set(path, window.setTimeout(() => {
      timersRef.current.delete(path)
      void save(path)
    }, MARKDOWN_AUTOSAVE_DEBOUNCE_MS))
  }, [save])

  const open = useCallback(async (task: TaskItem) => {
    if (tabsRef.current.some((tab) => tab.path === task.filePath)) {
      setActivePath(task.filePath)
      return
    }
    if (!context) return
    try {
      const { content, revision } = await readTaskMarkdownSource(context, task.filePath)
      savedRef.current.set(task.filePath, { source: content, revision })
      setTabs((current) => (current.some((tab) => tab.path === task.filePath)
        ? current
        : [...current, { path: task.filePath, title: task.title, lockedContext: task.contexto, source: content, saveStatus: 'idle' }]))
      setActivePath(task.filePath)
    } catch {
      onErrorRef.current('No se pudo abrir el ticket.')
    }
  }, [context])

  /** A change of the editor; without `path` it belongs to the active tab. */
  const change = useCallback((source: string, path?: string) => {
    const target = path ?? activePath
    if (!target) return
    setTabs((current) => current.map((tab) => (tab.path === target ? { ...tab, source } : tab)))
    tabsRef.current = tabsRef.current.map((tab) => (tab.path === target ? { ...tab, source } : tab))
    schedule(target)
  }, [activePath, schedule])

  const close = useCallback(async (path: string) => {
    // What the editor still holds is saved before the tab goes.
    flushPendingEditorChanges()
    window.clearTimeout(timersRef.current.get(path))
    timersRef.current.delete(path)
    await save(path)
    savedRef.current.delete(path)
    setTabs((current) => current.filter((tab) => tab.path !== path))
    setActivePath((current) => (current === path ? null : current))
  }, [save])

  const activate = useCallback((path: string | null) => {
    flushPendingEditorChanges()
    setActivePath(path)
  }, [])

  // Leaving the page saves what is pending and asks before unsaved changes go.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      flushPendingEditorChanges()
      const dirty = tabsRef.current.filter((tab) => tab.source !== savedRef.current.get(tab.path)?.source)
      if (dirty.length === 0) return
      dirty.forEach((tab) => void save(tab.path))
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [save])

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
  }, [])

  return {
    tabs,
    activeTab: tabs.find((tab) => tab.path === activePath) ?? null,
    open,
    change,
    close,
    activate,
  }
}
