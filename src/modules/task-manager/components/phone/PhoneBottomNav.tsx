import { PhoneIcon, type PhoneIconName } from './phoneIcons'

export type PhoneSection = 'tasks' | 'pomodoro' | 'archive' | 'settings'

interface PhoneBottomNavProps {
  section: PhoneSection
  /** Finished tasks, on the «Archivo» badge. */
  archiveCount: number
  /** The Pomodoro is running: a dot on its icon. */
  pomodoroRunning: boolean
  /** «Ajustes» edits the board: not offered without that right (published board). */
  canEditBoard: boolean
  onSelect: (section: PhoneSection) => void
}

const ITEMS: Array<{ section: PhoneSection; label: string; icon: PhoneIconName }> = [
  { section: 'tasks', label: 'Tareas', icon: 'tasks' },
  { section: 'pomodoro', label: 'Pomodoro', icon: 'timer' },
  { section: 'archive', label: 'Archivo', icon: 'archive' },
  { section: 'settings', label: 'Ajustes', icon: 'sliders' },
]

/** «Tareas · Pomodoro · Archivo · Ajustes», the sections of the phone boards. */
export function PhoneBottomNav({ section, archiveCount, pomodoroRunning, canEditBoard, onSelect }: PhoneBottomNavProps) {
  return (
    <nav className="tmp-nav" aria-label="Secciones">
      {ITEMS.filter((item) => item.section !== 'settings' || canEditBoard).map((item) => {
        const current = item.section === section
        return (
          <button
            key={item.section}
            type="button"
            className={`tmp-nav-item${current ? ' is-current' : ''}`}
            aria-current={current ? 'page' : undefined}
            onClick={() => onSelect(item.section)}
          >
            <span className="tmp-nav-icon">
              <PhoneIcon name={item.icon} size={20} />
              {item.section === 'archive' ? <span className="tmp-nav-badge">{archiveCount}</span> : null}
              {item.section === 'pomodoro' && pomodoroRunning ? <span className="tmp-nav-dot" aria-label="En curso" /> : null}
            </span>
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}
