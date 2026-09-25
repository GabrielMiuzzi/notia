import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { NotiaLibrary } from "../../../types/notia";
import {
  getFinanceDashboard,
  getFinanceDashboardInsights,
  type FinanceDashboardInsights,
} from "../services/financeService";
import type {
  FinanceDashboard as DashboardData,
  FinanceReviewItem,
  FinanceSavingsMovementType,
  FinanceTransaction,
} from "../types/financeTypes";
import { financeErrorMessage } from "../engines/financeError";
import { FinanceRecordsPanel } from "./FinanceRecordsPanel";
import { DollarQuotesCards } from "./DollarQuotesCards";
import { subscribeToFinanceDataChanges } from "../services/financeDataEvents";
import { getDollarQuotes } from "../services/dollarQuotesService";

interface FinanceDashboardProps {
  library: NotiaLibrary;
}

const TYPE_LABELS: Record<FinanceTransaction["transactionType"], string> = {
  income: "Ingreso",
  expense: "Gasto",
  transfer: "Transferencia",
  adjustment: "Ajuste",
  exchange: "Cambio de moneda",
};

const STATUS_LABELS: Record<FinanceTransaction["status"], string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  corrected: "Corregido",
  discarded: "Descartado",
  card_unpaid: "En tarjeta, a pagar",
};

const SAVINGS_TOTAL_LABELS: Record<FinanceSavingsMovementType, string> = {
  contribution: "Aportes",
  withdrawal: "Retiros",
  return: "Rendimientos",
  loss: "Pérdidas",
  adjustment: "Ajustes",
};

const SAVINGS_MOVEMENT_LABELS: Record<FinanceSavingsMovementType, string> = {
  contribution: "Aporte",
  withdrawal: "Retiro",
  return: "Rendimiento",
  loss: "Pérdida",
  adjustment: "Ajuste",
};

const SAVINGS_TYPES = Object.keys(SAVINGS_TOTAL_LABELS) as FinanceSavingsMovementType[];

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
function historyStartPeriod(endPeriod: string) {
  const [year, month] = endPeriod.split("-").map(Number);
  return new Date(Date.UTC(year, month - 12, 1)).toISOString().slice(0, 7);
}

function formatPreciseAmount(value: string, currency = "ARS") {
  const number = Number(value || 0);
  return `${currency} ${Number.isFinite(number) ? number.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value}`;
}

/** Each currency apart; pesos and dollars never add up. */
function formatTotals(totals: Record<string, string> | undefined) {
  const entries = Object.entries(totals ?? {}).filter(([, value]) => Number(value) !== 0);
  return entries.length === 0
    ? "—"
    : entries.map(([currency, value]) => formatPreciseAmount(value, currency)).join(" · ");
}

function formatRates(values: Record<string, string | null>) {
  const entries = Object.entries(values).filter(([, value]) => value !== null);
  return entries.length === 0 ? "—" : entries.map(([currency, value]) => `${currency} ${value}%`).join(" · ");
}

