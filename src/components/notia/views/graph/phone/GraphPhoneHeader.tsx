import { useEffect, useRef } from 'react'
import { BackIcon, CloseIcon, SearchIcon, ViewSettingsIcon } from './graphPhoneIcons'

interface GraphPhoneHeaderProps {
  visibleNotes: number
  visibleLinks: number
  /** The view differs from its defaults: a dot marks the view button. */
  isViewCustomized: boolean
  onOpenSearch: () => void
  onOpenView: () => void
}

/** Title with what is shown, and the buttons of the search and of the view sheet. */
export function GraphPhoneHeader({ visibleNotes, visibleLinks, isViewCustomized, onOpenSearch, onOpenView }: GraphPhoneHeaderProps) {
  return (
    <header className="notia-gv-phone-header">
      <div className="notia-gv-phone-heading">
        <h2>Grafo</h2>
        <span className="notia-gv-phone-stats">
          {visibleNotes} {visibleNotes === 1 ? 'nota' : 'notas'} · {visibleLinks} {visibleLinks === 1 ? 'enlace' : 'enlaces'}
        </span>
      </div>
      <button type="button" className="notia-gv-phone-icon" aria-label="Buscar notas" onClick={onOpenSearch}>
        <SearchIcon />
      </button>
      <button
        type="button"
        className="notia-gv-phone-icon"
        aria-label={isViewCustomized ? 'Vista y filtros (con cambios)' : 'Vista y filtros'}
        onClick={onOpenView}
      >
        <ViewSettingsIcon />
        {isViewCustomized ? <span className="notia-gv-phone-badge" aria-hidden="true" /> : null}
      </button>
    </header>
  )
}

interface GraphPhoneSearchHeaderProps {
  query: string
  onQueryChange: (query: string) => void
  onClose: () => void
}

/** The header while searching: back, and the search field with the keyboard up. */
export function GraphPhoneSearchHeader({ query, onQueryChange, onClose }: GraphPhoneSearchHeaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  return (
    <header className="notia-gv-phone-header notia-gv-phone-header--search">
      <button type="button" className="notia-gv-phone-icon" aria-label="Cerrar búsqueda" onClick={onClose}>
        <BackIcon />
      </button>
      <label className="notia-gv-phone-search-field">
        <span className="notia-gv-sr-only">Buscar en el grafo</span>
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          value={query}
          placeholder="Título o contenido"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
          }}
        />
        {query.trim() ? (
          <button
            type="button"
            className="notia-gv-phone-clear"
            aria-label="Limpiar búsqueda"
            onClick={() => {
              onQueryChange('')
              inputRef.current?.focus()
            }}
          >
            <CloseIcon size={14} strokeWidth={2.4} />
          </button>
        ) : null}
      </label>
    </header>
  )
}
