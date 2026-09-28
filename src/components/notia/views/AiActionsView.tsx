import { memo } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { AiActionsDashboardView } from '../../../modules/ai-actions/components/AiActionsDashboardView'

function AiActionsViewComponent({ library }: { library: NotiaLibrary | null }) {
  if (!library) return <main className="notia-main ai-actions-view" role="status">Abrí una librería para usar Acciones IA.</main>
  return <AiActionsDashboardView key={library.id} library={library} />
}

export const AiActionsView = memo(AiActionsViewComponent)
AiActionsView.displayName = 'AiActionsView'
