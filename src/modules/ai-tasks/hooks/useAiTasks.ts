import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { aiTasksErrorMessage, getAiTask, listAiTasks, subscribeToAiTasks } from '../services/aiTasksService'
import type { AiTaskCard, AiTaskDetail } from '../types/aiTasksTypes'

export type AiTasksLoadStatus = 'loading' | 'ready' | 'error'

/** Las horas «Hoy · 15:00» las escribe Rust: el panel se recarga cada minuto. */
const REFRESH_INTERVAL_MS = 60_000

/**
 * Estado de presentación del panel: la lista de tareas y el detalle de la
 * elegida, que Rust arma; se recargan con cada evento del core, cada minuto
 * y al recuperar el foco.
 */
export function useAiTasks(library: NotiaLibrary, selectedId: string | null) {
  const [tasks, setTasks] = useState<AiTaskCard[]>([])
  const [detail, setDetail] = useState<AiTaskDetail | null>(null)
  const [status, setStatus] = useState<AiTasksLoadStatus>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  // Each load takes a ticket; older responses are discarded.
  const ticketRef = useRef(0)

  const reload = useCallback(async () => {
    const ticket = ++ticketRef.current
    try {
      const [nextTasks, nextDetail] = await Promise.all([
        listAiTasks(library),
        selectedId ? getAiTask(library, selectedId).catch(() => null) : Promise.resolve(null),
      ])
      if (ticket !== ticketRef.current) return
      setTasks(nextTasks)
      setDetail(nextDetail)
      setLoadError(null)
      setStatus('ready')
    } catch (reason) {
      if (ticket !== ticketRef.current) return
      setLoadError(aiTasksErrorMessage(reason))
      setStatus('error')
    }
  }, [library, selectedId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    void subscribeToAiTasks(library, () => { void reload() }).then((stop) => {
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

  return { tasks, detail, status, loadError, reload }
}
