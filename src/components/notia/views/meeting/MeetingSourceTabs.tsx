import type { KeyboardEvent } from 'react'
import { ArrowUpFromLine, Mic, Upload } from 'lucide-react'

export type MeetingSourceTab = 'live' | 'file'

export const MEETING_SOURCE_PANEL_ID = 'meeting-source-panel'

const TABS: Array<{ id: MeetingSourceTab; label: string; phoneLabel: string; icon: typeof Mic; phoneIcon: typeof Mic }> = [
  { id: 'live', label: 'Grabar en vivo', phoneLabel: 'Grabar', icon: Mic, phoneIcon: Mic },
  { id: 'file', label: 'Subir audio o video', phoneLabel: 'Subir archivo', icon: Upload, phoneIcon: ArrowUpFromLine },
]

interface MeetingSourceTabsProps {
  selected: MeetingSourceTab
  onSelect: (tab: MeetingSourceTab) => void
  /** Phone layout: two halves with short labels and no drag hint. */
  phone?: boolean
}

/** Where the meeting's audio comes from: a live recording or a file. */
export function MeetingSourceTabs({ selected, onSelect, phone = false }: MeetingSourceTabsProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = selected === 'live' ? 'file' : 'live'
    onSelect(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
  }
  const tabs = (
    <div
      className={`notia-meeting-tabs${phone ? ' notia-meeting-tabs--phone' : ''}`}
      role="tablist"
      aria-label="Origen del audio"
      onKeyDown={handleKeyDown}
    >
      {TABS.map((tab) => {
        const Icon = phone ? tab.phoneIcon : tab.icon
        const active = tab.id === selected
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab={tab.id}
            aria-selected={active}
            aria-controls={MEETING_SOURCE_PANEL_ID}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
          >
            <Icon size={phone ? 15 : 14} aria-hidden="true" />{phone ? tab.phoneLabel : tab.label}
          </button>
        )
      })}
    </div>
  )
  if (phone) return tabs
  return (
    <div className="notia-meeting-source-row">
      {tabs}
      <span className="notia-meeting-drop-hint">También podés arrastrar un archivo a esta pantalla.</span>
    </div>
  )
}
