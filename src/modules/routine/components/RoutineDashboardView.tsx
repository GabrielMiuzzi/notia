import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarDays, ChartPie, Flame, Layers, LayoutGrid, Plus, RotateCcw, SquareCheckBig, TrendingUp } from 'lucide-react'
import type { NotiaLibrary } from '../../../types/notia'
import { useRoutineDashboard } from '../hooks/useRoutineDashboard'
import type { RoutineDashboard, RoutineTask } from '../types/routineTypes'
import { RoutineCalendar, RoutineEvolution, RoutineHeatmap, RoutineLifeWheel, RoutineWeekly } from './RoutineCharts'
import { RoutineManagerSection } from './RoutineManagerSection'
import { RoutineTaskSection } from './RoutineTaskSection'
import { RoutineWeekSection } from './RoutineWeekSection'
import '../styles/routine.css'

const TOAST_DURATION_MS = 6000

type SectionId = 'routines' | 'tasks' | 'habits' | 'calendar' | 'evolution' | 'weekly' | 'wheel' | 'today'

function pctLabel(value: number | null): string {
  return value === null ? '–' : `${value}%`
}

function navItems(dashboard: RoutineDashboard): Array<{ id: SectionId; label: string; stat: string }> {
  const { nav } = dashboard
  return [
    { id: 'routines', label: 'Rutinas', stat: String(nav.routines) },
    { id: 'tasks', label: 'Tareas', stat: String(nav.activeTasks) },
    { id: 'habits', label: 'Hábitos', stat: nav.bestStreak > 0 ? `🔥${nav.bestStreak}` : '–' },
    { id: 'calendar', label: 'Calendario', stat: pctLabel(nav.todayPct) },
    { id: 'evolution', label: 'Evolución', stat: nav.bestDayPct ? `${nav.bestDayPct}%` : '–' },
    { id: 'weekly', label: 'Semanal', stat: pctLabel(nav.weekPct) },
    { id: 'wheel', label: 'Rueda', stat: `${nav.wheelAverage}/10` },
    { id: 'today', label: 'Hoy', stat: nav.todayTotal > 0 ? `${nav.todayDone}/${nav.todayTotal}` : '–' },
  ]
}

