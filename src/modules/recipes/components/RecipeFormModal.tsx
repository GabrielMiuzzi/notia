import { useMemo, useState } from 'react'
import { ImageIcon, Sparkles, X } from 'lucide-react'
import { NotiaModalShell } from '../../../components/notia/NotiaModalShell'
import type { NotiaLibrary } from '../../../types/notia'
import { useRecipePhoto } from '../hooks/useRecipes'
import { asRecipesError, createRecipe, updateRecipe } from '../services/recipesService'
import type { FieldError, MealTime, PhotoEdit, RecipeDetail, RecipeInput, RecipesError } from '../types/recipesTypes'

/** Campos del formulario (etiquetas y unidades para mostrar; Rust valida). */
const MEALS: Array<{ meal: MealTime; label: string }> = [
  { meal: 'breakfast', label: 'Desayuno' },
  { meal: 'lunch', label: 'Almuerzo' },
  { meal: 'dinner', label: 'Cena' },
  { meal: 'snack', label: 'Snack' },
]
type NutrientField = [key: string, label: string, unit: string]
const MACROS: NutrientField[] = [['kcal', 'Calorías', 'kcal'], ['prot', 'Proteína', 'g'], ['carb', 'Carbohidratos', 'g'], ['grasa', 'Grasas', 'g'], ['fibra', 'Fibra', 'g'], ['azucar', 'Azúcares', 'g']]
const VITAMINS: NutrientField[] = [['vitA', 'Vitamina A', 'µg'], ['vitC', 'Vitamina C', 'mg'], ['vitD', 'Vitamina D', 'µg'], ['vitE', 'Vitamina E', 'mg'], ['vitK', 'Vitamina K', 'µg'], ['b6', 'Vitamina B6', 'mg'], ['b12', 'Vitamina B12', 'µg'], ['folato', 'Folato (B9)', 'µg']]
const MINERALS: NutrientField[] = [['calcio', 'Calcio', 'mg'], ['hierro', 'Hierro', 'mg'], ['magnesio', 'Magnesio', 'mg'], ['potasio', 'Potasio', 'mg'], ['zinc', 'Zinc', 'mg'], ['sodio', 'Sodio', 'mg']]
const MAX_PHOTO_BYTES = 15 * 1024 * 1024

interface FormState {
  name: string
  meal: MealTime
  minutes: string
  servings: string
  description: string
  ingredients: string
  steps: string
  nutrition: Record<string, string>
}

function initialState(detail: RecipeDetail | null, meal: MealTime | null): FormState {
  const form = detail?.form
  return {
    name: form?.name ?? '',
    meal: form?.meal ?? meal ?? 'lunch',
    minutes: form?.minutes ? String(form.minutes) : '',
    servings: form?.servings ? String(form.servings) : '',
    description: form?.description ?? '',
    ingredients: form?.ingredients.join('\n') ?? '',
    steps: form?.steps.join('\n') ?? '',
    nutrition: Object.fromEntries(Object.entries(form?.nutrition ?? {}).map(([key, value]) => [key, String(value)])),
  }
}

function toInput(state: FormState): RecipeInput {
  const whole = (value: string) => (value.trim() ? Math.round(Number(value.replace(',', '.'))) : null)
  const nutrition: Record<string, number> = {}
  for (const [key, value] of Object.entries(state.nutrition)) {
    if (value.trim()) nutrition[key] = Number(value.replace(',', '.'))
  }
  return {
    name: state.name,
    meal: state.meal,
    minutes: whole(state.minutes),
    servings: whole(state.servings),
    description: state.description,
    ingredients: state.ingredients.split('\n'),
    steps: state.steps.split('\n'),
    nutrition,
  }
}

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
  const editing = detail !== null
  const [state, setState] = useState<FormState>(() => initialState(detail, defaultMeal))
  const [photoEdit, setPhotoEdit] = useState<PhotoEdit>({ kind: 'keep' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<RecipesError | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const storedPhoto = useRecipePhoto(library, detail?.id ?? '', detail?.photoKey ?? '', Boolean(detail?.hasPhoto))
  const preview = photoEdit.kind === 'replace' ? photoEdit.value : photoEdit.kind === 'remove' ? null : storedPhoto
  const fieldErrors = useMemo(() => new Map((error?.fields ?? []).map((field: FieldError) => [field.field, field.message])), [error])

  const set = (changes: Partial<FormState>) => {
    setState((current) => ({ ...current, ...changes }))
    setError(null)
  }
  const setNutrient = (key: string, value: string) => set({ nutrition: { ...state.nutrition, [key]: value } })

  const pickPhoto = (file: File | undefined) => {
    setLocalError(null)
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setLocalError('Elegí un archivo de imagen (JPG, PNG o WebP).')
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setLocalError('La foto tiene que pesar menos de 15 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' && setPhotoEdit({ kind: 'replace', value: reader.result })
    reader.onerror = () => setLocalError('No se pudo leer la imagen. Probá con otro archivo.')
    reader.readAsDataURL(file)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const input = toInput(state)
      const saved = editing && detail
        ? await updateRecipe(library, detail.id, input, photoEdit)
        : await createRecipe(library, input, photoEdit.kind === 'replace' ? photoEdit.value : null)
      onSaved(saved.id, !editing)
    } catch (reason) {
      setError(asRecipesError(reason))
    } finally {
      setBusy(false)
    }
  }

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
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="rcp-visually-hidden" onChange={(event) => { pickPhoto(event.target.files?.[0]); event.target.value = '' }} />
                  Elegir foto
                </label>
                {preview && <button type="button" className="rcp-button rcp-button--ghost" onClick={() => setPhotoEdit(editing ? { kind: 'remove' } : { kind: 'keep' })}>Quitar foto</button>}
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
