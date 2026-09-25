import { useCallback, useEffect, useState } from "react";
import type { NotiaLibrary } from "../../../types/notia";
import {
  listFinanceCreditCardStatements,
  listFinanceInstallmentPlans,
  listFinancePriceHistory,
  listFinanceProducts,
  listFinancePurchases,
  listFinanceSalaries,
  type FinanceDebtRatioSeries,
} from "../services/financeService";
import type {
  FinanceAccount,
  FinanceCreditCardStatement,
  FinanceCurrency,
  FinanceInstallmentPlanSummary,
  FinancePriceObservation,
  FinanceProductSummary,
  FinancePurchaseSummary,
  FinanceSalaryEvolution,
} from "../types/financeTypes";
import { financeErrorMessage } from "../engines/financeError";
import { formatFinanceLoadedDate } from "../engines/financeLoadedDate";
import { subscribeToFinanceDataChanges } from "../services/financeDataEvents";
import { CreditCardEvolutionChart } from "./CreditCardEvolutionChart";
import { SalaryRatioChart } from "./SalaryRatioChart";
import { SalaryEvolutionChart } from "./SalaryEvolutionChart";

interface Props {
  library: NotiaLibrary;
  accounts: FinanceAccount[];
  debtRatioSeries: FinanceDebtRatioSeries;
  servicesRatioSeries: FinanceDebtRatioSeries;
  historyFrom: string;
  historyTo: string;
}

