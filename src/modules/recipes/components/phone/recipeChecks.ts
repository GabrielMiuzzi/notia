/** Ingredientes y pasos tildados de una receta: estado de pantalla, no se guarda. */
export interface RecipeChecks {
  ingredients: number[]
  steps: number[]
}

export const NO_CHECKS: RecipeChecks = { ingredients: [], steps: [] }

/** La lista con `index` tildado o destildado. */
export function toggled(list: number[], index: number): number[] {
  return list.includes(index) ? list.filter((item) => item !== index) : [...list, index]
}
