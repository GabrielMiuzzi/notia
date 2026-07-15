import { useContext, useMemo } from 'react'
import { NotiaActionsContext, type NotiaActions } from './NotiaActionsContext'

/**
 * Selector-style hook for individual Notia actions.
 * Avoids re-renders caused by the monolithic actions object changing reference
 * when unrelated callbacks are recreated.
 */
export function useNotiaAction<K extends keyof NotiaActions>(actionName: K): NotiaActions[K] {
  const actions = useContext(NotiaActionsContext)
  if (!actions) {
    throw new Error('useNotiaAction must be used within a NotiaActionsProvider')
  }
  return useMemo(() => actions[actionName], [actions, actionName])
}
