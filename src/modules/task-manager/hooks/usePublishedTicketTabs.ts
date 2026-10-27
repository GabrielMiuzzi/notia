import { useCallback, useEffect, useRef, useState } from 'react'
import { MARKDOWN_AUTOSAVE_DEBOUNCE_MS } from '../../../components/notia/hooks/useTextDocumentAutosave'
import { flushPendingEditorChanges } from '../../../services/markdown/pendingEditorChanges'
import { readLibraryDocument, writeLibraryDocument } from '../../../services/libraries/libraryDocumentRuntime'
import type { NotiaDocumentSaveStatus } from '../../../types/views/fileDocument'
import { readTaskMarkdownSource, writeTaskMarkdownSource, type TaskManagerBackendContext } from '../services/taskManagerService'
import type { TaskItem } from '../types/taskManagerTypes'

/*
 * The documents a published Task Manager has open, as tabs, the way the app
 * opens notes: tickets of the published boards and notes of their contexts,
 * each one in the document view, saved by itself a moment after the last
 * change. Reads and writes go through the publication's commands, which
 * Rust checks against the published boards, the note's context and its
 * revision.
 */

export interface PublishedTicketTab {
  /** Logical path of the document: its identity in the publication. */
  path: string
  title: string
  /** A ticket of a board, or a note of the boards' contexts. */
  kind: 'ticket' | 'note'
  /** Context the document keeps: the board's, or the note's own. */
  lockedContext?: string
  source: string
  saveStatus: NotiaDocumentSaveStatus
}

interface SavedState {
  source: string
  revision: string
}

/** The library root as the published page names it. */
export const PUBLISHED_VAULT_ALIAS = 'published-vault'

/** `published-vault/<logical>` → `<logical>`. */
export function publishedLogicalPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (normalized === PUBLISHED_VAULT_ALIAS) return ''
  return normalized.startsWith(`${PUBLISHED_VAULT_ALIAS}/`) ? normalized.slice(PUBLISHED_VAULT_ALIAS.length + 1) : normalized
}

export function publishedVisiblePath(logical: string): string {
  const trimmed = logical.replace(/^\/+|\/+$/g, '')
  return trimmed ? `${PUBLISHED_VAULT_ALIAS}/${trimmed}` : PUBLISHED_VAULT_ALIAS
}

const SAVE_ERROR = 'No se pudo guardar el documento.'
const CONFLICT_ERROR = 'El documento cambió en otra sesión. Cerralo y volvé a abrirlo para seguir.'

function noteTitle(logical: string): string {
  const name = logical.split('/').pop() ?? logical
  return name.replace(/\.md$/i, '')
}

