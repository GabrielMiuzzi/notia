import { useEffect, useRef } from 'react'
import { beginPhantomClickSuppression } from '../utils/interactions/phantomClickSuppression'

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

  useEffect(() => {
    if (!open) {
      return
    }

    // Opening from a tap mounts the panel synchronously; the Android WebView
    // then dispatches the tap's native click. Without the suppression window
    // that click falls outside trigger/panel and closes the submenu right
    // after it opened.
    beginPhantomClickSuppression(triggerRef.current ?? panelRef.current)
  }, [open])

  return {
    triggerRef,
    panelRef,
  }
}
