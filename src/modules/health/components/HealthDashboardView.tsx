import { useState } from 'react'
import { X } from 'lucide-react'
import type { NotiaLibrary } from '../../../types/notia'
import { useHealthDashboard } from '../hooks/useHealthDashboard'
import { asHealthError, estimateMeal } from '../services/healthService'
import type { HealthMutation, WeightRange } from '../types/healthTypes'
import { CompositionPanelView, FoodPanelView } from './FoodAndBodyPanels'
import { MealFormView, MeasurementFormView, ProfileFormView, type MealTarget } from './HealthForms'
import { BmiPanelView, ObjectivePanelView, WaterPanelView, WeightPanelView } from './HealthPanels'
import '../styles/health.css'

type Modal = { kind: 'profile' } | { kind: 'measurement' } | { kind: 'meal'; target: MealTarget }

export function HealthDashboardView({ library }: { library: NotiaLibrary }) {
  const { dashboard, status, loadError, updateQuery, reload, apply, generatePlan } = useHealthDashboard(library)
  const [modal, setModal] = useState<Modal | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  /** Un cambio de un panel: el error queda arriba, a la vista. */
  const run = async (mutation: HealthMutation): Promise<boolean> => {
    setActionError(null)
    try {
      await apply(mutation)
      return true
    } catch (reason) {
      setActionError(asHealthError(reason).message)
      return false
    }
  }

  if (!dashboard) {
    return (
      <main className="notia-main health-view">
        <div className="hl-page">
          {status === 'error' ? (
            <div className="hl-state" role="alert">
              <p>{loadError}</p>
              <button type="button" className="hl-button" onClick={() => { void reload() }}>Reintentar</button>
            </div>
          ) : (
            <p className="hl-state" role="status">Cargando…</p>
          )}
        </div>
      </main>
    )
  }

  const today = dashboard.today
  return (
    <main className="notia-main health-view">
      <div className="hl-page">
        <header className="hl-top">
          <div>
            <h1 className="hl-h1">Salud</h1>
            {dashboard.header.chips.length > 0 && (
              <div className="hl-top__chips">
                {dashboard.header.chips.map((chip) => <span key={chip} className="hl-well hl-top__chip">{chip}</span>)}
                {dashboard.header.bmi && <span className="hl-top__chip hl-top__chip--tone" data-tone={dashboard.header.bmi.tone}>{dashboard.header.bmi.label}</span>}
              </div>
            )}
          </div>
          <div className="hl-actions">
            <button type="button" className="hl-button" onClick={() => setModal({ kind: 'profile' })}>{dashboard.hasProfile ? 'Editar perfil' : 'Configurar perfil'}</button>
            {dashboard.hasProfile && <button type="button" className="hl-button hl-button--primary" onClick={() => setModal({ kind: 'measurement' })}>Registrar medición</button>}
          </div>
        </header>

        {actionError && (
          <div className="hl-alert hl-alert--page" role="alert">
            <span>{actionError}</span>
            <button type="button" className="hl-icon-button hl-icon-button--small" aria-label="Cerrar aviso" onClick={() => setActionError(null)}><X size={16} /></button>
          </div>
        )}

        {!dashboard.hasProfile ? (
          <div className="hl-panel hl-welcome">
            <h2 className="hl-mid">Empezá por tu perfil</h2>
            <p className="hl-muted">
              Con tu fecha de nacimiento, altura y peso se calculan tus calorías diarias, el agua que necesitás y tu IMC. Después podés sumar las mediciones de tu balanza.
            </p>
            <div className="hl-actions">
              <button type="button" className="hl-button hl-button--primary" onClick={() => setModal({ kind: 'profile' })}>Configurar perfil</button>
            </div>
          </div>
        ) : (
          <div className="hl-grid">
            {dashboard.bmi && <div className="hl-grid__full"><BmiPanelView panel={dashboard.bmi} /></div>}
            <div className="hl-grid__wide">
              <WeightPanelView
                panel={dashboard.weight}
                today={today}
                onRange={(range) => updateQuery({ weightRange: range as WeightRange })}
                onAdd={(date, kg) => run({ kind: 'addWeight', date, kg })}
                onDelete={(date) => { void run({ kind: 'deleteWeight', date }) }}
              />
            </div>
            <ObjectivePanelView
              key={`${dashboard.objective.targetKg ?? ''}-${dashboard.objective.pace}`}
              panel={dashboard.objective}
              onObjective={(targetKg, pace) => { void run({ kind: 'setObjective', targetKg, pace }) }}
              onGeneratePlan={generatePlan}
              onCalculatePlan={() => apply({ kind: 'calculatePlan' })}
              onClearPlan={() => { void run({ kind: 'clearPlan' }) }}
            />
            {dashboard.food && (
              <div className="hl-grid__wide">
                <FoodPanelView
                  panel={dashboard.food}
                  onDate={(date) => updateQuery({ foodDate: date })}
                  onAdd={(category) => setModal({ kind: 'meal', target: { id: null, date: dashboard.food?.date ?? today, category, values: null } })}
                  onEdit={(meal) => setModal({ kind: 'meal', target: { id: meal.id, date: dashboard.food?.date ?? today, category: null, values: meal.values } })}
                />
              </div>
            )}
            {dashboard.water && (
              <div className="hl-grid__side">
                <WaterPanelView panel={dashboard.water} onAdd={(deltaMl) => { void run({ kind: 'addWater', date: today, deltaMl }) }} />
              </div>
            )}
            <div className="hl-grid__full">
              <CompositionPanelView
                panel={dashboard.composition}
                onNew={() => setModal({ kind: 'measurement' })}
                onDate={(date) => updateQuery({ measurementDate: date })}
                onDelete={(date) => { updateQuery({ measurementDate: null }); void run({ kind: 'deleteMeasurement', date }) }}
              />
            </div>
          </div>
        )}
      </div>

      {modal?.kind === 'profile' && (
        <ProfileFormView dashboard={dashboard} onClose={() => setModal(null)} onSave={(input) => apply({ kind: 'saveProfile', input })} />
      )}
      {modal?.kind === 'measurement' && (
        <MeasurementFormView dashboard={dashboard} onClose={() => setModal(null)} onSave={(input) => apply({ kind: 'saveMeasurement', input })} />
      )}
      {modal?.kind === 'meal' && (
        <MealFormView
          dashboard={dashboard}
          target={modal.target}
          onClose={() => setModal(null)}
          onSave={(id, input) => apply({ kind: 'saveMeal', id, input })}
          onDelete={(id) => apply({ kind: 'deleteMeal', id })}
          onEstimate={(description) => estimateMeal(library, description)}
        />
      )}
    </main>
  )
}