function Card({ id, icon, title, description, children }: { id: SectionId; icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <section className="routine-card" id={`routine-${id}`} data-section={id} aria-labelledby={`routine-${id}-title`}>
      <header className="routine-card__head">
        <span className="routine-card__icon" aria-hidden="true">{icon}</span>
        <div>
          <h2 id={`routine-${id}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

interface ToastState {
  message: string
  undo: (() => void) | null
}

export function RoutineDashboardView({ library }: { library: NotiaLibrary }) {
  const { dashboard, status, loadError, isMutating, reload, mutate } = useRoutineDashboard(library)
  const scrollRef = useRef<HTMLElement>(null)
  const [activeSection, setActiveSection] = useState<SectionId>('routines')
  const [toast, setToast] = useState<ToastState | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const root = scrollRef.current
    if (!root || !dashboard || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.find((entry) => entry.isIntersecting)
      const section = (visible?.target as HTMLElement | undefined)?.dataset.section as SectionId | undefined
      if (section) setActiveSection(section)
    }, { root, rootMargin: '-80px 0px -70% 0px', threshold: 0 })
    root.querySelectorAll('[data-section]').forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [dashboard])

  const showError = useCallback((message: string) => setToast({ message, undo: null }), [])

  const handleTaskDeleted = useCallback((task: RoutineTask) => {
    setToast({
      message: `Tarea «${task.name}» eliminada`,
      undo: () => {
        setToast(null)
        void mutate({ type: 'restoreTask', id: task.id }).catch((reason: Error) => showError(reason.message))
      },
    })
  }, [mutate, showError])

  const scrollToSection = (id: SectionId) => {
    setActiveSection(id)
    document.getElementById(`routine-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (status === 'loading' && !dashboard) {
    return <main className="notia-main routine-view" role="status" aria-live="polite"><p className="routine-empty">Cargando tu rutina...</p></main>
  }

  if (!dashboard) {
    return (
      <main className="notia-main routine-view">
        <div className="routine-card routine-load-error" role="alert">
          <p>{loadError ?? 'No se pudo cargar la rutina.'}</p>
          <button type="button" className="routine-button routine-button--primary" onClick={() => void reload()}><RotateCcw size={16} /> Reintentar</button>
        </div>
      </main>
    )
  }

  const hasTasks = dashboard.tasks.length > 0
  const shared = { disabled: isMutating, onMutate: mutate, onError: showError }

  return (
    <main className="notia-main routine-view" ref={scrollRef}>
      <div className="routine-wrap">
        <header className="routine-hero">
          <div>
            <h1>Tu rutina</h1>
            <p>Sumá hábitos, marcalos día a día y mirá cómo se acumula el progreso.</p>
          </div>
          <div className="routine-hero__stat">
            <strong>{dashboard.nav.monthPct === null ? '—' : `${dashboard.nav.monthPct}%`}</strong>
            <span>completado en {dashboard.monthLabel}</span>
          </div>
        </header>

        {status === 'error' && loadError ? (
          <div className="routine-inline-error" role="alert">
            <span>{loadError}</span>
            <button type="button" className="routine-button routine-button--secondary" onClick={() => void reload()}>Reintentar</button>
          </div>
        ) : null}

        <nav className="routine-quicknav" aria-label="Secciones de Rutina">
          {navItems(dashboard).map((item) => (
            <button key={item.id} type="button" className="routine-nav-chip" aria-current={activeSection === item.id ? 'true' : undefined} onClick={() => scrollToSection(item.id)}>
              <span className="routine-nav-chip__label">{item.label}</span>
              <span className="routine-nav-chip__stat">{item.stat}</span>
            </button>
          ))}
        </nav>

        <Card id="routines" icon={<Layers size={19} />} title="Tus rutinas" description="Agrupá tus tareas en rutinas con su propio checklist (Mañana, Noche, Fin de semana...).">
          <RoutineManagerSection routines={dashboard.routines} {...shared} />
        </Card>

        <Card id="tasks" icon={<Plus size={19} />} title="Sumar a la rutina" description="Agregá lo que querés convertir en hábito. Arrastrá el asa (o usá las flechas) para priorizar.">
          <RoutineTaskSection routines={dashboard.routines} tasks={dashboard.tasks} categories={dashboard.categories} onTaskDeleted={handleTaskDeleted} {...shared} />
        </Card>

        <Card id="habits" icon={<CalendarDays size={19} />} title="Panel de hábitos" description="Así viene tu racha este mes, día a día.">
          <RoutineHeatmap heatmap={dashboard.heatmap} />
        </Card>

        <Card id="calendar" icon={<LayoutGrid size={19} />} title="Calendario del mes" description="De un vistazo, qué días te fue mejor o peor.">
          <RoutineCalendar calendar={dashboard.calendar} />
        </Card>

        <Card id="evolution" icon={<TrendingUp size={19} />} title="Evolución del mes" description="Qué días tuviste mejor racha, comparado con el mes pasado.">
          <RoutineEvolution evolution={dashboard.evolution} hasTasks={hasTasks} />
        </Card>

        <Card id="weekly" icon={<Flame size={19} />} title="Racha y progreso semanal" description="Cuánto completaste semana a semana, este mes vs. el pasado.">
          <RoutineWeekly weekly={dashboard.weekly} hasTasks={hasTasks} />
        </Card>

        <Card id="wheel" icon={<ChartPie size={19} />} title="Rueda de la vida" description="Se arma sola con las tareas que fuiste completando en cada categoría.">
          <RoutineLifeWheel wheel={dashboard.wheel} {...shared} />
        </Card>

        <Card id="today" icon={<SquareCheckBig size={19} />} title="Semana actual" description={dashboard.currentWeek.rangeLabel}>
          <RoutineWeekSection dashboard={dashboard} {...shared} />
        </Card>

        <footer className="routine-footer">Los datos quedan guardados en la base de la biblioteca.</footer>
      </div>

      <div className={`routine-toast${toast ? ' routine-toast--visible' : ''}`} role="status" aria-live="polite">
        {toast ? (
          <>
            <span>{toast.message}</span>
            {toast.undo ? <button type="button" className="routine-toast__undo" onClick={toast.undo}>Deshacer</button> : null}
            <button type="button" className="routine-toast__close" onClick={() => setToast(null)} aria-label="Cerrar aviso">×</button>
          </>
        ) : null}
      </div>
    </main>
  )
}
