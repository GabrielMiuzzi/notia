import type { NotiaLibrary } from '../../../types/notia'
import { useRecipePhoto } from '../hooks/useRecipes'
import { PlateIllustration } from './PlateIllustration'

interface RecipeVisualProps {
  library: NotiaLibrary
  id: string
  name: string
  photoKey: string
  hasPhoto: boolean
}

/** La foto de la receta, o la ilustración del plato mientras no hay foto. */
export function RecipeVisual({ library, id, name, photoKey, hasPhoto }: RecipeVisualProps) {
  const photo = useRecipePhoto(library, id, photoKey, hasPhoto)
  if (photo) return <img src={photo} alt={`Foto de ${name}`} loading="lazy" />
  return <PlateIllustration seed={id} label={name} />
}
