import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { AgendaEvent, AgendaTimeSlot, AgendaWeek } from '../types/agendaTypes'

export type SlotMode = 'add' | 'remove'

/** Clave visual de un bloque seleccionado: `fecha|minuto`. */
function slotKey(date: string, minute: number): string {
  return `${date}|${minute}`
}

const TOUCH_HOLD_MS = 350
const TOUCH_CANCEL_DISTANCE_PX = 10
const INITIAL_SCROLL_MINUTE = 8 * 60

interface GridPosition {
  day: number
  row: number
}

interface DragState {
  pointerId: number
  mode: SlotMode
  active: boolean
  originX: number
  originY: number
  timerId: number | null
}

interface AgendaWeekGridProps {
  week: AgendaWeek
  timeSlots: AgendaTimeSlot[]
  slotMinutes: number
  selectedSlots: ReadonlySet<string>
  activeEventId: string | null
  revealEventId: string | null
  onRevealed: () => void
  onSlotChange: (key: string, mode: SlotMode) => void
  onPickEvent: (eventId: string) => void
}

interface SlotButtonProps {
  slotId: string
  day: number
  row: number
  isHour: boolean
  label: string
  selected: boolean
  focusable: boolean
}

const SlotButton = memo(function SlotButton({ slotId, day, row, isHour, label, selected, focusable }: SlotButtonProps) {
  return (
    <button
      type="button"
      className="agenda-slot"
      data-slot={slotId}
      data-day={day}
      data-row={row}
      data-hour={isHour}
      aria-label={label}
      aria-pressed={selected}
      tabIndex={focusable ? 0 : -1}
      style={{ gridRow: row + 1 }}
    />
  )
})

