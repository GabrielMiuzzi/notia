import { useNotiaActionValue, type NotiaActions } from './NotiaActionsContext'

/**
 * Selector-style hook for individual Notia actions.
 * Avoids re-renders caused by the monolithic actions object changing reference
 * when unrelated callbacks are recreated.
 */
export function useNotiaAction<K extends keyof NotiaActions>(actionName: K): NotiaActions[K] {
  return useNotiaActionValue(actionName)
}
