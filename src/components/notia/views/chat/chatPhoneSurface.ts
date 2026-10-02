import { useEffect, useRef, type KeyboardEvent } from 'react'
import { beginPhantomClickSuppression } from '../../../../utils/interactions/phantomClickSuppression'

/**
 * Focuses a phone sheet or drawer that just opened and gives the focus back
 * when it closes. The tap that opened it cannot close it through the
 * phantom click Android sends after the tap.
 */
export function usePhoneSurfaceFocus<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus({ preventScroll: true })
    beginPhantomClickSuppression(ref.current)
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])
  return ref
}

/** Keydown handler that closes the surface with Escape. */
export function closeOnEscape(onClose: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onClose()
  }
}
