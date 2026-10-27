import { useState } from 'react'
import type { PublicNavEntry, PublicNavGroup } from '../services/publicSpaceClient'

function containsUrl(entry: PublicNavEntry, url: string): boolean {
  return entry.url === url || entry.children.some((child) => containsUrl(child, url))
}

interface EntryProps {
  entry: PublicNavEntry
  currentUrl: string
  depth: number
  onNavigate: (url: string) => void
}

function NavItem({ entry, currentUrl, depth, onNavigate }: EntryProps) {
  const hasChildren = entry.children.length > 0
  const inside = hasChildren && containsUrl(entry, currentUrl)
  const [open, setOpen] = useState(inside)
  const [wasInside, setWasInside] = useState(inside)
  // Opening a page opens the sections that hold it.
  if (inside !== wasInside) {
    setWasInside(inside)
    if (inside) setOpen(true)
  }
  const active = entry.url === currentUrl
  const label = entry.url ? (
    <a
      href={entry.url}
      className="ps-nav-link"
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        onNavigate(entry.url as string)
        if (hasChildren) setOpen(true)
      }}
    >
      {entry.title}
    </a>
  ) : (
    <button type="button" className="ps-nav-link ps-nav-folder" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {entry.title}
    </button>
  )
  return (
    <li className="ps-nav-item" data-depth={depth}>
      <div className="ps-nav-row" data-active={active || undefined}>
        {label}
        {hasChildren ? (
          <button
            type="button"
            className="ps-nav-toggle"
            aria-expanded={open}
            aria-label={open ? `Contraer ${entry.title}` : `Expandir ${entry.title}`}
            onClick={() => setOpen((value) => !value)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
          </button>
        ) : null}
      </div>
      {hasChildren && open ? (
        <ul className="ps-nav-children">
          {entry.children.map((child, index) => (
            <NavItem key={`${child.url ?? child.title}-${index}`} entry={child} currentUrl={currentUrl} depth={depth + 1} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

interface SpaceSidebarProps {
  groups: PublicNavGroup[]
  currentUrl: string
  onNavigate: (url: string) => void
}

/** The index of the space, as GitBook's left column. */
export function SpaceSidebar({ groups, currentUrl, onNavigate }: SpaceSidebarProps) {
  return (
    <nav className="ps-nav" aria-label="Índice">
      {groups.map((group, index) => (
        <section key={`${group.title ?? 'inicio'}-${index}`} className="ps-nav-group">
          {group.title ? <h2 className="ps-nav-group-title">{group.title}</h2> : null}
          <ul className="ps-nav-list">
            {group.entries.map((entry, entryIndex) => (
              <NavItem key={`${entry.url ?? entry.title}-${entryIndex}`} entry={entry} currentUrl={currentUrl} depth={0} onNavigate={onNavigate} />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}
