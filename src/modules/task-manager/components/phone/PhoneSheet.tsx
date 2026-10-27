import { useEffect, useRef, type ReactNode } from 'react'

interface PhoneSheetProps {
  /** Accessible name of the dialog. */
  label: string
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]'

/**
 * The bottom sheet of the phone boards: a scrim that closes it, a handle,
 * Escape, focus on the first control and back to the opener on close.
 */
export function PhoneSheet({ label, onClose, children }: PhoneSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = sheetRef.current?.querySelector<HTMLElement>(`[aria-checked="true"], ${FOCUSABLE}`)
    first?.focus({ preventScroll: true })
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  return (
    <>
      <div className="tmp-scrim" aria-hidden="true" onClick={() => closeRef.current()} />
      <div
        ref={sheetRef}
        className="tmp-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeRef.current()
          }
        }}
      >
        <div className="tmp-sheet-handle-row">
          <button type="button" className="tmp-sheet-handle" aria-label="Cerrar" onClick={() => closeRef.current()}>
            <span />
          </button>
        </div>
        {children}
      </div>
    </>
  )
}

/** Title row of a sheet, with «Volver» when it came from another sheet. */
export function PhoneSheetTitle({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="tmp-sheet-title">
      {onBack ? (
        <button type="button" className="tmp-icon-btn tmp-sheet-back" aria-label="Volver" onClick={onBack}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
      ) : null}
      <span>{title}</span>
    </div>
  )
}
