import { useCallback, useEffect, useRef, useState } from 'react'
import { financeErrorMessage } from '../engines/financeError'
import { subscribeToFinanceDataChanges } from '../services/financeDataEvents'

export interface FinanceResource<T> {
  data: T | null
  error: string | null
  isLoading: boolean
  reload: () => void
}

/**
 * Reads one view of the Finanzas screen from Rust and reads it again when
 * `load` changes or a finance write happens. A stale answer never replaces
 * a newer one; the last good data stays on screen while it reloads.
 */
export function useFinanceResource<T>(load: () => Promise<T>, fallbackError: string): FinanceResource<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const requestRef = useRef(0)

  const reload = useCallback(() => {
    const request = ++requestRef.current
    setIsLoading(true)
    load()
      .then((value) => {
        if (request !== requestRef.current) return
        setData(value)
        setError(null)
      })
      .catch((reason) => {
        if (request === requestRef.current) setError(financeErrorMessage(reason, fallbackError))
      })
      .finally(() => {
        if (request === requestRef.current) setIsLoading(false)
      })
  }, [fallbackError, load])

  useEffect(() => {
    reload()
  }, [reload])
  useEffect(() => subscribeToFinanceDataChanges(reload), [reload])
  useEffect(() => () => {
    requestRef.current += 1
  }, [])

  return { data, error, isLoading, reload }
}
