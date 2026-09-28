import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { aiActionsErrorMessage, getAiActionsDashboard, subscribeToAiActions } from '../services/aiActionsService'
import type { AiActionsDashboard, DashboardFilter } from '../types/aiActionsTypes'

export type AiActionsLoadStatus = 'loading' | 'ready' | 'error'

/** Los textos «en N min» los recalcula Rust: el panel se recarga cada minuto. */
const REFRESH_INTERVAL_MS = 60_000

/**
 * Estado de presentación del panel: pide a Rust el tablero con el filtro y la
 * búsqueda vigentes y lo recarga con cada evento del core, cada minuto y al
 * recuperar el foco.
 */
export function useAiActionsDashboard(library: NotiaLibrary, filter: DashboardFilter, query: string) {
  const [dashboard, setDashboard] = useState<AiActionsDashboard | null>(null)
  const [status, setStatus] = useState<AiActionsLoadStatus>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  // Each load takes a ticket; older responses are discarded.
  const ticketRef = useRef(0)

  const reload = useCallback(async () => {
    const ticket = ++ticketRef.current
    try {
      const next = await getAiActionsDashboard(library, filter, query)
      if (ticket !== ticketRef.current) return
      setDashboard(next)
      setLoadError(null)
      setStatus('ready')
    } catch (reason) {
      if (ticket !== ticketRef.current) return
      setLoadError(aiActionsErrorMessage(reason))
      setStatus('error')
    }
  }, [library, filter, query])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    void subscribeToAiActions(library, () => { void reload() }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    })
    const handleFocus = () => { void reload() }
    window.addEventListener('focus', handleFocus)
    const timer = window.setInterval(() => { void reload() }, REFRESH_INTERVAL_MS)
    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener('focus', handleFocus)
      window.clearInterval(timer)
    }
  }, [library, reload])

  return { dashboard, status, loadError, reload }
}
