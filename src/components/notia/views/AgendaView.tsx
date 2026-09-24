import { memo } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { AgendaDashboardView } from '../../../modules/agenda/components/AgendaDashboardView'

function AgendaViewComponent({ library }: { library: NotiaLibrary | null }) {
  if (!library) return <main className="notia-main agenda-view" role="status">Abrí una librería para usar la Agenda.</main>
  return <AgendaDashboardView key={library.id} library={library} />
}

export const AgendaView = memo(AgendaViewComponent)
AgendaView.displayName = 'AgendaView'
