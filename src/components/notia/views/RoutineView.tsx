import { memo } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { RoutineDashboardView } from '../../../modules/routine/components/RoutineDashboardView'

function RoutineViewComponent({ library }: { library: NotiaLibrary | null }) {
  if (!library) return <main className="notia-main routine-view" role="status">Abrí una librería para usar Rutina.</main>
  return <RoutineDashboardView key={library.id} library={library} />
}

export const RoutineView = memo(RoutineViewComponent)
RoutineView.displayName = 'RoutineView'
