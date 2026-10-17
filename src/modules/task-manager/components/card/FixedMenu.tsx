import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { MenuAnchor } from './taskViewTypes'

/*
 * A menu or small dialog fixed to the viewport next to its trigger: it opens
 * upward when there is no room below, stays inside the screen, takes the
 * focus, moves with the arrows, and closes with Escape or a tap outside.
 */

const MARGIN = 8
const GAP = 6

interface FixedLayout {
  left: number
  top: number
  maxHeight: number
}

function placeMenu(anchor: MenuAnchor, align: 'start' | 'end', width: number, height: number): FixedLayout {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const rawLeft = align === 'end' ? anchor.right - width : anchor.left
  const left = Math.max(MARGIN, Math.min(rawLeft, viewportWidth - width - MARGIN))
  const below = anchor.bottom + GAP
  const spaceBelow = viewportHeight - MARGIN - below
  const spaceAbove = anchor.top - GAP - MARGIN
  const up = height > spaceBelow && (height <= spaceAbove || spaceAbove > spaceBelow)
  const maxHeight = Math.max(120, up ? spaceAbove : spaceBelow)
  const shown = Math.min(height, maxHeight)
  return { left, top: up ? anchor.top - GAP - shown : below, maxHeight }
}

export interface FixedMenuProps {
  anchor: MenuAnchor
  align: 'start' | 'end'
  width: number
  /** Height assumed before the first measure. */
  estimatedHeight: number
  role: 'menu' | 'dialog'
  ariaLabel: string
  /** The trigger toggles the menu itself: a tap on it is not «outside». */
  trigger: HTMLElement | null
  /** Changing it focuses the current item again (submenus). */
  focusKey: string
  onClose: (restoreFocus: boolean) => void
  /** Escape; closes and returns the focus by default. */
  onEscape?: () => void
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  className?: string
  children: ReactNode
}

function menuItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)'))
}

export function FixedMenu({
  anchor,
  align,
  width,
  estimatedHeight,
  role,
  ariaLabel,
  trigger,
  focusKey,
  onClose,
  onEscape,
  onKeyDown,
  className,
  children,
}: FixedMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState<FixedLayout>(() => placeMenu(anchor, align, width, estimatedHeight))
  const layoutRef = useRef(layout)
  const closeRef = useRef(onClose)

  useLayoutEffect(() => {
    layoutRef.current = layout
    closeRef.current = onClose
  })

  // Measures the real height and where an ancestor that holds fixed boxes
  // puts this one, then places it next to the trigger.
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const bounds = node.getBoundingClientRect()
    if (!bounds.width && !bounds.height) return
    const applied = layoutRef.current
    const holderLeft = bounds.left - applied.left
    const holderTop = bounds.top - applied.top
    const placed = placeMenu(anchor, align, width, Math.min(node.scrollHeight, window.innerHeight - 2 * MARGIN))
    const next = { left: placed.left - holderLeft, top: placed.top - holderTop, maxHeight: placed.maxHeight }
    if (Math.abs(next.left - applied.left) > 0.5 || Math.abs(next.top - applied.top) > 0.5 || next.maxHeight !== applied.maxHeight) {
      layoutRef.current = next
      setLayout(next)
    }
  }, [align, anchor, focusKey, width])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const target = node.querySelector<HTMLElement>('[data-autofocus]')
      ?? menuItems(node)[0]
      ?? node.querySelector<HTMLElement>('button, input, textarea')
    target?.focus({ preventScroll: true })
  }, [focusKey])

  useEffect(() => {
    const isInside = (target: EventTarget | null) => target instanceof Node && Boolean(ref.current?.contains(target))
    const onPointerDown = (event: PointerEvent) => {
      if (isInside(event.target)) return
      if (event.target instanceof Node && trigger?.contains(event.target)) return
      closeRef.current(false)
    }
    // A menu does not follow the page; a dialog stays (the keyboard of a phone resizes it).
    const onMove = (event: Event) => {
      if (!isInside(event.target)) closeRef.current(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    if (role === 'menu') {
      window.addEventListener('scroll', onMove, true)
      window.addEventListener('resize', onMove)
    }
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [role, trigger])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (onEscape) onEscape()
      else onClose(true)
      return
    }
    if (role !== 'menu' || !ref.current) return
    const items = menuItems(ref.current)
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    if (next >= 0) {
      event.preventDefault()
      items[next].focus()
    }
  }

  return (
    <div
      ref={ref}
      className={`tm-fmenu tm-scroll${className ? ` ${className}` : ''}`}
      role={role}
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      style={{ left: layout.left, top: layout.top, width, maxHeight: layout.maxHeight }}
    >
      {children}
    </div>
  )
}
