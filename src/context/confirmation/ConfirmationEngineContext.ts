import { createContext } from 'react'
import type { ConfirmationRequest } from './ConfirmationEngine'

export interface ConfirmationEngineValue {
  confirm: (request: ConfirmationRequest) => Promise<boolean>
}

export const ConfirmationEngineContext = createContext<ConfirmationEngineValue | null>(null)
