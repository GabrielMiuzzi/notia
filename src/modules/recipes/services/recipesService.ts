import { callBackend, subscribeBackend, type Unsubscribe } from '../../../services/transport'
import type { NotiaLibrary } from '../../../types/notia'
import type { PhotoEdit, RecipeDetail, RecipeGrid, RecipeInput, RecipeQuery, RecipesError } from '../types/recipesTypes'

/** Rust avisa con el id de la biblioteca cuando cambian las recetas. */
export const RECIPES_CHANGED_EVENT = 'notia://recipes-changed'
/** Telegram cambió datos de la biblioteca (puede haber cargado una receta). */
const TELEGRAM_LIBRARY_CHANGED_EVENT = 'notia://telegram-library-changed'

const context = (library: NotiaLibrary) => ({ libraryId: library.id })

export function getRecipeGrid(library: NotiaLibrary, query: RecipeQuery): Promise<RecipeGrid> {
  return callBackend<RecipeGrid>('recipes_grid', { context: context(library), query })
}

export function getRecipeDetail(library: NotiaLibrary, id: string): Promise<RecipeDetail> {
  return callBackend<RecipeDetail>('recipes_detail', { context: context(library), id })
}

export function getRecipePhoto(library: NotiaLibrary, id: string): Promise<string | null> {
  return callBackend<string | null>('recipes_photo', { context: context(library), id })
}

/** Rust la revisa con IA antes de guardarla y rechaza una comida repetida. */
export function createRecipe(library: NotiaLibrary, input: RecipeInput, photo: string | null): Promise<{ id: string }> {
  return callBackend('recipes_create', { context: context(library), input, photo })
}

export function updateRecipe(library: NotiaLibrary, id: string, input: RecipeInput, photo: PhotoEdit): Promise<{ id: string }> {
  return callBackend('recipes_update', { context: context(library), id, input, photo })
}

export function deleteRecipe(library: NotiaLibrary, id: string): Promise<void> {
  return callBackend('recipes_delete', { context: context(library), id })
}

export async function subscribeToRecipes(library: NotiaLibrary, listener: () => void): Promise<Unsubscribe> {
  const onEvent = (libraryId: unknown) => {
    if (libraryId === library.id) listener()
  }
  const stops = await Promise.all([
    subscribeBackend(RECIPES_CHANGED_EVENT, onEvent),
    subscribeBackend(TELEGRAM_LIBRARY_CHANGED_EVENT, onEvent),
  ])
  return () => stops.forEach((stop) => stop())
}

export function asRecipesError(reason: unknown): RecipesError {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') {
    const error = reason as Partial<RecipesError>
    return { code: error.code ?? 'storage', message: reason.message, fields: error.fields ?? [], duplicateId: error.duplicateId ?? null }
  }
  const message = typeof reason === 'string' && reason.trim() ? reason : 'No se pudo completar la operación de Recetas.'
  return { code: 'storage', message, fields: [], duplicateId: null }
}
