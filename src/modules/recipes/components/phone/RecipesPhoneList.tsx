import { useEffect, useRef, useState } from 'react'
import { Clock, Flame, LayoutGrid, Plus, Search, StretchHorizontal } from 'lucide-react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { RecipesLoadStatus } from '../../hooks/useRecipes'
import type { MealTime, RecipeCard, RecipeGrid, RecipeSort } from '../../types/recipesTypes'
import { RecipeVisual } from '../RecipeVisual'
import { RECIPE_SORTS } from '../recipeSorts'

type Layout = 'list' | 'grid'

interface RecipesPhoneListProps {
  library: NotiaLibrary
  grid: RecipeGrid | null
  status: RecipesLoadStatus
  loadError: string | null
  search: string
  sort: RecipeSort
  onSearch: (value: string) => void
  onMeal: (meal: MealTime | null) => void
  onSort: (sort: RecipeSort) => void
  onOpen: (id: string) => void
  onCreate: () => void
  onClear: () => void
  onRetry: () => void
  /** A page covers the list: it leaves the focus order. */
  covered: boolean
}

function CardMeta({ card }: { card: RecipeCard }) {
  return (
    <span className="rcpm-meta">
      <span><Flame size={14} strokeWidth={1.8} aria-hidden="true" />{card.kcalLabel}</span>
      {card.minutesLabel && <span><Clock size={14} strokeWidth={1.8} aria-hidden="true" />{card.minutesLabel}</span>}
    </span>
  )
}

function MacroBar({ card }: { card: RecipeCard }) {
  return (
    <span className="rcpm-mbar" aria-hidden="true">
      {card.macros.map((share) => <i key={share.key} data-macro={share.key} style={{ width: `${share.percent}%` }} />)}
    </span>
  )
}

/**
 * Lista de Recetas de la versión celular (canvas «Munin · Recetas (mobile)»):
 * barra con búsqueda y vista, chips de momento, cantidad y orden, filas o
 * mosaicos con la franja del momento y el botón flotante «Nueva comida».
 * Rust filtra, busca, ordena y cuenta.
 */
export function RecipesPhoneList(props: RecipesPhoneListProps) {
  const { library, grid, status, loadError, search, sort, onSearch, onMeal, onSort, onOpen, onCreate, onClear, onRetry, covered } = props
  const [layout, setLayout] = useState<Layout>('list')
  const [searchOpen, setSearchOpen] = useState(() => search.trim() !== '')
  const [scrolled, setScrolled] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const focusSearch = useRef(false)

  useEffect(() => {
    if (!searchOpen || !focusSearch.current) return
    focusSearch.current = false
    searchRef.current?.focus()
  }, [searchOpen])

  const toggleSearch = () => {
    if (searchOpen) {
      setSearchOpen(false)
      if (search) onSearch('')
      return
    }
    focusSearch.current = true
    setSearchOpen(true)
  }

  const gridLayout = layout === 'grid'
  const card = (item: RecipeCard) => (gridLayout ? (
    <button key={item.id} type="button" className="rcpm-tile" data-meal={item.meal} data-recipe-id={item.id} onClick={() => onOpen(item.id)}>
      <span className="rcpm-thumb"><RecipeVisual library={library} id={item.id} name={item.name} photoKey={item.photoKey} hasPhoto={item.hasPhoto} /></span>
      <span className="rcpm-text">
        <span className="rcpm-name">{item.name}</span>
        <CardMeta card={item} />
        <MacroBar card={item} />
      </span>
    </button>
  ) : (
    <button key={item.id} type="button" className="rcpm-row" data-meal={item.meal} data-recipe-id={item.id} onClick={() => onOpen(item.id)}>
      <span className="rcpm-thumb"><RecipeVisual library={library} id={item.id} name={item.name} photoKey={item.photoKey} hasPhoto={item.hasPhoto} /></span>
      <span className="rcpm-text">
        <span className="rcp-chip"><span className="rcp-dot" aria-hidden="true" />{item.mealLabel}</span>
        <span className="rcpm-name">{item.name}</span>
        <CardMeta card={item} />
        <MacroBar card={item} />
      </span>
    </button>
  ))

  return (
    <>
      <header className="rcpm-appbar" data-scrolled={scrolled} inert={covered}>
        <div className="rcpm-ab-row">
          <h1>Recetas</h1>
          <button type="button" className="rcpm-icon-btn" aria-pressed={searchOpen} aria-label="Buscar" onClick={toggleSearch}>
            <Search size={22} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" className="rcpm-icon-btn" aria-label={gridLayout ? 'Ver como lista' : 'Ver como cuadrícula'} onClick={() => setLayout(gridLayout ? 'list' : 'grid')}>
            {gridLayout ? <StretchHorizontal size={22} strokeWidth={1.8} aria-hidden="true" /> : <LayoutGrid size={22} strokeWidth={1.8} aria-hidden="true" />}
          </button>
        </div>
        {searchOpen && (
          <label className="rcpm-search">
            <span className="rcp-visually-hidden">Buscar recetas</span>
            <Search size={18} strokeWidth={1.8} aria-hidden="true" />
            <input ref={searchRef} type="search" placeholder="Nombre o ingrediente" autoComplete="off" enterKeyHint="search" value={search} onChange={(event) => onSearch(event.target.value)} />
          </label>
        )}
        <div className="rcpm-chips" role="group" aria-label="Filtrar por momento del día">
          {(grid?.filters ?? []).map((filter) => (
            <button key={filter.label} type="button" aria-pressed={filter.selected} data-meal={filter.meal ?? undefined} onClick={() => onMeal(filter.meal)}>
              {filter.meal && <span className="rcp-dot" aria-hidden="true" />}
              {filter.label}
            </button>
          ))}
        </div>
        <div className="rcpm-subrow">
          <span>{grid?.shortCountLabel ?? ''}</span>
          <label>Ordenar <select value={sort} onChange={(event) => onSort(event.target.value as RecipeSort)}>
            {RECIPE_SORTS.map((option) => <option key={option.sort} value={option.sort}>{option.label}</option>)}
          </select></label>
        </div>
      </header>

      <div className="rcpm-scroll" inert={covered} onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 4)}>
        {status === 'loading' && !grid && <p className="rcpm-state" role="status">Cargando recetas…</p>}
        {status === 'error' && !grid && (
          <div className="rcpm-state" role="alert">
            <p>{loadError}</p>
            <button type="button" className="rcpm-abtn rcpm-abtn--ghost rcpm-abtn--inline" onClick={onRetry}>Reintentar</button>
          </div>
        )}
        {grid && (
          <div className={gridLayout ? 'rcpm-list rcpm-list--grid' : 'rcpm-list'} aria-live="polite">
            {grid.empty ? (
              <div className="rcpm-empty">
                <h2>{grid.empty.title}</h2>
                <p>{grid.empty.text}</p>
                {grid.empty.action === 'clear' && <button type="button" className="rcpm-abtn rcpm-abtn--ghost rcpm-abtn--inline" onClick={onClear}>{grid.empty.actionLabel}</button>}
              </div>
            ) : grid.cards.map(card)}
          </div>
        )}
      </div>

      <button type="button" className="rcpm-fab" inert={covered} onClick={onCreate}><Plus size={22} strokeWidth={1.8} aria-hidden="true" />Nueva comida</button>
    </>
  )
}