function formatMoney(amount: string, currency: FinanceCurrency): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${currency} ${amount}`;
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

export function FinanceRecordsPanel({ library, accounts, debtRatioSeries, servicesRatioSeries, historyFrom, historyTo }: Props) {
  const [purchases, setPurchases] = useState<FinancePurchaseSummary[]>([]);
  const [salaries, setSalaries] = useState<FinanceSalaryEvolution[]>([]);
  const [cardStatements, setCardStatements] = useState<FinanceCreditCardStatement[]>([]);
  const [plans, setPlans] = useState<FinanceInstallmentPlanSummary[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState<FinanceProductSummary[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<FinanceProductSummary | null>(null);
  const [productHistory, setProductHistory] = useState<FinancePriceObservation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [purchaseRows, salaryRows, statementRows, planRows] = await Promise.all([
        listFinancePurchases(library),
        listFinanceSalaries(library),
        listFinanceCreditCardStatements(library, { from: historyFrom, to: historyTo }),
        listFinanceInstallmentPlans(library),
      ]);
      setPurchases(purchaseRows);
      setSalaries(salaryRows);
      setCardStatements(statementRows);
      setPlans(planRows);
      setError(null);
    } catch (reason) {
      setError(financeErrorMessage(reason));
    }
  }, [historyFrom, historyTo, library]);
  // The dashboard passes new accounts after every refresh; reload then too.
  useEffect(() => void load(), [load, accounts]);
  useEffect(() => subscribeToFinanceDataChanges(() => { void load(); }), [load]);

  useEffect(() => {
    let isCurrent = true;
    const timer = window.setTimeout(() => {
      void listFinanceProducts(library, productSearch)
        .then((rows) => { if (isCurrent) setProducts(rows); })
        .catch((reason) => { if (isCurrent) setError(financeErrorMessage(reason)); });
    }, 250);
    return () => { isCurrent = false; window.clearTimeout(timer); };
  }, [library, productSearch, accounts]);

  useEffect(() => {
    let isCurrent = true;
    if (!selectedProduct) { setProductHistory([]); return; }
    void listFinancePriceHistory(library, { productId: selectedProduct.id })
      .then((rows) => { if (isCurrent) setProductHistory(rows); })
      .catch((reason) => { if (isCurrent) setError(financeErrorMessage(reason)); });
    return () => { isCurrent = false; };
  }, [library, selectedProduct]);

  const latestSalaries = [...salaries]
    .sort((left, right) => right.salary.period.localeCompare(left.salary.period))
    .slice(0, 6);
  const upcoming = plans.filter((plan) => plan.pendingCount > 0);

  return (
    <section className="finance-records" aria-labelledby="finance-records-title">
      <div className="finance-section-heading">
        <div>
          <h2 id="finance-records-title">Productos, tickets y tarjetas</h2>
          <p className="finance-muted">Lo que el asistente cargó desde tus tickets, recibos y resúmenes.</p>
        </div>
      </div>
      {error && <p className="finance-error" role="alert">{error}</p>}
      <article className="finance-card" aria-labelledby="finance-products-title">
        <div className="finance-section-heading">
          <h3 id="finance-products-title">Productos</h3>
          <label>Buscar <input type="search" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Leche, yerba…" /></label>
        </div>
        {products.length === 0 ? <p className="finance-muted">{productSearch.trim() ? "Ningún producto coincide." : "Todavía no hay productos; aparecen al cargar tickets."}</p> : (
          <ul className="finance-category-list">
            {products.slice(0, 40).map((product) => (
              <li key={product.id}>
                <button type="button" className="finance-list-button" aria-expanded={selectedProduct?.id === product.id} onClick={() => setSelectedProduct(selectedProduct?.id === product.id ? null : product)}>
                  <span>
                    {product.name}
                    <small>{product.prices.map((price) => `${price.merchantName ?? "Sin comercio"}: ${formatMoney(price.unitPrice, price.currency)} (${price.observedAt.slice(0, 10)})`).join(" · ") || "Sin precios confirmados"}</small>
                  </span>
                  <strong>{product.observationCount} compra(s)</strong>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectedProduct && (
          <div className="finance-table-wrap" aria-label={`Historial de precios de ${selectedProduct.name}`}>
            <table>
              <thead><tr><th>Fecha</th><th>Comercio</th><th>Cantidad</th><th>Precio unitario</th><th>Total</th></tr></thead>
              <tbody>{productHistory.map((price) => <tr key={price.id}><td>{price.observedAt.slice(0, 10)}</td><td>{price.merchantName ?? "Sin comercio"}</td><td>{price.quantity}</td><td>{formatMoney(price.unitPrice, price.currency)}</td><td>{formatMoney(price.finalAmount, price.currency)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </article>
      <div className="finance-grid">
        <article className="finance-card">
          <h3>Tickets</h3>
          {purchases.length ? <ul className="finance-category-list">{purchases.slice(0, 10).map((purchase) => <li key={purchase.id}><span>{purchase.merchantName}<small>{purchase.observedAt.slice(0, 10)} · {purchase.itemCount} producto(s)</small></span><strong>{formatMoney(purchase.totalAmount, purchase.currency)}</strong></li>)}</ul> : <p className="finance-muted">Sin tickets registrados.</p>}
        </article>
        <article className="finance-card">
          <h3>Últimos sueldos</h3>
          {latestSalaries.length ? <ul className="finance-category-list">{latestSalaries.map(({ salary }) => { const loadedDate = formatFinanceLoadedDate(salary.createdAt); return <li key={salary.id}><span>{salary.period} · {salary.employer}<small>Cobrado el {salary.paymentDate}{loadedDate && <><br />Cargado el {loadedDate}</>}</small></span><strong>Neto {formatMoney(salary.netAmount, salary.currency)}</strong></li> })}</ul> : <p className="finance-muted">Sin recibos registrados.</p>}
        </article>
      </div>
      <div className="finance-grid">
        <article className="finance-card">
          <h3>Resúmenes pagados</h3>
          {cardStatements.length ? <ul className="finance-category-list">{cardStatements.slice(0, 8).map((statement) => <li key={statement.id}><span>{statement.issuer}{statement.cardLastFour ? ` · •••• ${statement.cardLastFour}` : ""}<small>Período {statement.period} · vencimiento {statement.dueDate} · {statement.items.length} línea(s)</small></span><strong>{formatMoney(statement.totalDue, statement.currency)}</strong></li>)}</ul> : <p className="finance-muted">Sin resúmenes cargados.</p>}
        </article>
        <article className="finance-card">
          <h3>Cuotas pendientes</h3>
          {upcoming.length ? <ul className="finance-category-list">{upcoming.map((plan) => <li key={plan.id}><span>{plan.description}<small>{plan.pendingCount} de {plan.installmentCount} cuota(s) por pagar{plan.nextDueDate ? ` · próxima ${plan.nextDueDate}` : ""}</small></span><strong>{formatMoney(plan.remainingAmount, plan.currency)}</strong></li>)}</ul> : <p className="finance-muted">No hay cuotas por pagar.</p>}
        </article>
      </div>
      <SalaryEvolutionChart library={library} refreshKey={salaries} />
      <CreditCardEvolutionChart accounts={accounts} statements={cardStatements} />
      <SalaryRatioChart id="card-ratio" title="Tarjetas respecto del sueldo" description="Lo pagado de tarjetas cada mes sobre el sueldo del mes anterior, que es con el que se paga." emptyText="Cargá sueldos y resúmenes de tarjeta para ver su evolución." data={debtRatioSeries} />
      <SalaryRatioChart id="services-ratio" title="Servicios respecto del sueldo" description="Lo pagado de servicios cada mes sobre el sueldo del mes anterior, que es con el que se paga." emptyText="Registrá pagos de servicios y sueldos para ver su evolución." data={servicesRatioSeries} />
    </section>
  );
}
