// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MeetingOptionRows } from './MeetingOptions'
import { MeetingPhoneSetup } from './MeetingPhoneSetup'
import { MeetingPhoneRecording } from './MeetingPhoneRecording'
import { MeetingPhoneProcessing } from './MeetingPhoneProcessing'
import { MeetingPhoneCompleted } from './MeetingPhoneCompleted'
import { MeetingPhoneMenu } from './MeetingPhoneMenu'
import type { MeetingSnapshot } from '../../../../services/meeting/meetingTypes'

vi.mock('../../../../services/transport', () => ({
  callBackend: vi.fn(async () => null),
  subscribeBackend: vi.fn(async () => () => undefined),
  backendKind: () => 'local',
  backendSupports: () => true,
}))

const options = {
  language: 'es',
  onLanguageChange: vi.fn(),
  expectedSpeakers: null,
  onExpectedSpeakersChange: vi.fn(),
  folder: 'Meetings',
  folderOptions: ['Trabajo'],
  libraryName: 'gaia',
  onFolderChange: vi.fn(),
}

const live = {
  canStart: true,
  isStarting: false,
  onStart: vi.fn(),
  systemAudioSupported: false,
  sources: { microphone: true, system: true },
  onToggleSource: vi.fn(),
  isChecking: false,
  onToggleCheck: vi.fn(),
  levels: { microphone: [], system: [] },
}

const upload = {
  file: { status: 'empty' as const },
  isDragging: false,
  canTranscribe: true,
  isStarting: false,
  onChooseFile: vi.fn(),
  onRemoveFile: vi.fn(),
  onTranscribe: vi.fn(),
}

const snapshot: MeetingSnapshot = {
  id: 'meet-1',
  status: 'completed',
  title: 'Reunión',
  dateLabel: '2 de octubre',
  durationMs: 1_112_000,
  sources: { microphone: true, system: false },
  lines: [{ id: 'l1', startMs: 750_000, endMs: 765_000, text: '¿Qué te agradaba de tu trabajo?', question: true }],
  speakers: [
    { id: 's1', name: 'Hablante 1', initials: 'H1', talkMs: 678_000, sharePercent: 61, colorIndex: 0 },
    { id: 's2', name: 'Hablante 2', initials: 'H2', talkMs: 434_000, sharePercent: 39, colorIndex: 1 },
  ],
  turns: [{ id: 't1', speakerId: 's1', startMs: 0, endMs: 20_000, text: 'Bien, buenas.' }],
  totalTurns: 1,
  notes: '',
  marks: [],
  answers: [],
  liveAnswers: false,
  aiNotes: { enabled: false, running: false, objective: '', decisions: [], openQuestions: [], topics: [], tasks: [] },
  insights: { keyPoints: [], tasks: [], corrected: false },
  review: { cleaned: false, named: 0 },
  suggestedQuestions: [{ question: '¿Por qué renunció?', atMs: 160_000 }],
  contextText: '[00:00] Hablante 1: Bien, buenas.',
}

const aiContext = {
  libraryName: 'gaia',
  options: {
    folders: [{ path: 'Facultad', noteCount: 24 }, { path: 'Personal', noteCount: 8 }],
    contexts: [
      { tag: '#Personal', label: 'Personal', color: '#6FCF97', locked: false, selectedByDefault: true },
      { tag: '#Confidencial', label: 'Confidencial', color: '#FF6B6B', locked: true, selectedByDefault: false },
    ],
  },
  error: null,
  choice: { wholeLibrary: true, folder: 'Facultad', contexts: ['#Personal'] },
  setWholeLibrary: vi.fn(),
  setFolder: vi.fn(),
  toggleContext: vi.fn(),
  setAllContexts: vi.fn(),
}

const notesActions = {
  libraryId: 'lib-1',
  onToggleAiNotes: vi.fn(),
  onCallNotesAgent: vi.fn(),
  onAddOwnNote: vi.fn(async () => true),
  onRemoveMark: vi.fn(),
  onError: vi.fn(),
}

