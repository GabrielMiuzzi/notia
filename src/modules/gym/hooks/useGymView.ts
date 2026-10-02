import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { applyGymMutation, asGymError, getBody, getGymView, subscribeToGym } from '../services/gymService'
import type { BodyView, GymMutation, GymQuery, GymView } from '../types/gymTypes'

type Status = 'loading' | 'ready' | 'error'

// Al abrir, un entrenamiento en curso sigue donde estaba (Rust decide la pantalla).
const INITIAL_QUERY: GymQuery = { screen: 'panel', routineId: null, day: null, search: '', group: null, onlyMine: true, resume: true }

/** La marca de esta vista en los avisos de Rust: solo la distingue de otras ventanas. */
function newOrigin() {
  return `gym-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function sameQuery(a: GymQuery, b: GymQuery) {
  return a.screen === b.screen && a.routineId === b.routineId && a.day === b.day && a.search === b.search && a.group === b.group && a.onlyMine === b.onlyMine
}

interface Requested {
  library: NotiaLibrary
  query: GymQuery
}

/** La vista de Gimnasio y los pedidos a Rust; el estado es solo de pantalla. */
export function useGymView(library: NotiaLibrary) {
  const [query, setQuery] = useState<GymQuery>(INITIAL_QUERY)
  const [view, setView] = useState<GymView | null>(null)
  const [body, setBody] = useState<BodyView | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Cambios de esta vista que Rust todavía no respondió. */
  const [applying, setApplying] = useState(0)
  const [origin] = useState(newOrigin)
  const requestRef = useRef(0)
  const queryRef = useRef(query)
  /** Lo último que se pidió: la misma consulta no se vuelve a pedir. */
  const requestedRef = useRef<Requested | null>(null)
  /** Pedidos en curso, y si se descartó la respuesta de un cambio: otro pedido pudo leer antes de que se guardara. */
  const pendingRef = useRef(0)
  const staleRef = useRef(false)
  const reloadRef = useRef<() => Promise<void>>(() => Promise.resolve())

  // Runs before the reload below, so the request uses the new query.
  useEffect(() => {
    queryRef.current = query
  }, [query])

  /** Termina un pedido; al terminar el último, una respuesta descartada pide la vista otra vez. */
  const settle = useCallback(() => {
    pendingRef.current -= 1
    if (pendingRef.current === 0 && staleRef.current) {
      staleRef.current = false
      void reloadRef.current()
    }
  }, [])

  const reload = useCallback(async () => {
    const request = ++requestRef.current
    const sent = queryRef.current
    requestedRef.current = { library, query: sent }
    pendingRef.current += 1
    try {
      const next = await getGymView(library, sent)
      if (request !== requestRef.current) return
      if (sent.resume) {
        // La pantalla que Rust eligió pasa a ser la consulta, sin pedirla otra vez.
        const opened: GymQuery = { ...sent, resume: false, screen: next.screen, routineId: next.routineId }
        requestedRef.current = { library, query: opened }
        setQuery(opened)
      }
      setView(next)
      setStatus('ready')
      setLoadError(null)
    } catch (reason) {
      if (request !== requestRef.current) return
      setStatus('error')
      setLoadError(asGymError(reason).message)
    } finally {
      settle()
    }
  }, [library, settle])

  useEffect(() => {
    reloadRef.current = reload
  }, [reload])

  useEffect(() => {
    const requested = requestedRef.current
    if (requested && requested.library === library && sameQuery(requested.query, query)) return
    void reload()
  }, [library, query, reload])

  const reloadBody = useCallback(() => {
    void getBody(library).then(setBody).catch(() => setBody(null))
  }, [library])

  useEffect(() => {
    reloadBody()
  }, [reloadBody])

  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    // El aviso de un cambio pedido desde esta vista llega con su respuesta.
    void subscribeToGym(library, (from) => {
      if (from !== origin) void reload()
    }).then((unsubscribe) => {
      if (cancelled) unsubscribe()
      else stop = unsubscribe
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [library, origin, reload])

  /**
   * Manda un cambio a Rust; un rechazo se muestra como aviso. Devuelve la
   * rutina que Rust eligió (una creada o duplicada), si hay.
   */
  const apply = useCallback(async (mutation: GymMutation): Promise<string | null> => {
    const request = ++requestRef.current
    const sent = queryRef.current
    pendingRef.current += 1
    // En el mismo toque: los toques encolados detrás (la pantalla trabada)
    // encuentran los controles de la sesión deshabilitados.
    setApplying((count) => count + 1)
    try {
      const result = await applyGymMutation(library, mutation, sent, origin)
      if (request !== requestRef.current) {
        staleRef.current = true
        return result.routineId
      }
      // Rust armó la vista con la rutina creada o duplicada: la consulta la sigue sin pedirla de nuevo.
      requestedRef.current = { library, query: { ...sent, routineId: result.routineId ?? sent.routineId } }
      setView(result.view)
      setNotice(null)
      if (result.routineId) setQuery((current) => ({ ...current, routineId: result.routineId }))
      return result.routineId
    } catch (reason) {
      setNotice(asGymError(reason).message)
      void reload()
      return null
    } finally {
      setApplying((count) => count - 1)
      settle()
    }
  }, [library, origin, reload, settle])

  const updateQuery = useCallback((change: Partial<GymQuery>) => setQuery((current) => ({ ...current, ...change })), [])

  return { view, body, status, loadError, notice, setNotice, query, updateQuery, reload, apply, applying: applying > 0 }
}

export type GymController = ReturnType<typeof useGymView>
