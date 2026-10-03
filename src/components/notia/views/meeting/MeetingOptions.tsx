import type { ChangeEvent, ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

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

export interface MeetingOptionsProps {
  language: string
  onLanguageChange: (language: string) => void
  expectedSpeakers: number | null
  onExpectedSpeakersChange: (count: number | null) => void
  folder: string
  folderOptions: string[]
  libraryName: string | null
  onFolderChange: (folder: string) => void
}

/** The three choices with their options, the same for both layouts. */
function optionChoices({ language, folder, folderOptions }: MeetingOptionsProps) {
  const languages = LANGUAGES.some(([code]) => code === language) ? LANGUAGES : [...LANGUAGES, [language, language] as [string, string]]
  const folders = Array.from(new Set([DEFAULT_MEETING_FOLDER, folder, ...folderOptions]))
  return { languages, folders }
}

const speakersValue = (count: number | null) => count ?? 'auto'
const readSpeakers = (event: ChangeEvent<HTMLSelectElement>) => (
  event.target.value === 'auto' ? null : Number(event.target.value)
)

/** Language, speakers and folder of the note: the same for a recording and a file. */
export function MeetingOptions(props: MeetingOptionsProps) {
  const { language, onLanguageChange, expectedSpeakers, onExpectedSpeakersChange, folder, libraryName, onFolderChange } = props
  const { languages, folders } = optionChoices(props)
  return (
    <div className="notia-meeting-options">
      <label>
        <span>Idioma</span>
        <select value={language} onChange={(event) => onLanguageChange(event.target.value)}>
          {languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      <label>
        <span>Hablantes</span>
        <select value={speakersValue(expectedSpeakers)} onChange={(event) => onExpectedSpeakersChange(readSpeakers(event))}>
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
  )
}

interface OptionRowProps {
  label: string
  value: string
  disabled?: boolean
  /** The native select, laid invisibly over the row: a tap opens the system picker. */
  children: ReactNode
}

function OptionRow({ label, value, disabled = false, children }: OptionRowProps) {
  return (
    <label className="notia-meeting-option-row" data-disabled={disabled ? 'true' : undefined}>
      <span className="notia-meeting-option-label">{label}</span>
      <span className="notia-meeting-option-value">{value}</span>
      <ChevronRight size={14} aria-hidden="true" />
      {children}
    </label>
  )
}

interface OptionButtonRowProps {
  label: string
  value: string
  onClick: () => void
  disabled?: boolean
}

/** A row that opens a sheet of its own instead of the system picker. */
export function OptionButtonRow({ label, value, onClick, disabled = false }: OptionButtonRowProps) {
  return (
    <button type="button" className="notia-meeting-option-row" disabled={disabled} onClick={onClick}>
      <span className="notia-meeting-option-label">{label}</span>
      <span className="notia-meeting-option-value">{value}</span>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  )
}

/** The same choices as rows of a list, for the phone layout; `leadingRow` goes first. */
export function MeetingOptionRows({ leadingRow, ...props }: MeetingOptionsProps & { leadingRow?: ReactNode }) {
  const { language, onLanguageChange, expectedSpeakers, onExpectedSpeakersChange, folder, libraryName, onFolderChange } = props
  const { languages, folders } = optionChoices(props)
  const languageName = languages.find(([code]) => code === language)?.[1] ?? language
  return (
    <div className="notia-meeting-option-rows">
      {leadingRow}
      <OptionRow label="Idioma" value={languageName}>
        <select aria-label="Idioma" value={language} onChange={(event) => onLanguageChange(event.target.value)}>
          {languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </OptionRow>
      <OptionRow label="Hablantes" value={expectedSpeakers ? `${expectedSpeakers} hablantes` : 'Automático'}>
        <select aria-label="Hablantes" value={speakersValue(expectedSpeakers)} onChange={(event) => onExpectedSpeakersChange(readSpeakers(event))}>
          <option value="auto">Detectar automáticamente</option>
          {SPEAKER_COUNTS.map((count) => <option key={count} value={count}>{count} hablantes</option>)}
        </select>
      </OptionRow>
      <OptionRow label="Guardar en" value={libraryName ? `${libraryName} / ${folder}` : 'Abrí una biblioteca'} disabled={!libraryName}>
        <select aria-label="Guardar en" value={folder} disabled={!libraryName} onChange={(event) => onFolderChange(event.target.value)}>
          {libraryName
            ? folders.map((option) => <option key={option} value={option}>{`${libraryName} / ${option}`}</option>)
            : <option value={folder}>Abrí una biblioteca</option>}
        </select>
      </OptionRow>
    </div>
  )
}
