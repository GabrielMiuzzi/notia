import { useCallback, useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

interface NotiaModalShellProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  panelClassName?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  panelStyle?: CSSProperties
}

const resolveSizeClass = (size: NotiaModalShellProps['size']): string => {
  if (size === 'sm') {
    return 'notia-modal-engine-panel--sm'
  }
  if (size === 'md') {
    return 'notia-modal-engine-panel--md'
  }
  if (size === 'xl') {
    return 'notia-modal-engine-panel--xl'
  }
  return 'notia-modal-engine-panel--lg'
}

export function NotiaModalShell({
  open,
  onClose,
  children,
  panelClassName,
  size = 'lg',
  panelStyle,
}: NotiaModalShellProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const handleBackdropPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Android WebViews can retarget a touch pointerdown to the backdrop
      // while the finger is still activating a control inside the panel. Do
      // not dismiss modal surfaces from touch; their explicit close control
      // remains available and avoids losing the pending touch activation.
      if (event.pointerType !== 'mouse') {
        return
      }
      // Closing on `pointerdown` keeps the dismissal anchored to the gesture
      // that actually touched the backdrop. The phantom native `click` that
      // Android WebView dispatches after a tap can be retargeted to the
      // freshly mounted backdrop; reacting to that synthetic click instead
      // closed the modal right after the same tap opened it.
      if (event.target !== event.currentTarget) {
        return
      }
      const panel = panelRef.current
      if (panel) {
        const bounds = panel.getBoundingClientRect()
        const isInsidePanel =
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom
        if (isInsidePanel) {
          return
        }
      }
      event.preventDefault()
      onClose()
    },
    [onClose],
  )

  const handlePanelKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape') {
        return
      }
      event.stopPropagation()
      onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) {
      return
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const panel = panelRef.current
    panel?.focus({ preventScroll: true })
    return () => {
      const previous = previousFocusRef.current
      if (previous && document.contains(previous)) {
        previous.focus({ preventScroll: true })
      }
      previousFocusRef.current = null
    }
  }, [open])

  if (!open) {
    return null
  }

  const panelClasses = ['notia-modal-engine-panel', 'notia-modal-engine-panel--viewport', resolveSizeClass(size), panelClassName]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className="notia-modal-engine-backdrop"
      onPointerDown={handleBackdropPointerDown}
    >
      <div
        className={panelClasses}
        style={panelStyle}
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        onKeyDown={handlePanelKeyDown}
      >
        {children}
      </div>
    </div>
  )
}
