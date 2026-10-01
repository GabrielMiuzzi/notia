import { CalendarCheck, Clock, Dumbbell, Flame, Play, Zap } from 'lucide-react'
import type { BodyView, PanelView } from '../types/gymTypes'
import { BodyGraph } from './BodyGraph'

interface PanelScreenProps {
  panel: PanelView
  body: BodyView | null
  equipmentOwned: number
  equipmentTotal: number
  onEquipment: () => void
  onRoutines: () => void
  onStart: (routineId: string) => void
  onPickDay: (date: string) => void
}

const STAT_ICONS = { streak: Flame, week: CalendarCheck, kcal: Zap, time: Clock }
const STAT_TITLES = { streak: 'Racha', week: 'Esta semana', kcal: 'Calorías de la semana', time: 'Tiempo entrenando' }
const DAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

export function PanelScreen({ panel, body, equipmentOwned, equipmentTotal, onEquipment, onRoutines, onStart, onPickDay }: PanelScreenProps) {
  const next = panel.nextRoutineId
  return (
    <main className="gym-main gym-panel">
      <header className="gym-panel-header">
        <div className="gym-title-block">
          <h1 className="gym-h1">Entrenamiento</h1>
          <span className="gym-muted">{panel.weekLabel}</span>
        </div>
        <div className="gym-header-actions">
          <span className="gym-muted gym-next-label">{panel.nextLabel}</span>
          <button type="button" className="gym-button" onClick={onEquipment}>
            <Dumbbell size={16} aria-hidden="true" />
            Equipamiento
            <span className="gym-count">{equipmentOwned}/{equipmentTotal}</span>
          </button>
          <button type="button" className="gym-button" onClick={onRoutines}>Ver rutinas</button>
          {next ? (
            <button type="button" className="gym-button gym-button--primary" onClick={() => onStart(next)}>
              <Play size={14} fill="currentColor" aria-hidden="true" />
              Empezar {panel.nextName}
            </button>
          ) : null}
        </div>
      </header>

      <section className="gym-stats" aria-label="Resumen de la semana">
        {panel.stats.map((stat) => {
          const Icon = STAT_ICONS[stat.key]
          return (
            <div key={stat.key} className="gym-card gym-stat" data-stat={stat.key}>
              <span className="gym-stat-title"><Icon size={16} aria-hidden="true" />{STAT_TITLES[stat.key]}</span>
              <span className="gym-stat-value">{stat.value}</span>
              <span className="gym-stat-sub">{stat.sub}</span>
            </div>
          )
        })}
      </section>

      <div className="gym-panel-grid">
        <section className="gym-card gym-muscles" aria-label="Estado de los músculos esta semana">
          <div className="gym-section-head">
            <h2 className="gym-h2">Músculos esta semana</h2>
            <span className="gym-muted">Según los entrenamientos desde el lunes</span>
          </div>
          <div className="gym-muscles-top">
            <div className="gym-body-pair">
              <figure>
                <BodyGraph figure={body?.front ?? null} tones={panel.muscleStates} scale="state" height={224} label="Cuerpo de frente con el estado de cada músculo" />
                <figcaption>Frente</figcaption>
              </figure>
              <figure>
                <BodyGraph figure={body?.back ?? null} tones={panel.muscleStates} scale="state" height={224} label="Cuerpo de espalda con el estado de cada músculo" />
                <figcaption>Espalda</figcaption>
              </figure>
            </div>
            <div className="gym-legend">
              {panel.legend.map((row) => (
                <div key={row.state} className="gym-legend-row" data-state={row.state}>
                  <span className="gym-swatch" aria-hidden="true" />
                  <span className="gym-legend-label">{row.label}</span>
                  <span className="gym-legend-count">{row.count}</span>
                </div>
              ))}
              {panel.advice ? <p className="gym-advice">{panel.advice}</p> : null}
            </div>
          </div>
          <div role="list" aria-label="Músculos" className="gym-muscle-list">
            {panel.muscles.map((muscle) => (
              <div role="listitem" key={muscle.key} className="gym-muscle-row" data-state={muscle.state}>
                <span className="gym-dot" aria-hidden="true" />
                <span className="gym-muscle-text">
                  <span className="gym-muscle-name">{muscle.name}</span>
                  <span className="gym-muscle-detail">{muscle.detail}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <div className="gym-panel-side">
          <section className="gym-card gym-heat" aria-label="Días entrenados">
            <div className="gym-section-head gym-section-head--row">
              <div>
                <h2 className="gym-h2">Días entrenados</h2>
                <span className="gym-muted">Últimas 24 semanas. Tocá un día para ver el detalle.</span>
              </div>
              <div className="gym-routine-legend">
                {panel.routineLegend.map((routine) => (
                  <span key={routine.name} className="gym-routine-legend-item" data-color={routine.color}>
                    <span className="gym-swatch gym-swatch--routine" aria-hidden="true" />{routine.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="gym-heat-scroll">
              <div className="gym-heat-letters" aria-hidden="true">
                {DAY_LETTERS.map((letter) => <span key={letter}>{letter}</span>)}
              </div>
              <div className="gym-heat-grid">
                <div className="gym-heat-months" aria-hidden="true">
                  {panel.weeks.map((week, index) => <span key={index}>{week.month}</span>)}
                </div>
                <div className="gym-heat-weeks">
                  {panel.weeks.map((week, index) => (
                    <div key={index} className="gym-heat-week">
                      {week.days.map((day) => (
                        <button
                          key={day.date}
                          type="button"
                          className="gym-heat-day"
                          data-color={day.color ?? undefined}
                          data-level={day.level}
                          data-future={day.future || undefined}
                          data-today={day.today || undefined}
                          data-selected={day.selected || undefined}
                          disabled={day.future}
                          aria-label={day.label}
                          title={day.label}
                          onClick={() => onPickDay(day.date)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="gym-day-detail">
              <div className="gym-day-text">
                <span className="gym-day-date">{panel.day.date}</span>
                {panel.day.has ? (
                  <span className="gym-muted gym-day-routine" data-color={panel.day.color ?? undefined}>
                    <span className="gym-swatch gym-swatch--routine" aria-hidden="true" />{panel.day.routine}
                  </span>
                ) : (
                  <span className="gym-muted">{panel.day.noneText}</span>
                )}
              </div>
              {panel.day.has ? (
                <div className="gym-day-figures">
                  <span><strong>{panel.day.kcal}</strong><small>kcal</small></span>
                  <span><strong>{panel.day.minutes}</strong><small>minutos</small></span>
                  <span><strong>{panel.day.sets}</strong><small>series</small></span>
                </div>
              ) : null}
            </div>
            <span className="gym-heat-key">
              Menos kcal
              <span className="gym-heat-key-cell" data-level="1" aria-hidden="true" />
              <span className="gym-heat-key-cell" data-level="2" aria-hidden="true" />
              <span className="gym-heat-key-cell" data-level="3" aria-hidden="true" />
              Más kcal
              <span className="gym-heat-key-today" aria-hidden="true" />
              Hoy
            </span>
          </section>

          <section className="gym-card gym-bars-card" aria-label="Calorías por día">
            <div className="gym-section-head gym-section-head--row">
              <h2 className="gym-h2">Calorías por día</h2>
              <span className="gym-muted">Últimos 14 días: {panel.calories14} kcal</span>
            </div>
            <div role="list" className="gym-bars">
              {panel.bars.map((bar, index) => (
                <div role="listitem" key={index} aria-label={bar.label} className="gym-bar-cell">
                  <span className="gym-bar-value">{bar.value}</span>
                  <div className="gym-bar" data-color={bar.color ?? undefined} style={{ height: bar.height }} />
                </div>
              ))}
            </div>
            <div className="gym-bar-labels">
              {panel.bars.map((bar, index) => (
                <span key={index} data-today={bar.today || undefined}><span>{bar.letter}</span><span>{bar.day}</span></span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
