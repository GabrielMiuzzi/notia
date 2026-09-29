import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { applyHealthMutation, asHealthError, generateHealthPlan, getHealthDashboard, subscribeToHealth } from '../services/healthService'
import type { DashboardQuery, HealthDashboard, HealthMutation } from '../types/healthTypes'

type Status = 'loading' | 'ready' | 'error'

const INITIAL_QUERY: DashboardQuery = { foodDate: null, weightRange: '90', measurementDate: null }

/** El tablero de Salud y los pedidos a Rust; el estado es solo de pantalla. */
export function useHealthDashboard(library: NotiaLibrary) {
  const [query, setQuery] = useState<DashboardQuery>(INITIAL_QUERY)
  const [dashboard, setDashboard] = useState<HealthDashboard | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestRef = useRef(0)

  const reload = useCallback(async () => {
    const request = ++requestRef.current
    try {
      const next = await getHealthDashboard(library, query)
      if (request !== requestRef.current) return
      setDashboard(next)
      setStatus('ready')
      setLoadError(null)
    } catch (reason) {
      if (request !== requestRef.current) return
      setStatus('error')
      setLoadError(asHealthError(reason).message)
    }
  }, [library, query])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    void subscribeToHealth(library, () => { void reload() }).then((unsubscribe) => {
      if (cancelled) unsubscribe()
      else stop = unsubscribe
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [library, reload])

  /** Manda un cambio a Rust; el error vuelve al que lo pidió. */
  const apply = useCallback(async (mutation: HealthMutation) => {
    const request = ++requestRef.current
    const next = await applyHealthMutation(library, mutation, query)
    if (request === requestRef.current) setDashboard(next)
  }, [library, query])

  const generatePlan = useCallback(async () => {
    const request = ++requestRef.current
    const next = await generateHealthPlan(library, query)
    if (request === requestRef.current) setDashboard(next)
  }, [library, query])

  const updateQuery = useCallback((change: Partial<DashboardQuery>) => setQuery((current) => ({ ...current, ...change })), [])

  return { dashboard, status, loadError, query, updateQuery, reload, apply, generatePlan }
}