/** Cards paid over salary per currency, as the backend computed it. */
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
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingsReserveFilter, setSavingsReserveFilter] = useState("");
  const [savingsCurrencyFilter, setSavingsCurrencyFilter] = useState("");
  const [transactionPage, setTransactionPage] = useState(0);
  const [dollarRate, setDollarRate] = useState<number | null>(null);
  const [summaryView, setSummaryView] = useState<"day" | "week" | "month">("month");
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
  useEffect(() => setTransactionPage(0), [month, transactionAccountFilter, transactionCategoryFilter, transactionCurrencyFilter, transactionSearch, transactionServiceFilter, transactionSourceFilter, transactionStatusFilter]);
  useEffect(() => {
    if (summaryDate.slice(0, 7) !== month) setSummaryDate(`${month}-01`);
  }, [month, summaryDate]);
  // The backend filters the movements, totals them and summarizes the chosen
  // period; `data` changes after every reload, so they are requested again.
  useEffect(() => {
    let isCurrent = true;
    if (!data) { setInsights(null); return; }
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
    return () => { isCurrent = false; };
  }, [data, dollarRate, library, month, savingsCurrencyFilter, savingsReserveFilter, summaryDate, summaryView, transactionAccountFilter, transactionCategoryFilter, transactionCurrencyFilter, transactionPage, transactionSearch, transactionServiceFilter, transactionSourceFilter, transactionStatusFilter]);
  const summary = insights?.summary ?? null;
  const saved = insights?.savedThisMonth;
  const cost = formatTotals(saved?.costByCurrency);

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
          <button type="button" aria-label="Actualizar" onClick={() => void refresh()}>
            <RefreshCw size={18} />
          </button>
        </div>
        <p className="finance-muted">Para cargar o corregir algo, escribile al asistente en el chat o por Telegram.</p>
      </header>
      <DollarQuotesCards />
      {error && (
        <div className="finance-error" role="alert">
          {error}
        </div>
      )}
      {insights && insights.reviewItems.length > 0 && <FinanceReviewList items={insights.reviewItems} />}
      {data && (
        <div className="finance-dashboard-content">
          <section className="finance-metrics" aria-label="Totales del mes">
            <article>
              <span>Gastos del mes</span>
              <strong>{formatTotals(data.expenseByCurrency)}</strong>
              <small className="finance-muted">Lo pagado con tarjeta cuenta en el mes en que se paga el resumen.</small>
            </article>
            <article>
              <span>Pagado de tarjetas</span>
              <strong>{formatTotals(insights?.cardPaidByCurrency)}</strong>
              <small className="finance-muted">Resúmenes que vencen este mes.</small>
            </article>
            <article>
              <span>En tarjeta, a pagar</span>
              <strong>{formatTotals(insights?.cardUnpaidByCurrency)}</strong>
              <small className="finance-muted">{insights?.cardUnpaidCount ? `${insights.cardUnpaidCount} gasto(s) esperan su resumen.` : "Nada espera un resumen."}</small>
            </article>
            <article>
              <span>Ahorrado este mes</span>
              <strong>{formatTotals(saved?.contributionsByCurrency)}</strong>
              <small className="finance-muted">
                {cost !== "—" ? `Costó ${cost}.` : "Aportes a las reservas."}
                {formatTotals(saved?.withdrawalsByCurrency) !== "—" && ` Retirado: ${formatTotals(saved?.withdrawalsByCurrency)}.`}
              </small>
            </article>
            <article>
              <span>Tarjetas / sueldo</span>
              <strong>{formatRatios(insights?.debtRatio.ratios ?? [])}</strong>
              <small className="finance-muted">
                {(insights?.debtRatio.period ?? month) === month
                  ? "Lo pagado de tarjetas sobre el sueldo cobrado en el mes."
                  : `Último mes con datos: ${insights?.debtRatio.period}.`}
              </small>
            </article>
            <article>
              <span>Ahorro / sueldo</span>
              <strong>{formatPercent(insights?.savingsToIncome)}</strong>
              <small className="finance-muted">Saldo de ahorro respecto del sueldo en la misma moneda.</small>
            </article>
          </section>
          {summary && <section className="finance-card finance-daily-summary" aria-labelledby="finance-daily-summary-title">
            <div className="finance-section-heading">
              <div>
                <h2 id="finance-daily-summary-title">Resumen de gastos y ahorro</h2>
                <p className="finance-muted">Información registrada; no representa saldos de cuentas.</p>
              </div>
              <div className="finance-actions">
                <label>Vista <select value={summaryView} onChange={(event) => setSummaryView(event.target.value as typeof summaryView)}><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option></select></label>
                {summaryView === "month" ? <input aria-label="Mes del resumen" type="month" value={month} onChange={(event) => { setMonth(event.target.value); setSummaryDate(`${event.target.value}-01`); }} /> : <input aria-label="Fecha del resumen" type="date" value={summaryDate} onChange={(event) => { setSummaryDate(event.target.value); setMonth(event.target.value.slice(0, 7)); }} />}
              </div>
            </div>
            <div className="finance-metrics finance-daily-summary__metrics">
              <article><span>Gastos registrados</span><strong>{formatTotals(summary.expenseByCurrency)}</strong><small className="finance-muted">{summary.coverage.includedExpenses} gasto(s)</small></article>
              <article><span>Ahorro neto del período</span><strong>{formatTotals(summary.savings.netByCurrency)}</strong><small className="finance-muted">Aportes + rendimientos − retiros − pérdidas</small></article>
              <article><span>Reservas acumuladas</span><strong>{formatTotals(summary.savings.reserveBalancesByCurrency)}</strong><small className="finance-muted">Ahorro acumulado en las reservas</small></article>
              <article><span>Tasa de ahorro registrada</span><strong>{formatRates(summary.savingsRateByCurrency)}</strong><small className="finance-muted">Aportes sobre ingresos del período.</small></article>
            </div>
            <article><h3>Gastos por categoría</h3>{summary.expenseByCategory.length === 0 ? <p className="finance-muted">No hay gastos en el período.</p> : <ul className="finance-category-list">{summary.expenseByCategory.map((item) => { const variation = insights?.categoryVariation[`${item.categoryId ?? "uncategorized"}:${item.currency}`]; return <li key={`${item.categoryId ?? "uncategorized"}-${item.currency}`}><span>{item.categoryName}<small>{item.count} gasto(s){variation !== undefined && (variation === null ? " · nuevo en el período" : ` · ${variation >= 0 ? "+" : ""}${variation.toLocaleString("es-AR", { maximumFractionDigits: 1 })}% vs. período anterior`)}</small></span><strong>{formatPreciseAmount(item.amount, item.currency)}</strong></li> })}</ul>}</article>
            {(summary.coverage.pendingTransactions > 0 || summary.coverage.uncategorizedExpenses > 0 || data.transactionsTruncated || data.savingsMovementsTruncated) && <p className="finance-muted" role="status">{[summary.coverage.pendingTransactions ? `${summary.coverage.pendingTransactions} movimiento(s) pendiente(s)` : "", summary.coverage.uncategorizedExpenses ? `${summary.coverage.uncategorizedExpenses} gasto(s) sin categoría` : "", data.transactionsTruncated ? "el listado de movimientos está limitado" : "", data.savingsMovementsTruncated ? "el listado de ahorro está limitado" : ""].filter(Boolean).join(" · ")}</p>}
          </section>}
          <section className="finance-card">
            <h2>Movimientos del mes</h2>
            <div className="finance-form-row" aria-label="Filtros de movimientos">
              <label>Buscar<input value={transactionSearch} onChange={(event) => setTransactionSearch(event.target.value)} placeholder="Descripción u origen" /></label>
              <label>Categoría<select value={transactionCategoryFilter} onChange={(event) => setTransactionCategoryFilter(event.target.value)}><option value="">Todas</option>{data.categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label>Moneda<select value={transactionCurrencyFilter} onChange={(event) => setTransactionCurrencyFilter(event.target.value)}><option value="">Todas</option><option value="ARS">ARS</option><option value="USD">USD</option></select></label>
              <label>Estado<select value={transactionStatusFilter} onChange={(event) => setTransactionStatusFilter(event.target.value)}><option value="">Todos</option>{Object.entries(STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
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
                    </tr>
                  </thead>
                  <tbody>
                    {(insights?.transactions ?? []).map((item) => (
                      <tr key={item.id}>
                        <td>{item.effectiveDate}{item.purchaseDate && item.purchaseDate !== item.effectiveDate && <small className="finance-table-secondary">Compra del {item.purchaseDate}</small>}</td>
                        <td><span>{item.description || "Sin descripción"}</span><small className="finance-table-secondary">{data.accounts.find((account) => account.id === item.accountId)?.name ?? "Cuenta no disponible"} · {data.categories.find((category) => category.id === item.categoryId)?.name ?? "Sin categoría"}{item.serviceId ? ` · Servicio ${item.serviceId}` : ""}</small></td>
                        <td>{TYPE_LABELS[item.transactionType] ?? item.transactionType}</td>
                        <td>{formatPreciseAmount(item.amount, item.currency)}</td>
                        <td>{STATUS_LABELS[item.status] ?? item.status}</td>
                        <td>{item.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {insights && insights.pageCount > 1 && <nav className="finance-pagination" aria-label="Páginas de movimientos"><button type="button" disabled={insights.page === 0} onClick={() => setTransactionPage(Math.max(0, insights.page - 1))}>Anterior</button><span>Página {insights.page + 1} de {insights.pageCount}</span><button type="button" disabled={insights.page + 1 >= insights.pageCount} onClick={() => setTransactionPage(insights.page + 1)}>Siguiente</button></nav>}
          </section>
          <section className="finance-card" aria-labelledby="finance-savings-title">
            <h2 id="finance-savings-title">Ahorro con saldo</h2>
            {data.savings.length === 0 ? (
              <p className="finance-muted">Todavía no hay reservas de ahorro. Pedile al asistente que cree una.</p>
            ) : (
              <>
                <div className="finance-actions"><label>Reserva<select value={savingsReserveFilter} onChange={(event) => setSavingsReserveFilter(event.target.value)}><option value="">Todas</option>{data.savings.map((reserve) => <option key={reserve.id} value={reserve.id}>{reserve.name}</option>)}</select></label><label>Moneda<select value={savingsCurrencyFilter} onChange={(event) => setSavingsCurrencyFilter(event.target.value)}><option value="">Todas</option><option value="ARS">ARS</option><option value="USD">USD</option></select></label></div>
                <ul className="finance-category-list">
                  {data.savings
                    .filter((reserve) => reserve.active && (!savingsReserveFilter || reserve.id === savingsReserveFilter) && (!savingsCurrencyFilter || reserve.currency === savingsCurrencyFilter))
                    .map((reserve) => (
                      <li key={reserve.id}>
                        <span>
                          {reserve.name}
                          <small>{reserve.objective || "Reserva"} · {reserve.currency}</small>
                        </span>
                        <strong>{formatPreciseAmount(reserve.balance, reserve.currency)}</strong>
                      </li>
                    ))}
                </ul>
                <div className="finance-savings-breakdown" aria-label="Movimientos de ahorro del mes">{SAVINGS_TYPES.map((kind) => <span key={kind}>{SAVINGS_TOTAL_LABELS[kind]}: <strong>{insights?.savingsBreakdown[kind] ?? "0.00"}</strong></span>)}</div>
                <div className="finance-table-wrap"><table><thead><tr><th>Fecha</th><th>Reserva</th><th>Tipo</th><th>Importe</th><th>Motivo</th></tr></thead><tbody>{(insights?.savingsMovements ?? []).map((movement) => <tr key={movement.id}><td>{movement.effectiveDate}</td><td>{data.savings.find((reserve) => reserve.id === movement.reserveId)?.name}</td><td>{SAVINGS_MOVEMENT_LABELS[movement.movementType] ?? movement.movementType}</td><td>{formatPreciseAmount(movement.amount, movement.currency)}</td><td>{movement.reason || movement.description || "—"}</td></tr>)}</tbody></table></div>
              </>
            )}
          </section>
          <FinanceRecordsPanel library={library} accounts={data.accounts} debtRatioSeries={insights?.debtRatioSeries ?? { periods: [], series: [] }} historyFrom={historyStartPeriod(month)} historyTo={month} />
        </div>
      )}
    </section>
  );
}

/** Doubts the assistant left; they are answered in the chat or Telegram. */
function FinanceReviewList({ items }: { items: FinanceReviewItem[] }) {
  return (
    <section className="finance-card finance-review" aria-labelledby="finance-review-title">
      <h2 id="finance-review-title">Para revisar</h2>
      <p className="finance-muted">El asistente te lo pregunta al cargar algo; también podés pedirle «¿qué falta revisar en Finanzas?» en el chat o por Telegram.</p>
      <ul className="finance-category-list">
        {items.map((item) => (
          <li key={item.id}>
            <span>
              {item.question}
              <small>{item.options.map((option) => option.label).join(" · ")}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
