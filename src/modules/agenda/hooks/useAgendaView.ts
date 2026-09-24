import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { agendaErrorMessage, applyAgendaMutation, getAgendaView } from '../services/agendaService'
import type { AgendaMutation, AgendaMutationOutcome, AgendaView, AgendaViewRequest } from '../types/agendaTypes'

export type AgendaLoadStatus = 'loading' | 'ready' | 'error'

/** Hoy y su mes: Rust resuelve la fecha con el reloj local. */
export const AGENDA_TODAY_REQUEST: AgendaViewRequest = { selectedDate: null, month: null }

/**
 * Estado de presentación de la Agenda: pide a Rust la vista del día y el mes
 * elegidos, la recarga al recuperar el foco y envía mutaciones.
 */
export function useAgendaView(library: NotiaLibrary) {
  const [request, setRequest] = useState<AgendaViewRequest>(AGENDA_TODAY_REQUEST)
  const [view, setView] = useState<AgendaView | null>(null)
  const [status, setStatus] = useState<AgendaLoadStatus>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isMutating, setIsMutating] = useState(false)
  const requestRef = useRef(request)
  // Each load or mutation takes a ticket; older responses are discarded.
  const ticketRef = useRef(0)

  const load = useCallback(async (next: AgendaViewRequest) => {
    const ticket = ++ticketRef.current
    try {
      const loaded = await getAgendaView(library, next)
      if (ticket !== ticketRef.current) return
      setView(loaded)
      setLoadError(null)
      setStatus('ready')
    } catch (reason) {
      if (ticket !== ticketRef.current) return
      setLoadError(agendaErrorMessage(reason))
      setStatus('error')
    }
  }, [library])

  useEffect(() => {
    requestRef.current = request
    void load(request)
  }, [load, request])

  useEffect(() => {
    const handleFocus = () => { void load(requestRef.current) }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [load])

  const reload = useCallback(() => load(requestRef.current), [load])

  /** Rechaza con el mensaje del backend para que la vista lo muestre. */
  const mutate = useCallback(async (mutation: AgendaMutation): Promise<AgendaMutationOutcome> => {
    const ticket = ++ticketRef.current
    setIsMutating(true)
    try {
      const response = await applyAgendaMutation(library, mutation, requestRef.current)
      if (ticket === ticketRef.current) {
        setView(response.view)
        setLoadError(null)
        setStatus('ready')
      }
      return response.outcome
    } catch (reason) {
      throw new Error(agendaErrorMessage(reason))
    } finally {
      setIsMutating(false)
    }
  }, [library])

  return { view, status, loadError, isMutating, navigate: setRequest, reload, mutate }
}
