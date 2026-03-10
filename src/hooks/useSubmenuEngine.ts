import { useEffect, useRef } from 'react'

interface UseSubmenuEngineOptions {
  open: boolean
  onClose: () => void
}

export function useSubmenuEngine<
  TTrigger extends HTMLElement = HTMLButtonElement,
  TPanel extends HTMLElement = HTMLDivElement,
>({ open, onClose }: UseSubmenuEngineOptions) {
  const triggerRef = useRef<TTrigger | null>(null)
  const panelRef = useRef<TPanel | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      const clickedTrigger = Boolean(triggerRef.current?.contains(target))
      const clickedPanel = Boolean(panelRef.current?.contains(target))
      if (clickedTrigger || clickedPanel) {
        return
      }

      onClose()
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('touchstart', handlePointerDown, { passive: true })
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('touchstart', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, open])

  return {
    triggerRef,
    panelRef,
  }
}
