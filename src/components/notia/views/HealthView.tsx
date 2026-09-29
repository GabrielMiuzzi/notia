import { memo } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { HealthDashboardView } from '../../../modules/health/components/HealthDashboardView'

function HealthViewComponent({ library }: { library: NotiaLibrary | null }) {
  if (!library) return <main className="notia-main health-view" role="status">Abrí una librería para usar Salud.</main>
  return <HealthDashboardView key={library.id} library={library} />
}

export const HealthView = memo(HealthViewComponent)
HealthView.displayName = 'HealthView'
