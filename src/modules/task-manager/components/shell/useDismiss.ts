import { useEffect, type RefObject } from 'react'

/**
 * Closes a menu when the person presses Escape or touches outside it; the
 * focus goes back to the button that opened it.
 */
export function useDismiss(
  container: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  trigger?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return undefined
    const handlePointer = (event: PointerEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) onClose()
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
      trigger?.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointer, true)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointer, true)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [container, onClose, open, trigger])
}
