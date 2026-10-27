import { useEffect, useRef, useState } from 'react'
import { searchSpace, type PublicSearchResult } from '../services/publicSpaceClient'

const SEARCH_DELAY_MS = 180

interface SearchDialogProps {
  onClose: () => void
  onNavigate: (url: string) => void
}

/** Search of the space (Ctrl + K), as GitBook's. */
export function SearchDialog({ onClose, onNavigate }: SearchDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PublicSearchResult[]>([])
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      searchSpace(trimmed, controller.signal)
        .then((found) => {
          setResults(found)
          setSelected(0)
          setSearched(true)
        })
        .catch(() => {})
    }, SEARCH_DELAY_MS)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  const visible = query.trim() ? results : []
  const open = (result: PublicSearchResult) => {
    onNavigate(result.url)
    onClose()
  }

  return (
    <div className="ps-search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="ps-search" role="dialog" aria-modal="true" aria-label="Buscar">
        <div className="ps-search-field">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Buscar en el espacio"
            aria-label="Buscar en el espacio"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelected((index) => Math.min(index + 1, visible.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected((index) => Math.max(index - 1, 0))
              }
              if (event.key === 'Enter' && visible[selected]) open(visible[selected])
            }}
          />
          <button type="button" className="ps-search-close" onClick={onClose}>Esc</button>
        </div>
        <ul className="ps-search-results" role="listbox" aria-label="Resultados">
          {visible.map((result, index) => (
            <li key={result.url} role="option" aria-selected={index === selected}>
              <a
                href={result.url}
                onMouseEnter={() => setSelected(index)}
                onClick={(event) => {
                  event.preventDefault()
                  open(result)
                }}
              >
                {result.trail && result.trail.length > 0 ? <span className="ps-search-trail">{result.trail.join(' / ')}</span> : null}
                <span className="ps-search-title">{result.title}</span>
                <span className="ps-search-snippet">{result.snippet}</span>
              </a>
            </li>
          ))}
        </ul>
        {query.trim() && searched && visible.length === 0 ? <p className="ps-search-empty">No hay páginas con «{query.trim()}».</p> : null}
      </div>
    </div>
  )
}
