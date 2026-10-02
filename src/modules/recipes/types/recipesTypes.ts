/** Contrato del recetario: los DTO que arma Rust (`recipes`). */

export type MealTime = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type RecipeSort = 'recent' | 'kcal' | 'protein' | 'name'
export type NutrientTone = 'normal' | 'over' | 'limit'

export interface RecipeQuery {
  meal: MealTime | null
  query: string
  sort: RecipeSort
}

export interface MacroShare {
  key: 'prot' | 'carb' | 'grasa'
  label: string
  initial: string
  gramsLabel: string
  percent: number
  percentLabel: string
  /** «24% kcal», como lo muestra la versión celular. */
  shortPercentLabel: string
}

export interface RecipeCard {
  id: string
  name: string
  meal: MealTime
  mealLabel: string
  kcalLabel: string
  minutesLabel: string | null
  macros: MacroShare[]
  hasPhoto: boolean
  photoKey: string
}

export interface MealFilter {
  meal: MealTime | null
  label: string
  selected: boolean
}

export interface EmptyState {
  title: string
  text: string
  action: 'new' | 'clear'
  actionLabel: string
}

export interface RecipeGrid {
  total: number
  countLabel: string
  /** «8 recetas», como lo muestra la versión celular. */
  shortCountLabel: string
  filters: MealFilter[]
  sort: RecipeSort
  cards: RecipeCard[]
  empty: EmptyState | null
}

export interface NutrientRow {
  key: string
  label: string
  amountLabel: string
  bar: number
  percentLabel: string
  tone: NutrientTone
  limit: boolean
}

/** El formulario tal como se escribe; Rust valida y la IA completa. */
export interface RecipeInput {
  name: string
  meal: MealTime | null
  minutes: number | null
  servings: number | null
  /** Peso de una porción en gramos; el formulario no lo edita y Rust lo conserva. */
  servingGrams?: number | null
  description: string
  ingredients: string[]
  steps: string[]
  nutrition: Record<string, number>
}

export interface RecipeDetail {
  id: string
  name: string
  meal: MealTime
  mealLabel: string
  description: string
  minutesLabel: string | null
  servingsLabel: string | null
  hasPhoto: boolean
  photoKey: string
  kcalLabel: string
  kcalShareLabel: string
  macros: MacroShare[]
  fiberLabel: string
  /** La fibra separada para la versión celular: «10 g» y «36% VD». */
  fiberAmountLabel: string
  fiberDailyLabel: string
  sugarLabel: string
  vitamins: NutrientRow[]
  minerals: NutrientRow[]
  ingredients: string[]
  steps: string[]
  aiReviewed: boolean
  path: string
  form: RecipeInput
}

export type PhotoEdit = { kind: 'keep' } | { kind: 'remove' } | { kind: 'replace'; value: string }

export interface FieldError {
  field: string
  message: string
}

export interface RecipesError {
  code: 'validation' | 'not-found' | 'duplicate' | 'ai' | 'storage'
  message: string
  fields: FieldError[]
  duplicateId: string | null
}
