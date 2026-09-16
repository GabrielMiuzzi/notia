import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useSubmenuEngine } from '../../hooks/useSubmenuEngine'
import { NotiaButton } from './NotiaButton'
import { NotiaSubmenuPanel } from '../notia/NotiaSubmenuPanel'

export interface NotiaSelectMenuOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

interface NotiaSelectMenuProps {
  value: string
  options: readonly NotiaSelectMenuOption[]
  onChange: (value: string) => void
  className?: string
  menuClassName?: string
  optionClassName?: string
  ariaLabel?: string
  placeholder?: ReactNode
  disabled?: boolean
}

const getEnabledOptionIndexes = (options: readonly NotiaSelectMenuOption[]) => options
  .map((option, index) => option.disabled ? -1 : index)
  .filter((index) => index >= 0)

export function NotiaSelectMenu({
  value,
  options,
  onChange,
  className,
  menuClassName,
  optionClassName,
  ariaLabel,
  placeholder = 'Seleccionar',
  disabled = false,
}: NotiaSelectMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()
  const { triggerRef: engineTriggerRef, panelRef } = useSubmenuEngine<HTMLButtonElement, HTMLDivElement>({
    open,
    onClose: () => setOpen(false),
  })
  const selectedOption = options.find((option) => option.value === value)
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled)
  const enabledIndexes = getEnabledOptionIndexes(options)

  const setTriggerRefs = (element: HTMLButtonElement | null) => {
    triggerRef.current = element
    engineTriggerRef.current = element
  }

  const selectOption = (option: NotiaSelectMenuOption) => {
    if (option.disabled) return
    if (option.value !== value) onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const focusOption = (optionIndex: number) => {
    optionRefs.current[optionIndex]?.focus()
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) setOpen(true)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
    }
  }

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, optionIndex: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectOption(options[optionIndex])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return

    event.preventDefault()
    const currentEnabledPosition = enabledIndexes.indexOf(optionIndex)
    const nextEnabledPosition = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? enabledIndexes.length - 1
        : (currentEnabledPosition + (event.key === 'ArrowDown' ? 1 : -1) + enabledIndexes.length) % enabledIndexes.length
    const nextIndex = enabledIndexes[nextEnabledPosition]
    if (nextIndex !== undefined) focusOption(nextIndex)
  }

  useEffect(() => {
    if (!open || enabledIndexes.length === 0) return
    const focusIndex = selectedIndex >= 0 ? selectedIndex : enabledIndexes[0]
    const frame = window.requestAnimationFrame(() => focusOption(focusIndex))
    return () => window.cancelAnimationFrame(frame)
  }, [enabledIndexes, open, selectedIndex])

  return (
    <div className="notia-select-menu">
      <NotiaButton
        ref={setTriggerRefs}
        className={['notia-select-menu-trigger', className].filter(Boolean).join(' ')}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selectedOption?.label ?? placeholder}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </NotiaButton>
      {open ? (
        <NotiaSubmenuPanel
          ref={panelRef}
          id={menuId}
          className={['notia-select-menu-panel', menuClassName].filter(Boolean).join(' ')}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option, index) => (
            <button
              ref={(element) => { optionRefs.current[index] = element }}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              disabled={option.disabled}
              className={[
                'notia-select-menu-option',
                option.value === value ? 'is-selected' : '',
                optionClassName,
              ].filter(Boolean).join(' ')}
              onClick={() => selectOption(option)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
            >
              {option.label}
            </button>
          ))}
        </NotiaSubmenuPanel>
      ) : null}
    </div>
  )
}
