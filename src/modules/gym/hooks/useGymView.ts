import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { applyGymMutation, asGymError, getBody, getGymView, subscribeToGym } from '../services/gymService'
import type { BodyView, GymMutation, GymQuery, GymView } from '../types/gymTypes'

type Status = 'loading' | 'ready' | 'error'

const INITIAL_QUERY: GymQuery = { screen: 'panel', routineId: null, day: null, search: '', group: null, onlyMine: true }

/** La vista de Gimnasio y los pedidos a Rust; el estado es solo de pantalla. */
export function useGymView(library: NotiaLibrary) {
  const [query, setQuery] = useState<GymQuery>(INITIAL_QUERY)
  const [view, setView] = useState<GymView | null>(null)
  const [body, setBody] = useState<BodyView | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const requestRef = useRef(0)
  const queryRef = useRef(query)

  // Runs before the reload below, so the request uses the new query.
  useEffect(() => {
    queryRef.current = query
  }, [query])

  const reload = useCallback(async () => {
    const request = ++requestRef.current
    try {
      const next = await getGymView(library, queryRef.current)
      if (request !== requestRef.current) return
      setView(next)
      setStatus('ready')
      setLoadError(null)
    } catch (reason) {
      if (request !== requestRef.current) return
      setStatus('error')
      setLoadError(asGymError(reason).message)
    }
  }, [library])

  useEffect(() => {
    void reload()
  }, [reload, query])

  const reloadBody = useCallback(() => {
    void getBody(library).then(setBody).catch(() => setBody(null))
  }, [library])

  useEffect(() => {
    reloadBody()
  }, [reloadBody])

  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    void subscribeToGym(library, () => { void reload() }).then((unsubscribe) => {
      if (cancelled) unsubscribe()
      else stop = unsubscribe
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [library, reload])

  /** Manda un cambio a Rust; un rechazo se muestra como aviso. */
  const apply = useCallback(async (mutation: GymMutation) => {
    const request = ++requestRef.current
    try {
      const result = await applyGymMutation(library, mutation, queryRef.current)
      if (request !== requestRef.current) return
      setView(result.view)
      setNotice(null)
      if (result.routineId) setQuery((current) => ({ ...current, routineId: result.routineId }))
    } catch (reason) {
      setNotice(asGymError(reason).message)
      void reload()
    }
  }, [library, reload])

  const updateQuery = useCallback((change: Partial<GymQuery>) => setQuery((current) => ({ ...current, ...change })), [])

  return { view, body, status, loadError, notice, setNotice, query, updateQuery, reload, apply }
}

export type GymController = ReturnType<typeof useGymView>
