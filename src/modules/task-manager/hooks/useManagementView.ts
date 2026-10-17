import { useEffect, useRef, useState } from 'react'
import { readManagementView, type TaskManagerBackendContext } from '../services/taskManagerService'
import type { ManagementRequest, ManagementView } from '../types/managementTypes'

export const DEFAULT_MANAGEMENT_REQUEST: ManagementRequest = { divisionOffset: 0, rangeMode: 'auto', groupBy: 'task' }

/**
 * Management plan of a board as Rust computes it. It is read again when
 * the board changes (`generation`), when the request changes, and every
 * minute so «ahora» and the remaining hours keep moving.
 */
export function useManagementView(
  context: TaskManagerBackendContext | null,
  board: string | null,
  request: ManagementRequest,
  generation: number,
  active: boolean,
): { view: ManagementView | null; loading: boolean; error: string | null } {
  const [view, setView] = useState<ManagementView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minute, setMinute] = useState(0)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!active) return undefined
    const interval = window.setInterval(() => setMinute((value) => value + 1), 60_000)
    return () => window.clearInterval(interval)
  }, [active])

  useEffect(() => {
    if (!active || !context || !board) return
    const requestId = ++requestIdRef.current
    setLoading(true)
    readManagementView(context, board, request)
      .then((next) => {
        if (requestId !== requestIdRef.current) return
        setView(next)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (requestId !== requestIdRef.current) return
        setError(reason instanceof Error && reason.message ? reason.message : 'No se pudo calcular el plan del tablero.')
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [active, board, context, generation, minute, request])

  return { view, loading, error }
}
