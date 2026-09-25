import { useCallback, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, MessageSquare, RefreshCw } from 'lucide-react'
import type { NotiaLibrary } from '../../../types/notia'
import { useAppDispatch } from '../../../store/hooks'
import { setRightChatPanelOpen } from '../../../features/ui/uiSlice'
import { requestChatComposerText } from '../../../services/chat/chatComposerRequests'
import { getDollarQuotes } from '../services/dollarQuotesService'
import { notifyFinanceDataChanged } from '../services/financeDataEvents'
import { useFinanceResource } from '../hooks/useFinanceResource'
import { formatAmount, formatMonthTitle, formatUpdatedAt } from '../engines/financeFormat'
import { FinanceOverviewTab } from './FinanceOverviewTab'
import { FinanceMovementsTab } from './FinanceMovementsTab'
import { FinanceSalaryTab } from './FinanceSalaryTab'
import { FinanceProductsTab } from './FinanceProductsTab'
import { FinanceDeveloperView } from './FinanceDeveloperView'
import '../styles/finance.css'

type FinanceTab = 'overview' | 'movements' | 'salary' | 'products' | 'dev'

const TABS: Array<{ id: FinanceTab; label: string; short: string }> = [
  { id: 'overview', label: 'Resumen', short: 'Resumen' },
  { id: 'movements', label: 'Movimientos', short: 'Movimientos' },
  { id: 'salary', label: 'Sueldo y ahorro', short: 'Sueldo' },
  { id: 'products', label: 'Productos y tickets', short: 'Productos' },
]

const TICKET_PROMPT = 'Te mando un ticket para cargar en Finanzas.'

function currentMonth(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year, monthNumber - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Finanzas: read-only screen; the assistant loads and changes everything. */
export function FinanceScreen({ library }: { library: NotiaLibrary }) {
  const dispatch = useAppDispatch()
  const [tab, setTab] = useState<FinanceTab>('overview')
  const [month, setMonth] = useState(currentMonth)
  const quotes = useFinanceResource(getDollarQuotes, 'No se pudieron cargar las cotizaciones.')

  const openChat = useCallback((prompt: string | null) => {
    dispatch(setRightChatPanelOpen(true))
    requestChatComposerText(prompt)
  }, [dispatch])
  const refresh = useCallback(() => notifyFinanceDataChanged(), [])
  const showMovements = useCallback(() => setTab('movements'), [])

  const hasMonth = tab === 'overview' || tab === 'movements'
  const title = tab === 'salary' ? 'Sueldo y ahorro' : tab === 'products' ? 'Productos y tickets' : tab === 'dev' ? 'Desarrollo' : formatMonthTitle(month)
  const primaryAction = tab === 'products'
    ? { label: 'Mandar un ticket', prompt: TICKET_PROMPT }
    : { label: 'Cargar con el asistente', prompt: null }
  const oficial = quotes.data?.find((quote) => quote.kind === 'oficial')

  return <main className="notia-main finance-screen">
    <div className="finance-screen__wrap">
      <header className="finance-header">
        <div className="finance-header__main">
          <span className="finance-eyebrow">Finanzas</span>
          <div className="finance-header__title">
            {hasMonth && <IconButton label="Mes anterior" onClick={() => setMonth((value) => shiftMonth(value, -1))}><ChevronLeft size={18} /></IconButton>}
            <h1>{title}</h1>
            {hasMonth && <IconButton label="Mes siguiente" onClick={() => setMonth((value) => shiftMonth(value, 1))}><ChevronRight size={18} /></IconButton>}
          </div>
          {tab === 'overview' && <p className="finance-header__sub finance-only-wide">Lo carga el asistente desde el chat o Telegram. Esta pantalla solo muestra.</p>}
          {tab === 'products' && <p className="finance-header__sub finance-only-wide">Cada ticket que le mandás al asistente suma sus productos con el precio y el comercio.</p>}
        </div>
        <div className="finance-header__actions finance-only-wide">
          {tab === 'overview' && <button type="button" className="finance-button finance-button--ghost" onClick={refresh} aria-label="Actualizar datos"><RefreshCw size={16} aria-hidden="true" />Actualizar</button>}
          <button type="button" className="finance-button finance-button--primary" onClick={() => openChat(primaryAction.prompt)}><MessageSquare size={16} aria-hidden="true" />{primaryAction.label}</button>
        </div>
      </header>

      <nav className="finance-tabs" aria-label="Secciones de Finanzas">
        <div className="finance-tabs__list" role="tablist">
          {TABS.map((item) => <button key={item.id} type="button" role="tab" id={`finance-tab-${item.id}`} aria-controls="finance-tabpanel" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
            <span className="finance-only-wide">{item.label}</span><span className="finance-only-narrow">{item.short}</span>
          </button>)}
          <button type="button" role="tab" id="finance-tab-dev" aria-controls="finance-tabpanel" aria-selected={tab === 'dev'} className="finance-tabs__dev finance-only-wide" onClick={() => setTab('dev')}>Dev</button>
        </div>
        {tab === 'overview' && quotes.data && quotes.data.length > 0 && <div className="finance-tabs__quotes finance-only-wide" aria-label="Dólar venta">
          <span className="finance-mono-label">Dólar venta</span>
          {quotes.data.map((quote) => <span key={quote.kind}>{quote.name} <strong>{formatAmount(quote.sell, 'ARS', 0)}</strong></span>)}
          {oficial && <span>{formatUpdatedAt(oficial.updatedAt)}</span>}
        </div>}
      </nav>

      <section id="finance-tabpanel" role="tabpanel" aria-labelledby={`finance-tab-${tab}`} className="finance-tabpanel">
        {tab === 'overview' && <FinanceOverviewTab library={library} month={month} officialSell={oficial?.sell ?? null} onOpenChat={openChat} onShowMovements={showMovements} />}
        {tab === 'movements' && <FinanceMovementsTab library={library} month={month} onOpenChat={openChat} />}
        {tab === 'salary' && <FinanceSalaryTab library={library} month={month} />}
        {tab === 'products' && <FinanceProductsTab library={library} onOpenChat={openChat} ticketPrompt={TICKET_PROMPT} />}
        {tab === 'dev' && <FinanceDeveloperView library={library} />}
      </section>

      <footer className="finance-footer finance-only-narrow">
        {tab === 'overview' && quotes.data && quotes.data.length > 0 && <div className="finance-footer__quotes">
          <span>{quotes.data.map((quote) => `${quote.name} ${formatAmount(quote.sell, 'ARS', 0)}`).join(' · ')}</span>
          {oficial && <span>{formatUpdatedAt(oficial.updatedAt).split(',')[0]}</span>}
        </div>}
        <button type="button" className="finance-button finance-button--primary finance-button--block" onClick={() => openChat(primaryAction.prompt)}><MessageSquare size={18} aria-hidden="true" />{primaryAction.label}</button>
        <button type="button" className="finance-button finance-button--quiet" aria-pressed={tab === 'dev'} onClick={() => setTab(tab === 'dev' ? 'overview' : 'dev')}>{tab === 'dev' ? 'Volver al resumen' : 'Herramientas de desarrollo'}</button>
      </footer>
    </div>
  </main>
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="finance-icon-button" aria-label={label} onClick={onClick}>{children}</button>
}
