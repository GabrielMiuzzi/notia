import { memo } from 'react'

function FinanceViewComponent() {
  return (
    <main className="notia-main notia-finance-view">
      <iframe
        className="notia-finance-webview"
        title="Finanzas personales"
        src="/finance/index.html"
      />
    </main>
  )
}

export const FinanceView = memo(FinanceViewComponent)
FinanceView.displayName = 'FinanceView'
