import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { applyRoutineMutation, getRoutineDashboard, routineErrorMessage, subscribeToRoutineDataChanges } from '../services/routineService'
import type { RoutineDashboard, RoutineMutation, RoutineMutationResponse } from '../types/routineTypes'

export type RoutineLoadStatus = 'loading' | 'ready' | 'error'

/**
 * Estado de presentación del panel: carga el DTO de Rust, lo recarga cuando el
 * agente cambia datos o la ventana recupera el foco y envía mutaciones.
 */
export function useRoutineDashboard(library: NotiaLibrary) {
  const [dashboard, setDashboard] = useState<RoutineDashboard | null>(null)
  const [status, setStatus] = useState<RoutineLoadStatus>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isMutating, setIsMutating] = useState(false)
  // Each load or mutation takes a ticket; older responses are discarded.
  const ticketRef = useRef(0)

  const reload = useCallback(async () => {
    const ticket = ++ticketRef.current
    try {
      const next = await getRoutineDashboard(library)
      if (ticket !== ticketRef.current) return
      setDashboard(next)
      setLoadError(null)
      setStatus('ready')
    } catch (reason) {
      if (ticket !== ticketRef.current) return
      setLoadError(routineErrorMessage(reason))
      setStatus('error')
    }
  }, [library])

  useEffect(() => {
    setStatus('loading')
    void reload()
  }, [reload])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    void subscribeToRoutineDataChanges(() => { void reload() }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    })
    const handleFocus = () => { void reload() }
    window.addEventListener('focus', handleFocus)
    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener('focus', handleFocus)
    }
  }, [reload])

  /** Rechaza con el mensaje del backend para que la vista lo muestre. */
  const mutate = useCallback(async (mutation: RoutineMutation): Promise<RoutineMutationResponse['outcome']> => {
    const ticket = ++ticketRef.current
    setIsMutating(true)
    try {
      const response = await applyRoutineMutation(library, mutation)
      if (ticket === ticketRef.current) {
        setDashboard(response.dashboard)
        setStatus('ready')
      }
      return response.outcome
    } catch (reason) {
      throw new Error(routineErrorMessage(reason))
    } finally {
      setIsMutating(false)
    }
  }, [library])

  return { dashboard, status, loadError, isMutating, reload, mutate }
}
