// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MeetingProcessingPanel } from './MeetingProcessingPanel'
import { MeetingSourceTabs } from './MeetingSourceTabs'
import { MeetingUploadPanel, type MeetingFileState } from './MeetingUploadPanel'
import { formatBytes } from './meetingDisplay'

vi.mock('../../../../services/transport', () => ({ callBackend: vi.fn() }))

const optionProps = {
  language: 'es',
  onLanguageChange: vi.fn(),
  expectedSpeakers: null,
  onExpectedSpeakersChange: vi.fn(),
  folder: 'Meetings',
  folderOptions: [],
  libraryName: 'gaia',
  onFolderChange: vi.fn(),
}

function renderUpload(file: MeetingFileState, overrides: Partial<Parameters<typeof MeetingUploadPanel>[0]> = {}) {
  const props = {
    ...optionProps,
    file,
    isDragging: false,
    canTranscribe: true,
    isStarting: false,
    onChooseFile: vi.fn(),
    onRemoveFile: vi.fn(),
    onTranscribe: vi.fn(),
    ...overrides,
  }
  render(<MeetingUploadPanel {...props} />)
  return props
}

describe('Meeting file upload', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('formats file sizes as a person reads them', () => {
    expect(formatBytes(850 * 1024)).toBe('850 KB')
    expect(formatBytes(5.25 * 1024 * 1024)).toBe('5.3 MB')
    expect(formatBytes(142 * 1024 * 1024)).toBe('142 MB')
    expect(formatBytes(1.4 * 1024 * 1024 * 1024)).toBe('1.4 GB')
  })

  it('offers to pick a file and only transcribes once one is ready', () => {
    const props = renderUpload({ status: 'empty' })
    expect(screen.getByText('Arrastrá un audio o un video')).toBeTruthy()
    expect(screen.getByText('MP3 · WAV · M4A · OGG · MP4 · MOV · MKV · WEBM')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Transcribir archivo/ }) as HTMLButtonElement).disabled).toBe(true)
    const picked = new File(['x'], 'entrevista.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText('Elegir un audio o un video'), { target: { files: [picked] } })
    expect(props.onChooseFile).toHaveBeenCalledWith(picked)
  })

  it('shows the upload progress, then the file with its waveform', () => {
    renderUpload({ status: 'uploading', name: 'entrevista-rrhh.mp4', byteLength: 142 * 1024 * 1024, progress: 0.45 })
    expect(screen.getByText('Cargando… 45% · 142 MB')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Carga del archivo' }).getAttribute('aria-valuenow')).toBe('45')
    cleanup()

    const props = renderUpload({
      status: 'ready',
      media: {
        mediaId: 'm1',
        name: 'entrevista-rrhh.mp4',
        kind: 'video',
        byteLength: 142 * 1024 * 1024,
        durationMs: 1_112_000,
        peaks: [0, 0.5, 1],
      },
    })
    expect(screen.getByText('Video · 18:32 · 142 MB · se usa solo el audio')).toBeTruthy()
    expect(document.querySelectorAll('.notia-meeting-waveform > span')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: /Transcribir archivo/ }))
    expect(props.onTranscribe).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar archivo' }))
    expect(props.onRemoveFile).toHaveBeenCalledOnce()
  })

  it('switches between recording and uploading with the arrow keys', () => {
    const onSelect = vi.fn()
    render(<MeetingSourceTabs selected="live" onSelect={onSelect} />)
    const live = screen.getByRole('tab', { name: /Grabar en vivo/ })
    expect(live.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(live, { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenCalledWith('file')
    fireEvent.click(screen.getByRole('tab', { name: /Subir audio o video/ }))
    expect(onSelect).toHaveBeenLastCalledWith('file')
  })

  it('shows a file being transcribed and lets the person cancel it', () => {
    const onCancelFile = vi.fn()
    render(
      <MeetingProcessingPanel
        durationMs={0}
        progress={0.3}
        stage="transcribing"
        lines={[]}
        sourceFile={{ name: 'entrevista-rrhh.mp4', kind: 'video' }}
        isSkipping={false}
        onSkip={vi.fn()}
        onCancelFile={onCancelFile}
      />,
    )
    expect(screen.getByText('Transcribiendo el archivo…')).toBeTruthy()
    expect(screen.getByText('entrevista-rrhh.mp4')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Progreso de la transcripción del archivo' }).getAttribute('aria-valuenow')).toBe('30')
    expect(screen.queryByRole('button', { name: 'Cancelar separación' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar transcripción' }))
    expect(onCancelFile).toHaveBeenCalledOnce()
    cleanup()

    render(
      <MeetingProcessingPanel
        durationMs={0}
        progress={0.5}
        stage="detecting-speakers"
        lines={[]}
        sourceFile={{ name: 'entrevista-rrhh.mp4', kind: 'video' }}
        isSkipping={false}
        onSkip={vi.fn()}
        onCancelFile={onCancelFile}
      />,
    )
    expect(screen.getByText('Separando hablantes…')).toBeTruthy()
    expect(screen.getByText('Archivo transcripto')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar separación' })).toBeTruthy()
  })
})
