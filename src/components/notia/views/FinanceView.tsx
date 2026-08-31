import { memo } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import { FinanceDashboard } from '../../../modules/finance/components/FinanceDashboard'
import { ChatWorkspaceView } from './chat/ChatWorkspaceView'

function FinanceViewComponent({ library, aiPreferences }: { library: NotiaLibrary | null; aiPreferences: AiPreferences }) {
  if (!library) return <main className="notia-main finance-module" role="status">Abrí una librería para usar Finanzas.</main>
  return <main className="notia-main notia-finance-view"><FinanceDashboard library={library} /><section className="finance-chat-panel"><ChatWorkspaceView agentScope="finance" library={library} aiPreferences={aiPreferences} title="Chat financiero" description="Consultá tus saldos y registrá movimientos con confirmación." suggestions={["¿Cuánto gasté este mes?", "Registrar un aporte de ahorro", "¿Cuál es mi saldo?"]} showHistoryPanel={false} /></section></main>
}

export const FinanceView = memo(FinanceViewComponent)
FinanceView.displayName = 'FinanceView'
