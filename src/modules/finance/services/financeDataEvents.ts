type FinanceDataListener = () => void

const listeners = new Set<FinanceDataListener>()

export function notifyFinanceDataChanged(): void {
  for (const listener of listeners) listener()
}

export function subscribeToFinanceDataChanges(listener: FinanceDataListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
