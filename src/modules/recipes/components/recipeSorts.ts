import type { RecipeSort } from '../types/recipesTypes'

/** Los órdenes que ofrece Recetas; Rust ordena. */
export const RECIPE_SORTS: Array<{ sort: RecipeSort; label: string }> = [
  { sort: 'recent', label: 'Más recientes' },
  { sort: 'kcal', label: 'Menos calorías' },
  { sort: 'protein', label: 'Más proteína' },
  { sort: 'name', label: 'Nombre (A–Z)' },
]
