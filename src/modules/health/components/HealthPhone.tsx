import { useRef, useState, type ReactNode } from 'react'
import { Activity, ChevronRight, MoreVertical, Plus, User } from 'lucide-react'
import type { CaloriesSummary, HealthDashboard, WeightTrend } from '../types/healthTypes'
import { HealthModal } from './HealthForms'

/*
 * La versión celular de Salud (canvas «SaludDashboard», `SaludMovil`): barra
 * de arriba con «Más opciones», pestañas Hoy / Comidas / Peso / Cuerpo, el
 * botón flotante de cada pestaña y las tarjetas de resumen de Hoy. Los paneles
 * son los mismos del escritorio; Rust arma todos los textos y la línea.
 */

/** Ancho de la vista de Salud (no de la ventana) por debajo del cual se usa el celular. */
export const HEALTH_PHONE_MAX_WIDTH = 700

type PhoneTab = 'hoy' | 'comidas' | 'peso' | 'cuerpo'

const TABS: Array<{ id: PhoneTab; label: string }> = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'comidas', label: 'Comidas' },
  { id: 'peso', label: 'Peso' },
  { id: 'cuerpo', label: 'Cuerpo' },
]

/** Los paneles compartidos con el escritorio, ya armados. */
export interface HealthPanels {
  welcome: ReactNode
  alert: ReactNode
  bmi: ReactNode
  weight: ReactNode
  objective: ReactNode
  food: ReactNode
  water: ReactNode
  composition: ReactNode
}

interface HealthPhoneProps {
  dashboard: HealthDashboard
  panels: HealthPanels
  onProfile: () => void
  onMeasurement: () => void
  /** Agregar una comida al día indicado. */
  onMeal: (date: string) => void
}

