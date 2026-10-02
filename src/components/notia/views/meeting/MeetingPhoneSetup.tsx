import { useRef, type ChangeEvent } from 'react'
import { Activity, AlignLeft, Folder, Lock, Mic, MonitorSpeaker, Video, X } from 'lucide-react'
import { MEETING_MEDIA_ACCEPT } from '../../../../services/meeting/meetingMediaService'
import { MeetingLevelBars } from './MeetingLevelBars'
import { MeetingOptionRows, type MeetingOptionsProps } from './MeetingOptions'
import type { MeetingLiveSetupProps } from './MeetingReadyPanel'
import { MEETING_SOURCE_PANEL_ID, MeetingSourceTabs, type MeetingSourceTab } from './MeetingSourceTabs'
import type { MeetingFileSetupProps } from './MeetingUploadPanel'
import { fileDetail, fileIdentity, sourceStatus } from './meetingDisplay'

/*
 * Ready stage of Meeting in the space of a phone (canvas «Notia · Meeting»,
 * boards M1 «Lista para grabar» and M1b «Subir archivo»): the setup scrolls
 * and the action that starts stays at the bottom.
 */

const METER_BARS = 30
const METER_HEIGHT = 18
const GALLERY_ACCEPT = 'video/*'

interface MeetingPhoneSetupProps {
  tab: MeetingSourceTab
  onSelectTab: (tab: MeetingSourceTab) => void
  options: MeetingOptionsProps
  live: MeetingLiveSetupProps
  upload: MeetingFileSetupProps
}

export function MeetingPhoneSetup({ tab, onSelectTab, options, live, upload }: MeetingPhoneSetupProps) {
  return (
    <div className="notia-meeting-phone-stage">
      <div className="notia-meeting-phone-setup">
        <header className="notia-meeting-phone-intro">
          {tab === 'live' ? <span className="notia-meeting-phone-eyebrow"><Lock size={13} aria-hidden="true" />Transcripción local</span> : null}
          <h1>Meeting</h1>
          <p>{tab === 'file'
            ? 'Subí una grabación que ya tengas y Notia la transcribe entera.'
            : 'Al finalizar, Notia separa las intervenciones por hablante.'}</p>
        </header>
        <MeetingSourceTabs phone selected={tab} onSelect={onSelectTab} />
        <div className="notia-meeting-phone-panel" id={MEETING_SOURCE_PANEL_ID} role="tabpanel">
          {tab === 'file' ? <PhoneFilePicker {...upload} /> : <PhoneSources {...live} />}
          <MeetingOptionRows {...options} />
        </div>
      </div>
      {tab === 'file' ? <PhoneTranscribeBar {...upload} /> : <PhoneRecordButton {...live} />}
    </div>
  )
}

function PhoneSources({ systemAudioSupported, sources, onToggleSource, isChecking, onToggleCheck, levels }: MeetingLiveSetupProps) {
  // The computer's audio exists only where the backend captures it.
  const cards = [
    { id: 'microphone' as const, name: 'Micrófono', icon: Mic, levels: levels.microphone },
    ...(systemAudioSupported ? [{ id: 'system' as const, name: 'Audio de la computadora', icon: MonitorSpeaker, levels: levels.system }] : []),
  ]
  return (
    <section className="notia-meeting-phone-card notia-meeting-phone-sources" aria-label="Fuentes de audio">
      {cards.map((source) => {
        const enabled = sources[source.id]
        const Icon = source.icon
        return (
          <div key={source.id} className="notia-meeting-phone-source" data-enabled={enabled ? 'true' : 'false'}>
            <div className="notia-meeting-phone-source-head">
              <span className="notia-meeting-phone-source-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
              <span className="notia-meeting-phone-source-text">
                <strong>{source.name}</strong>
                <small role="status">{sourceStatus(true, enabled, isChecking, source.levels)}</small>
              </span>
              <button
                type="button"
                role="switch"
                className="notia-meeting-phone-switch"
                aria-checked={enabled}
                aria-label={`${enabled ? 'Desactivar' : 'Activar'} ${source.name.toLowerCase()}`}
                onClick={() => onToggleSource(source.id)}
              >
                <span aria-hidden="true" />
              </button>
            </div>
            <MeetingLevelBars
              levels={enabled && isChecking ? source.levels : []}
              count={METER_BARS}
              highlight={METER_BARS}
              maxHeight={METER_HEIGHT}
              className="notia-meeting-phone-meter"
            />
          </div>
        )
      })}
      <div className="notia-meeting-phone-hint">
        <p>{systemAudioSupported
          ? 'Notia mezcla ambas fuentes internamente. No requiere dispositivos virtuales.'
          : 'Dejá el teléfono sobre la mesa, cerca de quienes hablan.'}</p>
        <button type="button" className="notia-meeting-chip-button" aria-pressed={isChecking} onClick={onToggleCheck}>
          <Activity size={14} aria-hidden="true" />
          {isChecking ? 'Detener prueba' : 'Probar audio'}
        </button>
      </div>
    </section>
  )
}

