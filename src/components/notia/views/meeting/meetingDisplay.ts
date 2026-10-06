import { FileAudio, Film, Music } from 'lucide-react'
import type { SpeechFinalizingStage } from '../../../../services/speech/speechTypes'
import type { MeetingLine, MeetingSourceFile } from '../../../../services/meeting/meetingTypes'
import type { MeetingFileState } from './MeetingUploadPanel'

/** `mm:ss`, or `h:mm:ss` past the first hour, for the minute labels. */
export function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor(totalSeconds / 60) % 60
  const seconds = totalSeconds % 60
  const pad = (value: number) => value.toString().padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** Size of a file as a person reads it: `850 KB`, `142 MB`, `1.4 GB`. */
export function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024)
  if (megabytes < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (megabytes < 1024) return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`
  return `${(megabytes / 1024).toFixed(1)} GB`
}

/** CSS class of the palette color a speaker is drawn with. */
export const speakerColorClass = (colorIndex: number) => `notia-meeting-speaker-color--${colorIndex % 6}`

/** Detail line of the file; the phone layout leaves out its kind, the icon shows it. */
export function fileDetail(file: Exclude<MeetingFileState, { status: 'empty' }>, withKind = true): string {
  if (file.status === 'uploading') return `Cargando… ${Math.round(file.progress * 100)}% · ${formatBytes(file.byteLength)}`
  if (file.status === 'reading') return `Leyendo el audio… · ${formatBytes(file.byteLength)}`
  const { media } = file
  const parts = [formatClock(media.durationMs), formatBytes(media.byteLength)]
  if (withKind) parts.unshift(media.kind === 'video' ? 'Video' : 'Audio')
  if (media.kind === 'video') parts.push('se usa solo el audio')
  return parts.join(' · ')
}

/** Name and icon of the file of the upload tab, `null` without one. */
export function fileIdentity(file: MeetingFileState) {
  if (file.status === 'empty') return null
  if (file.status !== 'ready') return { name: file.name, Icon: FileAudio }
  return { name: file.media.name, Icon: file.media.kind === 'video' ? Film : Music }
}

const SIGNAL_LEVEL = 0.1

/** What a source of the ready stage is doing, next to its meter. */
export function sourceStatus(available: boolean, enabled: boolean, isChecking: boolean, levels: number[]): string {
  if (!available) return 'No disponible'
  if (!enabled) return 'Apagado'
  if (!isChecking) return 'Listo'
  return (levels[levels.length - 1] ?? 0) >= SIGNAL_LEVEL ? 'Captando' : 'Sin señal'
}

/** The confirmed line being said at `atMs`, where a marked moment points. */
export function lineAtMoment(lines: MeetingLine[], atMs: number): MeetingLine | undefined {
  return [...lines].reverse().find((candidate) => candidate.startMs <= atMs) ?? lines[0]
}

const PROCESSING_STAGES: SpeechFinalizingStage[] = ['transcribing', 'detecting-speakers', 'assigning-turns']
const SECOND_PASS_STAGES: SpeechFinalizingStage[] = ['transcribing', 'detecting-speakers', 'second-pass']
const LATER_STEP_LABELS: Record<Exclude<SpeechFinalizingStage, 'transcribing'>, string> = {
  'detecting-speakers': 'Detectando voces',
  'assigning-turns': 'Asignando intervenciones',
  'second-pass': 'Segunda pasada por palabra',
}

export type MeetingProcessingStepState = 'done' | 'current' | 'pending'

interface ProcessingInput {
  progress: number | undefined
  stage: SpeechFinalizingStage | undefined
  /** The file being transcribed; `undefined` for a recording. */
  sourceFile?: MeetingSourceFile
  isSkipping: boolean
}

/** Title, steps and progress of the processing stage, the same for both layouts. */
export function describeMeetingProcessing({ progress, stage, sourceFile, isSkipping }: ProcessingInput) {
  const currentStage = stage ?? 'transcribing'
  const stages = currentStage === 'second-pass' ? SECOND_PASS_STAGES : PROCESSING_STAGES
  const current = stages.indexOf(currentStage)
  // A file is transcribed here; a recording was already transcribed live.
  const transcribingFile = Boolean(sourceFile) && currentStage === 'transcribing'
  const steps = stages.map((step, index) => ({
    stage: step,
    state: (index < current ? 'done' : index === current ? 'current' : 'pending') as MeetingProcessingStepState,
    label: step !== 'transcribing' ? LATER_STEP_LABELS[step]
      : !sourceFile ? 'Transcripción completa'
        : transcribingFile ? 'Transcribiendo el archivo' : 'Archivo transcripto',
  }))
  const title = transcribingFile ? 'Transcribiendo el archivo…'
    : isSkipping ? 'Terminando sin separar hablantes…' : 'Separando hablantes…'
  const percent = Math.round((progress ?? 0) * 100)
  return { transcribingFile, steps, title, percent }
}

/** «Pasar por IA» waits for the AI review: both never edit the transcript at once. */
export const generateLabel = (isGenerating: boolean, reviewing: boolean) =>
  isGenerating ? 'Generando…' : reviewing ? 'Esperando el repaso…' : 'Generar'
