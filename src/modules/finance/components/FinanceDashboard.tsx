import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { Plus, RefreshCw } from "lucide-react";
import { useConfirmationEngine } from "../../../context/confirmation/useConfirmationEngine";
import type { NotiaLibrary } from "../../../types/notia";
import {
  getFinanceDashboard,
  saveFinanceAccount,
  saveFinanceCategory,
  saveFinanceSavingsReserve,
  linkFinanceSavingsAccount,
  deleteFinanceAccount,
  deleteFinanceCategory,
  deleteFinanceTransaction,
  applyFinanceUiChange,
  getFinanceDashboardInsights,
  getFinanceRelationAudit,
  type FinanceDashboardInsights,
} from "../services/financeService";
import type {
  FinanceAccount,
  FinanceCategory,
  FinanceDashboard as DashboardData,
  FinanceTransaction,
  FinanceSavingsMovement,
  FinanceSavingsReserve,
} from "../types/financeTypes";
import { financeErrorMessage } from "../engines/financeError";
import { FinanceRecordsPanel } from "./FinanceRecordsPanel";
import { DollarQuotesCards } from "./DollarQuotesCards";
import { subscribeToFinanceDataChanges } from "../services/financeDataEvents";
import { getDollarQuotes } from "../services/dollarQuotesService";
import type { FinanceRelationAudit } from "../types/financeViews";

