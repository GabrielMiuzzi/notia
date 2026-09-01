import { useCallback, useEffect, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { financeErrorMessage } from '../engines/financeError'
import { listFinanceDevTables, queryFinanceDevSql, queryFinanceDevTable, seedFinanceDevData } from '../services/financeService'
import { notifyFinanceDataChanged } from '../services/financeDataEvents'
import type { FinanceDevQueryResult, FinanceDevTable } from '../types/financeTypes'

const PAGE_SIZE = 50

interface QuerySource {
  kind: 'table' | 'sql'
  value: string
  label: string
}

export function FinanceDeveloperView({ library }: { library: NotiaLibrary }) {
  const [tables, setTables] = useState<FinanceDevTable[]>([])
  const [sql, setSql] = useState('SELECT * FROM finance_transactions ORDER BY effective_date DESC')
  const [source, setSource] = useState<QuerySource | null>(null)
  const [result, setResult] = useState<FinanceDevQueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSeeding, setIsSeeding] = useState(false)

  useEffect(() => {
    let isCurrent = true
    void listFinanceDevTables()
      .then((items) => { if (isCurrent) setTables(items) })
      .catch((reason) => { if (isCurrent) setError(financeErrorMessage(reason, 'No se pudieron listar las entidades financieras.')) })
    return () => { isCurrent = false }
  }, [])

  const run = useCallback(async (nextSource: QuerySource, page = 0) => {
    setIsLoading(true)
    setError(null)
    try {
      const nextResult = nextSource.kind === 'table'
        ? await queryFinanceDevTable(library, nextSource.value, page, PAGE_SIZE)
        : await queryFinanceDevSql(library, nextSource.value, page, PAGE_SIZE)
      setSource(nextSource)
      setResult(nextResult)
    } catch (reason) {
      setError(financeErrorMessage(reason, 'No se pudo ejecutar la consulta de desarrollo.'))
    } finally {
      setIsLoading(false)
    }
  }, [library])

  const maxPage = result ? Math.max(0, Math.ceil(result.totalRows / result.pageSize) - 1) : 0

  const seedDemoData = async () => {
    if (!window.confirm('Se cargarán datos demo para julio y agosto de 2026. No se eliminarán ni modificarán datos existentes.')) return
    setIsSeeding(true)
    setError(null)
    try {
      await seedFinanceDevData(library)
      notifyFinanceDataChanged()
      if (source) await run(source, 0)
    } catch (reason) {
      setError(financeErrorMessage(reason, 'No se pudieron cargar los datos demo.'))
    } finally {
      setIsSeeding(false)
    }
  }

  return <section className="finance-module finance-dev" aria-labelledby="finance-dev-title">
    <header className="finance-card finance-dev__header">
      <h1 id="finance-dev-title">Dev · Base de datos financiera</h1>
      <p className="finance-muted">Explorador de solo lectura. La consola acepta una única consulta <code>SELECT</code> o <code>WITH</code>.</p>
      <button type="button" onClick={() => void seedDemoData()} disabled={isLoading || isSeeding}>
        {isSeeding ? 'Cargando datos demoâ€¦' : 'Cargar datos demo (2 meses)'}
      </button>
      <form className="finance-dev__sql" onSubmit={(event) => { event.preventDefault(); void run({ kind: 'sql', value: sql, label: 'Consulta SQL' }) }}>
        <label htmlFor="finance-dev-sql">Consulta SQL</label>
        <textarea id="finance-dev-sql" value={sql} onChange={(event) => setSql(event.target.value)} spellCheck={false} />
        <button type="submit" disabled={isLoading || !sql.trim()}>Ejecutar consulta</button>
      </form>
    </header>

    <section className="finance-card" aria-labelledby="finance-dev-tables-title">
      <h2 id="finance-dev-tables-title">Entidades</h2>
      <div className="finance-dev__tables" aria-label="Entidades financieras">
        {tables.map((table) => <button type="button" key={table.name} onClick={() => void run({ kind: 'table', value: table.name, label: table.name })} disabled={isLoading}>{table.name}</button>)}
      </div>
    </section>

    {error && <p className="finance-error" role="alert">{error}</p>}
    {isLoading && <p className="finance-muted" role="status">Ejecutando consulta…</p>}
    {result && source && <section className="finance-card finance-dev__results" aria-labelledby="finance-dev-results-title">
      <div className="finance-section-heading">
        <h2 id="finance-dev-results-title">{source.label}</h2>
        <span className="finance-muted">{result.totalRows} registro{result.totalRows === 1 ? '' : 's'}</span>
      </div>
      <div className="finance-dev__table-scroll" tabIndex={0}>
        <table>
          <thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
          <tbody>{result.rows.map((row, rowIndex) => <tr key={`${result.page}-${rowIndex}`}>{row.map((value, columnIndex) => <td key={result.columns[columnIndex] ?? columnIndex}>{value ?? <em>NULL</em>}</td>)}</tr>)}</tbody>
        </table>
        {result.rows.length === 0 && <p className="finance-muted">La consulta no devolvió registros.</p>}
      </div>
      <nav className="finance-pagination" aria-label="Paginación de resultados">
        <button type="button" disabled={isLoading || result.page === 0} onClick={() => void run(source, result.page - 1)}>Anterior</button>
        <span>Página {result.page + 1} de {maxPage + 1}</span>
        <button type="button" disabled={isLoading || result.page >= maxPage} onClick={() => void run(source, result.page + 1)}>Siguiente</button>
      </nav>
    </section>}
  </section>
}
