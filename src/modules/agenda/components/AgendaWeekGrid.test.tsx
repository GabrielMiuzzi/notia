// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AgendaTimeSlot, AgendaWeek } from '../types/agendaTypes'
import { AgendaWeekGrid } from './AgendaWeekGrid'

const DATES = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']
const NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

const timeSlots: AgendaTimeSlot[] = Array.from({ length: 96 }, (_, index) => {
  const minute = index * 15
  return { minute, label: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`, isHour: minute % 60 === 0 }
})

const week: AgendaWeek = {
  label: '21 – 27 sep 2026',
  prevDate: '2026-09-17',
  nextDate: '2026-10-01',
  days: DATES.map((date, index) => ({
    date,
    shortName: 'Día',
    day: 21 + index,
    longLabel: `${NAMES[index]} ${21 + index} de septiembre`,
    isToday: index === 3,
    isSelected: index === 3,
  })),
  events: [{
    id: 'event-1',
    date: '2026-09-21',
    startMinute: 540,
    endMinute: 570,
    title: 'Reunión de equipo',
    priority: 'medium',
    priorityLabel: 'Media',
    timeLabel: '09:00–09:30',
    whenLabel: 'Lun 21 sep · 09:00–09:30',
  }],
}

function renderGrid(selectedSlots: ReadonlySet<string> = new Set()) {
  const onSlotChange = vi.fn()
  const onPickEvent = vi.fn()
  render(
    <AgendaWeekGrid
      week={week}
      timeSlots={timeSlots}
      slotMinutes={15}
      selectedSlots={selectedSlots}
      activeEventId={null}
      revealEventId={null}
      onRevealed={() => {}}
      onSlotChange={onSlotChange}
      onPickEvent={onPickEvent}
    />,
  )
  return { onSlotChange, onPickEvent }
}

const slot = (label: string) => screen.getByRole('button', { name: label })

describe('AgendaWeekGrid', () => {
  afterEach(cleanup)

  it('replaces the blocks an event covers with the event itself', () => {
    const { onPickEvent } = renderGrid()
    expect(screen.queryByRole('button', { name: 'lunes 21 de septiembre, 09:00' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'lunes 21 de septiembre, 09:15' })).toBeNull()
    expect(slot('lunes 21 de septiembre, 09:30')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Reunión de equipo, prioridad Media/ }))
    expect(onPickEvent).toHaveBeenCalledWith('event-1')
  })

  it('toggles a block from the keyboard', () => {
    const { onSlotChange } = renderGrid(new Set(['2026-09-24|600']))
    fireEvent.click(slot('jueves 24 de septiembre, 09:45'), { detail: 0 })
    fireEvent.click(slot('jueves 24 de septiembre, 10:00'), { detail: 0 })
    expect(onSlotChange.mock.calls).toEqual([['2026-09-24|585', 'add'], ['2026-09-24|600', 'remove']])
  })

  it('selects on mouse press and ignores the click that follows', () => {
    const { onSlotChange } = renderGrid()
    const target = slot('martes 22 de septiembre, 08:00')
    fireEvent.pointerDown(target, { pointerType: 'mouse', button: 0, pointerId: 1 })
    fireEvent.pointerUp(target, { pointerType: 'mouse', button: 0, pointerId: 1 })
    fireEvent.click(target, { detail: 1 })
    expect(onSlotChange.mock.calls).toEqual([['2026-09-22|480', 'add']])
  })

  it('toggles on a quick touch tap through the click', () => {
    const { onSlotChange } = renderGrid()
    const target = slot('martes 22 de septiembre, 08:00')
    fireEvent.pointerDown(target, { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(target, { pointerType: 'touch', pointerId: 2 })
    expect(onSlotChange).not.toHaveBeenCalled()
    fireEvent.click(target, { detail: 1 })
    expect(onSlotChange.mock.calls).toEqual([['2026-09-22|480', 'add']])
  })

  it('starts a touch selection only after holding the finger', () => {
    vi.useFakeTimers()
    try {
      const { onSlotChange } = renderGrid()
      const target = slot('martes 22 de septiembre, 08:00')
      fireEvent.pointerDown(target, { pointerType: 'touch', pointerId: 3, clientX: 10, clientY: 10 })
      vi.advanceTimersByTime(400)
      expect(onSlotChange.mock.calls).toEqual([['2026-09-22|480', 'add']])
      fireEvent.pointerUp(target, { pointerType: 'touch', pointerId: 3 })
      fireEvent.click(target, { detail: 1 })
      expect(onSlotChange).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves the focus with the arrow keys, through events', () => {
    renderGrid()
    const start = slot('lunes 21 de septiembre, 08:45')
    start.focus()
    fireEvent.keyDown(start, { key: 'ArrowDown' })
    const event = screen.getByRole('button', { name: /Reunión de equipo/ })
    expect(document.activeElement).toBe(event)
    fireEvent.keyDown(event, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(slot('lunes 21 de septiembre, 09:30'))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(slot('martes 22 de septiembre, 09:30'))
    expect(slot('martes 22 de septiembre, 09:30').tabIndex).toBe(0)
  })
})