describe('Meeting phone layout', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the options as rows whose native picker changes them', () => {
    render(<MeetingOptionRows {...options} />)
    const speakers = screen.getByLabelText('Hablantes').closest('label') as HTMLElement
    expect(within(speakers).getByText('Automático')).toBeTruthy()
    expect(screen.getByText('gaia / Meetings', { selector: '.notia-meeting-option-value' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Hablantes'), { target: { value: '3' } })
    expect(options.onExpectedSpeakersChange).toHaveBeenCalledWith(3)
    fireEvent.change(screen.getByLabelText('Guardar en'), { target: { value: 'Trabajo' } })
    expect(options.onFolderChange).toHaveBeenCalledWith('Trabajo')
    cleanup()

    render(<MeetingOptionRows {...options} libraryName={null} />)
    expect(screen.getByText('Abrí una biblioteca', { selector: '.notia-meeting-option-value' })).toBeTruthy()
    expect((screen.getByLabelText('Guardar en') as HTMLSelectElement).disabled).toBe(true)
  })

  it('records from the phone: only the microphone, an audio check on demand and the button at the bottom', () => {
    render(<MeetingPhoneSetup tab="live" onSelectTab={vi.fn()} options={options} live={live} upload={upload} aiContext={aiContext} />)
    expect(screen.queryByRole('switch', { name: /audio de la computadora/i })).toBeNull()
    expect(screen.getByText('Listo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Probar audio/ }))
    expect(live.onToggleCheck).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('switch', { name: 'Desactivar micrófono' }))
    expect(live.onToggleSource).toHaveBeenCalledWith('microphone')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar grabación' }))
    expect(live.onStart).toHaveBeenCalledOnce()
    expect(screen.getByRole('tab', { name: /Grabar/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('offers the computer audio where the backend captures it', () => {
    render(<MeetingPhoneSetup tab="live" onSelectTab={vi.fn()} options={options} live={{ ...live, systemAudioSupported: true }} upload={upload} aiContext={aiContext} />)
    expect(screen.getByRole('switch', { name: /audio de la computadora/i })).toBeTruthy()
  })

  it('chooses the AI context in a sheet: the whole library with its contexts, or a folder', () => {
    const { rerender } = render(<MeetingPhoneSetup tab="live" onSelectTab={vi.fn()} options={options} live={live} upload={upload} aiContext={aiContext} />)
    const row = screen.getByRole('button', { name: /Contexto IA/ })
    expect(row.textContent).toContain('Toda la librería · 1 de 2')
    fireEvent.click(row)
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('heading', { name: 'Contexto para la IA' })).toBeTruthy()
    // With the whole library the folders wait; the contexts choose.
    expect((within(sheet).getByRole('radio', { name: /Facultad/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(sheet).getByRole('button', { name: /Confidencial/ }))
    expect(aiContext.toggleContext).toHaveBeenCalledWith('#Confidencial')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Todos' }))
    expect(aiContext.setAllContexts).toHaveBeenCalledWith(true)
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Toda la librería' }))
    expect(aiContext.setWholeLibrary).toHaveBeenCalledWith(false)

    const folderChoice = { ...aiContext, choice: { ...aiContext.choice, wholeLibrary: false } }
    rerender(<MeetingPhoneSetup tab="live" onSelectTab={vi.fn()} options={options} live={live} upload={upload} aiContext={folderChoice} />)
    expect(screen.getByRole('radio', { name: /Facultad/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: /Personal/ }))
    expect(aiContext.setFolder).toHaveBeenCalledWith('Personal')
    expect((screen.getByRole('button', { name: /Confidencial/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /Contexto IA/ }).textContent).toContain('Facultad')
  })

  it('picks a file or a video of the gallery and transcribes it once ready', () => {
    const onSelectTab = vi.fn()
    const ready = {
      ...upload,
      file: {
        status: 'ready' as const,
        media: { mediaId: 'm1', name: 'entrevista-rrhh.mp4', kind: 'video' as const, byteLength: 142 * 1024 * 1024, durationMs: 1_112_000, peaks: [] },
      },
    }
    render(<MeetingPhoneSetup tab="file" onSelectTab={onSelectTab} options={options} live={live} upload={ready} aiContext={aiContext} />)
    expect(screen.queryByRole('button', { name: /Contexto IA/ })).toBeNull()
    expect(screen.getByText('18:32 · 142 MB · se usa solo el audio')).toBeTruthy()
    expect(screen.getByLabelText('Elegir un video de la galería').getAttribute('accept')).toBe('video/*')
    const picked = new File(['x'], 'reunion.m4a', { type: 'audio/mp4' })
    fireEvent.change(screen.getByLabelText('Elegir un audio o un video'), { target: { files: [picked] } })
    expect(upload.onChooseFile).toHaveBeenCalledWith(picked)
    fireEvent.click(screen.getByRole('button', { name: /Transcribir archivo/ }))
    expect(upload.onTranscribe).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('tab', { name: /Grabar/ }))
    expect(onSelectTab).toHaveBeenCalledWith('live')
  })

  it('records with lines arriving late and the controls at the bottom', () => {
    const handlers = {
      onMark: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
      onStop: vi.fn(),
      onToggleLiveAnswers: vi.fn(),
      onRegenerateAnswer: vi.fn(),
      onPinAnswer: vi.fn(),
      onSaveNotes: vi.fn(),
      onRemoveMark: vi.fn(),
      onCloseSheet: vi.fn(),
    }
    const recording = { ...snapshot, status: 'live' as const, lines: [] }
    const props = { snapshot: recording, partialText: '', levels: { microphone: [], system: [] }, isPaused: false, canMark: true, sheet: null, notesActions, ...handlers }
    const { rerender } = render(<MeetingPhoneRecording {...props} />)
    // Android has no preview: the transcript waits for the first lines.
    expect(screen.getByText('Las frases aparecen acá a medida que se reconocen.')).toBeTruthy()
    expect(screen.getByText(/Activalo y Munin arma el resumen/)).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Notas IA' }))
    expect(notesActions.onToggleAiNotes).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Respuestas' }))
    expect(screen.getByText('Activalo y, cuando alguien haga una pregunta, la respuesta aparece acá.')).toBeTruthy()
    rerender(<MeetingPhoneRecording {...props} snapshot={{ ...recording, lines: snapshot.lines }} />)
    expect(screen.getByText('¿Qué te agradaba de tu trabajo?')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Respuestas en vivo' }))
    expect(handlers.onToggleLiveAnswers).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Marcar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar' }))
    expect(handlers.onMark).toHaveBeenCalledOnce()
    expect(handlers.onPause).toHaveBeenCalledOnce()
    expect(handlers.onStop).toHaveBeenCalledOnce()
    rerender(<MeetingPhoneRecording {...props} isPaused sheet="marks" snapshot={{ ...recording, marks: [{ id: 'k1', atMs: 0, label: 'Inicio' }] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reanudar' }))
    expect(handlers.onResume).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar el momento 00:00' }))
    expect(handlers.onRemoveMark).toHaveBeenCalledWith('k1')
  })

  it('sums up Notas IA on the phone: the topic under way, the latest of each kind and «Llamar agente»', () => {
    const notes = {
      ...snapshot.aiNotes,
      enabled: true,
      nextPassAt: Date.now() + 42_000,
      decisions: ['Repasar formación primero', 'Repasar primero formación y experiencia.'],
      openQuestions: ['Qué busca aprender en el nuevo puesto.'],
      topics: [
        { title: 'Lo que le gustaba y no de su trabajo', atMs: 750_000, items: ['Le disgustan los proveedores que no cumplen plazos'], current: true },
        { title: 'Presentación', atMs: 0, items: ['Etapa final'], current: false },
      ],
      tasks: [{ id: 'nt-1', text: 'Pedir un ejemplo concreto de un atraso.', owner: '', ownerInitials: '', due: '', sent: false }],
    }
    render(
      <MeetingPhoneRecording
        snapshot={{ ...snapshot, status: 'live', aiNotes: notes }}
        partialText=""
        levels={{ microphone: [], system: [] }}
        isPaused={false}
        canMark
        onMark={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        onToggleLiveAnswers={vi.fn()}
        onRegenerateAnswer={vi.fn()}
        onPinAnswer={vi.fn()}
        onSaveNotes={vi.fn()}
        onRemoveMark={vi.fn()}
        notesActions={notesActions}
        sheet={null}
        onCloseSheet={vi.fn()}
      />,
    )
    expect(screen.getByRole('tab', { name: /Notas IA/ }).textContent).toBe('Notas IA2')
    expect(screen.getByText('Lo que le gustaba y no de su trabajo')).toBeTruthy()
    expect(screen.getByText('En curso')).toBeTruthy()
    expect(screen.getByText('Repasar primero formación y experiencia.')).toBeTruthy()
    expect(screen.queryByText('Repasar formación primero')).toBeNull()
    expect(screen.getByText('Pedir un ejemplo concreto de un atraso.')).toBeTruthy()
    expect(screen.getByText(/Próxima actualización en/).textContent).toMatch(/0:4\d/)
    fireEvent.click(screen.getByRole('button', { name: /Llamar agente/ }))
    expect(notesActions.onCallNotesAgent).toHaveBeenCalledOnce()
  })

  it('keeps «Cancelar separación» while separating and cancels a file being transcribed', () => {
    const onSkip = vi.fn()
    const onCancelFile = vi.fn()
    const { rerender } = render(
      <MeetingPhoneProcessing durationMs={1_112_000} progress={0.64} stage="detecting-speakers" lines={[]} isSkipping={false} onSkip={onSkip} onCancelFile={onCancelFile} />,
    )
    expect(screen.getByRole('heading', { name: 'Separando hablantes…' })).toBeTruthy()
    expect(screen.getByText('Detectando voces').closest('li')?.getAttribute('data-state')).toBe('current')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar separación' }))
    expect(onSkip).toHaveBeenCalledOnce()
    rerender(
      <MeetingPhoneProcessing durationMs={0} progress={0.3} stage="transcribing" lines={[]} sourceFile={{ name: 'entrevista.mp4', kind: 'video' }} isSkipping={false} onSkip={onSkip} onCancelFile={onCancelFile} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar transcripción' }))
    expect(onCancelFile).toHaveBeenCalledOnce()
  })

  it('shows the finished meeting by tabs, with each tab action at the bottom', () => {
    const actions = { onNewRecording: vi.fn(), onSaveNote: vi.fn(), onOpenNote: vi.fn(), onCloseSearch: vi.fn(), onFilterChange: vi.fn() }
    render(
      <MeetingPhoneCompleted
        snapshot={{ ...snapshot, savedNotePath: 'Meetings/reunion.md' }}
        filter={{ query: '', speakerId: null }}
        aiPreferences={{} as never}
        library={null}
        searchOpen={false}
        isBusy={false}
        isSaving={false}
        {...actions}
      />,
    )
    expect(screen.getByText('61% · 11:18')).toBeTruthy()
    expect(screen.getByText('Bien, buenas.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir nota' }))
    expect(actions.onOpenNote).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: /Actualizar nota/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Nueva grabación' }))
    expect(actions.onNewRecording).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Editar Hablante 1' }))
    expect((screen.getByLabelText('Nombre de Hablante 1') as HTMLInputElement).value).toBe('Hablante 1')
    expect(screen.getByRole('button', { name: 'Unir hablantes' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: /IA/ }))
    expect(screen.getByRole('heading', { name: 'Pasar por IA' })).toBeTruthy()
    expect(screen.getByLabelText('Preguntar sobre la reunión')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Guardar como nota|Actualizar nota/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /¿Por qué renunció\?/ }))
    expect(screen.getByRole('alert').textContent).toBe('Abrí una biblioteca para preguntarle a la reunión.')
  })

  it('opens a menu of the bar and runs the chosen item', () => {
    const onSelect = vi.fn()
    render(<MeetingPhoneMenu label="Más opciones" icon={null} items={[{ label: 'Cancelar grabación', onSelect }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancelar grabación' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
