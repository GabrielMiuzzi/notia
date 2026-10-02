import { useEffect, useRef } from 'react'
import { Camera, Sparkles } from 'lucide-react'
import type { NotiaLibrary } from '../../../../types/notia'
import { MACROS, MEALS, MINERALS, PHOTO_ACCEPT, VITAMINS, useRecipeForm, type NutrientField } from '../../hooks/useRecipeForm'
import type { MealTime, RecipeDetail } from '../../types/recipesTypes'

interface RecipePhoneFormProps {
  library: NotiaLibrary
  /** The recipe being edited, or none for a new one. */
  detail: RecipeDetail | null
  defaultMeal: MealTime | null
  onClose: () => void
  onSaved: (id: string, created: boolean) => void
  onOpenRecipe: (id: string) => void
}

/**
 * Formulario a pantalla completa de la versión celular: Cancelar / título /
 * Guardar arriba y los campos en una sola columna. Igual que en escritorio,
 * una comida nueva pasa por la revisión con IA y una repetida no se guarda.
 */
export function RecipePhoneForm({ library, detail, defaultMeal, onClose, onSaved, onOpenRecipe }: RecipePhoneFormProps) {
  const { editing, state, set, setNutrient, preview, pickPhoto, removePhoto, localError, busy, error, fieldErrors, submit } = useRecipeForm(library, detail, defaultMeal, onSaved)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  // A rejected save shows its reason: the first wrong field, or the alert on top.
  useEffect(() => {
    if (!error) return
    const invalid = bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (invalid) invalid.focus()
    else bodyRef.current?.scrollTo?.({ top: 0 })
  }, [error])

  const fieldError = (key: string) => fieldErrors.has(key) && <span className="rcpm-errmsg">{fieldErrors.get(key)}</span>

  const nutrientInput = ([key, label, unit]: NutrientField) => (
    <label key={key} className="rcpm-f">
      {label}
      <span className="rcpm-unit">
        <input
          className="rcpm-inp"
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
      {fieldError(key)}
    </label>
  )

  return (
    <section className="rcpm-page rcpm-form" role="dialog" aria-modal="true" aria-labelledby="rcpm-form-title">
      <form className="rcpm-form__el" noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <div className="rcpm-fbar">
          <button type="button" className="rcpm-fbar-btn" disabled={busy} onClick={onClose}>Cancelar</button>
          <h2 id="rcpm-form-title">{editing ? 'Editar receta' : 'Nueva comida'}</h2>
          <button type="submit" className="rcpm-fbar-btn rcpm-fbar-btn--save" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
        <div ref={bodyRef} className="rcpm-fbody">
          {!editing && (
            <p className="rcp-form__ai rcpm-notice" role="status">
              <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
              {busy ? 'Revisando con IA…' : 'Al guardar, la IA revisa la comida y completa lo que falte, sobre todo vitaminas y minerales. Si ya está en tu recetario, no se guarda otra igual.'}
            </p>
          )}
          {error && error.fields.length === 0 && (
            <div className="rcp-form__alert rcpm-notice" role="alert">
              <span>{error.message}</span>
              {error.duplicateId && (
                <button type="button" className="rcp-button rcp-button--small" onClick={() => onOpenRecipe(error.duplicateId as string)}>Ver la receta</button>
              )}
            </div>
          )}
          <fieldset>
            <legend>Foto</legend>
            <label className="rcpm-photo">
              <input type="file" accept={PHOTO_ACCEPT} className="rcp-visually-hidden" onChange={(event) => { pickPhoto(event.target.files?.[0]); event.target.value = '' }} />
              {preview
                ? <img src={preview} alt="Vista previa de la foto" />
                : <span className="rcpm-photo-ph"><Camera size={28} strokeWidth={1.8} aria-hidden="true" />Sacar o elegir una foto</span>}
            </label>
            <div className="rcpm-photo-acts">
              <span className="rcpm-hint">{localError ?? 'Sin foto, se dibuja una ilustración del plato.'}</span>
              {preview && <button type="button" onClick={removePhoto}>Quitar</button>}
            </div>
          </fieldset>
          <fieldset>
            <legend>Datos</legend>
            <label className="rcpm-f">Nombre
              <input className="rcpm-inp" name="name" value={state.name} placeholder="Ej: Tarta de zapallitos" autoComplete="off" enterKeyHint="next" aria-invalid={fieldErrors.has('name')} onChange={(event) => set({ name: event.target.value })} />
              {fieldError('name')}
            </label>
            <div className="rcpm-f" role="radiogroup" aria-label="Momento del día">Momento
              <div className="rcpm-tipos">
                {MEALS.map((option) => (
                  <label key={option.meal} data-meal={option.meal}>
                    <input type="radio" name="rcpm-meal" value={option.meal} checked={state.meal === option.meal} onChange={() => set({ meal: option.meal })} />
                    <span><span className="rcp-dot" aria-hidden="true" />{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="rcpm-two">
              <label className="rcpm-f">Tiempo
                <span className="rcpm-unit"><input className="rcpm-inp" type="number" min={0} inputMode="numeric" placeholder="30" value={state.minutes} aria-invalid={fieldErrors.has('minutes')} onChange={(event) => set({ minutes: event.target.value })} /><em>min</em></span>
                {fieldError('minutes')}
              </label>
              <label className="rcpm-f">Porciones
                <input className="rcpm-inp" type="number" min={1} inputMode="numeric" placeholder="2" value={state.servings} aria-invalid={fieldErrors.has('servings')} onChange={(event) => set({ servings: event.target.value })} />
                {fieldError('servings')}
              </label>
            </div>
            <label className="rcpm-f">Descripción corta
              <input className="rcpm-inp" value={state.description} placeholder="Una línea que la describa" aria-invalid={fieldErrors.has('description')} onChange={(event) => set({ description: event.target.value })} />
              {fieldError('description')}
            </label>
          </fieldset>
          <fieldset>
            <legend>Ingredientes</legend>
            <label className="rcpm-f"><span className="rcp-visually-hidden">Ingredientes</span>
              <textarea className="rcpm-inp" placeholder={'Uno por línea\n200 g de harina\n2 huevos'} value={state.ingredients} aria-invalid={fieldErrors.has('ingredients')} onChange={(event) => set({ ingredients: event.target.value })} />
              {fieldError('ingredients')}
            </label>
          </fieldset>
          <fieldset>
            <legend>Preparación</legend>
            <label className="rcpm-f"><span className="rcp-visually-hidden">Preparación</span>
              <textarea className="rcpm-inp" placeholder={'Un paso por línea\nPrecalentar el horno a 180 °C'} value={state.steps} aria-invalid={fieldErrors.has('steps')} onChange={(event) => set({ steps: event.target.value })} />
              {fieldError('steps')}
            </label>
          </fieldset>
          <fieldset>
            <legend>Nutrición por porción</legend>
            <div className="rcpm-ngrid">{MACROS.map(nutrientInput)}</div>
            <p className="rcpm-hint">Si dejás las calorías vacías, se calculan con proteína, carbohidratos y grasas.{editing ? '' : ' Lo demás que falte lo completa la IA.'}</p>
            <details className="rcpm-details rcpm-details--first"><summary>Vitaminas</summary><div className="rcpm-ngrid">{VITAMINS.map(nutrientInput)}</div></details>
            <details className="rcpm-details"><summary>Minerales</summary><div className="rcpm-ngrid">{MINERALS.map(nutrientInput)}</div></details>
          </fieldset>
        </div>
      </form>
    </section>
  )
}
