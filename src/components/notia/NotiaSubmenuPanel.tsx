import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

interface NotiaSubmenuPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export const NotiaSubmenuPanel = forwardRef<HTMLDivElement, NotiaSubmenuPanelProps>(function NotiaSubmenuPanel(
  { children, className, style, ...rest },
  ref,
) {
  const panelClassName = ['notia-submenu-panel', className].filter(Boolean).join(' ')

  return (
    <div ref={ref} className={panelClassName} style={style} {...rest}>
      {children}
    </div>
  )
})