export function usePublishedTicketTabs(context: TaskManagerBackendContext | null, onError: (message: string) => void) {
  const [tabs, setTabs] = useState<PublishedTicketTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  /** What each document has saved, and its revision. */
  const savedRef = useRef(new Map<string, SavedState>())
  const timersRef = useRef(new Map<string, number>())
  const savingRef = useRef(new Map<string, Promise<void>>())
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const setStatus = (path: string, saveStatus: NotiaDocumentSaveStatus) => {
    setTabs((current) => current.map((tab) => (tab.path === path ? { ...tab, saveStatus } : tab)))
  }

  /** Writes a tab's source; resolves with the new revision. */
  const write = useCallback(async (tab: PublishedTicketTab, source: string, revision: string): Promise<string> => {
    if (!context) throw new Error(SAVE_ERROR)
    if (tab.kind === 'ticket') {
      return (await writeTaskMarkdownSource(context, tab.path, source, revision))
        ?? (await readTaskMarkdownSource(context, tab.path)).revision
    }
    const result = await writeLibraryDocument(context.libraryId, publishedVisiblePath(tab.path), source, { expectedRevision: revision })
    if (!result.ok) throw new Error(result.conflict ? CONFLICT_ERROR : (result.error ?? SAVE_ERROR))
    return result.revision ?? revision
  }, [context])

  /** Saves what the tab shows, once at a time per document; a change in the meantime saves again. */
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
        const revision = await write(tab, source, saved.revision)
        savedRef.current.set(path, { source, revision })
        const latest = tabsRef.current.find((item) => item.path === path)
        setStatus(path, latest && latest.source !== source ? 'saving' : 'idle')
      } catch (error) {
        setStatus(path, 'error')
        const message = error instanceof Error ? error.message : ''
        onErrorRef.current(/cambi|conflict/i.test(message) ? CONFLICT_ERROR : message || SAVE_ERROR)
      } finally {
        savingRef.current.delete(path)
      }
    })()
    savingRef.current.set(path, run)
    return run
  }, [context, write])

  const schedule = useCallback((path: string) => {
    window.clearTimeout(timersRef.current.get(path))
    timersRef.current.set(path, window.setTimeout(() => {
      timersRef.current.delete(path)
      void save(path)
    }, MARKDOWN_AUTOSAVE_DEBOUNCE_MS))
  }, [save])

  const addTab = useCallback((tab: PublishedTicketTab, revision: string) => {
    savedRef.current.set(tab.path, { source: tab.source, revision })
    setTabs((current) => (current.some((item) => item.path === tab.path) ? current : [...current, tab]))
    setActivePath(tab.path)
  }, [])

  const open = useCallback(async (task: TaskItem) => {
    if (tabsRef.current.some((tab) => tab.path === task.filePath)) {
      setActivePath(task.filePath)
      return
    }
    if (!context) return
    try {
      const { content, revision } = await readTaskMarkdownSource(context, task.filePath)
      addTab({ path: task.filePath, title: task.title, kind: 'ticket', lockedContext: task.contexto, source: content, saveStatus: 'idle' }, revision)
    } catch {
      onErrorRef.current('No se pudo abrir el ticket.')
    }
  }, [addTab, context])

  /** Opens a note of the published contexts by its path (logical or `published-vault/…`). */
  const openNote = useCallback(async (path: string) => {
    const logical = publishedLogicalPath(path)
    if (!logical) return
    if (tabsRef.current.some((tab) => tab.path === logical)) {
      setActivePath(logical)
      return
    }
    if (!context) return
    const result = await readLibraryDocument(context.libraryId, publishedVisiblePath(logical), { markdownDefaults: true })
    if (!result.ok || !result.revision) {
      onErrorRef.current(result.error ?? 'No se pudo abrir la nota.')
      return
    }
    addTab({ path: logical, title: noteTitle(logical), kind: 'note', lockedContext: result.lockedContext, source: result.content, saveStatus: 'idle' }, result.revision)
  }, [addTab, context])

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

  /** A note renamed or moved in the explorer keeps its tab under the new path. */
  const rename = useCallback((from: string, to: string) => {
    const source = publishedLogicalPath(from)
    const target = publishedLogicalPath(to)
    if (!source || !target || source === target) return
    const move = (path: string) => (path === source ? target : path.startsWith(`${source}/`) ? `${target}${path.slice(source.length)}` : path)
    const saved = new Map<string, SavedState>()
    savedRef.current.forEach((value, key) => saved.set(move(key), value))
    savedRef.current = saved
    setTabs((current) => current.map((tab) => {
      const path = move(tab.path)
      return path === tab.path ? tab : { ...tab, path, title: tab.kind === 'note' ? noteTitle(path) : tab.title }
    }))
    setActivePath((current) => (current ? move(current) : current))
  }, [])

  /** A note deleted in the explorer loses its tab without saving. */
  const drop = useCallback((path: string) => {
    const logical = publishedLogicalPath(path)
    const gone = (candidate: string) => candidate === logical || candidate.startsWith(`${logical}/`)
    tabsRef.current.filter((tab) => gone(tab.path)).forEach((tab) => {
      window.clearTimeout(timersRef.current.get(tab.path))
      timersRef.current.delete(tab.path)
      savedRef.current.delete(tab.path)
    })
    setTabs((current) => current.filter((tab) => !gone(tab.path)))
    setActivePath((current) => (current && gone(current) ? null : current))
  }, [])

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
    openNote,
    change,
    close,
    rename,
    drop,
    activate,
  }
}
