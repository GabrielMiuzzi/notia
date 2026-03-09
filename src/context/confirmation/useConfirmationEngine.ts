import { useContext } from 'react'
import { ConfirmationEngineContext } from './ConfirmationEngineContext'

export function useConfirmationEngine() {
  const context = useContext(ConfirmationEngineContext)
  if (!context) {
    throw new Error('useConfirmationEngine must be used within ConfirmationEngineProvider.')
  }

  return context
}
