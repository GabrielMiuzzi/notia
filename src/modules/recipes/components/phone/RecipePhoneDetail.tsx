import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, Clock, Ellipsis, Pencil, Trash2, Users } from 'lucide-react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { RecipeDetail } from '../../types/recipesTypes'
import { NutrientList } from '../RecipeDetailSheet'
import { RecipeVisual } from '../RecipeVisual'
import { toggled, type RecipeChecks } from './recipeChecks'

type Tab = 'nutrition' | 'ingredients' | 'steps'
type Sheet = 'menu' | 'confirm' | null

const TABS: Array<{ tab: Tab; label: string }> = [
  { tab: 'nutrition', label: 'Nutrición' },
  { tab: 'ingredients', label: 'Ingredientes' },
  { tab: 'steps', label: 'Preparación' },
]
/** La barra de arriba se vuelve sólida cuando falta esto para terminar la foto. */
const SOLID_BAR_OFFSET_PX = 80

interface RecipePhoneDetailProps {
  library: NotiaLibrary
  detail: RecipeDetail
  busy: boolean
  /** El formulario está abierto encima: Escape es suyo. */
  covered: boolean
  checks: RecipeChecks
  onChecks: (checks: RecipeChecks) => void
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}

/**
 * Receta a pantalla completa de la versión celular: barra que se vuelve
 * sólida al bajar, foto, pestañas Nutrición / Ingredientes / Preparación con
 * ingredientes y pasos para tildar, y la hoja de acciones (editar, eliminar).
 */
