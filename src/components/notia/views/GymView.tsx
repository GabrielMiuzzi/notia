import { memo } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { GymDashboardView } from '../../../modules/gym/components/GymDashboardView'

function GymViewComponent({ library }: { library: NotiaLibrary | null }) {
  if (!library) return <main className="notia-main gym-view" role="status">Abrí una librería para usar Gimnasio.</main>
  return <GymDashboardView key={library.id} library={library} />
}

export const GymView = memo(GymViewComponent)
GymView.displayName = 'GymView'
