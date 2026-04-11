import { forwardRef, useCallback, type ButtonHTMLAttributes, type ReactNode, type TouchEvent } from 'react'

type NotiaButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type NotiaButtonSize = 'sm' | 'md' | 'icon'

interface NotiaButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: NotiaButtonVariant
  size?: NotiaButtonSize
  children: ReactNode
}

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
    children,
    onClick,
    onTouchEnd,
    ...rest
  },
  ref,
) {
  const handleTouchEnd = useCallback((event: TouchEvent<HTMLButtonElement>) => {
    onTouchEnd?.(event)
    if (!event.defaultPrevented && onClick) {
      event.preventDefault()
      onClick(event as unknown as React.MouseEvent<HTMLButtonElement>)
    }
  }, [onClick, onTouchEnd])

  return (
    <button 
      ref={ref} 
      type={type} 
      className={buildClassName(variant, size, className)} 
      onClick={onClick}
      onTouchEnd={handleTouchEnd}
      {...rest}
    >
      {children}
    </button>
  )
})
