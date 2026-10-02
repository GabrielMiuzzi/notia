import { Search, X } from 'lucide-react'
import type { GraphSearchResult } from '../../../../hooks/useLibraryGraphData'

const MAX_SHOWN_RESULTS = 8

interface GraphSearchPanelProps {
  query: string
  onQueryChange: (query: string) => void
  /** Results of the backend search; `null` while it answers. */
  results: GraphSearchResult[] | null
  colorOf: (path: string) => string
  selectedPath: string | null
  onPick: (path: string) => void
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** The label with the part that matches the search marked, when the match is in the title. */
export function HighlightedLabel({ label, query }: { label: string; query: string }) {
  const text = label.normalize('NFC')
  const index = fold(text).indexOf(fold(query.trim()))
  if (index < 0 || !query.trim()) return <>{text}</>
  const end = index + query.trim().normalize('NFC').length
  return (
    <>
      {text.slice(0, index)}
      <mark className="notia-gv-match">{text.slice(index, end)}</mark>
      {text.slice(end)}
    </>
  )
}

/** Search of titles and contents, and the notes it found. */
export function GraphSearchPanel({ query, onQueryChange, results, colorOf, selectedPath, onPick }: GraphSearchPanelProps) {
  const hasQuery = query.trim().length > 0
  const count = results?.length ?? 0
  return (
    <div className="notia-gv-search">
      <label className="notia-gv-search-field">
        <Search size={16} aria-hidden="true" />
        <span className="notia-gv-sr-only">Buscar en el grafo</span>
        <input
          type="text"
          value={query}
          placeholder="Buscar por título o contenido"
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {hasQuery ? (
          <>
            <span className="notia-gv-mono notia-gv-search-count" aria-live="polite">
              {results === null ? '…' : `${count} ${count === 1 ? 'nota' : 'notas'}`}
            </span>
            <button type="button" className="notia-gv-icon-button" aria-label="Limpiar búsqueda" onClick={() => onQueryChange('')}>
              <X size={13} aria-hidden="true" />
            </button>
          </>
        ) : null}
      </label>
      {hasQuery && results !== null ? (
        <div className="notia-gv-card notia-gv-search-results" role="list" aria-label="Notas que coinciden">
          {results.slice(0, MAX_SHOWN_RESULTS).map((result) => (
            <button
              key={result.path}
              type="button"
              role="listitem"
              className={`notia-gv-row${result.path === selectedPath ? ' is-selected' : ''}`}
              title={result.preview || result.label}
              onClick={() => onPick(result.path)}
            >
              <span className="notia-gv-dot" style={{ background: colorOf(result.path) }} aria-hidden="true" />
              <span className="notia-gv-row-label"><HighlightedLabel label={result.label} query={query} /></span>
              {result.folder ? <span className="notia-gv-mono notia-gv-muted">{result.folder}</span> : null}
            </button>
          ))}
          {results.length === 0 ? <p className="notia-gv-empty">Ninguna nota coincide con la búsqueda.</p> : null}
        </div>
      ) : null}
    </div>
  )
}
