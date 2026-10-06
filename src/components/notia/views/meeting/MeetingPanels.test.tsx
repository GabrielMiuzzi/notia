// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MeetingAskPanel } from './MeetingAskPanel'
import { MeetingProcessingPanel } from './MeetingProcessingPanel'
import { MeetingReadyPanel } from './MeetingReadyPanel'
import { LiveLines } from './MeetingRecordingPanel'
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
  aiContext: {
    libraryName: 'gaia',
    options: {
      folders: [{ path: 'Facultad', noteCount: 24 }, { path: 'Facultad/Materia', noteCount: 3 }],
      // A library has as many contexts as it wants.
      contexts: Array.from({ length: 10 }, (_, index) => ({
        tag: `#Contexto${index + 1}`,
        label: `Contexto${index + 1}`,
        color: '#6C8EFF',
        locked: index === 0,
        selectedByDefault: index !== 0,
      })),
    },
    error: null,
    choice: { wholeLibrary: true, folder: 'Facultad', contexts: ['#Contexto2', '#Contexto3'] },
    setWholeLibrary: vi.fn(),
    setFolder: vi.fn(),
    toggleContext: vi.fn(),
    setAllContexts: vi.fn(),
  },
}

describe('Meeting panels', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('names the live lines with who the call says was speaking', () => {
    render(
      <LiveLines
        lines={[
          { id: 'line-1', startMs: 0, endMs: 2_000, text: 'Arranquemos.', question: false, speaker: 'Ana Pérez' },
          { id: 'line-2', startMs: 2_000, endMs: 4_000, text: 'Sin llamada.', question: false },
        ]}
        answers={[]}
      />,
    )
    expect(screen.getByText('Ana Pérez')).toBeTruthy()
    expect(screen.getByText('Sin llamada.').parentElement?.querySelector('.notia-meeting-live-speaker')).toBeNull()
  })

  it('formats minutes past the first hour', () => {
    expect(formatClock(65_000)).toBe('01:05')
    expect(formatClock(3_725_000)).toBe('1:02:05')
  })

  it('lets the person choose each device and warns about a virtual one', () => {
    const choose = vi.fn()
    const devices = {
      supported: true,
      microphones: [
        { name: 'Micrófono (Voicemod)', isDefault: true, isVirtual: true },
        { name: 'Micrófono (Yeti X)', isDefault: false, isVirtual: false },
      ],
      outputs: [{ name: 'Altavoces (G935)', isDefault: true, isVirtual: false }],
      microphone: null,
      output: null,
    }
    const { rerender } = render(<MeetingReadyPanel {...readyProps} systemAudioSupported audioDevices={{ devices, choose }} />)
    const microphone = screen.getByRole('combobox', { name: 'Dispositivo de micrófono' }) as HTMLSelectElement
    expect(microphone.value).toBe('')
    expect(screen.getByRole('option', { name: 'Predeterminado de Windows · Micrófono (Voicemod)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Micrófono (Voicemod) (virtual)' })).toBeTruthy()
    expect(screen.getByText(/Es un dispositivo virtual/)).toBeTruthy()
    fireEvent.change(microphone, { target: { value: 'Micrófono (Yeti X)' } })
    expect(choose).toHaveBeenCalledWith('microphone', 'Micrófono (Yeti X)')

    rerender(<MeetingReadyPanel {...readyProps} systemAudioSupported audioDevices={{ devices: { ...devices, microphone: 'Micrófono (Yeti X)' }, choose }} />)
    expect(screen.queryByText(/Es un dispositivo virtual/)).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Dispositivo de audio de la computadora' }), { target: { value: '' } })
    expect(choose).toHaveBeenLastCalledWith('system', null)
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

  it('limits the AI to the whole library with some contexts, or to a folder', () => {
    const { rerender } = render(<MeetingReadyPanel {...readyProps} />)
    expect(screen.getByRole('heading', { name: 'Contexto para la IA' })).toBeTruthy()
    expect(screen.getByText('Toda la librería gaia')).toBeTruthy()
    expect((screen.getByLabelText('Carpeta de contexto') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText('2 de 10')).toBeTruthy()
    // The first eight contexts, the rest on demand.
    const group = screen.getByRole('group', { name: 'Contextos permitidos' })
    expect(group.querySelectorAll('[aria-pressed]').length).toBe(8)
    fireEvent.click(screen.getByRole('button', { name: '+2 más' }))
    expect(group.querySelectorAll('[aria-pressed]').length).toBe(10)
    fireEvent.click(screen.getByRole('button', { name: /Contexto10/ }))
    expect(readyProps.aiContext.toggleContext).toHaveBeenCalledWith('#Contexto10')
    fireEvent.click(screen.getByRole('button', { name: 'Ninguno' }))
    expect(readyProps.aiContext.setAllContexts).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('switch', { name: 'Toda la librería' }))
    expect(readyProps.aiContext.setWholeLibrary).toHaveBeenCalledWith(false)

    const folderChoice = { ...readyProps.aiContext, choice: { ...readyProps.aiContext.choice, wholeLibrary: false } }
    rerender(<MeetingReadyPanel {...readyProps} aiContext={folderChoice} />)
    expect(screen.getByText('gaia / Facultad')).toBeTruthy()
    expect(screen.getByText('24 notas')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Carpeta de contexto'), { target: { value: 'Facultad/Materia' } })
    expect(readyProps.aiContext.setFolder).toHaveBeenCalledWith('Facultad/Materia')
    expect((screen.getByRole('button', { name: /Contexto2/ }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<MeetingReadyPanel {...readyProps} aiContext={{ ...readyProps.aiContext, libraryName: null, options: null }} />)
    expect(screen.getByText('Abrí una biblioteca para que la IA consulte tus notas.')).toBeTruthy()
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

  it('names the second pass when the backend transcribes the recording again', () => {
    render(
      <MeetingProcessingPanel
        durationMs={60_000}
        progress={0.7}
        stage="second-pass"
        lines={[]}
        isSkipping={false}
        onSkip={vi.fn()}
      />,
    )
    expect(screen.getByText('Segunda pasada por palabra').closest('li')?.getAttribute('data-state')).toBe('current')
    expect(screen.queryByText('Asignando intervenciones')).toBeNull()
  })
})
