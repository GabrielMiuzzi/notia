import { useCallback, useEffect, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { NotiaLibrary } from '../../../types/notia'
import { useAiActionsDashboard } from '../hooks/useAiActionsDashboard'
import { aiActionsErrorMessage, retryAiRun, setAiActionEnabled } from '../services/aiActionsService'
import type { ActionCard, ActionColumn, AiActionsDashboard, DashboardFilter } from '../types/aiActionsTypes'
import { AiActionCardView } from './AiActionCardView'
import { AiActionFormPanel, type AiActionFormMode } from './AiActionFormPanel'
import { AiActionsTimeline } from './AiActionsTimeline'
import { KIND_VISUALS } from './aiActionsKinds'
import '../styles/aiActions.css'

const SEARCH_DELAY_MS = 150
const TOAST_DURATION_MS = 6000

const LEGEND: Array<{ tone: string; label: string }> = [
  { tone: 'done', label: 'Ejecutada' },
  { tone: 'next', label: 'Próxima' },
  { tone: 'pending', label: 'Pendiente' },
  { tone: 'failed', label: 'Falló' },
  { tone: 'paused', label: 'Pausada' },
]

function filterTabs(dashboard: AiActionsDashboard | null): Array<{ filter: DashboardFilter; label: string; count: number }> {
  const counts = dashboard?.counts
  return [
    { filter: 'all', label: 'Todas', count: counts?.all ?? 0 },
    { filter: 'reminder', label: 'Recordatorios', count: counts?.reminder ?? 0 },
    { filter: 'one-shot', label: 'Horarios', count: counts?.oneShot ?? 0 },
    { filter: 'recurring', label: 'Recurrentes', count: counts?.recurring ?? 0 },
  ]
}

function MetricCards({ dashboard }: { dashboard: AiActionsDashboard }) {
  const { metrics } = dashboard
  const paused = metrics.recurringPaused === 0 ? 'Ninguna pausada' : metrics.recurringPaused === 1 ? '1 pausada' : `${metrics.recurringPaused} pausadas`
  return (
    <section className="aia-metrics" aria-label="Resumen del día">
      <div className="aia-metric">
        <span className="aia-metric__label">Ejecutadas hoy</span>
        <span className="aia-metric__value">{metrics.doneToday}</span>
        {metrics.failedToday > 0
          ? <span className="aia-metric__note" data-tone="failed">{metrics.failedToday} falló · se puede reintentar</span>
          : <span className="aia-metric__note" data-tone="done">Sin errores</span>}
      </div>
      <div className="aia-metric">
        <span className="aia-metric__label">Pendientes hoy</span>
        <span className="aia-metric__value">{metrics.pendingToday}</span>
        <span className="aia-metric__note">{metrics.pendingUntil ?? 'Nada más por hoy'}</span>
      </div>
      <div className="aia-metric">
        <span className="aia-metric__label">Recurrentes activas</span>
        <span className="aia-metric__value">{metrics.recurringActive}<span className="aia-metric__total"> / {metrics.recurringTotal}</span></span>
        <span className="aia-metric__note">{paused}</span>
      </div>
      <div className="aia-metric aia-metric--next">
        <span className="aia-metric__label">Próxima ejecución</span>
        {metrics.next ? (
          <>
            <span className="aia-metric__value">{metrics.next.time}<span className="aia-metric__in"> · {metrics.next.inLabel}</span></span>
            <span className="aia-metric__note aia-metric__note--ink">{metrics.next.name} · {metrics.next.kindLabel}</span>
          </>
        ) : (
          <>
            <span className="aia-metric__value">—</span>
            <span className="aia-metric__note aia-metric__note--ink">No quedan acciones para hoy</span>
          </>
        )}
      </div>
    </section>
  )
}

interface ColumnProps {
  column: ActionColumn
  wide: boolean
  busyIds: Set<string>
  onOpen: (card: ActionCard) => void
  onToggle: (card: ActionCard) => void
  onRetry: (card: ActionCard) => void
}

function Column({ column, wide, busyIds, onOpen, onToggle, onRetry }: ColumnProps) {
  const visuals = KIND_VISUALS[column.kind]
  const Icon = visuals.icon
  return (
    <section className="aia-column" data-accent={visuals.accent} data-wide={wide} aria-labelledby={`aia-column-${column.kind}`}>
      <div className="aia-column__accent" aria-hidden="true" />
      <div className="aia-column__head">
        <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
        <h2 id={`aia-column-${column.kind}`}>{column.title}</h2>
        <span className="aia-column__count">{column.cards.length}</span>
        <span className="aia-column__subtitle">{column.subtitle}</span>
      </div>
      <div className="aia-column__cards">
        {column.cards.length === 0 && <p className="aia-column__empty">Sin acciones.</p>}
        {column.cards.map((card) => (
          <AiActionCardView key={card.id} card={card} busy={busyIds.has(card.id)} onOpen={onOpen} onToggle={onToggle} onRetry={onRetry} />
        ))}
      </div>
    </section>
  )
}

export function AiActionsDashboardView({ library }: { library: NotiaLibrary }) {
  const [filter, setFilter] = useState<DashboardFilter>('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<AiActionFormMode | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const { dashboard, status, loadError, reload } = useAiActionsDashboard(library, filter, query)

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  const withBusy = useCallback(async (id: string, work: () => Promise<unknown>) => {
    setBusyIds((current) => new Set(current).add(id))
    try {
      await work()
    } catch (reason) {
      setToast(aiActionsErrorMessage(reason))
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
      void reload()
    }
  }, [reload])

  const toggle = useCallback((card: ActionCard) => {
    void withBusy(card.id, () => setAiActionEnabled(library, card.id, !card.enabled))
  }, [library, withBusy])

  const retry = useCallback((card: ActionCard) => {
    if (!card.retryRunId) return
    const runId = card.retryRunId
    void withBusy(card.id, async () => {
      await retryAiRun(library, runId)
      setToast('Reintentando: la respuesta llega por Telegram.')
    })
  }, [library, withBusy])

  const closeForm = useCallback(() => {
    setForm(null)
    void reload()
  }, [reload])

  const tabs = filterTabs(dashboard)

  return (
    <main className="notia-main ai-actions-view">
      <div className="aia-page">
        <header className="aia-header">
          <div className="aia-header__text">
            <div className="aia-breadcrumb"><span>{library.name}</span><span aria-hidden="true">/</span><span className="aia-breadcrumb__current">Acciones IA</span></div>
            <h1>Acciones IA</h1>
            <p>{dashboard ? `${dashboard.titleDate} · ` : ''}Lo que la IA va a hacer por vos, con el prompt de cada acción.</p>
          </div>
          <div className="aia-header__actions">
            <label className="aia-search">
              <Search size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className="aia-visually-hidden">Buscar acciones o prompts</span>
              <input type="search" placeholder="Buscar acciones o prompts" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <button type="button" className="aia-button aia-button--primary" onClick={() => setForm({ mode: 'create' })}>
              <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
              Nueva acción
            </button>
          </div>
        </header>

        {status === 'error' && !dashboard && (
          <div className="aia-state" role="alert">
            <p>{loadError}</p>
            <button type="button" className="aia-button" onClick={() => { void reload() }}>Reintentar</button>
          </div>
        )}
        {status === 'loading' && !dashboard && <p className="aia-state" role="status">Cargando acciones…</p>}

        {dashboard && (
          <>
            <MetricCards dashboard={dashboard} />

            <div className="aia-toolbar">
              <div className="aia-tabs" role="group" aria-label="Filtrar por tipo">
                {tabs.map((tab) => (
                  <button key={tab.filter} type="button" className="aia-tab" aria-pressed={filter === tab.filter} onClick={() => setFilter(tab.filter)}>
                    {tab.label}
                    <span className="aia-tab__count">{tab.count}</span>
                  </button>
                ))}
              </div>
              <ul className="aia-legend" aria-label="Estados">
                {LEGEND.map((entry) => (
                  <li key={entry.tone} data-tone={entry.tone}><span className="aia-legend__dot" aria-hidden="true" />{entry.label}</li>
                ))}
              </ul>
            </div>

            <div className="aia-body">
              <div className="aia-columns" data-single={filter !== 'all'}>
                {dashboard.columns.map((column) => (
                  <Column
                    key={column.kind}
                    column={column}
                    wide={filter !== 'all'}
                    busyIds={busyIds}
                    onOpen={(card) => setForm({ mode: 'edit', actionId: card.id })}
                    onToggle={toggle}
                    onRetry={retry}
                  />
                ))}
              </div>
              <AiActionsTimeline dashboard={dashboard} />
            </div>
          </>
        )}
      </div>

      {form && <AiActionFormPanel library={library} form={form} onClose={closeForm} onToast={setToast} />}
      <div className="aia-toast-region" role="status" aria-live="polite">
        {toast && <div className="aia-toast">{toast}</div>}
      </div>
    </main>
  )
}
