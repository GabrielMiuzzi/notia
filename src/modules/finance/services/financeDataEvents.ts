import { subscribeBackend } from '../../../services/transport'

/** Emitted by Rust after every finance write, including the assistant's. */
export const FINANCE_DATA_CHANGED_EVENT = 'notia:finance-data-changed'

type FinanceDataListener = () => void

const listeners = new Set<FinanceDataListener>()

export function notifyFinanceDataChanged(): void {
  for (const listener of listeners) listener()
}

/** Calls `listener` when this window or the backend changed finance records. */
export function subscribeToFinanceDataChanges(listener: FinanceDataListener): () => void {
  listeners.add(listener)
  let isActive = true
  let unsubscribeBackend: (() => void) | null = null
  void Promise.resolve()
    .then(() => subscribeBackend(FINANCE_DATA_CHANGED_EVENT, () => listener()))
    .then((unsubscribe) => {
      if (isActive) unsubscribeBackend = unsubscribe
      else unsubscribe()
    })
    .catch(() => undefined)
  return () => {
    isActive = false
    listeners.delete(listener)
    unsubscribeBackend?.()
  }
}
