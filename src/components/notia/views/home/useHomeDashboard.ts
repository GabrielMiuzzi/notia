import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeBackend, type Unsubscribe } from '../../../../services/transport'
import { getHomeDashboard, homeErrorMessage } from '../../../../services/home/homeService'
import type { HomeDashboard } from '../../../../services/home/homeTypes'
import { subscribeToFinanceDataChanges } from '../../../../modules/finance/services/financeDataEvents'
import { subscribeToRoutineDataChanges } from '../../../../modules/routine/services/routineService'

const TASK_MANAGER_CHANGED_EVENT = 'task-manager-changed'
/** Changes that arrive together (a chat turn that writes to several modules) read the dashboard once. */
const REFRESH_DELAY_MS = 300

/**
 * The Home dashboard of the library, read again when a module says it
 * changed, when the window gets the focus back and after each change made
 * from Home.
 */
export function useHomeDashboard(libraryId: string | null) {
  const [dashboard, setDashboard] = useState<HomeDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const requestRef = useRef(0)

  const reload = useCallback(async () => {
    const request = ++requestRef.current
    if (!libraryId) {
      setDashboard(null)
      setError(null)
      return
    }
    setIsLoading(true)
    try {
      const next = await getHomeDashboard(libraryId)
      if (request !== requestRef.current) return
      setDashboard(next)
      setError(null)
    } catch (reason) {
      if (request !== requestRef.current) return
      setError(homeErrorMessage(reason, 'No se pudo armar el inicio.'))
    } finally {
      if (request === requestRef.current) setIsLoading(false)
    }
  }, [libraryId])

  useEffect(() => {
    setDashboard(null)
    void reload()
  }, [reload])

  useEffect(() => {
    let timer: number | null = null
    const scheduleReload = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        void reload()
      }, REFRESH_DELAY_MS)
    }
    let isActive = true
    const backendUnsubscribers: Unsubscribe[] = []
    const keep = (unsubscribe: Unsubscribe) => {
      if (isActive) backendUnsubscribers.push(unsubscribe)
      else unsubscribe()
    }
    void subscribeToRoutineDataChanges(scheduleReload).then(keep).catch(() => undefined)
    void subscribeBackend(TASK_MANAGER_CHANGED_EVENT, scheduleReload).then(keep).catch(() => undefined)
    const stopFinance = subscribeToFinanceDataChanges(scheduleReload)
    window.addEventListener('focus', scheduleReload)
    return () => {
      isActive = false
      if (timer !== null) window.clearTimeout(timer)
      stopFinance()
      for (const unsubscribe of backendUnsubscribers) unsubscribe()
      window.removeEventListener('focus', scheduleReload)
    }
  }, [reload])

  return { dashboard, error, isLoading, reload }
}
