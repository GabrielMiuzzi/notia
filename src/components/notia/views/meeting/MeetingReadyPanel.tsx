import { Mic, MonitorSpeaker, Activity } from 'lucide-react'
import { MeetingLevelBars } from './MeetingLevelBars'
import type { SpeechLevelHistory } from './useSpeechLevels'

export type MeetingSource = 'microphone' | 'system'

const LANGUAGES: Array<[string, string]> = [
  ['es', 'Español'],
  ['en', 'Inglés'],
  ['pt', 'Portugués'],
  ['fr', 'Francés'],
  ['it', 'Italiano'],
  ['de', 'Alemán'],
]
const SPEAKER_COUNTS = [2, 3, 4, 5, 6]
export const DEFAULT_MEETING_FOLDER = 'Meetings'
const METER_BARS = 28
const SIGNAL_LEVEL = 0.1

interface MeetingReadyPanelProps {
  canStart: boolean
  isStarting: boolean
  onStart: () => void
  microphoneLabel: string
  systemAudioSupported: boolean
  sources: Record<MeetingSource, boolean>
  onToggleSource: (source: MeetingSource) => void
  isChecking: boolean
  onToggleCheck: () => void
  levels: SpeechLevelHistory
  language: string
  onLanguageChange: (language: string) => void
  expectedSpeakers: number | null
  onExpectedSpeakersChange: (count: number | null) => void
  folder: string
  folderOptions: string[]
  libraryName: string | null
  onFolderChange: (folder: string) => void
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
  language,
  onLanguageChange,
  expectedSpeakers,
  onExpectedSpeakersChange,
  folder,
  folderOptions,
  libraryName,
  onFolderChange,
}: MeetingReadyPanelProps) {
  const languages = LANGUAGES.some(([code]) => code === language) ? LANGUAGES : [...LANGUAGES, [language, language] as [string, string]]
  const folders = Array.from(new Set([DEFAULT_MEETING_FOLDER, folder, ...folderOptions]))
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
    <div className="notia-meeting-ready">
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
            const latest = source.levels[source.levels.length - 1] ?? 0
            const status = !source.available ? 'No disponible'
              : !enabled ? 'Apagado'
                : isChecking ? (latest >= SIGNAL_LEVEL ? 'Captando' : 'Sin señal')
                  : 'Listo'
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

        <div className="notia-meeting-options">
          <label>
            <span>Idioma</span>
            <select value={language} onChange={(event) => onLanguageChange(event.target.value)}>
              {languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          <label>
            <span>Hablantes</span>
            <select
              value={expectedSpeakers ?? 'auto'}
              onChange={(event) => onExpectedSpeakersChange(event.target.value === 'auto' ? null : Number(event.target.value))}
            >
              <option value="auto">Detectar automáticamente</option>
              {SPEAKER_COUNTS.map((count) => <option key={count} value={count}>{count} hablantes</option>)}
            </select>
          </label>
          <label>
            <span>Guardar en</span>
            <select value={folder} disabled={!libraryName} onChange={(event) => onFolderChange(event.target.value)}>
              {libraryName
                ? folders.map((option) => <option key={option} value={option}>{`${libraryName} / ${option}`}</option>)
                : <option value={folder}>Abrí una biblioteca</option>}
            </select>
          </label>
        </div>

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
