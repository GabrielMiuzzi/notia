// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MeetingAskPanel } from './MeetingAskPanel'
import { MeetingProcessingPanel } from './MeetingProcessingPanel'
import { MeetingReadyPanel } from './MeetingReadyPanel'
import { formatClock } from './meetingDisplay'

const readyProps = {
  canStart: true,
  isStarting: false,
  onStart: vi.fn(),
  microphoneLabel: 'Micrófono USB',
  systemAudioSupported: false,
  sources: { microphone: true, system: false },
  onToggleSource: vi.fn(),
  isChecking: false,
  onToggleCheck: vi.fn(),
  levels: { microphone: [], system: [] },
  language: 'es',
  onLanguageChange: vi.fn(),
  expectedSpeakers: null,
  onExpectedSpeakersChange: vi.fn(),
  folder: 'Meetings',
  folderOptions: ['Trabajo'],
  libraryName: 'gaia',
  onFolderChange: vi.fn(),
}

describe('Meeting panels', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('formats minutes past the first hour', () => {
    expect(formatClock(65_000)).toBe('01:05')
    expect(formatClock(3_725_000)).toBe('1:02:05')
  })

  it('offers the computer audio only where the platform captures it', () => {
    render(<MeetingReadyPanel {...readyProps} />)
    const systemSwitch = screen.getByRole('switch', { name: /audio de la computadora/i })
    expect(systemSwitch).toHaveProperty('disabled', true)
    expect(screen.getByText('Disponible solo en Windows')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: /micrófono/i }))
    expect(readyProps.onToggleSource).toHaveBeenCalledWith('microphone')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar grabación' }))
    expect(readyProps.onStart).toHaveBeenCalled()
  })

  it('lists the questions of the meeting with the minute they were asked', () => {
    render(
      <MeetingAskPanel
        transcript="[02:40] Hablante 1: ¿Por qué renunció?"
        suggestions={[
          { question: '¿Por qué renunció?', atMs: 160_000 },
          { question: '¿Cómo era el puesto?', atMs: 112_000 },
        ]}
        aiPreferences={{} as never}
        library={null}
      />,
    )
    const questions = screen.getByRole('list', { name: 'Preguntas de la reunión' })
    const first = questions.querySelector('button')
    expect(first?.textContent).toBe('02:40¿Por qué renunció?')
    expect(first?.querySelector('time')?.textContent).toBe('02:40')
    expect(screen.getByRole('button', { name: /01:52.*¿Cómo era el puesto\?/ })).toBeTruthy()
    fireEvent.click(first as HTMLButtonElement)
    expect(screen.getByRole('alert').textContent).toBe('Abrí una biblioteca para preguntarle a la reunión.')
  })

  it('shows the separation stage and lets the person skip it', () => {
    const onSkip = vi.fn()
    render(
      <MeetingProcessingPanel
        durationMs={1_112_000}
        progress={0.64}
        stage="assigning-turns"
        lines={[{ id: 'line-1', startMs: 0, endMs: 2_000, text: 'Hola a todos.', question: false }]}
        isSkipping={false}
        onSkip={onSkip}
      />,
    )
    expect(screen.getByText('18:32 grabados')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('64')
    expect(screen.getByText('Asignando intervenciones').closest('li')?.getAttribute('data-state')).toBe('current')
    expect(screen.getByText('Detectando voces').closest('li')?.getAttribute('data-state')).toBe('done')
    fireEvent.click(screen.getByRole('button', { name: 'Ver texto sin separar' }))
    expect(screen.getByText('Hola a todos.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar separación' }))
    expect(onSkip).toHaveBeenCalled()
  })
})
