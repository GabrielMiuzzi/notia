import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { TaskBoardViewMode } from '../../services/taskManagerStorage'
import type { TaskFilters } from '../../utils/taskFilters'
import { ShellIcon, type ShellIconName } from './shellIcons'
import { useDismiss } from './useDismiss'

export interface FilterField {
  key: 'state' | 'priority' | 'project' | 'person' | 'group'
  label: string
  /** «Todos» or «Todas». */
  allLabel: string
  options: string[]
}

interface TaskFilterRowProps {
  filters: TaskFilters
  onChange: (filters: TaskFilters) => void
  fields: FilterField[]
  searchLabel: string
  /** Results while searching; null without a search. */
  resultCount: number | null
  searchRef: RefObject<HTMLInputElement | null>
  /** The board offers Tablero, Lista and Management. */
  viewMode?: TaskBoardViewMode
  onViewModeChange?: (mode: TaskBoardViewMode) => void
}

function FilterButton({ field, value, onSelect }: { field: FilterField; value: string; onSelect: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(menuRef, open, close, triggerRef)
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }, [open])
  const choose = (next: string) => {
    onSelect(next)
    setOpen(false)
    triggerRef.current?.focus()
  }
  return (
    <div className="tm-filter-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={`tm-control tm-filter-button${value ? ' is-set' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="tm-filter-label">{field.label}</span>
        <span className="tm-filter-value">{value || field.allLabel}</span>
        <ShellIcon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div ref={menuRef} className="tm-menu tm-filter-menu" role="menu" aria-label={field.label}>
          {['', ...field.options].map((option) => (
            <button
              key={option || '__all__'}
              type="button"
              role="menuitemradio"
              aria-checked={option === value}
              className={`tm-menu-item${option === value ? ' is-current' : ''}`}
              onClick={() => choose(option)}
            >
              <span className="tm-menu-text">{option || field.allLabel}</span>
              {option === value ? <span className="tm-teal"><ShellIcon name="check" size={14} strokeWidth={2.6} /></span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const VIEW_MODES: Array<{ mode: TaskBoardViewMode; label: string; icon: ShellIconName }> = [
  { mode: 'board', label: 'Tablero', icon: 'viewBoard' },
  { mode: 'list', label: 'Lista', icon: 'viewList' },
  { mode: 'management', label: 'Management', icon: 'viewManagement' },
]

/** Search, filters and the view of the board. */
export function TaskFilterRow({
  filters,
  onChange,
  fields,
  searchLabel,
  resultCount,
  searchRef,
  viewMode,
  onViewModeChange,
}: TaskFilterRowProps) {
  return (
    <div className="tm-filter-row">
      <label className="tm-search">
        <ShellIcon name="search" size={16} />
        <input
          ref={searchRef}
          type="search"
          value={filters.query}
          placeholder={searchLabel}
          aria-label={searchLabel}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && filters.query) {
              event.stopPropagation()
              onChange({ ...filters, query: '' })
            }
          }}
        />
        {resultCount !== null ? (
          <>
            <span className="tm-search-count" role="status">
              {resultCount === 1 ? '1 resultado' : `${resultCount} resultados`}
            </span>
            <button
              type="button"
              className="tm-search-clear"
              aria-label="Limpiar búsqueda"
              onClick={() => {
                onChange({ ...filters, query: '' })
                searchRef.current?.focus()
              }}
            >
              <ShellIcon name="close" size={12} />
            </button>
          </>
        ) : <kbd className="tm-search-key">/</kbd>}
      </label>
      {fields.map((field) => (
        <FilterButton
          key={field.key}
          field={field}
          value={filters[field.key]}
          onSelect={(value) => onChange({ ...filters, [field.key]: value })}
        />
      ))}
      {viewMode && onViewModeChange ? (
        <div className="tm-segmented" role="group" aria-label="Modo de vista">
          {VIEW_MODES.map((option) => (
            <button
              key={option.mode}
              type="button"
              aria-pressed={viewMode === option.mode}
              className={viewMode === option.mode ? 'is-on' : ''}
              onClick={() => onViewModeChange(option.mode)}
            >
              <ShellIcon name={option.icon} size={14} />
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