interface FinanceDashboardProps {
  library: NotiaLibrary;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
function historyStartPeriod(endPeriod: string) {
  const [year, month] = endPeriod.split("-").map(Number);
  return new Date(Date.UTC(year, month - 12, 1)).toISOString().slice(0, 7);
}
function formatAmount(value: string, currency = "ARS") {
  return `${currency} ${Number(value || 0).toLocaleString("es-AR")}`;
}
function formatTotals(totals: Record<string, string>) {
  const entries = Object.entries(totals);
  return entries.length === 0
    ? "—"
    : entries
        .map(([currency, value]) => formatPreciseAmount(value, currency))
        .join(" · ");
}

function formatPreciseAmount(value: string, currency = "ARS") {
  const number = Number(value || 0);
  return `${currency} ${Number.isFinite(number) ? number.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value}`;
}

function formatRates(values: Record<string, string | null>) {
  const entries = Object.entries(values).filter(([, value]) => value !== null);
  return entries.length === 0 ? "—" : entries.map(([currency, value]) => `${currency} ${value}%`).join(" · ");
}

/** Debt over income per currency, as the backend computed it. */
function formatRatios(ratios: FinanceDashboardInsights["debtRatio"]["ratios"]) {
  if (ratios.length === 0) return "—";
  const percent = (value: number) => `${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
  return ratios.length === 1
    ? percent(ratios[0].percentage)
    : ratios.map(({ currency, percentage }) => `${currency} ${percent(percentage)}`).join(" · ");
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
}

export function FinanceDashboard({ library }: FinanceDashboardProps) {
  const { confirm } = useConfirmationEngine();
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingsReserveFilter, setSavingsReserveFilter] = useState("");
  const [savingsCurrencyFilter, setSavingsCurrencyFilter] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAccountFormOpen, setIsAccountFormOpen] = useState(false);
  const [isCategoryFormOpen, setIsCategoryFormOpen] = useState(false);
  const [isSavingsFormOpen, setIsSavingsFormOpen] = useState(false);
  const [isQuickSavingsOpen, setIsQuickSavingsOpen] = useState(false);
  const [isQuickExpenseOpen, setIsQuickExpenseOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinanceAccount | null>(null);
  const [editingCategory, setEditingCategory] = useState<FinanceCategory | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<FinanceTransaction | null>(null);
  const [transactionPage, setTransactionPage] = useState(0);
  const [dollarRate, setDollarRate] = useState<number | null>(null);
  const [summaryView, setSummaryView] = useState<"day" | "week" | "month">("day");
  const [summaryDate, setSummaryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [transactionSearch, setTransactionSearch] = useState("");
  const [transactionCategoryFilter, setTransactionCategoryFilter] = useState("");
  const [transactionCurrencyFilter, setTransactionCurrencyFilter] = useState("");
  const [transactionStatusFilter, setTransactionStatusFilter] = useState("");
  const [transactionAccountFilter, setTransactionAccountFilter] = useState("");
  const [transactionSourceFilter, setTransactionSourceFilter] = useState("");
  const [transactionServiceFilter, setTransactionServiceFilter] = useState("");

  const moveMonth = (offset: number) => {
    const [year, monthNumber] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
    setMonth(date.toISOString().slice(0, 7));
  };

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await getFinanceDashboard(library, month));
    } catch (reason) {
      setError(financeErrorMessage(reason, "No se pudo cargar Finanzas."));
    } finally {
      setIsLoading(false);
    }
  }, [library, month]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => subscribeToFinanceDataChanges(() => {
    void refresh();
  }), [refresh]);
  useEffect(() => {
    let active = true;
    void getDollarQuotes().then((quotes) => {
      if (active) setDollarRate(quotes.find((quote) => quote.kind === "oficial")?.sell ?? null);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [library]);

  const [insights, setInsights] = useState<FinanceDashboardInsights | null>(null);
  const [relationAudit, setRelationAudit] = useState<FinanceRelationAudit | null>(null);
  useEffect(() => setTransactionPage(0), [month, transactionAccountFilter, transactionCategoryFilter, transactionCurrencyFilter, transactionSearch, transactionServiceFilter, transactionSourceFilter, transactionStatusFilter]);
  useEffect(() => {
    if (summaryDate.slice(0, 7) !== month) setSummaryDate(`${month}-01`);
  }, [month, summaryDate]);
  // The backend filters the movements, totals them and summarizes the chosen
  // period; `data` changes after every reload, so they are requested again.
  useEffect(() => {
    let isCurrent = true;
    if (!data) { setInsights(null); setRelationAudit(null); return; }
    void getFinanceDashboardInsights(library, {
      month,
      summaryView,
      summaryDate,
      page: transactionPage,
      dollarRate,
      filters: {
        search: transactionSearch,
        categoryId: transactionCategoryFilter,
        currency: transactionCurrencyFilter,
        status: transactionStatusFilter,
        accountId: transactionAccountFilter,
        source: transactionSourceFilter,
        serviceId: transactionServiceFilter,
      },
      savingsFilters: { reserveId: savingsReserveFilter, currency: savingsCurrencyFilter },
    }).then((value) => { if (isCurrent) setInsights(value); }).catch(() => { if (isCurrent) setInsights(null); });
    void getFinanceRelationAudit(library, month).then((audit) => { if (isCurrent) setRelationAudit(audit); }).catch(() => { if (isCurrent) setRelationAudit(null); });
    return () => { isCurrent = false; };
  }, [data, dollarRate, library, month, savingsCurrencyFilter, savingsReserveFilter, summaryDate, summaryView, transactionAccountFilter, transactionCategoryFilter, transactionCurrencyFilter, transactionPage, transactionSearch, transactionServiceFilter, transactionSourceFilter, transactionStatusFilter]);
  const dailySummary = insights?.summary ?? null;

  async function submitTransaction(transaction: FinanceTransaction) {
    await applyFinanceUiChange(library, { kind: "create-transaction", transaction });
    setIsFormOpen(false);
    await refresh();
  }

  if (isLoading && !data)
    return (
      <section className="finance-module finance-dashboard" role="status">
        Cargando Finanzas…
      </section>
    );
  return (
    <section className="finance-module finance-dashboard">
      <header className="finance-header finance-header--compact">
        <div className="finance-actions">
          <label>
            Mes{" "}
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          <button type="button" aria-label="Mes anterior" onClick={() => moveMonth(-1)}>‹</button>
          <button type="button" aria-label="Mes siguiente" onClick={() => moveMonth(1)}>›</button>
          <button type="button" onClick={() => setIsAccountFormOpen(true)}>
            <Plus size={18} /> Nueva cuenta
          </button>
          <button type="button" onClick={() => setIsCategoryFormOpen(true)}>
            <Plus size={18} /> Nueva categoría
          </button>
          <button type="button" onClick={() => setIsFormOpen(true)}>
            <Plus size={18} /> Nuevo movimiento
          </button>
          <button type="button" onClick={() => setIsQuickExpenseOpen(true)}>
            <Plus size={18} /> Registrar gasto
          </button>
          <button type="button" disabled={!data?.savings.some((reserve) => reserve.active)} onClick={() => setIsQuickSavingsOpen(true)}>
            <Plus size={18} /> Registrar ahorro
          </button>
          <button
            type="button"
            aria-label="Actualizar"
            onClick={() => void refresh()}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </header>
      <DollarQuotesCards />
      {error && (
        <div className="finance-error" role="alert">
          {error}
        </div>
      )}
      {data && (
        <div className="finance-dashboard-content">
          {dailySummary && <section className="finance-card finance-daily-summary" aria-labelledby="finance-daily-summary-title">
            <div className="finance-section-heading">
              <div>
                <h2 id="finance-daily-summary-title">Resumen de gastos y ahorro</h2>
                <p className="finance-muted">Información registrada; no representa saldos reales de cuentas.</p>
              </div>
              <div className="finance-actions">
                <label>Vista <select value={summaryView} onChange={(event) => setSummaryView(event.target.value as typeof summaryView)}><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option></select></label>
                {summaryView === "month" ? <input aria-label="Mes del resumen" type="month" value={month} onChange={(event) => { setMonth(event.target.value); setSummaryDate(`${event.target.value}-01`); }} /> : <input aria-label="Fecha del resumen" type="date" value={summaryDate} onChange={(event) => { setSummaryDate(event.target.value); setMonth(event.target.value.slice(0, 7)); }} />}
              </div>
            </div>
            <div className="finance-metrics finance-daily-summary__metrics">
              <article><span>Gastos registrados</span><strong>{formatTotals(dailySummary.expenseByCurrency)}</strong><small className="finance-muted">{dailySummary.coverage.includedExpenses} confirmado(s)</small></article>
              <article><span>Ahorro neto del período</span><strong>{formatTotals(dailySummary.savings.netByCurrency)}</strong><small className="finance-muted">Aportes + rendimientos − retiros − pérdidas</small></article>
              <article><span>Reservas acumuladas</span><strong>{formatTotals(dailySummary.savings.reserveBalancesByCurrency)}</strong><small className="finance-muted">No es saldo disponible de cuentas</small></article>
              <article><span>Tasa de ahorro registrada</span><strong>{formatRates(dailySummary.savingsRateByCurrency)}</strong><small className="finance-muted">Aportes confirmados sobre ingresos del período.</small></article>
            </div>
            <div className="finance-grid">
              <article><h3>Gastos por categoría</h3>{dailySummary.expenseByCategory.length === 0 ? <p className="finance-muted">No hay gastos confirmados en el período.</p> : <ul className="finance-category-list">{dailySummary.expenseByCategory.map((item) => { const variation = insights?.categoryVariation[`${item.categoryId ?? "uncategorized"}:${item.currency}`]; return <li key={`${item.categoryId ?? "uncategorized"}-${item.currency}`}><span>{item.categoryName}<small>{item.count} movimiento(s){variation !== undefined && (variation === null ? " · nuevo en el período" : ` · ${variation >= 0 ? "+" : ""}${variation.toLocaleString("es-AR", { maximumFractionDigits: 1 })}% vs. período anterior`)}</small></span><strong>{formatPreciseAmount(item.amount, item.currency)}</strong></li> })}</ul>}</article>
              <article><h3>Movimientos de ahorro</h3>{dailySummary.savings.movementCount === 0 ? <p className="finance-muted">No hay movimientos de ahorro confirmados.</p> : <ul className="finance-category-list">{(["contribution", "withdrawal", "return", "loss", "adjustment"] as const).flatMap((kind) => Object.entries(dailySummary.savings.byCurrency).map(([currency, values]) => ({ kind, currency, value: values[kind] })).filter((item) => item.value !== "0.00")).map((item) => <li key={`${item.kind}-${item.currency}`}><span>{item.kind === "contribution" ? "Aportes" : item.kind === "withdrawal" ? "Retiros" : item.kind === "return" ? "Rendimientos" : item.kind === "loss" ? "Pérdidas" : "Ajustes"}</span><strong>{formatPreciseAmount(item.value, item.currency)}</strong></li>)}</ul>}</article>
            </div>
            {(dailySummary.coverage.pendingTransactions > 0 || dailySummary.coverage.uncategorizedExpenses > 0 || dailySummary.coverage.invalidTransactionAmounts > 0 || dailySummary.coverage.invalidSavingsAmounts > 0 || data.transactionsTruncated || data.savingsMovementsTruncated) && <p className="finance-warning" role="status">Revisión necesaria: {dailySummary.coverage.pendingTransactions ? `${dailySummary.coverage.pendingTransactions} pendiente(s)` : ""}{dailySummary.coverage.uncategorizedExpenses ? ` · ${dailySummary.coverage.uncategorizedExpenses} sin categoría` : ""}{dailySummary.coverage.invalidTransactionAmounts || dailySummary.coverage.invalidSavingsAmounts ? " · hay importes inválidos excluidos" : ""}{data.transactionsTruncated ? " · el listado de movimientos está limitado" : ""}{data.savingsMovementsTruncated ? " · el listado de ahorro está limitado" : ""}</p>}
          </section>}
          <section className="finance-grid">
            <article className="finance-card finance-expenses-card">
              <h2>Gastos por categoría</h2>
              {(insights?.expensesByCategory ?? []).length === 0 ? (
                <p className="finance-muted">
                  Todavía no hay gastos confirmados.
                </p>
              ) : (
                <ul className="finance-category-list">
                  {(insights?.expensesByCategory ?? []).map(({ name, amount }) => (
                    <li key={name}>
                      <span>{name}</span>
                      <strong>
                        {formatAmount(amount)}
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </article>
            <article className="finance-card finance-accounts-card">
              <h2>Cuentas de pago</h2>
              <p className="finance-muted">Identifican de dónde entró o salió el dinero; no llevan saldo.</p>
              {data.accounts.length === 0 ? (
                <p className="finance-muted">Creá una cuenta para comenzar.</p>
              ) : (
                <ul className="finance-category-list">
                  {data.accounts
                    .filter((account) => account.active)
                    .map((account) => (
                      <li key={account.id}>
                        <span>
                          {account.name}
                          <small>{account.accountType} · {account.currency}</small>
                        </span>
                        <span className="finance-row-actions">
                          <button type="button" onClick={() => setEditingAccount(account)}>Editar</button>
                          <button type="button" onClick={async () => { if (window.confirm(`¿Desactivar ${account.name}?`)) { await deleteFinanceAccount(library, account.id); await refresh(); } }}>Desactivar</button>
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </article>
          </section>
          <section className="finance-metrics" aria-label="Totales del mes">
            <article>
              <span>Gastos</span>
              <strong>{formatTotals(data.expenseByCurrency)}</strong>
            </article>
            <article>
              <span>Ahorro / sueldo</span>
              <strong>{formatPercent(insights?.savingsToIncome)}</strong>
              <small className="finance-muted">Saldo de ahorro respecto del sueldo en la misma moneda.</small>
            </article>
            <article>
              <span>Resultado neto</span>
              <strong>{formatTotals(data.netByCurrency)}</strong>
            </article>
            <article>
              <span>Deuda / sueldo</span>
              <strong>{formatRatios(insights?.debtRatio.ratios ?? [])}</strong>
              <small className="finance-muted">
                {(insights?.debtRatio.period ?? month) === month
                  ? "Tarjetas y deudas registradas contra el sueldo del mes."
                  : `Último período con datos: ${insights?.debtRatio.period}.`}
              </small>
            </article>
          </section>
          {(insights?.pendingCount ?? 0) > 0 && <section className="finance-card finance-pending" role="status"><h2>Cargas pendientes</h2><p>{insights?.pendingCount} operaciones esperan revisión.</p></section>}
          <section className="finance-card">
            <h2>Movimientos recientes</h2>
            <div className="finance-form-row" aria-label="Filtros de movimientos">
              <label>Buscar<input value={transactionSearch} onChange={(event) => setTransactionSearch(event.target.value)} placeholder="Descripción u origen" /></label>
              <label>Categoría<select value={transactionCategoryFilter} onChange={(event) => setTransactionCategoryFilter(event.target.value)}><option value="">Todas</option>{data.categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label>Moneda<select value={transactionCurrencyFilter} onChange={(event) => setTransactionCurrencyFilter(event.target.value)}><option value="">Todas</option><option value="ARS">ARS</option><option value="USD">USD</option></select></label>
              <label>Estado<select value={transactionStatusFilter} onChange={(event) => setTransactionStatusFilter(event.target.value)}><option value="">Todos</option><option value="confirmed">Confirmado</option><option value="corrected">Corregido</option><option value="pending">Pendiente</option><option value="discarded">Descartado</option></select></label>
              <label>Cuenta<select value={transactionAccountFilter} onChange={(event) => setTransactionAccountFilter(event.target.value)}><option value="">Todas</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
              <label>Origen<select value={transactionSourceFilter} onChange={(event) => setTransactionSourceFilter(event.target.value)}><option value="">Todos</option>{(insights?.sources ?? []).map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
              <label>Servicio<select value={transactionServiceFilter} onChange={(event) => setTransactionServiceFilter(event.target.value)}><option value="">Todos</option>{(insights?.serviceIds ?? []).map((serviceId) => <option key={serviceId} value={serviceId}>{serviceId}</option>)}</select></label>
            </div>
            {(insights?.transactionCount ?? 0) === 0 ? (
              <p className="finance-muted">
                No hay movimientos en este período.
              </p>
            ) : (
              <div className="finance-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Descripción</th>
                      <th>Tipo</th>
                      <th>Importe</th>
                      <th>Estado</th>
                      <th>Origen</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(insights?.transactions ?? []).map((item) => (
                      <tr key={item.id}>
                        <td>{item.effectiveDate}</td>
                        <td><span>{item.description || "Sin descripción"}</span><small className="finance-table-secondary">{data.accounts.find((account) => account.id === item.accountId)?.name ?? "Cuenta no disponible"} · {data.categories.find((category) => category.id === item.categoryId)?.name ?? "Sin categoría"}{item.serviceId ? ` · Servicio ${item.serviceId}` : ""} · {item.sourceArtifactId ? "Con evidencia" : "Sin evidencia"}</small></td>
                        <td>{item.transactionType}</td>
                        <td>{formatAmount(item.amount, item.currency)}</td>
                        <td>{item.status}</td>
                        <td>{item.source}</td>
                        <td className="finance-row-actions">
                          <button type="button" onClick={() => setEditingTransaction(item)}>Editar</button>
                          {item.status === "pending" && <button type="button" onClick={async () => { await applyFinanceUiChange(library, { kind: "confirm-transaction", id: item.id }); await refresh(); }}>Confirmar</button>}
                          {item.status !== "discarded" && <button type="button" onClick={async () => { await applyFinanceUiChange(library, { kind: "discard-transaction", id: item.id }); await refresh(); }}>Descartar</button>}
                          <button type="button" onClick={async () => { if (window.confirm("¿Eliminar lógicamente este movimiento?")) { await deleteFinanceTransaction(library, item.id); await refresh(); } }}>Eliminar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {insights && insights.pageCount > 1 && <nav className="finance-pagination" aria-label="Páginas de movimientos"><button type="button" disabled={insights.page === 0} onClick={() => setTransactionPage(Math.max(0, insights.page - 1))}>Anterior</button><span>Página {insights.page + 1} de {insights.pageCount}</span><button type="button" disabled={insights.page + 1 >= insights.pageCount} onClick={() => setTransactionPage(insights.page + 1)}>Siguiente</button></nav>}
           </section>
        </div>)}
       {data && (
        <section className="finance-card">
          <div className="finance-section-heading">
            <h2>Ahorro con saldo</h2>
            <button type="button" onClick={() => setIsSavingsFormOpen(true)}>
              <Plus size={18} /> Nueva reserva
            </button>
          </div>
          {data.savings.length === 0 ? (
            <p className="finance-muted">
              Creá una reserva para separar tu ahorro de los gastos.
            </p>
          ) : (
            <><div className="finance-actions"><label>Reserva<select value={savingsReserveFilter} onChange={(event) => setSavingsReserveFilter(event.target.value)}><option value="">Todas</option>{data.savings.map((reserve) => <option key={reserve.id} value={reserve.id}>{reserve.name}</option>)}</select></label><label>Moneda<select value={savingsCurrencyFilter} onChange={(event) => setSavingsCurrencyFilter(event.target.value)}><option value="">Todas</option><option value="ARS">ARS</option><option value="USD">USD</option></select></label></div><ul className="finance-category-list">
              {data.savings
                .filter((reserve) => reserve.active && (!savingsReserveFilter || reserve.id === savingsReserveFilter) && (!savingsCurrencyFilter || reserve.currency === savingsCurrencyFilter))
                .map((reserve) => (
                  <li key={reserve.id}>
                    <span>
                      {reserve.name}
                      <small>
                        {reserve.objective || "Reserva"} · {reserve.currency}
                      </small>
                    </span>
                    <strong>
                      {formatAmount(reserve.balance, reserve.currency)}
                    </strong>
                  </li>
                ))}
            </ul><div className="finance-savings-breakdown" aria-label="Resumen de ahorro del mes">{["contribution", "withdrawal", "return", "loss", "adjustment"].map((kind) => <span key={kind}>{kind}: <strong>{insights?.savingsBreakdown[kind] ?? "0.00"}</strong></span>)}</div><div className="finance-table-wrap"><table><thead><tr><th>Fecha</th><th>Reserva</th><th>Tipo</th><th>Importe</th><th>Motivo</th></tr></thead><tbody>{(insights?.savingsMovements ?? []).map((movement) => <tr key={movement.id}><td>{movement.effectiveDate}</td><td>{data.savings.find((reserve) => reserve.id === movement.reserveId)?.name}</td><td>{movement.movementType}</td><td>{movement.currency} {movement.amount}</td><td>{movement.reason || movement.description || "—"}</td></tr>)}</tbody></table></div></>
            )}
          </section>
         )}
       {relationAudit && relationAudit.incompleteEntityCount > 0 && data && <FinanceRelationReview audit={relationAudit} transactions={data.transactions} onReview={setEditingTransaction} />}
       {data && <section className="finance-card" aria-labelledby="finance-category-settings"><div className="finance-section-heading"><h2 id="finance-category-settings">Configuración de categorías</h2><button type="button" onClick={() => setIsCategoryFormOpen(true)}>Nueva categoría</button></div><ul className="finance-category-list">{data.categories.map((category) => <li key={category.id}><span>{category.name}<small>{category.kind} · {category.active ? "activa" : "inactiva"}{category.parentId ? " · subcategoría" : ""}</small></span><span className="finance-row-actions"><button type="button" onClick={() => setEditingCategory(category)}>Editar</button>{category.active && <button type="button" onClick={async () => { if (window.confirm(`¿Desactivar ${category.name}?`)) { await deleteFinanceCategory(library, category.id); await refresh(); } }}>Desactivar</button>}</span></li>)}</ul></section>}
      {data && <FinanceRecordsPanel library={library} accounts={data.accounts} debtRatioSeries={insights?.debtRatioSeries ?? { periods: [], series: [] }} historyFrom={historyStartPeriod(month)} historyTo={month} onChanged={refresh} />}
      {isFormOpen && (
        <FinanceTransactionForm
          accounts={data?.accounts ?? []}
          categories={data?.categories ?? []}
          onCancel={() => setIsFormOpen(false)}
          onSubmit={submitTransaction}
        />
      )}
      {isAccountFormOpen && (
        <FinanceAccountForm
          onCancel={() => setIsAccountFormOpen(false)}
          onSubmit={async (account) => {
            await saveFinanceAccount(library, account);
            setIsAccountFormOpen(false);
            await refresh();
          }}
        />
      )}
      {editingAccount && <FinanceAccountForm initial={editingAccount} onCancel={() => setEditingAccount(null)} onSubmit={async (account) => { await saveFinanceAccount(library, account); setEditingAccount(null); await refresh(); }} />}
      {isCategoryFormOpen && (
        <FinanceCategoryForm
          categories={data?.categories ?? []}
          onCancel={() => setIsCategoryFormOpen(false)}
          onSubmit={async (category) => {
            await saveFinanceCategory(library, category);
            setIsCategoryFormOpen(false);
            await refresh();
          }}
        />
      )}
      {editingCategory && <FinanceCategoryForm initial={editingCategory} categories={data?.categories ?? []} onCancel={() => setEditingCategory(null)} onSubmit={async (category) => { await saveFinanceCategory(library, category); setEditingCategory(null); await refresh(); }} />}
      {editingTransaction && <FinanceTransactionForm initial={editingTransaction} accounts={data?.accounts ?? []} categories={data?.categories ?? []} onCancel={() => setEditingTransaction(null)} onSubmit={async (transaction) => { await applyFinanceUiChange(library, { kind: "edit-transaction", transaction }); setEditingTransaction(null); await refresh(); }} />}
      {isSavingsFormOpen && (
        <FinanceSavingsForm
          accounts={data?.accounts ?? []}
          onCancel={() => setIsSavingsFormOpen(false)}
          onSubmit={async (reserve, accountId) => {
            await saveFinanceSavingsReserve(library, reserve);
            if (accountId)
              await linkFinanceSavingsAccount(library, reserve.id, accountId);
            setIsSavingsFormOpen(false);
            await refresh();
          }}
        />
      )}
      {isQuickExpenseOpen && <FinanceQuickExpenseForm accounts={data?.accounts ?? []} categories={data?.categories ?? []} recentTransactions={data?.transactions ?? []} onCancel={() => setIsQuickExpenseOpen(false)} onSubmit={async (transaction) => { const accepted = await confirm({ title: "Confirmar gasto", message: `Se registrará ${transaction.amount} ${transaction.currency} como gasto${transaction.description ? `: ${transaction.description}` : ""}.`, confirmLabel: "Guardar gasto" }); if (!accepted) return false; await submitTransaction(transaction); return true; }} />}
      {isQuickSavingsOpen && <FinanceQuickSavingsForm reserves={data?.savings ?? []} accounts={data?.accounts ?? []} onCancel={() => setIsQuickSavingsOpen(false)} onSubmit={async (movement) => { const accepted = await confirm({ title: "Confirmar ahorro", message: `Se registrará ${movement.amount} ${movement.currency} como ${movement.movementType} en la reserva seleccionada.`, confirmLabel: "Guardar ahorro" }); if (!accepted) return false; await applyFinanceUiChange(library, { kind: "save-savings-movement", movement }); await refresh(); return true; }} />}
    </section>
  );
}

function FinanceQuickExpenseForm({ accounts, categories, recentTransactions, onCancel, onSubmit }: { accounts: DashboardData["accounts"]; categories: DashboardData["categories"]; recentTransactions: FinanceTransaction[]; onCancel: () => void; onSubmit: (transaction: FinanceTransaction) => Promise<boolean> }) {
  const recentExpense = recentTransactions.find((transaction) => transaction.transactionType === "expense" && transaction.status !== "discarded");
  const firstAccount = accounts.find((account) => account.active && account.id === recentExpense?.accountId) ?? accounts.find((account) => account.active);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState(firstAccount?.id ?? "");
  const [categoryId, setCategoryId] = useState(recentExpense?.categoryId ?? "");
  const [description, setDescription] = useState("");
  const [allowPossibleDuplicate, setAllowPossibleDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const possibleDuplicate = recentTransactions.some((transaction) => transaction.transactionType === "expense" && transaction.status !== "discarded" && transaction.effectiveDate.slice(0, 10) === date && transaction.accountId === accountId && transaction.amount === amount.trim() && transaction.description.trim().toLocaleLowerCase("es") === description.trim().toLocaleLowerCase("es"));
  async function submit(event: FormEvent) {
    event.preventDefault();
    const account = accounts.find((candidate) => candidate.id === accountId && candidate.active);
    if (!account || !amount.trim() || (possibleDuplicate && !allowPossibleDuplicate)) return;
    setSaving(true);
    try {
      const saved = await onSubmit({ id: crypto.randomUUID(), transactionType: "expense", amount: amount.trim(), currency: account.currency, effectiveDate: date, accountId, destinationAccountId: null, categoryId: categoryId || null, description: description.trim(), source: "manual", status: "confirmed" });
      if (saved) onCancel();
    } finally { setSaving(false); }
  }
  return <div className="finance-modal-backdrop" role="presentation"><form className="finance-form" aria-label="Registrar gasto rápido" onSubmit={(event) => void submit(event)}><h2>Registrar gasto</h2><label>Importe<input required autoFocus inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setAllowPossibleDuplicate(false); }} /></label><label>Fecha<input required type="date" value={date} onChange={(event) => { setDate(event.target.value); setAllowPossibleDuplicate(false); }} /></label><label>Cuenta de origen<select required value={accountId} onChange={(event) => { setAccountId(event.target.value); setAllowPossibleDuplicate(false); }}><option value="">Seleccionar…</option>{accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><label>Categoría (opcional)<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Sin categoría</option>{categories.filter((category) => category.active && category.kind === "expense").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Descripción<input value={description} onChange={(event) => { setDescription(event.target.value); setAllowPossibleDuplicate(false); }} placeholder="Ej. supermercado" /></label>{possibleDuplicate && <label className="finance-warning"><input type="checkbox" checked={allowPossibleDuplicate} onChange={(event) => setAllowPossibleDuplicate(event.target.checked)} /> Ya existe un gasto igual en esta fecha y cuenta; registrar de todos modos</label>}<div className="finance-form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button type="submit" disabled={saving || !accountId || (possibleDuplicate && !allowPossibleDuplicate)}>{saving ? "Guardando…" : "Guardar gasto"}</button></div></form></div>;
}

function FinanceRelationReview({ audit, transactions, onReview }: { audit: FinanceRelationAudit; transactions: FinanceTransaction[]; onReview: (transaction: FinanceTransaction) => void }) {
  return <section className="finance-card finance-warning" aria-labelledby="finance-relations-title"><h2 id="finance-relations-title">Relaciones para revisar</h2><p>{audit.incompleteEntityCount} registro(s) tienen relaciones incompletas o incompatibles. Esto no cambia los datos automáticamente.</p><ul>{audit.issues.slice(0, 8).map((issue) => { const transaction = issue.entity === "transaction" ? transactions.find((candidate) => candidate.id === issue.entityId) : undefined; return <li key={`${issue.entity}-${issue.entityId}-${issue.relation}`}>{issue.message}{transaction && <button type="button" onClick={() => onReview(transaction)}>Revisar movimiento</button>}</li> })}</ul>{audit.issues.length > 8 && <p>Hay más relaciones para revisar en los filtros y detalles de movimientos.</p>}</section>;
}

function FinanceQuickSavingsForm({ reserves, accounts, onCancel, onSubmit }: { reserves: FinanceSavingsReserve[]; accounts: DashboardData["accounts"]; onCancel: () => void; onSubmit: (movement: FinanceSavingsMovement) => Promise<boolean> }) {
  const firstReserve = reserves.find((reserve) => reserve.active);
  const [reserveId, setReserveId] = useState(firstReserve?.id ?? "");
  const [movementType, setMovementType] = useState<FinanceSavingsMovement["movementType"]>("contribution");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const reserve = reserves.find((candidate) => candidate.id === reserveId);
  const needsAccount = movementType === "contribution" || movementType === "withdrawal";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reserve || !amount.trim() || (needsAccount && !accountId) || (movementType === "withdrawal" && !reason.trim())) return;
    setSaving(true);
    try {
      const saved = await onSubmit({ id: crypto.randomUUID(), reserveId, accountId: accountId || null, movementType, amount: amount.trim(), currency: reserve.currency, effectiveDate: date, description: movementType, reason: reason.trim() || null, source: "manual", status: "confirmed", linkedTransactionId: null });
      if (saved) onCancel();
    } finally { setSaving(false); }
  }
  return <div className="finance-modal-backdrop" role="presentation"><form className="finance-form" aria-label="Registrar ahorro rápido" onSubmit={(event) => void submit(event)}><h2>Registrar ahorro</h2><label>Reserva<select required value={reserveId} onChange={(event) => setReserveId(event.target.value)}><option value="">Seleccionar…</option>{reserves.filter((candidate) => candidate.active).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.currency}</option>)}</select></label><label>Tipo<select value={movementType} onChange={(event) => setMovementType(event.target.value as FinanceSavingsMovement["movementType"])}><option value="contribution">Aporte</option><option value="withdrawal">Retiro</option><option value="return">Rendimiento</option><option value="loss">Pérdida</option><option value="adjustment">Ajuste</option></select></label><label>Importe<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Fecha<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>{needsAccount && <label>Cuenta de origen<select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Seleccionar…</option>{accounts.filter((account) => account.active && account.currency === reserve?.currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}{movementType === "withdrawal" && <label>Motivo<input required value={reason} onChange={(event) => setReason(event.target.value)} /></label>}<div className="finance-form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button type="submit" disabled={saving || !reserve || (needsAccount && !accountId)}>{saving ? "Guardando…" : "Guardar ahorro"}</button></div></form></div>;
}

function FinanceSavingsForm({
  accounts,
  onCancel,
  onSubmit,
}: {
  accounts: DashboardData["accounts"];
  onCancel: () => void;
  onSubmit: (
    reserve: FinanceSavingsReserve,
    accountId?: string,
  ) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"ARS" | "USD">("ARS");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [objective, setObjective] = useState("");
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !openingBalance) return;
    setSaving(true);
    try {
      await onSubmit(
        {
          id: crypto.randomUUID(),
          name: name.trim(),
          currency,
          openingBalance,
          objective: objective || null,
          active: true,
          balance: openingBalance,
        },
        accountId || undefined,
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="finance-modal-backdrop">
      <form className="finance-form" onSubmit={submit}>
        <h2>Nueva reserva de ahorro</h2>
        <label>
          Nombre
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Moneda
          <select
            value={currency}
            onChange={(event) =>
              setCurrency(event.target.value as "ARS" | "USD")
            }
          >
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label>
          Cuenta vinculada
          <select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">Sin vincular</option>
            {accounts
              .filter((item) => item.active && item.currency === currency)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Saldo inicial
          <input
            required
            inputMode="decimal"
            value={openingBalance}
            onChange={(event) => setOpeningBalance(event.target.value)}
          />
        </label>
        <label>
          Objetivo
          <input
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
          />
        </label>
        <div className="finance-form-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FinanceAccountForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial?: FinanceAccount;
  onCancel: () => void;
  onSubmit: (value: DashboardData["accounts"][number]) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [accountType, setAccountType] = useState(initial?.accountType ?? "cash");
  const [currency, setCurrency] = useState<"ARS" | "USD">(initial?.currency ?? "ARS");
  const [active, setActive] = useState(initial?.active ?? true);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        id: initial?.id ?? crypto.randomUUID(),
        name: name.trim(),
        accountType,
        currency,
        active,
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="finance-modal-backdrop">
      <form className="finance-form" onSubmit={submit}>
        <h2>{initial ? "Editar cuenta" : "Nueva cuenta"}</h2>
        <label>
          Nombre
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Tipo
          <select
            value={accountType}
            onChange={(event) => setAccountType(event.target.value)}
          >
            <option value="cash">Efectivo</option>
            <option value="bank">Cuenta bancaria</option>
            <option value="wallet">Billetera</option>
            <option value="credit_card">Tarjeta de crédito</option>
            {initial?.accountType === "savings" && <option value="savings">Ahorro (cuenta anterior)</option>}
          </select>
        </label>
        <label>
          Moneda
          <select
            value={currency}
            onChange={(event) =>
              setCurrency(event.target.value as "ARS" | "USD")
            }
          >
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </label>
        {initial && <label><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Cuenta activa</label>}
        <div className="finance-form-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FinanceCategoryForm({
  initial,
  categories,
  onCancel,
  onSubmit,
}: {
  initial?: FinanceCategory;
  categories: FinanceCategory[];
  onCancel: () => void;
  onSubmit: (value: DashboardData["categories"][number]) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<"income" | "expense">(initial?.kind ?? "expense");
  const [parentId, setParentId] = useState(initial?.parentId ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        id: initial?.id ?? crypto.randomUUID(),
        name: name.trim(),
        kind,
        active,
        parentId: parentId || null,
        description: description || null,
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="finance-modal-backdrop">
      <form className="finance-form" onSubmit={submit}>
        <h2>Nueva categoría</h2>
        <label>
          Nombre
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Tipo
          <select
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as "income" | "expense")
            }
          >
            <option value="expense">Gasto</option>
            <option value="income">Ingreso</option>
          </select>
        </label>
        <label>
          Categoría padre
          <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">Ninguna</option>
            {categories.filter((category) => category.active && category.kind === kind && category.id !== initial?.id).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label>Descripción<input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {initial && <label><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Categoría activa</label>}
        <div className="finance-form-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FinanceTransactionForm({
  initial,
  accounts,
  categories,
  onCancel,
  onSubmit,
}: {
  initial?: FinanceTransaction;
  accounts: DashboardData["accounts"];
  categories: DashboardData["categories"];
  onCancel: () => void;
  onSubmit: (value: FinanceTransaction) => Promise<void>;
}) {
  const [type, setType] = useState<
    "income" | "expense" | "transfer" | "adjustment"
  >(initial?.transactionType ?? "expense");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? "");
  const [destinationAccountId, setDestinationAccountId] = useState(initial?.destinationAccountId ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [date, setDate] = useState(initial?.effectiveDate.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState(initial?.status ?? "confirmed");
  const [saving, setSaving] = useState(false);
  const isCategorized = type === "income" || type === "expense";
  const account = accounts.find((item) => item.id === accountId);
  const destination = accounts.find((item) => item.id === destinationAccountId);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !amount ||
      !accountId ||
      (type === "transfer" &&
        (!destinationAccountId || destination?.currency !== account?.currency))
    )
      return;
    setSaving(true);
    try {
      await onSubmit({
        ...initial,
        id: initial?.id ?? crypto.randomUUID(),
        transactionType: type,
        amount,
        currency: account?.currency ?? "ARS",
        effectiveDate: date,
        accountId,
        destinationAccountId: type === "transfer" ? destinationAccountId : null,
        categoryId: isCategorized ? categoryId || null : null,
        description,
        source: initial?.source ?? "manual",
        status,
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="finance-modal-backdrop">
      <form className="finance-form" onSubmit={submit}>
        <h2>Nuevo movimiento</h2>
        <label>
          Tipo
          <select
            value={type}
            onChange={(event) => setType(event.target.value as typeof type)}
          >
            <option value="expense">Gasto</option>
            <option value="income">Ingreso</option>
            <option value="transfer">Transferencia</option>
            <option value="adjustment">Ajuste</option>
          </select>
        </label>
        <label>
          Importe
          <input
            required
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label>
          Fecha
          <input
            required
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label>
          Cuenta origen
          <select
            required
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">Seleccionar…</option>
            {accounts
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.currency})
                </option>
              ))}
          </select>
        </label>
        {type === "transfer" && (
          <label>
            Cuenta destino
            <select
              required
              value={destinationAccountId}
              onChange={(event) => setDestinationAccountId(event.target.value)}
            >
              <option value="">Seleccionar…</option>
              {accounts
                .filter(
                  (item) =>
                    item.active &&
                    item.id !== accountId &&
                    item.currency === account?.currency,
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.currency})
                  </option>
                ))}
            </select>
          </label>
        )}
        {isCategorized && (
          <label>
            Categoría
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Sin categoría</option>
              {categories
                .filter((item) => item.kind === type)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          Descripción
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          Estado
          <select value={status} onChange={(event) => setStatus(event.target.value as FinanceTransaction["status"])}>
            <option value="pending">Pendiente</option>
            <option value="confirmed">Confirmado</option>
            <option value="corrected">Corregido</option>
            <option value="discarded">Descartado</option>
          </select>
        </label>
        <div className="finance-form-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={
              saving ||
              !accountId ||
              (type === "transfer" &&
                (!destinationAccountId ||
                  destination?.currency !== account?.currency))
            }
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}