function PhoneRecordButton({ canStart, isStarting, onStart }: MeetingLiveSetupProps) {
  return (
    <div className="notia-meeting-phone-record">
      <button
        type="button"
        className="notia-meeting-phone-record-button"
        onClick={onStart}
        disabled={!canStart || isStarting}
        aria-label="Iniciar grabación"
      >
        <Mic size={30} aria-hidden="true" />
      </button>
      <strong aria-hidden="true">{isStarting ? 'Iniciando captura de audio…' : 'Iniciar grabación'}</strong>
    </div>
  )
}

function PhoneFilePicker({ file, isDragging, onChooseFile, onRemoveFile }: MeetingFileSetupProps) {
  const filesRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const identity = fileIdentity(file)
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    event.target.value = ''
    if (picked) onChooseFile(picked)
  }
  const Icon = file.status === 'ready' && file.media.kind === 'video' ? Video : identity?.Icon

  return (
    <>
      <div className="notia-meeting-phone-picks" data-dragging={isDragging ? 'true' : undefined}>
        <button type="button" className="notia-meeting-phone-pick" onClick={() => filesRef.current?.click()}>
          <Folder size={20} strokeWidth={1.8} aria-hidden="true" />
          <strong>Archivos</strong>
          <small>Audio o video</small>
        </button>
        <button type="button" className="notia-meeting-phone-pick" onClick={() => galleryRef.current?.click()}>
          <Video size={20} strokeWidth={1.8} aria-hidden="true" />
          <strong>Galería</strong>
          <small>Videos del teléfono</small>
        </button>
        <input ref={filesRef} type="file" accept={MEETING_MEDIA_ACCEPT} className="notia-meeting-file-input" tabIndex={-1} aria-label="Elegir un audio o un video" onChange={pick} />
        <input ref={galleryRef} type="file" accept={GALLERY_ACCEPT} className="notia-meeting-file-input" tabIndex={-1} aria-label="Elegir un video de la galería" onChange={pick} />
      </div>

      {file.status !== 'empty' && identity && Icon ? (
        <div className="notia-meeting-phone-file" data-kind={file.status === 'ready' ? file.media.kind : undefined}>
          <span className="notia-meeting-phone-file-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
          <div className="notia-meeting-phone-file-text">
            <strong title={identity.name}>{identity.name}</strong>
            <small role="status">{fileDetail(file, false)}</small>
          </div>
          <button type="button" className="notia-meeting-phone-file-remove" aria-label="Quitar archivo" onClick={onRemoveFile}>
            <X size={16} aria-hidden="true" />
          </button>
          {file.status !== 'ready' ? (
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
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function PhoneTranscribeBar({ file, canTranscribe, isStarting, onTranscribe }: MeetingFileSetupProps) {
  return (
    <div className="notia-meeting-phone-foot notia-meeting-phone-transcribe">
      <p>Se procesa en tu equipo, igual que una grabación.</p>
      <button
        type="button"
        className="notia-meeting-phone-primary"
        onClick={onTranscribe}
        disabled={file.status !== 'ready' || !canTranscribe || isStarting}
      >
        <AlignLeft size={16} aria-hidden="true" />
        {isStarting ? 'Iniciando…' : 'Transcribir archivo'}
      </button>
    </div>
  )
}
