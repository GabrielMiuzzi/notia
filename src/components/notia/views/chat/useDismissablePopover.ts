import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

/** A popover that closes when the person taps outside it or presses Escape. */
export function useDismissablePopover<T extends HTMLElement = HTMLElement>() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<T | null>(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
    }
  }
  return { open, setOpen, containerRef, onKeyDown }
}
