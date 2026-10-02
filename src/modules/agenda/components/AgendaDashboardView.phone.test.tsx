// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { NotiaLibrary } from '../../../types/notia'
import type { AgendaView, AgendaViewRequest } from '../types/agendaTypes'
import { AgendaDashboardView } from './AgendaDashboardView'

const getAgendaView = vi.fn<(library: NotiaLibrary, request: AgendaViewRequest) => Promise<AgendaView>>()

vi.mock('../services/agendaService', () => ({
  getAgendaView: (library: NotiaLibrary, request: AgendaViewRequest) => getAgendaView(library, request),
  applyAgendaMutation: vi.fn(),
  subscribeToAgendaDataChanges: () => Promise.resolve(() => undefined),
  agendaErrorMessage: (reason: unknown) => String(reason),
}))
vi.mock('../../../hooks/useNarrowContainer', () => ({ useNarrowContainer: () => true }))

const library = { id: 'library-1', path: 'C:/Notas', name: 'Notas' } as NotiaLibrary
const DATES = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
const INITIALS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']

function agendaView(selectedDate: string): AgendaView {
  return {
    today: '2026-10-02',
    todayLabel: 'viernes 2 de octubre de 2026',
    summaryLabel: '1 evento próximo · 0 tareas pendientes',
    selectedDate,
    slotMinutes: 15,
    month: {
      key: '2026-10',
      label: 'Octubre 2026',
      prevMonth: '2026-09',
      nextMonth: '2026-11',
      weekdays: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
      cells: [{
        date: '2026-10-12',
        day: 12,
        inMonth: true,
        isToday: false,
        isSelected: false,
        hasEvents: false,
        holidayName: 'Día del Respeto a la Diversidad Cultural',
        holidayKind: 'move',
        holidayTitle: 'Día del Respeto a la Diversidad Cultural (Feriado trasladable)',
        ariaLabel: 'lunes 12 de octubre, Feriado trasladable: Día del Respeto a la Diversidad Cultural',
      }],
    },
    week: {
      label: '28 sep – 4 oct 2026',
      prevDate: '2026-09-25',
      nextDate: '2026-10-09',
      days: DATES.map((date, index) => ({
        date,
        shortName: 'Día',
        initials: INITIALS[index],
        day: Number(date.slice(8)),
        longLabel: `día ${date}`,
        isToday: date === '2026-10-02',
        isSelected: date === selectedDate,
        hasEvents: index === 4,
        holidayKind: null,
        ariaLabel: `día ${date}${index === 4 ? ', con tareas' : ''}`,
      })),
      events: [{
        id: 'event-1',
        date: '2026-10-02',
        startMinute: 660,
        endMinute: 705,
        title: 'Llamada con cliente',
        priority: 'urgent',
        priorityLabel: 'Urgente',
        timeLabel: '11:00–11:45',
        whenLabel: 'Vie 2 oct · 11:00–11:45',
        lane: 0,
        lanes: 1,
        overlapLabel: 'Se superpone con Reunión',
        tooltip: 'Llamada con cliente · 11:00–11:45',
        ariaLabel: 'Llamada con cliente, prioridad Urgente, viernes 2 de octubre de 11:00 a 11:45',
      }],
    },
    timeSlots: Array.from({ length: 96 }, (_, index) => ({
      minute: index * 15,
      label: `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`,
      isHour: index % 4 === 0,
    })),
    priorities: [{ key: 'urgent', label: 'Urgente' }, { key: 'high', label: 'Alta' }, { key: 'medium', label: 'Media' }, { key: 'low', label: 'Baja' }],
    defaultPriority: 'medium',
    upcoming: { events: [], total: 0, label: '' },
    notes: { items: [], pending: 0, pendingLabel: '0 pendientes' },
    holidays: { next: null, afterLabel: '', emptyLabel: 'No hay feriados publicados por delante.' },
    selectedDay: { label: `Día ${selectedDate}`, holidays: selectedDate === '2026-10-02' ? [] : [{ name: 'Feriado de prueba', kind: 'nonwork', kindLabel: 'Día no laborable' }] },
  }
}

describe('AgendaDashboardView on a phone', () => {
  beforeEach(() => {
    getAgendaView.mockImplementation((_library, request) => Promise.resolve(agendaView(request.selectedDate ?? '2026-10-02')))
  })
  afterEach(() => {
    cleanup()
    getAgendaView.mockReset()
  })

  it('follows the phone board: day strip, one day and the selected day under the month', async () => {
    render(<AgendaDashboardView library={library} />)
    const strip = await screen.findByRole('group', { name: 'Días de la semana' })
    expect(document.querySelector('.agenda-view--phone')).toBeTruthy()
    expect(within(strip).getAllByRole('button').map((button) => button.textContent)).toEqual(['Lu28', 'Ma29', 'Mi30', 'Ju1', 'Vi2', 'Sá3', 'Do4'])
    expect(within(strip).getByRole('button', { name: 'día 2026-10-02, con tareas' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('group', { name: 'día 2026-10-02 en bloques de 15 minutos' })).toBeTruthy()
    expect(screen.getByText('Sin feriados este día.')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Tipos de feriado' }).textContent).toBe('InamovibleTrasladablePuenteNo laborable')
    // The month days hide the holiday names on a phone.
    expect(screen.queryByText('Día del Respeto a la Diversidad Cultural')).toBeNull()
    expect(screen.getByText(/Usá la franja de la derecha/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Agregar tarea' })).toBeTruthy()
    expect(screen.getByText('No hay eventos próximos.')).toBeTruthy()

    fireEvent.click(within(strip).getByRole('button', { name: 'día 2026-09-29' }))
    await waitFor(() => expect(getAgendaView).toHaveBeenLastCalledWith(library, { selectedDate: '2026-09-29', month: null }))
    expect(await screen.findByText('Feriado de prueba')).toBeTruthy()
    expect(screen.getByText('Día no laborable').dataset.holiday).toBe('nonwork')
    expect(screen.getByRole('group', { name: 'día 2026-09-29 en bloques de 15 minutos' })).toBeTruthy()
  })

  it('puts Cancelar before Agendar once blocks are selected', async () => {
    render(<AgendaDashboardView library={library} />)
    fireEvent.click(await screen.findByRole('button', { name: 'día 2026-10-02, 09:00' }), { detail: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'día 2026-10-02, 09:15' }), { detail: 0 })
    expect(screen.getByText('2 bloques · 30 min')).toBeTruthy()
    const buttons = screen.getByRole('button', { name: 'Agendar' }).parentElement as HTMLElement
    expect(within(buttons).getAllByRole('button').map((button) => button.textContent)).toEqual(['Cancelar', 'Agendar'])
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText('2 bloques · 30 min')).toBeNull()
  })

  it('shows the picked event stacked, with Cerrar and Eliminar', async () => {
    render(<AgendaDashboardView library={library} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Llamada con cliente, prioridad Urgente/ }))
    expect(screen.getByText('Vie 2 oct · 11:00–11:45').className).toBe('agenda-bar__time')
    expect(screen.getByText('Se superpone con Reunión')).toBeTruthy()
    const buttons = screen.getByRole('button', { name: 'Eliminar' }).parentElement as HTMLElement
    expect(within(buttons).getAllByRole('button').map((button) => button.textContent)).toEqual(['Cerrar', 'Eliminar'])
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('button', { name: 'Eliminar' })).toBeNull()
  })
})
