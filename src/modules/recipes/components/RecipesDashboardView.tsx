import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { NotiaLibrary } from '../../../types/notia'
import { useRecipeGrid } from '../hooks/useRecipes'
import { asRecipesError, deleteRecipe, getRecipeDetail } from '../services/recipesService'
import type { MealTime, RecipeDetail, RecipeSort } from '../types/recipesTypes'
import { RecipeCardView } from './RecipeCardView'
import { RecipeDetailSheet } from './RecipeDetailSheet'
import { RecipeFormModal } from './RecipeFormModal'
import '../styles/recipes.css'

const SEARCH_DELAY_MS = 150
const TOAST_DURATION_MS = 3000
const SORTS: Array<{ sort: RecipeSort; label: string }> = [
  { sort: 'recent', label: 'Más recientes' },
  { sort: 'kcal', label: 'Menos calorías' },
  { sort: 'protein', label: 'Más proteína' },
  { sort: 'name', label: 'Nombre (A–Z)' },
]

type FormTarget = { mode: 'create' } | { mode: 'edit'; detail: RecipeDetail }

export function RecipesDashboardView({ library }: { library: NotiaLibrary }) {
  const [meal, setMeal] = useState<MealTime | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<RecipeSort>('recent')
  const [detail, setDetail] = useState<RecipeDetail | null>(null)
  const [form, setForm] = useState<FormTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const query = useMemo(() => ({ meal, query: debouncedSearch, sort }), [meal, debouncedSearch, sort])
  const { grid, status, loadError, reload } = useRecipeGrid(library, query)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  const openDetail = useCallback(async (id: string) => {
    try {
      setDetail(await getRecipeDetail(library, id))
    } catch (reason) {
      setToast(asRecipesError(reason).message)
    }
  }, [library])

  // The open recipe follows changes made elsewhere (the agent, Telegram).
  useEffect(() => {
    if (!detail || !grid) return
    const card = grid.cards.find((item) => item.id === detail.id)
    if (card && card.photoKey !== detail.photoKey) void openDetail(detail.id)
  }, [grid, detail, openDetail])

  const clearFilters = () => {
    setSearch('')
    setDebouncedSearch('')
    setMeal(null)
  }

  const remove = async () => {
    if (!detail) return
    setBusy(true)
    try {
      await deleteRecipe(library, detail.id)
      setDetail(null)
      setToast('Receta eliminada')
      void reload()
    } catch (reason) {
      setToast(asRecipesError(reason).message)
    } finally {
      setBusy(false)
    }
  }

  const saved = (id: string, created: boolean) => {
    setForm(null)
    setToast(created ? 'Receta guardada: la IA completó los datos que faltaban' : 'Receta actualizada')
    void reload()
    void openDetail(id)
  }

  return (
    <main className="notia-main recipes-view">
      <div className="rcp-page">
        <header className="rcp-top">
          <div>
            <h1>Recetas</h1>
            <p>{grid?.countLabel ?? ''}</p>
          </div>
          <button type="button" className="rcp-button rcp-button--primary" onClick={() => setForm({ mode: 'create' })}>
            <Plus size={20} strokeWidth={1.8} aria-hidden="true" />Nueva comida
          </button>
        </header>

        <div className="rcp-toolbar">
          <label className="rcp-search">
            <span className="rcp-visually-hidden">Buscar recetas</span>
            <Search size={18} strokeWidth={1.8} aria-hidden="true" />
            <input type="search" placeholder="Buscar por nombre o ingrediente" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <div className="rcp-segmented" role="group" aria-label="Filtrar por momento del día">
            {(grid?.filters ?? []).map((filter) => (
              <button key={filter.label} type="button" aria-pressed={filter.selected} data-meal={filter.meal ?? undefined} onClick={() => setMeal(filter.meal)}>
                {filter.meal && <span className="rcp-dot" aria-hidden="true" />}
                {filter.label}
              </button>
            ))}
          </div>
          <label className="rcp-sort">Ordenar
            <select className="rcp-input" value={sort} onChange={(event) => setSort(event.target.value as RecipeSort)}>
              {SORTS.map((option) => <option key={option.sort} value={option.sort}>{option.label}</option>)}
            </select>
          </label>
        </div>

        {status === 'loading' && !grid && <p className="rcp-state" role="status">Cargando recetas…</p>}
        {status === 'error' && !grid && (
          <div className="rcp-state" role="alert">
            <p>{loadError}</p>
            <button type="button" className="rcp-button" onClick={() => { void reload() }}>Reintentar</button>
          </div>
        )}
        {grid && (
          <section className="rcp-grid" aria-live="polite">
            {grid.empty ? (
              <div className="rcp-empty">
                <h2>{grid.empty.title}</h2>
                <p>{grid.empty.text}</p>
                <button
                  type="button"
                  className={grid.empty.action === 'new' ? 'rcp-button rcp-button--primary' : 'rcp-button'}
                  onClick={() => (grid.empty?.action === 'new' ? setForm({ mode: 'create' }) : clearFilters())}
                >
                  {grid.empty.actionLabel}
                </button>
              </div>
            ) : (
              grid.cards.map((card) => <RecipeCardView key={card.id} library={library} card={card} onOpen={(id) => { void openDetail(id) }} />)
            )}
          </section>
        )}
      </div>

      {detail && !form && (
        <RecipeDetailSheet
          library={library}
          detail={detail}
          busy={busy}
          onClose={() => setDetail(null)}
          onEdit={() => setForm({ mode: 'edit', detail })}
          onDelete={() => { void remove() }}
        />
      )}
      {form && (
        <RecipeFormModal
          library={library}
          detail={form.mode === 'edit' ? form.detail : null}
          defaultMeal={meal}
          onClose={() => setForm(null)}
          onSaved={saved}
          onOpenRecipe={(id) => { setForm(null); void openDetail(id) }}
        />
      )}
      <div className="rcp-toast-region" role="status" aria-live="polite">{toast && <div className="rcp-toast">{toast}</div>}</div>
    </main>
  )
}
