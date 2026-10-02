import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { CompositionPanel, FoodPanel, RecentMeal } from '../types/healthTypes'
import { RangeBarView } from './HealthCharts'
import { categoryIcon } from './healthUi'

interface FoodPanelProps {
  panel: FoodPanel
  /** En el celular «Agregar comida» es el botón flotante de la pantalla. */
  phone?: boolean
  onDate: (date: string) => void
  onAdd: (category: string | null) => void
  onEdit: (meal: { id: string; values: RecentMeal }) => void
}

export function FoodPanelView({ panel, phone = false, onDate, onAdd, onEdit }: FoodPanelProps) {
  return (
    <section className="hl-panel hl-food" aria-labelledby="hl-food-title">
      <div className="hl-panel__top hl-panel__top--center">
        <h2 id="hl-food-title" className="hl-h2">Alimentación</h2>
        <div className="hl-food__controls">
          <div className="hl-seg hl-day" role="group" aria-label="Día">
            <button type="button" onClick={() => onDate(panel.previousDate)} aria-label="Día anterior"><ChevronLeft size={16} aria-hidden="true" /></button>
            <span className="hl-day__label">{panel.dayLabel}</span>
            <button type="button" onClick={() => panel.nextDate && onDate(panel.nextDate)} disabled={!panel.nextDate} aria-label="Día siguiente"><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
          {!phone && <button type="button" className="hl-button hl-button--primary" onClick={() => onAdd(null)}><Plus size={16} aria-hidden="true" />Agregar comida</button>}
        </div>
      </div>

      <div className="hl-food__summary">
        <div className="hl-food__energy">
          <div className="hl-figure"><span className="hl-big">{panel.totalLabel}</span><span className="hl-muted">{panel.targetLabel}</span></div>
          <div className="hl-track"><div className="hl-fill" data-over={panel.over} style={{ width: `${panel.progress}%` }} /></div>
          <p className="hl-small" data-over={panel.over}>{panel.remainingLabel}</p>
          <dl className="hl-pairs hl-small">
            {panel.stats.map((stat) => (
              <div key={stat.label} className="hl-pairs__row"><dt className="hl-muted">{stat.label}</dt><dd>{stat.value}</dd></div>
            ))}
          </dl>
          <p className="hl-small hl-faint">{panel.footnote}</p>
        </div>
        <div className="hl-food__macros">
          {panel.macros.map((macro) => (
            <div key={macro.key} className="hl-well hl-macro" data-macro={macro.key}>
              <div className="hl-macro__head hl-small">
                <span><i className="hl-dot" aria-hidden="true" />{macro.label}</span>
                <span className="hl-muted">{macro.percentLabel}</span>
              </div>
              <div><span className="hl-mid">{macro.valueLabel}</span><span className="hl-small hl-muted"> {macro.targetLabel}</span></div>
              <div className="hl-track"><div className="hl-fill" style={{ width: `${macro.progress}%` }} /></div>
              <div className="hl-small hl-faint">{macro.status}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="hl-meals">
        {panel.groups.map((group) => {
          const Icon = categoryIcon(group.id)
          return (
            <div key={group.id} className="hl-well hl-meal-group">
              <div className="hl-meal-group__head">
                <div className="hl-meal-group__title">
                  <Icon size={16} className="hl-muted" aria-hidden="true" />
                  <h3 className="hl-h3">{group.label}</h3>
                  {group.kcalLabel && <span className="hl-small hl-muted">{group.kcalLabel}</span>}
                </div>
                <button type="button" className="hl-button hl-button--small" onClick={() => onAdd(group.id)} aria-label={`Agregar a ${group.label}`}>
                  <Plus size={14} aria-hidden="true" />Agregar
                </button>
              </div>
              {group.meals.length === 0 ? (
                <p className="hl-small hl-faint hl-meal-group__empty">Sin comidas cargadas.</p>
              ) : (
                <div className="hl-meal-group__list">
                  {group.meals.map((meal) => (
                    <button key={meal.id} type="button" className="hl-meal" onClick={() => onEdit(meal)} aria-label={`Editar ${meal.name}`}>
                      <span className="hl-meal__line"><span>{meal.name}</span><span className="hl-small">{meal.kcalLabel}</span></span>
                      <span className="hl-pills">
                        {meal.pills.map((pill) => (
                          <span key={pill.key} className="hl-small hl-muted" data-macro={pill.key} title={pill.label}><i className="hl-dot hl-dot--small" aria-hidden="true" />{pill.short} {pill.valueLabel}</span>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

interface CompositionPanelProps {
  panel: CompositionPanel | null
  onNew: () => void
  onDate: (date: string) => void
  onDelete: (date: string) => void
}

export function CompositionPanelView({ panel, onNew, onDate, onDelete }: CompositionPanelProps) {
  if (!panel) {
    return (
      <section className="hl-panel" aria-labelledby="hl-body-title">
        <h2 id="hl-body-title" className="hl-h2">Composición corporal</h2>
        <p className="hl-small hl-muted">Todavía no hay mediciones de la balanza. Registrá la primera para ver tu composición.</p>
        <button type="button" className="hl-button hl-button--primary" onClick={onNew}>Registrar medición</button>
      </section>
    )
  }
  return (
    <section className="hl-panel hl-body" aria-labelledby="hl-body-title">
      <div className="hl-panel__top hl-panel__top--center">
        <div>
          <h2 id="hl-body-title" className="hl-h2">Composición corporal</h2>
          <p className="hl-small hl-muted">{panel.subtitle}</p>
        </div>
        <div className="hl-actions hl-actions--tight">
          {panel.dates.length > 1 && (
            <select className="hl-input hl-input--auto" value={panel.date} onChange={(event) => onDate(event.target.value)} aria-label="Elegir medición">
              {panel.dates.map((date) => <option key={date.value} value={date.value}>{date.label}</option>)}
            </select>
          )}
          <button type="button" className="hl-button" onClick={() => onDelete(panel.date)}>Eliminar</button>
        </div>
      </div>

      <div className="hl-strip">
        <p className="hl-small">{panel.stripTitle}</p>
        <div className="hl-strip__bar">
          {panel.parts.map((part) => <div key={part.key} data-part={part.key} title={`${part.label}: ${part.detail}`} style={{ width: `${part.share}%` }} />)}
        </div>
        <div className="hl-legend">
          {panel.parts.map((part) => (
            <span key={part.key} data-part={part.key}><i className="hl-square" aria-hidden="true" />{part.label} <span className="hl-muted">{part.detail}</span></span>
          ))}
        </div>
      </div>

      <div className="hl-body__groups">
        {panel.groups.map((group) => (
          <div key={group.id} className="hl-well hl-metrics" data-group={group.id}>
            <h3 className="hl-small hl-strong">{group.title}</h3>
            {group.metrics.map((metric) => (
              <div key={`${metric.key}-${metric.label}`} className="hl-metric">
                <div className="hl-small hl-muted">{metric.label}</div>
                <div className="hl-metric__value">
                  <span><span className="hl-metric__number">{metric.valueLabel}</span>{metric.unit && <span className="hl-small hl-muted"> {metric.unit}</span>}</span>
                  {metric.deltaLabel && <span className="hl-small hl-faint">{metric.deltaLabel}</span>}
                </div>
                {metric.bar && <RangeBarView bar={metric.bar} height={5} />}
                {metric.state && <span className="hl-chip" data-tone={metric.state.tone}>{metric.state.label}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="hl-small hl-faint">Los rangos son referencias generales para adultos; cada balanza calcula estos valores a su manera.</p>
    </section>
  )
}
