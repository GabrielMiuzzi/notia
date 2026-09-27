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

/** Language, speakers and folder of the note: the same for a recording and a file. */
export function MeetingOptions({
  language,
  onLanguageChange,
  expectedSpeakers,
  onExpectedSpeakersChange,
  folder,
  folderOptions,
  libraryName,
  onFolderChange,
}: MeetingOptionsProps) {
  const languages = LANGUAGES.some(([code]) => code === language) ? LANGUAGES : [...LANGUAGES, [language, language] as [string, string]]
  const folders = Array.from(new Set([DEFAULT_MEETING_FOLDER, folder, ...folderOptions]))
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
  )
}
