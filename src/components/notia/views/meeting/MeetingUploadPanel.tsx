import { useRef } from 'react'
import { AlignLeft, FileAudio, Film, Music, Upload, X } from 'lucide-react'
import { MEETING_MEDIA_ACCEPT } from '../../../../services/meeting/meetingMediaService'
import type { MeetingMediaFile } from '../../../../services/meeting/meetingTypes'
import { MeetingOptions, type MeetingOptionsProps } from './MeetingOptions'
import { MEETING_SOURCE_PANEL_ID } from './MeetingSourceTabs'
import { formatBytes, formatClock } from './meetingDisplay'

/** The file of the upload tab, as the view follows it. */
export type MeetingFileState =
  | { status: 'empty' }
  | { status: 'uploading'; name: string; byteLength: number; progress: number }
  | { status: 'reading'; name: string; byteLength: number }
  | { status: 'ready'; media: MeetingMediaFile }

const WAVEFORM_MAX_HEIGHT = 26

interface MeetingUploadPanelProps extends MeetingOptionsProps {
  file: MeetingFileState
  isDragging: boolean
  canTranscribe: boolean
  isStarting: boolean
  onChooseFile: (file: File) => void
  onRemoveFile: () => void
  onTranscribe: () => void
}

function fileDetail(file: Exclude<MeetingFileState, { status: 'empty' }>): string {
  if (file.status === 'uploading') return `Cargando… ${Math.round(file.progress * 100)}% · ${formatBytes(file.byteLength)}`
  if (file.status === 'reading') return `Leyendo el audio… · ${formatBytes(file.byteLength)}`
  const { media } = file
  const parts = [media.kind === 'video' ? 'Video' : 'Audio', formatClock(media.durationMs), formatBytes(media.byteLength)]
  if (media.kind === 'video') parts.push('se usa solo el audio')
  return parts.join(' · ')
}

/** Upload tab of Meeting: a file that already exists, transcribed like a recording. */
export function MeetingUploadPanel({
  file,
  isDragging,
  canTranscribe,
  isStarting,
  onChooseFile,
  onRemoveFile,
  onTranscribe,
  ...options
}: MeetingUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const name = file.status === 'empty' ? null : file.status === 'ready' ? file.media.name : file.name
  const Icon = file.status !== 'ready' ? FileAudio : file.media.kind === 'video' ? Film : Music

  return (
    <div className="notia-meeting-ready" id={MEETING_SOURCE_PANEL_ID} role="tabpanel">
      <section className="notia-meeting-card notia-meeting-setup" aria-label="Subir un audio o un video">
        <div className="notia-meeting-upload">
          <div className="notia-meeting-dropzone" data-dragging={isDragging ? 'true' : undefined}>
            <span className="notia-meeting-dropzone-icon" aria-hidden="true"><Upload size={22} /></span>
            <strong className="notia-meeting-dropzone-title">Arrastrá un audio o un video</strong>
            <strong className="notia-meeting-dropzone-title--touch">Elegí un audio o un video</strong>
            <div className="notia-meeting-dropzone-choose">
              <span className="notia-meeting-dropzone-or">o</span>
              <button type="button" className="notia-meeting-secondary-button" onClick={() => inputRef.current?.click()}>
                Elegir archivo
              </button>
            </div>
            <span className="notia-meeting-dropzone-formats">MP3 · WAV · M4A · OGG · MP4 · MOV · MKV · WEBM</span>
            <input
              ref={inputRef}
              type="file"
              accept={MEETING_MEDIA_ACCEPT}
              className="notia-meeting-file-input"
              aria-label="Elegir un audio o un video"
              onChange={(event) => {
                const picked = event.target.files?.[0]
                event.target.value = ''
                if (picked) onChooseFile(picked)
              }}
            />
          </div>

          {file.status !== 'empty' && name ? (
            <div className="notia-meeting-file" data-kind={file.status === 'ready' ? file.media.kind : undefined}>
              <span className="notia-meeting-file-icon" aria-hidden="true"><Icon size={18} /></span>
              <div className="notia-meeting-file-text">
                <strong title={name}>{name}</strong>
                <small role="status">{fileDetail(file)}</small>
              </div>
              {file.status === 'ready' ? (
                <div className="notia-meeting-waveform" aria-hidden="true">
                  {file.media.peaks.map((peak, index) => (
                    <span key={index} style={{ height: `${Math.max(3, Math.round(peak * WAVEFORM_MAX_HEIGHT))}px` }} />
                  ))}
                </div>
              ) : (
                <div
                  className="notia-meeting-upload-progress"
                  role="progressbar"
                  aria-label="Carga del archivo"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={file.status === 'uploading' ? Math.round(file.progress * 100) : undefined}
                >
                  <div style={{ width: `${file.status === 'uploading' ? Math.max(4, Math.round(file.progress * 100)) : 100}%` }} />
                </div>
              )}
              <button type="button" className="notia-meeting-icon-button" aria-label="Quitar archivo" onClick={onRemoveFile}>
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>

        <MeetingOptions {...options} />

        <div className="notia-meeting-setup-footer">
          <p>Se procesa en tu equipo, igual que una grabación. Al terminar, Notia separa a los hablantes.</p>
          <button
            type="button"
            className="notia-meeting-primary-button"
            onClick={onTranscribe}
            disabled={file.status !== 'ready' || !canTranscribe || isStarting}
          >
            <AlignLeft size={15} aria-hidden="true" />
            {isStarting ? 'Iniciando…' : 'Transcribir archivo'}
          </button>
        </div>
      </section>

      <ol className="notia-meeting-steps">
        <li><span>1</span><div><strong>Subí</strong><small>Un audio o video que ya tengas.</small></div></li>
        <li><span>2</span><div><strong>Transcribí</strong><small>Notia transcribe y separa hablantes.</small></div></li>
        <li><span>3</span><div><strong>Pasá por IA</strong><small>Resumen, puntos clave y tareas.</small></div></li>
      </ol>
    </div>
  )
}