export function HealthPhone({ dashboard, panels, onProfile, onMeasurement, onMeal }: HealthPhoneProps) {
  const [tab, setTab] = useState<PhoneTab>('hoy')
  const [menu, setMenu] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const profile = dashboard.hasProfile

  const showTab = (next: PhoneTab) => {
    setTab(next)
    scrollRef.current?.scrollTo?.({ top: 0 })
  }
  const choose = (action: () => void) => () => {
    setMenu(false)
    action()
  }
  // En Comidas la comida va al día que se está viendo, como el botón del escritorio.
  const fab = !profile ? null
    : tab === 'hoy' ? { label: 'Agregar comida', run: () => onMeal(dashboard.today) }
    : tab === 'comidas' ? { label: 'Agregar comida', run: () => onMeal(dashboard.food?.date ?? dashboard.today) }
    : tab === 'cuerpo' ? { label: 'Registrar medición', run: onMeasurement }
    : null

  return (
    <>
      <div ref={scrollRef} className="hl-phone">
        <header className="hl-phone__top">
          <div className="hl-phone__bar">
            <h1 className="hl-h1">Salud</h1>
            <button type="button" className="hl-phone__icon" aria-label="Más opciones" aria-haspopup="dialog" onClick={() => setMenu(true)}>
              <MoreVertical size={20} aria-hidden="true" />
            </button>
          </div>
          {profile && (
            <div className="hl-phone__tabs" role="tablist" aria-label="Secciones de Salud">
              {TABS.map((item) => (
                <button key={item.id} type="button" role="tab" id={`hl-tab-${item.id}`} aria-controls="hl-tabpanel" aria-selected={tab === item.id} onClick={() => showTab(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </header>

        <div
          id="hl-tabpanel"
          className="hl-phone__main"
          role={profile ? 'tabpanel' : undefined}
          aria-labelledby={profile ? `hl-tab-${tab}` : undefined}
          data-fab={fab !== null}
        >
          {panels.alert}
          {!profile ? panels.welcome
            : tab === 'hoy' ? (
              <>
                {dashboard.todayCalories && <CaloriesCard summary={dashboard.todayCalories} onOpen={() => showTab('comidas')} />}
                {panels.water}
                <WeightCard currentLabel={dashboard.weight.currentLabel} trend={dashboard.weightTrend} onOpen={() => showTab('peso')} />
                {panels.bmi}
              </>
            )
            : tab === 'comidas' ? panels.food
            : tab === 'peso' ? <>{panels.weight}{panels.objective}</>
            : panels.composition}
        </div>
      </div>

      {fab && (
        <button type="button" className="hl-fab" onClick={fab.run}><Plus size={20} aria-hidden="true" />{fab.label}</button>
      )}

      {menu && (
        <HealthModal title="Opciones" phone onClose={() => setMenu(false)}>
          <div className="hl-phone__menu">
            <button type="button" className="hl-phone__item" onClick={choose(onProfile)}>
              <User size={20} className="hl-muted" aria-hidden="true" />{profile ? 'Editar perfil' : 'Configurar perfil'}
            </button>
            {profile && (
              <button type="button" className="hl-phone__item" onClick={choose(onMeasurement)}>
                <Activity size={20} className="hl-muted" aria-hidden="true" />Registrar medición de la balanza
              </button>
            )}
          </div>
        </HealthModal>
      )}
    </>
  )
}

/** «Calorías de hoy»: tocarla lleva a Comidas. */
function CaloriesCard({ summary, onOpen }: { summary: CaloriesSummary; onOpen: () => void }) {
  return (
    <section className="hl-panel hl-phone-card">
      <button type="button" className="hl-phone-card__button" onClick={onOpen}>
        <span className="hl-phone-card__head">
          <span className="hl-h2">Calorías de hoy</span>
          <span className="hl-small hl-muted hl-phone-card__more">Ver comidas<ChevronRight size={16} aria-hidden="true" /></span>
        </span>
        <span className="hl-phone-card__figure">
          <span className="hl-big">{summary.totalLabel}</span>
          <span className="hl-small hl-muted">{summary.targetLabel}</span>
        </span>
        <span className="hl-track"><span className="hl-fill" data-over={summary.over} style={{ width: `${summary.progress}%` }} /></span>
        <span className="hl-small hl-phone-card__note" data-over={summary.over}>{summary.remainingLabel}</span>
        <span className="hl-phone-card__macros">
          {summary.macros.map((macro) => (
            <span key={macro.key} className="hl-phone-macro" data-macro={macro.key}>
              <span className="hl-small hl-phone-macro__label"><i className="hl-dot" aria-hidden="true" />{macro.label}</span>
              <span className="hl-small hl-muted hl-phone-macro__amount">{macro.valueLabel} {macro.targetLabel}</span>
              <span className="hl-track hl-phone-macro__track"><span className="hl-fill" style={{ width: `${macro.progress}%` }} /></span>
            </span>
          ))}
        </span>
      </button>
    </section>
  )
}

/** «Peso» con la línea del último mes: tocarla lleva a Peso. */
function WeightCard({ currentLabel, trend, onOpen }: { currentLabel: string; trend: WeightTrend; onOpen: () => void }) {
  return (
    <section className="hl-panel hl-phone-card">
      <button type="button" className="hl-phone-card__button" onClick={onOpen}>
        <span className="hl-phone-card__head">
          <span className="hl-h2">Peso</span>
          <span className="hl-small hl-muted hl-phone-card__more">Ver detalle<ChevronRight size={16} aria-hidden="true" /></span>
        </span>
        <span className="hl-phone-card__row">
          <span>
            <span className="hl-phone-card__figure hl-phone-card__figure--tight">
              <span className="hl-big">{currentLabel}</span>
              <span className="hl-muted">kg</span>
            </span>
            <span className="hl-small hl-muted hl-phone-card__lines">
              {trend.changeLabel}
              {trend.changeLabel && trend.goalLabel && <br />}
              {trend.goalLabel}
            </span>
          </span>
          {trend.line && (
            <span className="hl-spark" aria-hidden="true">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                <path d={trend.line} vectorEffect="non-scaling-stroke" />
              </svg>
            </span>
          )}
        </span>
      </button>
    </section>
  )
}
