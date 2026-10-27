import { useEffect, useState } from 'react'
import type { PublicOutlineEntry } from '../services/publicSpaceClient'

interface PageOutlineProps {
  outline: PublicOutlineEntry[]
  onJump: (id: string) => void
}

/** «En esta página»: the sections of the page, the one in view marked. */
export function PageOutline({ outline, onJump }: PageOutlineProps) {
  const [current, setCurrent] = useState<string | null>(null)

  useEffect(() => {
    const headings = outline.map((entry) => document.getElementById(entry.id)).filter((heading): heading is HTMLElement => heading !== null)
    if (headings.length === 0 || typeof IntersectionObserver === 'undefined') return
    const visible = new Set<string>()
    const observer = new IntersectionObserver((records) => {
      for (const record of records) {
        if (record.isIntersecting) visible.add(record.target.id)
        else visible.delete(record.target.id)
      }
      const first = outline.find((entry) => visible.has(entry.id))
      if (first) setCurrent(first.id)
    }, { rootMargin: '-72px 0px -60% 0px' })
    headings.forEach((heading) => observer.observe(heading))
    return () => observer.disconnect()
  }, [outline])

  if (outline.length === 0) return null
  return (
    <nav className="ps-outline" aria-label="En esta página">
      <p className="ps-outline-title">En esta página</p>
      <ul>
        {outline.map((entry) => (
          <li key={entry.id} data-level={entry.level}>
            <a
              href={`#${entry.id}`}
              aria-current={current === entry.id ? 'location' : undefined}
              onClick={(event) => {
                event.preventDefault()
                setCurrent(entry.id)
                onJump(entry.id)
              }}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