export function RecipePhoneDetail({ library, detail, busy, covered, checks, onChecks, onClose, onEdit, onDelete }: RecipePhoneDetailProps) {
  const [tab, setTab] = useState<Tab>('nutrition')
  const [solid, setSolid] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const pageRef = useRef<HTMLElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    backRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (sheet) sheetRef.current?.querySelector('button')?.focus()
  }, [sheet])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || covered) return
      if (sheet) setSheet(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [covered, sheet, onClose])

  const onScroll = () => {
    const page = pageRef.current
    const hero = heroRef.current
    if (page && hero) setSolid(page.scrollTop > hero.offsetHeight - SOLID_BAR_OFFSET_PX)
  }

  const edit = () => {
    setSheet(null)
    onEdit()
  }

  const ingredientsDone = checks.ingredients.length
  const stepsDone = checks.steps.length

  return (
    <>
      <section ref={pageRef} className="rcpm-page rcpm-detail" role="dialog" aria-modal="true" aria-labelledby="rcpm-detail-title" data-meal={detail.meal} inert={covered || sheet !== null} onScroll={onScroll}>
        <div className="rcpm-dbar" data-solid={solid}>
          <button ref={backRef} type="button" className="rcpm-icon-btn" aria-label="Volver" onClick={onClose}><ChevronLeft size={22} strokeWidth={1.8} aria-hidden="true" /></button>
          <span className="rcpm-dbar-title">{detail.name}</span>
          <button type="button" className="rcpm-icon-btn" aria-label="Más opciones" onClick={() => setSheet('menu')}><Ellipsis size={22} strokeWidth={1.8} aria-hidden="true" /></button>
        </div>
        <div ref={heroRef} className="rcpm-hero">
          <RecipeVisual library={library} id={detail.id} name={detail.name} photoKey={detail.photoKey} hasPhoto={detail.hasPhoto} />
        </div>
        <div className="rcpm-dhead">
          <span className="rcp-chip"><span className="rcp-dot" aria-hidden="true" />{detail.mealLabel}</span>
          <h2 id="rcpm-detail-title">{detail.name}</h2>
          {detail.description && <p>{detail.description}</p>}
          <div className="rcpm-meta">
            {detail.minutesLabel && <span><Clock size={14} strokeWidth={1.8} aria-hidden="true" />{detail.minutesLabel}</span>}
            {detail.servingsLabel && <span><Users size={14} strokeWidth={1.8} aria-hidden="true" />{detail.servingsLabel}</span>}
          </div>
        </div>
        <div className="rcpm-tabs">
          <div role="tablist" aria-label="Secciones de la receta">
            {TABS.map((item) => (
              <button key={item.tab} type="button" role="tab" id={`rcpm-tab-${item.tab}`} aria-controls="rcpm-pane" aria-selected={tab === item.tab} onClick={() => setTab(item.tab)}>{item.label}</button>
            ))}
          </div>
        </div>
        <div className="rcpm-pane" id="rcpm-pane" role="tabpanel" aria-labelledby={`rcpm-tab-${tab}`}>
          {tab === 'nutrition' && (
            <>
              <section className="rcpm-energy" aria-label="Energía y macronutrientes">
                <div className="rcpm-kcal"><span className="rcpm-kcal-num">{detail.kcalLabel}</span><span className="rcpm-kcal-unit">kcal</span></div>
                <span className="rcpm-kcal-dv">Por porción, {detail.kcalShareLabel}</span>
                <div className="rcpm-comp" aria-hidden="true">
                  {detail.macros.map((share) => <i key={share.key} data-macro={share.key} style={{ width: `${share.percent}%` }} />)}
                </div>
                <div className="rcpm-legend">
                  {detail.macros.map((share) => (
                    <div key={share.key}>
                      <span className="rcpm-legend-name"><i data-macro={share.key} />{share.label}</span>
                      <span className="rcpm-legend-grams">{share.gramsLabel}</span>
                      <span className="rcpm-legend-pc">{share.shortPercentLabel}</span>
                    </div>
                  ))}
                </div>
                <div className="rcpm-extras">
                  <span className="rcpm-pill">Fibra <b>{detail.fiberAmountLabel}</b> · {detail.fiberDailyLabel}</span>
                  <span className="rcpm-pill">Azúcares <b>{detail.sugarLabel}</b></span>
                </div>
              </section>
              <section className="rcpm-sec" data-group="vitamins">
                <h3>Vitaminas <small>por porción</small></h3>
                <NutrientList rows={detail.vitamins} />
              </section>
              <section className="rcpm-sec" data-group="minerals">
                <h3>Minerales <small>por porción</small></h3>
                <NutrientList rows={detail.minerals} />
              </section>
              <p className="rcpm-foot">
                % VD es el porcentaje del valor diario de referencia para un adulto con una dieta de 2000 kcal. En el sodio, la barra muestra cuánto del límite diario ocupa la porción. Los valores son aproximados{detail.aiReviewed ? ' y los revisó la IA' : ''}.
              </p>
            </>
          )}
          {tab === 'ingredients' && (detail.ingredients.length === 0
            ? <p className="rcpm-none">Sin ingredientes cargados. Podés sumarlos desde Editar receta.</p>
            : (
              <>
                <div className="rcpm-progress">
                  <span>{ingredientsDone} de {detail.ingredients.length} listos</span>
                  {ingredientsDone > 0 && <button type="button" onClick={() => onChecks({ ...checks, ingredients: [] })}>Desmarcar todo</button>}
                </div>
                {detail.ingredients.map((line, index) => (
                  <button key={`${index}-${line}`} type="button" className="rcpm-check" aria-pressed={checks.ingredients.includes(index)} onClick={() => onChecks({ ...checks, ingredients: toggled(checks.ingredients, index) })}>
                    <span className="rcpm-box"><Check size={14} strokeWidth={2.6} aria-hidden="true" /></span>
                    <span>{line}</span>
                  </button>
                ))}
              </>
            ))}
          {tab === 'steps' && (detail.steps.length === 0
            ? <p className="rcpm-none">Sin pasos cargados. Podés sumarlos desde Editar receta.</p>
            : (
              <>
                <div className="rcpm-progress">
                  <span>{stepsDone} de {detail.steps.length} pasos hechos</span>
                  {stepsDone > 0 && <button type="button" onClick={() => onChecks({ ...checks, steps: [] })}>Empezar de nuevo</button>}
                </div>
                {detail.steps.map((line, index) => {
                  const done = checks.steps.includes(index)
                  return (
                    <button key={`${index}-${line}`} type="button" className="rcpm-step" aria-pressed={done} onClick={() => onChecks({ ...checks, steps: toggled(checks.steps, index) })}>
                      <span className="rcpm-step-n">{done ? <Check size={14} strokeWidth={2.6} aria-hidden="true" /> : index + 1}</span>
                      <span>{line}</span>
                    </button>
                  )
                })}
              </>
            ))}
        </div>
      </section>

      {sheet && (
        <div className="rcpm-sheetwrap">
          <div className="rcpm-backdrop" aria-hidden="true" onClick={() => setSheet(null)} />
          <div ref={sheetRef} className="rcpm-asheet" role="dialog" aria-modal="true" aria-labelledby="rcpm-sheet-title">
            <div className="rcpm-grab" aria-hidden="true" />
            {sheet === 'menu' ? (
              <>
                <h3 id="rcpm-sheet-title">{detail.name}</h3>
                <p>{detail.mealLabel}</p>
                <button type="button" className="rcpm-aitem" onClick={edit}><Pencil size={22} strokeWidth={1.8} aria-hidden="true" />Editar receta</button>
                <button type="button" className="rcpm-aitem rcpm-aitem--danger" onClick={() => setSheet('confirm')}><Trash2 size={22} strokeWidth={1.8} aria-hidden="true" />Eliminar receta</button>
              </>
            ) : (
              <>
                <h3 id="rcpm-sheet-title">¿Eliminar “{detail.name}”?</h3>
                <p>Se borra del recetario y no se puede recuperar.</p>
                <button type="button" className="rcpm-abtn rcpm-abtn--danger" disabled={busy} onClick={onDelete}>Eliminar receta</button>
              </>
            )}
            <button type="button" className="rcpm-abtn rcpm-abtn--ghost" disabled={busy} onClick={() => setSheet(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </>
  )
}
