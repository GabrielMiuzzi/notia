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
    initials: 'Dí',
    day: 21 + index,
    longLabel: `${NAMES[index]} ${21 + index} de septiembre`,
    isToday: index === 3,
    isSelected: index === 3,
    hasEvents: index === 0,
    holidayKind: null,
    ariaLabel: `${NAMES[index]} ${21 + index} de septiembre`,
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
    lane: 0,
    lanes: 2,
    overlapLabel: 'Se superpone con Llamada',
    tooltip: 'Reunión de equipo · 09:00–09:30 · se superpone con Llamada',
    ariaLabel: 'Reunión de equipo, prioridad Media, lunes 21 de septiembre de 09:00 a 09:30, superpuesta con 1 evento',
  }, {
    id: 'event-2',
    date: '2026-09-21',
    startMinute: 555,
    endMinute: 570,
    title: 'Llamada',
    priority: 'urgent',
    priorityLabel: 'Urgente',
    timeLabel: '09:15–09:30',
    whenLabel: 'Lun 21 sep · 09:15–09:30',
    lane: 1,
    lanes: 2,
    overlapLabel: 'Se superpone con Reunión de equipo',
    tooltip: 'Llamada · 09:15–09:30 · se superpone con Reunión de equipo',
    ariaLabel: 'Llamada, prioridad Urgente, lunes 21 de septiembre de 09:15 a 09:30, superpuesta con 1 evento',
  }],
}

function renderGrid(selectedSlots: ReadonlySet<string> = new Set(), dayOnly = false, gridWeek: AgendaWeek = week) {
  const onSlotChange = vi.fn()
  const onPickEvent = vi.fn()
  render(
    <AgendaWeekGrid
      week={gridWeek}
      dayOnly={dayOnly}
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

  it('keeps the blocks under events and lays overlapping events in lanes', () => {
    const { onPickEvent, onSlotChange } = renderGrid()
    fireEvent.click(slot('lunes 21 de septiembre, 09:15'), { detail: 0 })
    expect(onSlotChange).toHaveBeenCalledWith('2026-09-21|555', 'add')
    const meeting = screen.getByRole('button', { name: /Reunión de equipo, prioridad Media/ })
    const call = screen.getByRole('button', { name: /Llamada, prioridad Urgente/ })
    expect(call.style.getPropertyValue('--agenda-lane')).toBe('1')
    expect(call.style.getPropertyValue('--agenda-lanes')).toBe('2')
    expect(call.dataset.short).toBe('true')
    expect(meeting.title).toBe('Reunión de equipo · 09:00–09:30 · se superpone con Llamada')
    fireEvent.click(meeting)
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

  it('moves the focus with the arrow keys, also under events', () => {
    renderGrid()
    const start = slot('lunes 21 de septiembre, 08:45')
    start.focus()
    fireEvent.keyDown(start, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(slot('lunes 21 de septiembre, 09:00'))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(slot('lunes 21 de septiembre, 09:30'))
    expect(screen.getByRole('button', { name: /Llamada/ }).tabIndex).toBe(0)
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(slot('martes 22 de septiembre, 09:30'))
    expect(slot('martes 22 de septiembre, 09:30').tabIndex).toBe(0)
  })

  it('shows only the selected day on a phone, without the week header', () => {
    const monday = { ...week, days: week.days.map((day, index) => ({ ...day, isSelected: index === 0 })) }
    const { onSlotChange, onPickEvent } = renderGrid(new Set(), true, monday)
    expect(screen.getByRole('group', { name: 'lunes 21 de septiembre en bloques de 15 minutos' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /martes 22 de septiembre/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^lunes 21 de septiembre, / })).toHaveLength(96)
    expect(document.querySelector('.agenda-grid__head')).toBeNull()
    fireEvent.click(slot('lunes 21 de septiembre, 10:00'), { detail: 0 })
    expect(onSlotChange).toHaveBeenCalledWith('2026-09-21|600', 'add')
    fireEvent.click(screen.getByRole('button', { name: /Llamada, prioridad Urgente/ }))
    expect(onPickEvent).toHaveBeenCalledWith('event-2')
  })

  it('keeps the arrow keys inside the one day of a phone', () => {
    renderGrid(new Set(), true)
    const start = slot('jueves 24 de septiembre, 08:00')
    expect(start.tabIndex).toBe(0)
    start.focus()
    fireEvent.keyDown(start, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(start)
    fireEvent.keyDown(start, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(slot('jueves 24 de septiembre, 08:15'))
    expect(start.tabIndex).toBe(-1)
  })
})
