import { useEffect, useRef, useState } from 'react'
import { Clock, Pencil, Trash2, Users, X } from 'lucide-react'
import type { NotiaLibrary } from '../../../types/notia'
import type { NutrientRow, RecipeDetail } from '../types/recipesTypes'
import { RecipeVisual } from './RecipeVisual'

const DISARM_DELAY_MS = 3500

interface RecipeDetailSheetProps {
  library: NotiaLibrary
  detail: RecipeDetail
  busy: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}

function NutrientList({ rows }: { rows: NutrientRow[] }) {
  return (
    <div className="rcp-nutrients">
      {rows.map((row) => (
        <div key={row.key} className="rcp-nutrient" data-tone={row.tone} data-limit={row.limit}>
          <div className="rcp-nutrient__top"><span>{row.label}</span><span>{row.amountLabel}</span></div>
          <div className="rcp-nutrient__track"><i style={{ width: `${row.bar}%` }} /></div>
          <div className="rcp-nutrient__percent">{row.percentLabel}</div>
        </div>
      ))}
    </div>
  )
}

/** Panel lateral con la receta completa: energía, nutrientes, ingredientes y pasos. */
export function RecipeDetailSheet({ library, detail, busy, onClose, onEdit, onDelete }: RecipeDetailSheetProps) {
  const [armed, setArmed] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [detail.id])

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), DISARM_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [armed])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="rcp-overlay">
      <div className="rcp-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="rcp-sheet" role="dialog" aria-modal="true" aria-labelledby="rcp-detail-title" data-meal={detail.meal}>
        <div className="rcp-hero">
          <RecipeVisual library={library} id={detail.id} name={detail.name} photoKey={detail.photoKey} hasPhoto={detail.hasPhoto} />
          <button ref={closeRef} type="button" className="rcp-icon-button" aria-label="Cerrar" onClick={onClose}><X size={20} strokeWidth={1.8} /></button>
        </div>
        <div className="rcp-sheet__body">
          <div className="rcp-detail-head">
            <span className="rcp-chip"><span className="rcp-dot" aria-hidden="true" />{detail.mealLabel}</span>
            <h2 id="rcp-detail-title">{detail.name}</h2>
            {detail.description && <p>{detail.description}</p>}
            <div className="rcp-meta">
              {detail.minutesLabel && <span><Clock size={15} strokeWidth={1.8} aria-hidden="true" />{detail.minutesLabel}</span>}
              {detail.servingsLabel && <span><Users size={15} strokeWidth={1.8} aria-hidden="true" />{detail.servingsLabel}</span>}
            </div>
          </div>

          <section className="rcp-energy" aria-label="Energía y macronutrientes">
            <div className="rcp-kcal">
              <span className="rcp-kcal__number">{detail.kcalLabel}</span>
              <span className="rcp-kcal__unit">kcal por porción</span>
              <span className="rcp-kcal__share">{detail.kcalShareLabel}</span>
            </div>
            <div className="rcp-composition" aria-hidden="true">
              {detail.macros.map((share) => <i key={share.key} data-macro={share.key} style={{ width: `${share.percent}%` }} />)}
            </div>
            <div className="rcp-legend">
              {detail.macros.map((share) => (
                <div key={share.key}>
                  <span className="rcp-legend__name"><i data-macro={share.key} />{share.label}</span>
                  <span className="rcp-legend__grams">{share.gramsLabel}</span>
                  <span className="rcp-legend__percent">{share.percentLabel}</span>
                </div>
              ))}
            </div>
            <div className="rcp-extras">
              <span className="rcp-pill">Fibra <b>{detail.fiberLabel}</b></span>
              <span className="rcp-pill">Azúcares <b>{detail.sugarLabel}</b></span>
            </div>
          </section>

          <section className="rcp-section" data-group="vitamins">
            <h3>Vitaminas <small>por porción</small></h3>
            <NutrientList rows={detail.vitamins} />
          </section>
          <section className="rcp-section" data-group="minerals">
            <h3>Minerales <small>por porción</small></h3>
            <NutrientList rows={detail.minerals} />
          </section>

          <section className="rcp-section rcp-two">
            <div>
              <h3>Ingredientes</h3>
              {detail.ingredients.length > 0
                ? <ul className="rcp-ingredients">{detail.ingredients.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>
                : <p className="rcp-hint">Sin ingredientes cargados.</p>}
            </div>
            <div>
              <h3>Preparación</h3>
              {detail.steps.length > 0
                ? <ol className="rcp-steps">{detail.steps.map((line, index) => <li key={`${index}-${line}`}><span>{line}</span></li>)}</ol>
                : <p className="rcp-hint">Sin pasos cargados.</p>}
            </div>
          </section>

          <p className="rcp-foot">
            % VD es el porcentaje del valor diario de referencia para un adulto con una dieta de 2000 kcal. En el sodio, la barra muestra cuánto del límite diario ocupa la porción. Los valores son aproximados{detail.aiReviewed ? ' y los revisó la IA' : ''}. Archivo: {detail.path}.
          </p>
          <div className="rcp-detail-actions">
            <button type="button" className="rcp-button" disabled={busy} onClick={onEdit}><Pencil size={18} strokeWidth={1.8} aria-hidden="true" />Editar receta</button>
            <button
              type="button"
              className="rcp-button rcp-button--danger"
              data-armed={armed}
              disabled={busy}
              onClick={() => (armed ? onDelete() : setArmed(true))}
            >
              <Trash2 size={18} strokeWidth={1.8} aria-hidden="true" />{armed ? 'Confirmar eliminación' : 'Eliminar'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
