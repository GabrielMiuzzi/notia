import { useMemo, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { asRecipesError, createRecipe, updateRecipe } from '../services/recipesService'
import type { FieldError, MealTime, PhotoEdit, RecipeDetail, RecipeInput, RecipesError } from '../types/recipesTypes'
import { useRecipePhoto } from './useRecipes'

/** Campos del formulario (etiquetas y unidades para mostrar; Rust valida). */
export const MEALS: Array<{ meal: MealTime; label: string }> = [
  { meal: 'breakfast', label: 'Desayuno' },
  { meal: 'lunch', label: 'Almuerzo' },
  { meal: 'dinner', label: 'Cena' },
  { meal: 'snack', label: 'Snack' },
]
export type NutrientField = [key: string, label: string, unit: string]
export const MACROS: NutrientField[] = [['kcal', 'Calorías', 'kcal'], ['prot', 'Proteína', 'g'], ['carb', 'Carbohidratos', 'g'], ['grasa', 'Grasas', 'g'], ['fibra', 'Fibra', 'g'], ['azucar', 'Azúcares', 'g']]
export const VITAMINS: NutrientField[] = [['vitA', 'Vitamina A', 'µg'], ['vitC', 'Vitamina C', 'mg'], ['vitD', 'Vitamina D', 'µg'], ['vitE', 'Vitamina E', 'mg'], ['vitK', 'Vitamina K', 'µg'], ['b6', 'Vitamina B6', 'mg'], ['b12', 'Vitamina B12', 'µg'], ['folato', 'Folato (B9)', 'µg']]
export const MINERALS: NutrientField[] = [['calcio', 'Calcio', 'mg'], ['hierro', 'Hierro', 'mg'], ['magnesio', 'Magnesio', 'mg'], ['potasio', 'Potasio', 'mg'], ['zinc', 'Zinc', 'mg'], ['sodio', 'Sodio', 'mg']]
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'
const MAX_PHOTO_BYTES = 15 * 1024 * 1024

export interface RecipeFormState {
  name: string
  meal: MealTime
  minutes: string
  servings: string
  description: string
  ingredients: string
  steps: string
  nutrition: Record<string, string>
}

function initialState(detail: RecipeDetail | null, meal: MealTime | null): RecipeFormState {
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

function toInput(state: RecipeFormState): RecipeInput {
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

/**
 * Estado del formulario de una receta, compartido por el modal de escritorio
 * y la página de la versión celular: lo que se escribe, la foto elegida y el
 * envío a Rust, que valida, revisa con IA las nuevas y rechaza repetidas.
 */
export function useRecipeForm(library: NotiaLibrary, detail: RecipeDetail | null, defaultMeal: MealTime | null, onSaved: (id: string, created: boolean) => void) {
  const editing = detail !== null
  const [state, setState] = useState<RecipeFormState>(() => initialState(detail, defaultMeal))
  const [photoEdit, setPhotoEdit] = useState<PhotoEdit>({ kind: 'keep' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<RecipesError | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const storedPhoto = useRecipePhoto(library, detail?.id ?? '', detail?.photoKey ?? '', Boolean(detail?.hasPhoto))
  const preview = photoEdit.kind === 'replace' ? photoEdit.value : photoEdit.kind === 'remove' ? null : storedPhoto
  const fieldErrors = useMemo(() => new Map((error?.fields ?? []).map((field: FieldError) => [field.field, field.message])), [error])

  const set = (changes: Partial<RecipeFormState>) => {
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

  const removePhoto = () => setPhotoEdit(editing ? { kind: 'remove' } : { kind: 'keep' })

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

  return { editing, state, set, setNutrient, preview, pickPhoto, removePhoto, localError, busy, error, fieldErrors, submit }
}
