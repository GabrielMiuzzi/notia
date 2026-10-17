import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'

/*
 * A popover anchored inside a card or a row, below its trigger or above it
 * when the view has no room below. It takes the focus, closes with Escape
 * (back to the trigger) or with a tap outside.
 */

const GAP = 6
const MARGIN = 8

export interface PopoverProps {
  ariaLabel: string
  anchorRef: RefObject<HTMLElement | null>
  /** The edge it hangs from and how far past it. */
  side: 'left' | 'right'
  offset: number
  width: number
  onClose: () => void
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  className?: string
  children: ReactNode
}

export function Popover({ ariaLabel, anchorRef, side, offset, width, onClose, onKeyDown, className, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [up, setUp] = useState(false)
  const closeRef = useRef(onClose)

  useLayoutEffect(() => {
    closeRef.current = onClose
  })

  useLayoutEffect(() => {
    const node = ref.current
    const anchor = anchorRef.current
    if (!node || !anchor) return
    const bounds = node.getBoundingClientRect()
    if (!bounds.height) return
    const view = node.closest<HTMLElement>('[data-tm-scroll]')?.getBoundingClientRect()
    const limitBottom = Math.min(window.innerHeight, view?.bottom ?? window.innerHeight) - MARGIN
    const limitTop = Math.max(0, view?.top ?? 0) + MARGIN
    const anchorBounds = anchor.getBoundingClientRect()
    const spaceBelow = limitBottom - anchorBounds.bottom - GAP
    const spaceAbove = anchorBounds.top - GAP - limitTop
    setUp(bounds.height > spaceBelow && (bounds.height <= spaceAbove || spaceAbove > spaceBelow))
  }, [anchorRef])

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return
      closeRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [anchorRef])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
    anchorRef.current?.focus()
  }

  return (
    <div
      ref={ref}
      className={`tm-pop tm-fmenu-shell${up ? ' is-up' : ''}${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      style={{ width, [side]: -offset }}
    >
      {children}
    </div>
  )
}
