import { memo } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { FinanceScreen } from '../../../modules/finance/components/FinanceScreen'

function FinanceViewComponent({ library }: { library: NotiaLibrary | null }) {
  if (!library) return <main className="notia-main finance-screen finance-screen--empty" role="status">Abrí una librería para usar Finanzas.</main>
  return <FinanceScreen library={library} />
}

export const FinanceView = memo(FinanceViewComponent)
FinanceView.displayName = 'FinanceView'
