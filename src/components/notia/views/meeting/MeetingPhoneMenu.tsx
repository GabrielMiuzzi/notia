import type { ReactNode } from 'react'
import { useDismissablePopover } from '../chat/useDismissablePopover'

export interface MeetingPhoneMenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
}

interface MeetingPhoneMenuProps {
  label: string
  icon: ReactNode
  items: MeetingPhoneMenuItem[]
  disabled?: boolean
}

/** An icon of the phone bar that opens a short menu; a tap outside closes it. */
export function MeetingPhoneMenu({ label, icon, items, disabled = false }: MeetingPhoneMenuProps) {
  const { open, setOpen, containerRef, onKeyDown } = useDismissablePopover<HTMLDivElement>()
  return (
    <div ref={containerRef} className="notia-meeting-menu" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="notia-meeting-phone-icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
      </button>
      {open ? (
        <div className="notia-meeting-menu-list" role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
