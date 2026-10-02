import { useLayoutEffect, useState } from 'react'

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

function isEditing(): boolean {
  const active = document.activeElement
  return active instanceof HTMLElement && active.matches(EDITABLE_SELECTOR)
}

/**
 * Pixels of `element` the virtual keyboard covers. When Android resizes the
 * WebView for the keyboard this stays 0 (the view already shrank); when the
 * keyboard only shrinks the visual viewport, the phone layout lifts its
 * composer and sheets by this much so the field being written stays above
 * it. Only counts while a field has the focus, so a pinch zoom does not move
 * the layout.
 */
export function useKeyboardInset(element: HTMLElement | null): number {
  const [inset, setInset] = useState(0)

  useLayoutEffect(() => {
    const viewport = typeof window === 'undefined' ? null : window.visualViewport
    if (!element || !viewport) {
      setInset(0)
      return undefined
    }
    const measure = () => {
      if (!isEditing()) {
        setInset(0)
        return
      }
      const visibleBottom = viewport.offsetTop + viewport.height
      const covered = Math.round(element.getBoundingClientRect().bottom - visibleBottom)
      setInset(covered > 0 ? covered : 0)
    }
    measure()
    viewport.addEventListener('resize', measure)
    viewport.addEventListener('scroll', measure)
    document.addEventListener('focusin', measure)
    document.addEventListener('focusout', measure)
    return () => {
      viewport.removeEventListener('resize', measure)
      viewport.removeEventListener('scroll', measure)
      document.removeEventListener('focusin', measure)
      document.removeEventListener('focusout', measure)
    }
  }, [element])

  return inset
}
