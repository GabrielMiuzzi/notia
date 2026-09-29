import { memo } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { RecipesDashboardView } from '../../../modules/recipes/components/RecipesDashboardView'

function RecipesViewComponent({ library }: { library: NotiaLibrary | null }) {
  if (!library) return <main className="notia-main recipes-view" role="status">Abrí una librería para usar Recetas.</main>
  return <RecipesDashboardView key={library.id} library={library} />
}

export const RecipesView = memo(RecipesViewComponent)
RecipesView.displayName = 'RecipesView'
