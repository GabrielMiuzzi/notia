import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { FileText, Plus, Unlink } from 'lucide-react'
import { NotiaButton } from '../../../../common/NotiaButton'
import { suggestLinkTargets } from '../../../../../services/libraries/libraryLinkRuntime'
import type { MarkdownWikiLinkTarget } from '../../../../../types/views/markdownWikiLink'
import { toWikiLinkValue } from './propertyKinds'

const MAX_SUGGESTIONS = 8

interface NoteLinkInputProps {
  /** Current reference, without the brackets. */
  initialReference: string
  libraryId?: string
  onSelect: (value: string) => void
  onClear?: () => void
  onCancel: () => void
  /** Creates a note next to this one; resolves to an error message or `null`. */
  onCreateNote?: (title: string) => Promise<string | null>
}

function folderOf(target: MarkdownWikiLinkTarget): string {
  const separator = target.relativePath.lastIndexOf('/')
  return separator > 0 ? target.relativePath.slice(0, separator).split('/').join(' / ') : ''
}

/** Keeps the input focused while the options are pressed. */
const keepInputFocus = (event: MouseEvent) => event.preventDefault()

export function NoteLinkInput({ initialReference, libraryId, onSelect, onClear, onCancel, onCreateNote }: NoteLinkInputProps) {
  const [query, setQuery] = useState(initialReference)
  const [suggestions, setSuggestions] = useState<MarkdownWikiLinkTarget[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const trimmedQuery = query.trim()
  const canCreate = Boolean(onCreateNote) && trimmedQuery !== '' && !suggestions.some((target) => target.title.toLowerCase() === trimmedQuery.toLowerCase())

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    // The backend ranks the notes; only the latest answer is shown.
    const request = ++requestRef.current
    if (!libraryId || !trimmedQuery) return
    void suggestLinkTargets(libraryId, trimmedQuery, MAX_SUGGESTIONS)
      .catch(() => [])
      .then((targets) => {
        if (request !== requestRef.current) return
        setSuggestions(targets)
        setActiveIndex(0)
      })
  }, [libraryId, trimmedQuery])

  const visibleSuggestions = trimmedQuery ? suggestions : []

  const createNote = async () => {
    if (!onCreateNote || !trimmedQuery || isCreating) return
    setIsCreating(true)
    setError(null)
    const failure = await onCreateNote(trimmedQuery)
    setIsCreating(false)
    if (failure) {
      setError(failure)
      return
    }
    onSelect(`[[${trimmedQuery}]]`)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (visibleSuggestions.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((index) => (index + step + visibleSuggestions.length) % visibleSuggestions.length)
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    const target = visibleSuggestions[activeIndex]
    if (target) {
      onSelect(`[[${target.wikiLink}]]`)
      return
    }
    const typed = toWikiLinkValue(query)
    if (typed) onSelect(typed)
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onCancel()
  }

  const showMenu = visibleSuggestions.length > 0 || canCreate || Boolean(onClear) || error !== null

  return (
    <div className="notia-note-link-input" onBlur={handleBlur}>
      <input
        ref={inputRef}
        className="notia-properties-input notia-properties-input--active"
        value={query}
        placeholder="Buscar nota…"
        role="combobox"
        aria-expanded={showMenu}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visibleSuggestions[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
          setError(null)
        }}
        onKeyDown={handleKeyDown}
      />
      {showMenu ? (
        <div className="notia-note-link-menu" id={listId} role="listbox" aria-label="Notas">
          {visibleSuggestions.length > 0 ? <p className="notia-note-link-menu-title">Notas</p> : null}
          {visibleSuggestions.map((target, index) => (
            <NotiaButton
              key={target.path}
              id={`${listId}-${index}`}
              variant="ghost"
              role="option"
              aria-selected={index === activeIndex}
              className="notia-note-link-option"
              onMouseDown={keepInputFocus}
              onClick={() => onSelect(`[[${target.wikiLink}]]`)}
            >
              <span className="notia-note-link-option-title">
                <FileText size={14} aria-hidden="true" />
                <span>{target.title}</span>
              </span>
              <span className="notia-note-link-option-folder">{folderOf(target)}</span>
            </NotiaButton>
          ))}
          {visibleSuggestions.length > 0 && (canCreate || onClear) ? <span className="notia-note-link-menu-divider" aria-hidden="true" /> : null}
          {canCreate ? (
            <NotiaButton
              variant="ghost"
              className="notia-note-link-action"
              disabled={isCreating}
              onMouseDown={keepInputFocus}
              onClick={() => void createNote()}
            >
              <Plus size={14} aria-hidden="true" />
              {isCreating ? 'Creando nota…' : `Crear nota «${trimmedQuery}»`}
            </NotiaButton>
          ) : null}
          {onClear ? (
            <NotiaButton variant="ghost" className="notia-note-link-action" onMouseDown={keepInputFocus} onClick={onClear}>
              <Unlink size={14} aria-hidden="true" />
              Quitar enlace
            </NotiaButton>
          ) : null}
          {error ? <p className="notia-note-link-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
