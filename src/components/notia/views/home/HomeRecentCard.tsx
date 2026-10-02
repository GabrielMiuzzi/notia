import { Clock, FileText, Folder, MessageSquare, Mic } from 'lucide-react'
import type { HomeFolder, HomeRecent, HomeRecentItem, HomeRecentKind } from '../../../../services/home/homeTypes'
import { HomeCardShell, HomeMoreButton } from './HomeCardShell'

const KIND_ICONS: Record<HomeRecentKind, typeof FileText> = {
  chat: MessageSquare,
  note: FileText,
  meeting: Mic,
}

interface HomeRecentCardProps {
  recent: HomeRecent
  onOpenHistory: () => void
  onOpenItem: (item: HomeRecentItem) => void
  onOpenFolder: (folder: HomeFolder) => void
  /** Phone board: no «Ver historial» and no divider over the folders. */
  phone?: boolean
}

/** The chats, notes and meeting to go back to, and the library's folders. */
export function HomeRecentCard({ recent, onOpenHistory, onOpenItem, onOpenFolder, phone = false }: HomeRecentCardProps) {
  return (
    <HomeCardShell
      id="home-recent-title"
      title="Seguir donde quedaste"
      icon={<Clock size={15} strokeWidth={1.75} />}
      className="home-card--recent"
      action={phone ? undefined : <HomeMoreButton label="Ver historial" onClick={onOpenHistory} />}
    >
      <div className="home-scroll home-rows home-rows--recent">
        {recent.items.length === 0 ? <p className="home-empty">Todavía no hay chats, notas ni reuniones para retomar.</p> : null}
        {recent.items.map((item, index) => {
          const Icon = KIND_ICONS[item.kind]
          return (
            <button key={`${item.kind}-${item.path ?? index}`} type="button" className="home-row" onClick={() => onOpenItem(item)}>
              <span className="home-lead" aria-hidden="true"><Icon size={14} strokeWidth={1.75} /></span>
              <span className="home-row__text">
                <span className="home-row__title">{item.title}</span>
                <span className="home-row__meta">{item.meta}</span>
              </span>
              {item.when ? <span className="home-card__sub home-row__when">{item.when}</span> : null}
            </button>
          )
        })}
      </div>
      {recent.folders.length > 0 ? (
        <>
          {phone ? null : <div className="home-divider" />}
          <div className="home-folders">
            {recent.folders.map((folder) => (
              <button key={folder.path} type="button" className="home-folder" onClick={() => onOpenFolder(folder)}>
                <Folder size={13} strokeWidth={1.75} aria-hidden="true" />
                {folder.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </HomeCardShell>
  )
}
