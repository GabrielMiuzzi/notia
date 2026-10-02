import { ImageIcon, Sparkles, X } from 'lucide-react'
import { NotiaModalShell } from '../../../components/notia/NotiaModalShell'
import type { NotiaLibrary } from '../../../types/notia'
import { MACROS, MEALS, MINERALS, PHOTO_ACCEPT, VITAMINS, useRecipeForm, type NutrientField } from '../hooks/useRecipeForm'
import type { MealTime, RecipeDetail } from '../types/recipesTypes'

interface RecipeFormModalProps {
  library: NotiaLibrary
  /** The recipe being edited, or none for a new one. */
  detail: RecipeDetail | null
  defaultMeal: MealTime | null
  onClose: () => void
  onSaved: (id: string, created: boolean) => void
  onOpenRecipe: (id: string) => void
}

export function RecipeFormModal({ library, detail, defaultMeal, onClose, onSaved, onOpenRecipe }: RecipeFormModalProps) {
  const { editing, state, set, setNutrient, preview, pickPhoto, removePhoto, localError, busy, error, fieldErrors, submit } = useRecipeForm(library, detail, defaultMeal, onSaved)

  const nutrientInput = ([key, label, unit]: NutrientField) => (
    <label key={key} className="rcp-field">
      {label}
      <span className="rcp-unit">
        <input
          className="rcp-input"
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          placeholder="0"
          value={state.nutrition[key] ?? ''}
          aria-invalid={fieldErrors.has(key)}
          onChange={(event) => setNutrient(key, event.target.value)}
        />
        <em>{unit}</em>
      </span>
      {fieldErrors.has(key) && <span className="rcp-error">{fieldErrors.get(key)}</span>}
    </label>
  )

  return (
    <NotiaModalShell open onClose={busy ? () => undefined : onClose} size="lg" panelClassName="rcp-form-panel" panelStyle={{ width: 'min(760px, calc(100vw - 24px))' }}>
      <form className="rcp-form" noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <div className="rcp-form__head">
          <h2>{editing ? 'Editar receta' : 'Nueva comida'}</h2>
          <button type="button" className="rcp-icon-button" aria-label="Cerrar" disabled={busy} onClick={onClose}><X size={20} strokeWidth={1.8} /></button>
        </div>
        <div className="rcp-form__body">
          {!editing && (
            <p className="rcp-form__ai"><Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />Al guardar, la IA revisa la comida y completa lo que falte, sobre todo vitaminas y minerales. Si ya está en tu recetario, no se guarda otra igual.</p>
          )}
          {error && error.fields.length === 0 && (
            <div className="rcp-form__alert" role="alert">
              <span>{error.message}</span>
              {error.duplicateId && (
                <button type="button" className="rcp-button rcp-button--small" onClick={() => onOpenRecipe(error.duplicateId as string)}>Ver la receta</button>
              )}
            </div>
          )}
          <fieldset className="rcp-fieldset">
            <legend>Datos</legend>
            <div className="rcp-row rcp-row--four">
              <label className="rcp-field">Nombre
                <input className="rcp-input" value={state.name} placeholder="Ej: Tarta de zapallitos" aria-invalid={fieldErrors.has('name')} onChange={(event) => set({ name: event.target.value })} />
                {fieldErrors.has('name') && <span className="rcp-error">{fieldErrors.get('name')}</span>}
              </label>
              <label className="rcp-field">Momento
                <select className="rcp-input" value={state.meal} onChange={(event) => set({ meal: event.target.value as MealTime })}>
                  {MEALS.map((option) => <option key={option.meal} value={option.meal}>{option.label}</option>)}
                </select>
              </label>
              <label className="rcp-field">Tiempo
                <span className="rcp-unit"><input className="rcp-input" type="number" min={0} inputMode="numeric" placeholder="30" value={state.minutes} aria-invalid={fieldErrors.has('minutes')} onChange={(event) => set({ minutes: event.target.value })} /><em>min</em></span>
                {fieldErrors.has('minutes') && <span className="rcp-error">{fieldErrors.get('minutes')}</span>}
              </label>
              <label className="rcp-field">Porciones
                <input className="rcp-input" type="number" min={1} inputMode="numeric" placeholder="2" value={state.servings} aria-invalid={fieldErrors.has('servings')} onChange={(event) => set({ servings: event.target.value })} />
                {fieldErrors.has('servings') && <span className="rcp-error">{fieldErrors.get('servings')}</span>}
              </label>
            </div>
            <label className="rcp-field rcp-field--spaced">Descripción corta
              <input className="rcp-input" value={state.description} placeholder="Una línea que la describa" onChange={(event) => set({ description: event.target.value })} />
              {fieldErrors.has('description') && <span className="rcp-error">{fieldErrors.get('description')}</span>}
            </label>
          </fieldset>

          <fieldset className="rcp-fieldset">
            <legend>Foto</legend>
            <div className="rcp-photo">
              <div className="rcp-photo__preview">
                {preview ? <img src={preview} alt="Vista previa de la foto" /> : <ImageIcon size={26} strokeWidth={1.8} aria-hidden="true" />}
              </div>
              <div className="rcp-photo__actions">
                <label className="rcp-button rcp-button--file">
                  <input type="file" accept={PHOTO_ACCEPT} className="rcp-visually-hidden" onChange={(event) => { pickPhoto(event.target.files?.[0]); event.target.value = '' }} />
                  Elegir foto
                </label>
                {preview && <button type="button" className="rcp-button rcp-button--ghost" onClick={removePhoto}>Quitar foto</button>}
                <span className="rcp-hint">{localError ?? 'Sin foto, se muestra una ilustración del plato. Con foto, la IA la usa para revisar la receta.'}</span>
              </div>
            </div>
          </fieldset>

          <fieldset className="rcp-fieldset">
            <legend>Ingredientes y preparación</legend>
            <div className="rcp-row rcp-row--two">
              <label className="rcp-field">Ingredientes
                <textarea className="rcp-input" placeholder={'Uno por línea\n200 g de harina\n2 huevos'} value={state.ingredients} aria-invalid={fieldErrors.has('ingredients')} onChange={(event) => set({ ingredients: event.target.value })} />
                {fieldErrors.has('ingredients') && <span className="rcp-error">{fieldErrors.get('ingredients')}</span>}
              </label>
              <label className="rcp-field">Preparación
                <textarea className="rcp-input" placeholder={'Un paso por línea\nPrecalentar el horno a 180 °C\nMezclar los secos'} value={state.steps} aria-invalid={fieldErrors.has('steps')} onChange={(event) => set({ steps: event.target.value })} />
                {fieldErrors.has('steps') && <span className="rcp-error">{fieldErrors.get('steps')}</span>}
              </label>
            </div>
          </fieldset>

          <fieldset className="rcp-fieldset">
            <legend>Nutrición por porción</legend>
            <div className="rcp-nutrient-grid">{MACROS.map(nutrientInput)}</div>
            <p className="rcp-hint rcp-hint--spaced">{editing ? 'Los valores se guardan como los escribas.' : 'Lo que dejes vacío lo completa la IA; si las calorías quedan vacías, salen de proteína, carbohidratos y grasas.'}</p>
            <details className="rcp-details"><summary>Vitaminas</summary><div className="rcp-nutrient-grid">{VITAMINS.map(nutrientInput)}</div></details>
            <details className="rcp-details"><summary>Minerales</summary><div className="rcp-nutrient-grid">{MINERALS.map(nutrientInput)}</div></details>
          </fieldset>
        </div>
        <div className="rcp-form__foot">
          {busy && !editing && <span className="rcp-form__working" role="status"><Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />Revisando con IA…</span>}
          <button type="button" className="rcp-button rcp-button--ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="rcp-button rcp-button--primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar receta'}</button>
        </div>
      </form>
    </NotiaModalShell>
  )
}
