import { memo } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { HomeDashboardView } from './home/HomeDashboardView'

function HomeViewComponent({ library }: { library: NotiaLibrary | null }) {
  if (!library) return <main className="notia-main home-view home-view--empty" role="status">Abrí una librería para ver el inicio.</main>
  return <HomeDashboardView key={library.id} library={library} />
}

export const HomeView = memo(HomeViewComponent)
HomeView.displayName = 'HomeView'
