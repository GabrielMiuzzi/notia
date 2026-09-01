import { useCallback, useEffect, useState } from 'react'
import { financeErrorMessage } from '../engines/financeError'
import { getDollarQuotes, type DollarQuote } from '../services/dollarQuotesService'

function formatPrice(value: number): string {
  return value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function DollarQuotesCards() {
  const [quotes, setQuotes] = useState<DollarQuote[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      setQuotes(await getDollarQuotes())
    } catch (reason) {
      setError(financeErrorMessage(reason, 'No se pudieron cargar las cotizaciones.'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return <section className="finance-quotes" aria-label="Cotizaciones del dólar">
    {error && <p className="finance-error" role="alert">{error}</p>}
    <div className="finance-quotes__grid">
      {quotes.map((quote) => <article className="finance-card finance-quote-card" key={quote.kind}>
        <span className="finance-quote-card__name">Dólar {quote.name}</span>
        {isLoading && quotes.length === 0 ? <p className="finance-muted" role="status">Cargando…</p> : <div className="finance-quote-card__prices">
          <div><span>Compra</span><strong>$ {formatPrice(quote.buy)}</strong></div>
          <div><span>Venta</span><strong>$ {formatPrice(quote.sell)}</strong></div>
        </div>}
        <small>Actualizado: {quote.updatedAt}</small>
      </article>)}
      {isLoading && quotes.length === 0 && [1, 2, 3].map((placeholder) => <article className="finance-card finance-quote-card" key={placeholder} aria-hidden="true"><span className="finance-muted">Cargando cotización…</span></article>)}
    </div>
  </section>
}
