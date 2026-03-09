import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ConfirmationDialogModal } from '../../components/notia/ConfirmationDialogModal'
import { ConfirmationEngineContext, type ConfirmationEngineValue } from './ConfirmationEngineContext'

export type ConfirmationTone = 'default' | 'danger'

export interface ConfirmationRequest {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmationTone
}

type PendingConfirmation = ConfirmationRequest & {
  resolve: (accepted: boolean) => void
}

interface ConfirmationEngineProviderProps {
  children: ReactNode
}

export function ConfirmationEngineProvider({ children }: ConfirmationEngineProviderProps) {
  const [queue, setQueue] = useState<PendingConfirmation[]>([])
  const queueRef = useRef<PendingConfirmation[]>([])

  const confirm = useCallback((request: ConfirmationRequest): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const pending: PendingConfirmation = { ...request, resolve }
      setQueue((current) => [...current, pending])
    })
  }, [])

  const resolveActiveConfirmation = useCallback((accepted: boolean) => {
    setQueue((current) => {
      const [activeConfirmation, ...remaining] = current
      if (activeConfirmation) {
        activeConfirmation.resolve(accepted)
      }
      return remaining
    })
  }, [])

  const activeConfirmation = queue[0] ?? null

  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  useEffect(() => {
    return () => {
      for (const pending of queueRef.current) {
        pending.resolve(false)
      }
      queueRef.current = []
    }
  }, [])

  const value = useMemo<ConfirmationEngineValue>(() => ({ confirm }), [confirm])

  return (
    <ConfirmationEngineContext.Provider value={value}>
      {children}
      <ConfirmationDialogModal
        open={Boolean(activeConfirmation)}
        title={activeConfirmation?.title ?? ''}
        message={activeConfirmation?.message ?? ''}
        confirmLabel={activeConfirmation?.confirmLabel}
        cancelLabel={activeConfirmation?.cancelLabel}
        tone={activeConfirmation?.tone}
        onConfirm={() => resolveActiveConfirmation(true)}
        onCancel={() => resolveActiveConfirmation(false)}
      />
    </ConfirmationEngineContext.Provider>
  )
}
