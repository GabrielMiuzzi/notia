/** Loading or error state of a Finanzas tab, with a retry for errors. */
export function FinanceStatus({ isLoading, error, onRetry }: { isLoading: boolean; error: string | null; onRetry: () => void }) {
  if (error) {
    return <div className="finance-alert" role="alert">
      <span>{error}</span>
      <button type="button" className="finance-button finance-button--ghost finance-button--small" onClick={onRetry}>Reintentar</button>
    </div>
  }
  return <p className="finance-status" role="status">{isLoading ? 'Cargando Finanzas…' : 'No hay datos para mostrar.'}</p>
}
