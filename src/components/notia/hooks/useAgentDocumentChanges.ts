import { useEffect, useRef } from 'react'
import { subscribeBackend } from '../../../services/transport'

const DOCUMENTS_CHANGED_EVENT = 'notia://library-documents-changed'

/** What the backend says the agent wrote (`backend_runtime::announce_documents_changed`). */
export interface AgentDocumentsChanged {
  libraryId: string
  /** Paths inside the library. */
  paths: string[]
  /** The same notes as the explorer and the tabs show them. */
  visiblePaths: string[]
}

const comparable = (path: string) => path.replace(/\\/g, '/').replace(/^\/\/\?\//, '').replace(/\/+$/, '')

/** The open tab paths that are one of the notes the event names. */
export function changedOpenPaths(openPaths: string[], event: AgentDocumentsChanged): string[] {
  const visible = new Set(event.visiblePaths.map(comparable))
  const inside = event.paths.map((path) => `/${comparable(path).replace(/^\/+/, '')}`)
  return openPaths.filter((openPath) => {
    const path = comparable(openPath)
    return visible.has(path) || inside.some((suffix) => path.endsWith(suffix))
  })
}

function readEvent(payload: unknown): AgentDocumentsChanged | null {
  if (!payload || typeof payload !== 'object') return null
  const { libraryId, paths, visiblePaths } = payload as Record<string, unknown>
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  return typeof libraryId === 'string' ? { libraryId, paths: strings(paths), visiblePaths: strings(visiblePaths) } : null
}

/**
 * Calls `onChanged` with the open tabs whose note the agent of a chat just
 * wrote, as soon as it writes it (a confirmed edit included), so the editor
 * shows the change without waiting for the end of the turn.
 */
export function useAgentDocumentChanges(
  libraryId: string | null | undefined,
  getOpenPaths: () => string[],
  onChanged: (paths: string[]) => void,
): void {
  const callbacks = useRef({ getOpenPaths, onChanged })
  useEffect(() => {
    callbacks.current = { getOpenPaths, onChanged }
  }, [getOpenPaths, onChanged])
  useEffect(() => {
    if (!libraryId) return
    let active = true
    let unlisten: (() => void) | null = null
    void subscribeBackend<unknown>(DOCUMENTS_CHANGED_EVENT, (payload) => {
      const event = readEvent(payload)
      if (!event || event.libraryId !== libraryId) return
      const paths = changedOpenPaths(callbacks.current.getOpenPaths(), event)
      if (paths.length) callbacks.current.onChanged(paths)
    }).then((stop) => {
      if (active) unlisten = stop
      else stop()
    }).catch(() => undefined)
    return () => {
      active = false
      unlisten?.()
    }
  }, [libraryId])
}
