import { Mic, MonitorSpeaker, Activity } from 'lucide-react'
import { MeetingLevelBars } from './MeetingLevelBars'
import { MeetingOptions, type MeetingOptionsProps } from './MeetingOptions'
import { MEETING_SOURCE_PANEL_ID } from './MeetingSourceTabs'
import { sourceStatus } from './meetingDisplay'
import type { SpeechLevelHistory } from './useSpeechLevels'

export type MeetingSource = 'microphone' | 'system'

const METER_BARS = 28

/** The live recording's setup: what it records and how to start. */
export interface MeetingLiveSetupProps {
  canStart: boolean
  isStarting: boolean
  onStart: () => void
  systemAudioSupported: boolean
  sources: Record<MeetingSource, boolean>
  onToggleSource: (source: MeetingSource) => void
  isChecking: boolean
  onToggleCheck: () => void
  levels: SpeechLevelHistory
}

interface MeetingReadyPanelProps extends MeetingOptionsProps, MeetingLiveSetupProps {
  microphoneLabel: string
}

export function MeetingReadyPanel({
  canStart,
  isStarting,
  onStart,
  microphoneLabel,
  systemAudioSupported,
  sources,
  onToggleSource,
  isChecking,
  onToggleCheck,
  levels,
  ...options
}: MeetingReadyPanelProps) {
  const sourceCards = [
    {
      id: 'microphone' as const,
      name: 'Micrófono',
      device: microphoneLabel,
      icon: Mic,
      available: true,
      levels: levels.microphone,
    },
    {
      id: 'system' as const,
      name: 'Audio de la computadora',
      device: systemAudioSupported ? 'Salida predeterminada · captura nativa' : 'Disponible solo en Windows',
      icon: MonitorSpeaker,
      available: systemAudioSupported,
      levels: levels.system,
    },
  ]

  return (
    <div className="notia-meeting-ready" id={MEETING_SOURCE_PANEL_ID} role="tabpanel">
      <section className="notia-meeting-card notia-meeting-setup" aria-label="Preparar la grabación">
        <div className="notia-meeting-hero">
          <button
            type="button"
            className="notia-meeting-record-button"
            onClick={onStart}
            disabled={!canStart || isStarting}
            aria-label="Iniciar grabación"
            aria-describedby="meeting-record-shortcut"
          >
            <Mic size={36} aria-hidden="true" />
          </button>
          <strong aria-hidden="true">{isStarting ? 'Iniciando captura de audio…' : 'Iniciar grabación'}</strong>
          <span id="meeting-record-shortcut" className="notia-meeting-shortcut">
            <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>R</kbd>
          </span>
        </div>

        <div className="notia-meeting-sources">
          {sourceCards.map((source) => {
            const enabled = source.available && sources[source.id]
            const status = sourceStatus(source.available, enabled, isChecking, source.levels)
            const Icon = source.icon
            return (
              <div key={source.id} className="notia-meeting-source-card" data-enabled={enabled ? 'true' : 'false'}>
                <div className="notia-meeting-source-head">
                  <span className="notia-meeting-source-icon" aria-hidden="true"><Icon size={17} /></span>
                  <span className="notia-meeting-source-text">
                    <strong>{source.name}</strong>
                    <small>{source.device}</small>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    className="notia-meeting-switch"
                    aria-checked={enabled}
                    aria-label={`${enabled ? 'Desactivar' : 'Activar'} ${source.name.toLowerCase()}`}
                    disabled={!source.available}
                    onClick={() => onToggleSource(source.id)}
                  >
                    <span aria-hidden="true" />
                  </button>
                </div>
                <div className="notia-meeting-source-meter">
                  <MeetingLevelBars levels={enabled && isChecking ? source.levels : []} count={METER_BARS} highlight={METER_BARS} maxHeight={16} />
                  <span role="status">{status}</span>
                </div>
              </div>
            )
          })}
        </div>

        <MeetingOptions {...options} />

        <div className="notia-meeting-setup-footer">
          <p>{systemAudioSupported
            ? 'Notia mezcla ambas fuentes internamente. No requiere dispositivos virtuales ni cambiar la entrada de Windows.'
            : 'En este dispositivo Notia graba el micrófono; el audio interno de otras aplicaciones solo se captura en Windows.'}</p>
          <button type="button" className="notia-meeting-chip-button" aria-pressed={isChecking} onClick={onToggleCheck}>
            <Activity size={14} aria-hidden="true" />
            {isChecking ? 'Detener prueba' : 'Probar audio'}
          </button>
        </div>
      </section>

      <ol className="notia-meeting-steps">
        <li><span>1</span><div><strong>Grabá</strong><small>La transcripción aparece en vivo.</small></div></li>
        <li><span>2</span><div><strong>Finalizá</strong><small>Notia separa a cada hablante.</small></div></li>
        <li><span>3</span><div><strong>Pasá por IA</strong><small>Resumen, puntos clave y tareas.</small></div></li>
      </ol>
    </div>
  )
}