export function AgendaWeekGrid({
  week,
  timeSlots,
  slotMinutes,
  selectedSlots,
  activeEventId,
  revealEventId,
  onRevealed,
  onSlotChange,
  onPickEvent,
}: AgendaWeekGridProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  // A pointer gesture that already changed the selection must not toggle it
  // again through the click that follows.
  const suppressClickRef = useRef(false)
  const selectedRef = useRef(selectedSlots)
  const rowCount = timeSlots.length
  const initialRow = Math.min(rowCount - 1, Math.floor(INITIAL_SCROLL_MINUTE / slotMinutes))
  const [focusPosition, setFocusPosition] = useState<GridPosition>(() => ({
    day: Math.max(0, week.days.findIndex((day) => day.isSelected)),
    row: initialRow,
  }))

  useEffect(() => { selectedRef.current = selectedSlots }, [selectedSlots])

  /** Qué evento cubre cada fila de cada día, para ubicar bloques y foco. */
  const occupancy = useMemo(() => week.days.map((day) => {
    const rows: Array<AgendaEvent | null> = Array.from({ length: rowCount }, () => null)
    for (const event of week.events) {
      if (event.date !== day.date) continue
      for (let row = event.startMinute / slotMinutes; row < event.endMinute / slotMinutes && row < rowCount; row += 1) rows[row] = event
    }
    return rows
  }), [rowCount, slotMinutes, week.days, week.events])

  useLayoutEffect(() => {
    const grid = gridRef.current
    const row = grid?.querySelector<HTMLElement>(`[data-time-row="${initialRow}"]`)
    const head = headRef.current
    // The hour column is sticky, so offsetTop would not count the header.
    if (grid && row && head) grid.scrollTop += row.getBoundingClientRect().top - head.getBoundingClientRect().bottom
  }, [initialRow])

  // While a long press selects, the finger must not scroll the grid: scrolling
  // would cancel the pointer. React touch listeners are passive, so this one
  // is registered by hand. Before the long press, touches scroll as usual.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const blockScrollWhileSelecting = (event: TouchEvent) => {
      if (dragRef.current?.active && event.cancelable) event.preventDefault()
    }
    grid.addEventListener('touchmove', blockScrollWhileSelecting, { passive: false })
    return () => grid.removeEventListener('touchmove', blockScrollWhileSelecting)
  }, [])

  useEffect(() => {
    if (!revealEventId) return
    const target = gridRef.current?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(revealEventId)}"]`)
    if (!target) return
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    onRevealed()
  }, [onRevealed, revealEventId, week.events])

  const clearDrag = useCallback(() => {
    const drag = dragRef.current
    if (drag?.timerId !== null && drag?.timerId !== undefined) window.clearTimeout(drag.timerId)
    dragRef.current = null
  }, [])

  useEffect(() => clearDrag, [clearDrag])

  const slotAtPoint = (clientX: number, clientY: number): HTMLElement | null => {
    const slot = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.agenda-slot[data-slot]') ?? null
    return slot && gridRef.current?.contains(slot) ? slot : null
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false
    const slot = (event.target as HTMLElement).closest<HTMLElement>('.agenda-slot[data-slot]')
    const key = slot?.dataset.slot
    if (!key) return
    const mode: SlotMode = selectedRef.current.has(key) ? 'remove' : 'add'
    clearDrag()
    if (event.pointerType === 'touch') {
      // A tap toggles through the click; holding starts a selection by dragging.
      const drag: DragState = { pointerId: event.pointerId, mode, active: false, originX: event.clientX, originY: event.clientY, timerId: null }
      drag.timerId = window.setTimeout(() => {
        drag.active = true
        drag.timerId = null
        suppressClickRef.current = true
        onSlotChange(key, mode)
      }, TOUCH_HOLD_MS)
      dragRef.current = drag
      return
    }
    if (event.button !== 0) return
    suppressClickRef.current = true
    onSlotChange(key, mode)
    dragRef.current = { pointerId: event.pointerId, mode, active: true, originX: event.clientX, originY: event.clientY, timerId: null }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY) > TOUCH_CANCEL_DISTANCE_PX) clearDrag()
      return
    }
    const key = slotAtPoint(event.clientX, event.clientY)?.dataset.slot
    if (key) onSlotChange(key, drag.mode)
  }

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) clearDrag()
  }

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    // Keyboard activation reports detail 0 and always toggles.
    if (event.detail !== 0 && suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    const key = (event.target as HTMLElement).closest<HTMLElement>('.agenda-slot[data-slot]')?.dataset.slot
    if (key) onSlotChange(key, selectedRef.current.has(key) ? 'remove' : 'add')
  }

  const focusCell = (position: GridPosition) => {
    const event = occupancy[position.day]?.[position.row]
    const selector = event
      ? `[data-event-id="${CSS.escape(event.id)}"]`
      : `.agenda-slot[data-day="${position.day}"][data-row="${position.row}"]`
    gridRef.current?.querySelector<HTMLElement>(selector)?.focus()
    setFocusPosition(position)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-day][data-row]')
    if (!cell) return
    const day = Number(cell.dataset.day)
    const row = Number(cell.dataset.row)
    const lastRow = Number(cell.dataset.endRow ?? row + 1) - 1
    const next: GridPosition | null = event.key === 'ArrowUp' ? { day, row: row - 1 }
      : event.key === 'ArrowDown' ? { day, row: lastRow + 1 }
        : event.key === 'ArrowLeft' ? { day: day - 1, row }
          : event.key === 'ArrowRight' ? { day: day + 1, row }
            : null
    if (!next) return
    event.preventDefault()
    if (next.day < 0 || next.day >= week.days.length || next.row < 0 || next.row >= rowCount) return
    focusCell(next)
  }

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-day][data-row]')
    if (!cell) return
    const position = { day: Number(cell.dataset.day), row: Number(cell.dataset.row) }
    setFocusPosition((current) => (current.day === position.day && current.row === position.row ? current : position))
  }

  const focusEventId = occupancy[focusPosition.day]?.[focusPosition.row]?.id ?? null
  const gridStyle = { '--agenda-slots': rowCount } as CSSProperties

  return (
    <div
      ref={gridRef}
      className="agenda-grid"
      style={gridStyle}
      role="group"
      aria-label={`Semana ${week.label} en bloques de ${slotMinutes} minutos`}
      aria-describedby="agenda-grid-help"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onContextMenu={(event) => { if ((event.target as HTMLElement).closest('.agenda-slot')) event.preventDefault() }}
    >
      <p id="agenda-grid-help" className="agenda-visually-hidden">
        Usá las flechas para moverte entre bloques y Enter o Espacio para seleccionarlos.
      </p>
      <div ref={headRef} className="agenda-grid__head">
        <div className="agenda-grid__corner" />
        {week.days.map((day) => (
          <div key={day.date} className="agenda-grid__day" data-today={day.isToday} data-selected={day.isSelected}>
            <span className="agenda-grid__day-name">{day.shortName}</span>
            <span className="agenda-grid__day-num">{day.day}</span>
          </div>
        ))}
      </div>
      <div className="agenda-grid__body">
        <div className="agenda-grid__times" aria-hidden="true">
          {timeSlots.map((slot, row) => (
            <div key={slot.minute} className="agenda-grid__time" data-time-row={row}>
              {slot.isHour && row > 0 ? slot.label : ''}
            </div>
          ))}
        </div>
        {week.days.map((day, dayIndex) => (
          <div key={day.date} className="agenda-grid__column" data-today={day.isToday}>
            {timeSlots.map((slot, row) => {
              if (occupancy[dayIndex][row]) return null
              const id = slotKey(day.date, slot.minute)
              return (
                <SlotButton
                  key={slot.minute}
                  slotId={id}
                  day={dayIndex}
                  row={row}
                  isHour={slot.isHour}
                  label={`${day.longLabel}, ${slot.label}`}
                  selected={selectedSlots.has(id)}
                  focusable={focusPosition.day === dayIndex && focusPosition.row === row}
                />
              )
            })}
            {week.events.filter((event) => event.date === day.date).map((event) => {
              const startRow = event.startMinute / slotMinutes
              const endRow = Math.min(rowCount, event.endMinute / slotMinutes)
              const isActive = event.id === activeEventId
              return (
                <button
                  key={event.id}
                  type="button"
                  className="agenda-event"
                  data-event-id={event.id}
                  data-priority={event.priority}
                  data-active={isActive}
                  data-day={dayIndex}
                  data-row={startRow}
                  data-end-row={endRow}
                  aria-pressed={isActive}
                  aria-label={`${event.title}, prioridad ${event.priorityLabel}, ${day.longLabel} de ${event.timeLabel}`}
                  tabIndex={focusEventId === event.id ? 0 : -1}
                  style={{ gridRow: `${startRow + 1} / ${endRow + 1}` }}
                  onClick={() => onPickEvent(event.id)}
                >
                  <span className="agenda-event__title">{event.title}</span>
                  <span className="agenda-event__time">{event.timeLabel}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
