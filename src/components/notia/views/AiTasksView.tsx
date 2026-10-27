import { memo } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { AiTasksView as AiTasksModuleView } from '../../../modules/ai-tasks/components/AiTasksView'

function AiTasksViewComponent({ library }: { library: NotiaLibrary | null }) {
  if (!library) return <main className="notia-main ai-tasks-view" role="status">Abrí una librería para usar Tareas IA.</main>
  return <AiTasksModuleView key={library.id} library={library} />
}

export const AiTasksView = memo(AiTasksViewComponent)
AiTasksView.displayName = 'AiTasksView'
