import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

type NotiaButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type NotiaButtonSize = 'sm' | 'md' | 'icon'

interface NotiaButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: NotiaButtonVariant
  size?: NotiaButtonSize
  children: ReactNode
}

const TAP_MOVE_TOLERANCE_PX = 16
const DUPLICATE_TRUSTED_CLICK_WINDOW_MS = 450

const buildClassName = (
  variant: NotiaButtonVariant,
  size: NotiaButtonSize,
  className?: string,
): string => {
  const classes = ['notia-button', `notia-button--${variant}`, `notia-button--${size}`]
  if (className) {
    classes.push(className)
  }
  return classes.join(' ')
}

export const NotiaButton = forwardRef<HTMLButtonElement, NotiaButtonProps>(function NotiaButton(
  {
    variant = 'secondary',
    size = 'md',
    className,
    type = 'button',
    disabled = false,
    children,
    onClick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    ...rest
  },
  ref,
) {
  const activeTouchPointerRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    cancelled: boolean
  } | null>(null)
  const ignoreTrustedClickUntilRef = useRef(0)
  const duplicateClickResetTimeoutRef = useRef<number | null>(null)

  const clearDuplicateClickResetTimeout = useCallback(() => {
    if (duplicateClickResetTimeoutRef.current !== null) {
      window.clearTimeout(duplicateClickResetTimeoutRef.current)
      duplicateClickResetTimeoutRef.current = null
    }
  }, [])

  const clearTouchPointerState = useCallback((button: HTMLButtonElement, pointerId: number) => {
    try {
      if (button.hasPointerCapture(pointerId)) {
        button.releasePointerCapture(pointerId)
      }
    } catch {
      // Some WebViews can report capture state inconsistently after cancellation.
    }
    activeTouchPointerRef.current = null
  }, [])

  useEffect(() => clearDuplicateClickResetTimeout, [clearDuplicateClickResetTimeout])

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const isTrustedClick = event.nativeEvent.isTrusted
    if (isTrustedClick && Date.now() <= ignoreTrustedClickUntilRef.current) {
      ignoreTrustedClickUntilRef.current = 0
      clearDuplicateClickResetTimeout()
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (Date.now() > ignoreTrustedClickUntilRef.current) {
      ignoreTrustedClickUntilRef.current = 0
      clearDuplicateClickResetTimeout()
    }

    onClick?.(event)
  }, [clearDuplicateClickResetTimeout, onClick])

  const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event)
    if (event.defaultPrevented || disabled || event.button !== 0 || event.pointerType === 'mouse') {
      return
    }

    activeTouchPointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cancelled: false,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // If capture is unavailable, we still fall back to the native click path.
    }
  }, [disabled, onPointerDown])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    onPointerMove?.(event)
    const activePointer = activeTouchPointerRef.current
    if (!activePointer || activePointer.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - activePointer.startX
    const deltaY = event.clientY - activePointer.startY
    if ((deltaX * deltaX) + (deltaY * deltaY) > (TAP_MOVE_TOLERANCE_PX * TAP_MOVE_TOLERANCE_PX)) {
      activePointer.cancelled = true
    }
  }, [onPointerMove])

  const handlePointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    onPointerUp?.(event)
    const activePointer = activeTouchPointerRef.current
    if (!activePointer || activePointer.pointerId !== event.pointerId) {
      return
    }

    const buttonElement = event.currentTarget
    const deltaX = event.clientX - activePointer.startX
    const deltaY = event.clientY - activePointer.startY
    const isTap =
      !activePointer.cancelled &&
      ((deltaX * deltaX) + (deltaY * deltaY) <= (TAP_MOVE_TOLERANCE_PX * TAP_MOVE_TOLERANCE_PX))

    clearTouchPointerState(buttonElement, event.pointerId)

    if (!isTap || disabled) {
      return
    }

    ignoreTrustedClickUntilRef.current = Date.now() + DUPLICATE_TRUSTED_CLICK_WINDOW_MS
    clearDuplicateClickResetTimeout()
    duplicateClickResetTimeoutRef.current = window.setTimeout(() => {
      ignoreTrustedClickUntilRef.current = 0
      duplicateClickResetTimeoutRef.current = null
    }, DUPLICATE_TRUSTED_CLICK_WINDOW_MS)

    // Android WebView can drop trusted clicks when the finger drifts slightly.
    // Trigger the activation explicitly once we know the gesture ended as a tap.
    event.preventDefault()
    buttonElement.click()
  }, [clearDuplicateClickResetTimeout, clearTouchPointerState, disabled, onPointerUp])

  const handlePointerCancel = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    onPointerCancel?.(event)
    const activePointer = activeTouchPointerRef.current
    if (!activePointer || activePointer.pointerId !== event.pointerId) {
      return
    }

    clearTouchPointerState(event.currentTarget, event.pointerId)
  }, [clearTouchPointerState, onPointerCancel])

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={buildClassName(variant, size, className)}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      {...rest}
    >
      {children}
    </button>
  )
})
