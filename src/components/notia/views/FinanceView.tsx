import { memo, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { FinanceDashboard } from '../../../modules/finance/components/FinanceDashboard'
import { FinanceDeveloperView } from '../../../modules/finance/components/FinanceDeveloperView'

function FinanceViewComponent({ library }: { library: NotiaLibrary | null }) {
  const [activeTab, setActiveTab] = useState<'home' | 'dev'>('home')
  if (!library) return <main className="notia-main finance-module" role="status">Abrí una librería para usar Finanzas.</main>
  return <main className="notia-main finance-view-shell">
    <nav className="finance-tabs" aria-label="Secciones de Finanzas">
      <button type="button" role="tab" aria-selected={activeTab === 'home'} onClick={() => setActiveTab('home')}>Home</button>
      <button type="button" role="tab" aria-selected={activeTab === 'dev'} onClick={() => setActiveTab('dev')}>Dev</button>
    </nav>
    {activeTab === 'home'
      ? <section className="notia-finance-view" role="tabpanel"><FinanceDashboard library={library} /></section>
      : <section role="tabpanel"><FinanceDeveloperView library={library} /></section>}
  </main>
}

export const FinanceView = memo(FinanceViewComponent)
FinanceView.displayName = 'FinanceView'
