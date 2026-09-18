import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useConfirmationEngine } from "../../../context/confirmation/useConfirmationEngine";
import type { NotiaLibrary } from "../../../types/notia";
import {
  getFinanceNetWorth,
  extractFinanceDocument,
  listFinanceNetWorthHistory,
  listFinancePriceHistory,
  listFinancePurchases,
  listFinanceSalaries,
  listFinanceCreditCardStatements,
  saveFinanceInstallmentPlan,
  saveFinanceInvestment,
  saveFinancePurchase,
  saveFinanceSalary,
  saveFinanceCreditCardStatement,
  queueFinanceAudit,
  repairFinanceRelation,
  listFinanceRelationRepairs,
  listFinanceServiceOccurrences,
  listAllFinanceTransactions,
  listAllFinanceSavingsMovements,
  listFinanceServices,
  listAllFinanceServiceOccurrences,
  listFinanceServiceInvoices,
  listFinanceInvestments,
} from "../services/financeService";
import type {
  FinanceAccount,
  FinanceCategory,
  FinanceCreditCardStatement,
  FinanceDebtRatioHistoryPoint,
  FinanceCurrency,
  FinanceNetWorth,
  FinanceNetWorthHistoryPoint,
  FinancePriceObservation,
  FinancePurchaseRecord,
  FinancePurchaseSummary,
  FinanceSalaryEvolution,
  FinanceSavingsReserve,
  FinanceRelationRepairType,
  FinanceTransaction,
  FinanceRelationRepair,
} from "../types/financeTypes";
import { validateTicketArithmetic } from "../engines/ticketValidation";
import { parseSalaryExtraction } from "../engines/salaryExtraction";
import { financeErrorMessage } from "../engines/financeError";
import { formatFinanceLoadedDate } from "../engines/financeLoadedDate";
import { reconcileFinanceCardServices } from "../engines/serviceEngine";
import { auditFinanceRelations, type FinanceRelationAudit, type FinanceRelationEntity, type FinanceRelationIssue } from "../engines/financeRelations";
import { CreditCardStatementForm } from "./CreditCardStatementForm";
import { CreditCardEvolutionChart } from "./CreditCardEvolutionChart";
import { DebtRatioEvolutionChart } from "./DebtRatioEvolutionChart";
import { SalaryEvolutionChart } from "./SalaryEvolutionChart";

interface Props {
  library: NotiaLibrary;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  reserves: FinanceSavingsReserve[];
  debtRatioHistory: FinanceDebtRatioHistoryPoint[];
  historyFrom: string;
  historyTo: string;
  onChanged: () => Promise<void>;
}

type FormKind = "ticket" | "salary" | "card-statement" | "installments" | "investment" | null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatSalaryNet(amount: string, currency: FinanceCurrency): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${currency} ${amount}`;
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

export function FinanceRecordsPanel({ library, accounts, categories, reserves, debtRatioHistory, historyFrom, historyTo, onChanged }: Props) {
  const { confirm } = useConfirmationEngine();
  const [form, setForm] = useState<FormKind>(null);
  const [purchases, setPurchases] = useState<FinancePurchaseSummary[]>([]);
  const [prices, setPrices] = useState<FinancePriceObservation[]>([]);
  const [salaries, setSalaries] = useState<FinanceSalaryEvolution[]>([]);
  const [cardStatements, setCardStatements] = useState<FinanceCreditCardStatement[]>([]);
  const [netWorth, setNetWorth] = useState<FinanceNetWorth | null>(null);
  const [netWorthHistory, setNetWorthHistory] = useState<FinanceNetWorthHistoryPoint[]>([]);
  const [relationAudit, setRelationAudit] = useState<FinanceRelationAudit | null>(null);
  const [relationEntityFilter, setRelationEntityFilter] = useState<FinanceRelationEntity | "all">("all");
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [relationRepairs, setRelationRepairs] = useState<FinanceRelationRepair[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [purchaseRows, priceRows, salaryRows, statementRows, worth, worthHistory, transactions, savingsMovements, services, occurrences, invoices, investments, repairs] = await Promise.all([
        listFinancePurchases(library),
        listFinancePriceHistory(library),
        listFinanceSalaries(library),
        listFinanceCreditCardStatements(library, { from: historyFrom, to: historyTo }),
        getFinanceNetWorth(library, today()),
        listFinanceNetWorthHistory(library),
        listAllFinanceTransactions(library),
        listAllFinanceSavingsMovements(library),
        listFinanceServices(library),
        listAllFinanceServiceOccurrences(library),
        listFinanceServiceInvoices(library),
        listFinanceInvestments(library),
        listFinanceRelationRepairs(library),
      ]);
      setPurchases(purchaseRows);
      setPrices(priceRows);
      setSalaries(salaryRows);
      setCardStatements(statementRows);
      setNetWorth(worth);
      setNetWorthHistory(worthHistory);
      setTransactions(transactions);
      setRelationRepairs(repairs);
      setRelationAudit(auditFinanceRelations({ accounts, categories, transactions, services, occurrences, invoices, reserves, savingsMovements, purchases: purchaseRows, statements: statementRows, investments }));
      setError(null);
    } catch (reason) {
      setError(financeErrorMessage(reason));
    }
  }, [accounts, categories, historyFrom, historyTo, library, reserves]);
  useEffect(() => void load(), [load]);
  const saved = async () => {
    setForm(null);
    await Promise.all([load(), onChanged()]);
  };
  const latestSalaries = [...salaries]
    .sort((left, right) => right.salary.period.localeCompare(left.salary.period))
    .slice(0, 6);
  const cardMovements = cardStatements
    .flatMap((statement) => statement.items
      .filter((item) => Boolean(item.transactionId) && ["purchase", "fee", "interest", "tax"].includes(item.itemType))
      .map((item) => ({ statement, item })))
    .sort((left, right) => right.item.purchaseDate.localeCompare(left.item.purchaseDate))
    .slice(0, 50);
  const visibleRelationIssues = relationAudit?.issues.filter((issue) => relationEntityFilter === "all" || issue.entity === relationEntityFilter) ?? [];
  const relationSections: Array<{ entity: FinanceRelationEntity; label: string }> = [
    { entity: "purchase", label: "Tickets sin movimiento o duplicados" },
    { entity: "statement", label: "Líneas de tarjeta sin conciliación" },
    { entity: "service", label: "Servicios sin ocurrencia" },
    { entity: "savings-movement", label: "Movimientos de ahorro incompletos" },
  ];

  return (
    <section className="finance-records" aria-labelledby="finance-records-title">
      <div className="finance-section-heading">
        <div>
          <h2 id="finance-records-title">Documentos y patrimonio</h2>
          <p className="finance-muted">Tickets, precios, sueldos, resúmenes de tarjeta, cuotas y valuaciones mantienen su historial.</p>
        </div>
        <div className="finance-actions">
          <button type="button" onClick={() => setForm("ticket")}>Cargar ticket</button>
          <button type="button" onClick={() => setForm("salary")}>Cargar sueldo</button>
          <button type="button" onClick={() => setForm("card-statement")}>Cargar resumen</button>
          <button type="button" onClick={() => setForm("installments")}>Compra en cuotas</button>
          <button type="button" onClick={() => setForm("investment")}>Valuar activo/deuda</button>
        </div>
      </div>
      <SalaryEvolutionChart salaries={salaries} />
      <CreditCardEvolutionChart accounts={accounts} statements={cardStatements} />
      <DebtRatioEvolutionChart history={debtRatioHistory} />
      {error && <p className="finance-error" role="alert">{error}</p>}
      <div className="finance-grid">
        <article className="finance-card">
          <h3>Patrimonio al día</h3>
          {netWorth && Object.entries(netWorth.byCurrency).length ? (
            <ul className="finance-category-list">{Object.entries(netWorth.byCurrency).map(([currency, value]) => <li key={currency}><span>{currency}</span><strong>{value}</strong></li>)}</ul>
          ) : <p className="finance-muted">Sin valuaciones registradas.</p>}
          {netWorthHistory.length > 1 && <details><summary>Evolución por moneda</summary><ul className="finance-category-list">{netWorthHistory.slice(-12).reverse().map((point) => <li key={point.asOf}><span>{point.asOf}</span><strong>{Object.entries(point.byCurrency).map(([currency, value]) => `${currency} ${value}`).join(" · ")}</strong></li>)}</ul></details>}
        </article>
        <article className="finance-card">
          <h3>Últimos sueldos</h3>
          {latestSalaries.length ? <ul className="finance-category-list">{latestSalaries.map(({ salary }) => { const loadedDate = formatFinanceLoadedDate(salary.createdAt); return <li key={salary.id}><span>{salary.period} · {salary.employer}<small>Cobrado el {salary.paymentDate}{loadedDate && <><br />Cargado el {loadedDate}</>}</small></span><strong>Neto {formatSalaryNet(salary.netAmount, salary.currency)}</strong></li> })}</ul> : <p className="finance-muted">Sin recibos registrados.</p>}
        </article>
      </div>
       <article className="finance-card" aria-labelledby="finance-record-relations-title">
         <h3 id="finance-record-relations-title">Relaciones y evidencia</h3>
         {!relationAudit || relationAudit.incompleteEntityCount === 0 ? <p className="finance-success" role="status">No hay relaciones incompatibles detectadas en los registros consultados.</p> : <>
           <p className="finance-warning" role="status">{relationAudit.incompleteEntityCount} registro(s) requieren revisión. No se modificaron datos automáticamente.</p>
           <div className="finance-form-row"><label>Explorar <select value={relationEntityFilter} onChange={(event) => setRelationEntityFilter(event.target.value as FinanceRelationEntity | "all")}><option value="all">Todas las relaciones</option><option value="purchase">Tickets</option><option value="statement">Tarjetas</option><option value="service">Servicios</option><option value="savings-movement">Ahorro</option><option value="transaction">Movimientos</option></select></label></div>
           <ul className="finance-category-list">{visibleRelationIssues.slice(0, 20).map((issue) => <li key={`${issue.entity}-${issue.entityId}-${issue.relation}-${issue.code}`}><span>{issue.entity} · {issue.relation}<small>{issue.message}</small></span><strong>{issue.severity === "error" ? "Revisar" : "Completar"}</strong>{issue.relation === "transaction" && ["missing-optional", "not-found", "kind-mismatch", "duplicate"].includes(issue.code) && <RelationRepairAction library={library} issue={issue} transactions={transactions} onChanged={saved} />}</li>)}</ul>
           {visibleRelationIssues.length > 20 && <p className="finance-muted">Hay más relaciones fuera de esta vista.</p>}
           <div className="finance-grid">{relationSections.map(({ entity, label }) => { const count = relationAudit.issues.filter((issue) => issue.entity === entity).length; return <section className="finance-card" key={entity} aria-label={label}><h4>{label}</h4><p className={count ? "finance-warning" : "finance-success"}>{count ? `${count} hallazgo(s) para revisar.` : "Sin hallazgos."}</p></section> })}</div>
         </>}
       </article>
       <details className="finance-card"><summary>Historial de reparaciones de relaciones ({relationRepairs.length})</summary>{relationRepairs.length === 0 ? <p className="finance-muted">Todavía no hay reparaciones persistidas.</p> : <ul className="finance-category-list">{relationRepairs.slice(0, 20).map((repair) => <li key={repair.id}><span>{repair.relationType} · {repair.relationId}<small>{repair.previousTransactionId ?? "sin vínculo"} → {repair.newTransactionId ?? "sin vínculo"}<br />{repair.reason ?? "Sin motivo"}</small></span><strong>{repair.createdAt ?? ""}</strong></li>)}</ul>}</details>
      <div className="finance-grid">
        <article className="finance-card">
          <h3>Movimientos de tarjetas</h3>
          {cardMovements.length ? <ul className="finance-category-list">{cardMovements.map(({ statement, item }) => <li key={item.transactionId}><span>{item.description}<small>{statement.issuer}{statement.cardLastFour ? ` · •••• ${statement.cardLastFour}` : ""} · {statement.period} · {item.purchaseDate} · {item.itemType}</small></span><strong>{item.currency} {item.amount}</strong></li>)}</ul> : <p className="finance-muted">Sin movimientos creados desde resúmenes.</p>}
        </article>
      </div>
      <div className="finance-grid">
        <article className="finance-card">
          <h3>Compras documentadas</h3>
          {purchases.length ? <ul className="finance-category-list">{purchases.slice(0, 8).map((purchase) => <li key={purchase.id}><span>{purchase.merchantName}<small>{purchase.observedAt} · {purchase.itemCount} productos · {purchase.status}</small></span><strong>{purchase.currency} {purchase.totalAmount}</strong></li>)}</ul> : <p className="finance-muted">Sin tickets registrados.</p>}
        </article>
        <article className="finance-card">
          <h3>Historial de precios</h3>
          {prices.length ? <ul className="finance-category-list">{prices.slice(0, 8).map((price) => <li key={price.id}><span>{price.productName}<small>{price.merchantName ?? "Sin comercio"} · {price.observedAt}</small></span><strong>{price.currency} {price.unitPrice}</strong></li>)}</ul> : <p className="finance-muted">Sin observaciones de precio.</p>}
        </article>
      </div>
      <div className="finance-grid">
        <article className="finance-card">
          <h3>Resúmenes de tarjeta</h3>
          {cardStatements.length ? <ul className="finance-category-list">{cardStatements.slice(0, 8).map((statement) => { const loadedDate = formatFinanceLoadedDate(statement.createdAt); return <li key={statement.id}><span>{statement.issuer}{statement.cardLastFour ? ` · •••• ${statement.cardLastFour}` : ""}<small>{statement.period} · vence {statement.dueDate} · {statement.items.length} movimientos{loadedDate && <><br />Cargado el {loadedDate}</>}</small></span><strong>{statement.currency} {statement.totalDue}</strong></li> })}</ul> : <p className="finance-muted">Sin resúmenes registrados.</p>}
        </article>
        <article className="finance-card">
          <h3>Tratamiento contable</h3>
          <p className="finance-muted">Los consumos y cargos crean gastos en la cuenta de tarjeta. Pagos y créditos concilian el resumen; el total a pagar no se duplica como gasto.</p>
        </article>
      </div>
      {form === "ticket" && <TicketForm library={library} accounts={accounts} onCancel={() => setForm(null)} onSave={async (purchase) => { await saveFinancePurchase(library, purchase); await queueFinanceAudit(library, purchase.observedAt.slice(0, 7), `ui:purchase:${purchase.id}`, "Alta de compra desde Finanzas"); await saved(); }} />}
      {form === "salary" && <SalaryForm library={library} accounts={accounts} onCancel={() => setForm(null)} onSave={async (salary) => { await saveFinanceSalary(library, salary); await queueFinanceAudit(library, salary.paymentDate.slice(0, 7), `ui:salary:${salary.id}`, "Alta de sueldo desde Finanzas"); await saved(); }} />}
      {form === "card-statement" && <CreditCardStatementForm library={library} accounts={accounts} onCancel={() => setForm(null)} onSave={async (statement) => {
        const [services, occurrences] = await Promise.all([listFinanceServices(library), listFinanceServiceOccurrences(library, statement.period)]);
        const preview = reconcileFinanceCardServices({ ...statement, items: statement.items.map((item) => ({ ...item, transactionId: item.transactionId ?? `preview:${item.id}` })) }, services, occurrences);
        const previewText = preview.assignments.map((assignment) => `${assignment.lineId} → ${assignment.period}`).join(", ") || "sin asignaciones automáticas";
        const ambiguityText = preview.ambiguousGroups.length ? ` Hay ${preview.ambiguousGroups.length} grupo(s) ambiguo(s) que no se asignarán automáticamente.` : "";
        const accepted = await confirm({ title: "Vista previa del resumen y conciliación", message: `Se guardará el resumen del período ${statement.period}. Conciliación prevista: ${previewText}.${ambiguityText}`, confirmLabel: "Continuar", tone: "default" });
        if (!accepted) return;
        const reinforced = await confirm({ title: "Confirmación reforzada", message: "Confirmá nuevamente para persistir el resumen y aplicar únicamente las asociaciones inequívocas.", confirmLabel: "Guardar resumen", tone: "danger" });
        if (!reinforced) return;
        await saveFinanceCreditCardStatement(library, statement);
        await queueFinanceAudit(library, statement.period, `ui:card-statement:${statement.id}`, "Alta de resumen de tarjeta desde Finanzas");
        await saved();
      }} />}
      {form === "installments" && <InstallmentForm accounts={accounts} onCancel={() => setForm(null)} onSave={async (plan) => { await saveFinanceInstallmentPlan(library, plan); await saved(); }} />}
      {form === "investment" && <InvestmentForm accounts={accounts} onCancel={() => setForm(null)} onSave={async (investment) => { await saveFinanceInvestment(library, investment); await saved(); }} />}
    </section>
  );
}

function relationRepairType(entity: FinanceRelationEntity): FinanceRelationRepairType | null {
  if (entity === "purchase") return "purchase-transaction"
  if (entity === "statement") return "statement-item-transaction"
  if (entity === "savings-movement") return "savings-movement-transaction"
  return null
}

function RelationRepairAction({ library, issue, transactions, onChanged }: { library: NotiaLibrary; issue: FinanceRelationIssue; transactions: FinanceTransaction[]; onChanged: () => Promise<void> }) {
  const { confirm } = useConfirmationEngine()
  const repairType = relationRepairType(issue.entity)
  const candidates = transactions.filter((transaction) => ["confirmed", "corrected"].includes(transaction.status) && transaction.transactionType === "expense")
  const initialCandidate = issue.currentTransactionId && candidates.some((candidate) => candidate.id === issue.currentTransactionId) ? issue.currentTransactionId : candidates[0]?.id ?? ""
  const [selectedTransactionId, setSelectedTransactionId] = useState(initialCandidate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!repairType) return null
  const allowUnlink = repairType !== "purchase-transaction"
  const repair = async () => {
    const newTransactionId = selectedTransactionId || null
    if (!newTransactionId && !allowUnlink) { setError("Un ticket debe conservar un movimiento asociado."); return }
    const accepted = await confirm({ title: "Confirmar reparación de relación", message: `Se ${newTransactionId ? "asociará" : "desvinculará"} esta evidencia ${newTransactionId ? `al movimiento ${newTransactionId}` : "del movimiento actual"}. Se conservará el historial de la relación.`, confirmLabel: "Aplicar reparación", tone: "danger" })
    if (!accepted) return
    setBusy(true); setError(null)
    try {
      await repairFinanceRelation(library, { operationId: crypto.randomUUID(), relationType: repairType, relationId: issue.targetId ?? issue.entityId, newTransactionId, expectedTransactionId: issue.currentTransactionId ?? null, reason: "Reparación explícita desde auditoría de Finanzas" })
      await onChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo reparar la relación.") } finally { setBusy(false) }
  }
  return <div className="finance-relation-repair"><label>Movimiento <select disabled={busy} value={selectedTransactionId} onChange={(event) => setSelectedTransactionId(event.target.value)}><option value="">Sin asociación</option>{candidates.map((transaction) => <option key={transaction.id} value={transaction.id}>{transaction.effectiveDate} · {transaction.description} · {transaction.currency} {transaction.amount}</option>)}</select></label><button type="button" disabled={busy || (!selectedTransactionId && !allowUnlink)} onClick={() => void repair()}>{busy ? "Guardando…" : "Reparar relación"}</button>{error && <small className="finance-error" role="alert">{error}</small>}</div>
}

interface FormProps<T> { accounts: FinanceAccount[]; onCancel: () => void; onSave: (value: T) => Promise<void> }

function DialogForm({ title, children, onSubmit, onCancel, error, submitLabel = "Guardar" }: { title: string; children: React.ReactNode; onSubmit: (event: FormEvent) => void; onCancel: () => void; error: string | null; submitLabel?: string }) {
  return <div className="finance-modal-backdrop" role="presentation"><form className="finance-form finance-form--wide" aria-label={title} onSubmit={onSubmit}><h2>{title}</h2>{children}{error && <p className="finance-error" role="alert">{error}</p>}<div className="finance-form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button type="submit">{submitLabel}</button></div></form></div>;
}

function AccountCurrencyFields({ accounts, accountId, currency, setAccountId, setCurrency }: { accounts: FinanceAccount[]; accountId: string; currency: FinanceCurrency; setAccountId: (value: string) => void; setCurrency: (value: FinanceCurrency) => void }) {
  return <><label>Cuenta<select required value={accountId} onChange={(event) => { const id = event.target.value; setAccountId(id); const account = accounts.find((candidate) => candidate.id === id); if (account) setCurrency(account.currency); }}><option value="">Seleccionar</option>{accounts.filter((account) => account.active && account.accountType !== "savings_reserve").map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><label>Moneda<select value={currency} disabled><option>{currency}</option></select></label></>;
}

function TicketForm({ library, accounts, onCancel, onSave }: FormProps<FinancePurchaseRecord> & { library: NotiaLibrary }) {
  const [accountId, setAccountId] = useState(""); const [currency, setCurrency] = useState<FinanceCurrency>("ARS"); const [merchant, setMerchant] = useState(""); const [date, setDate] = useState(today()); const [lines, setLines] = useState(""); const [discount, setDiscount] = useState("0"); const [tax, setTax] = useState("0"); const [total, setTotal] = useState(""); const [reference, setReference] = useState(""); const [rawExtraction, setRawExtraction] = useState<string | null>(null); const [extracting, setExtracting] = useState(false); const [status, setStatus] = useState<"pending" | "confirmed">("pending"); const [error, setError] = useState<string | null>(null);
  const items = lines.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [description = "", quantity = "1", unitPrice = "0", lineTotal = "0"] = line.split("|").map((part) => part.trim()); return { id: crypto.randomUUID(), originalDescription: description, quantity, unitPrice, discountAmount: "0", lineTotal }; });
  const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0).toFixed(2);
  const purchase: FinancePurchaseRecord = { id: crypto.randomUUID(), accountId, merchantName: merchant, observedAt: date, currency, subtotalAmount: subtotal, discountAmount: discount, taxAmount: tax, totalAmount: total, status, sourceReference: reference || null, rawExtraction, items };
  const validation = validateTicketArithmetic(purchase);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (status === "confirmed" && !validation?.valid) { setError("Revisá la discrepancia antes de confirmar."); return; } try { await onSave(purchase); } catch (reason) { setError(financeErrorMessage(reason)); } };
  const extract = async () => { if (!reference.trim()) return; setExtracting(true); setError(null); try { const result = await extractFinanceDocument(library, `ticket-extraction:${crypto.randomUUID()}`, reference, "ticket"); setRawExtraction(JSON.stringify(result.rawResult)); } catch (reason) { setError(financeErrorMessage(reason)); } finally { setExtracting(false); } };
  return <DialogForm title="Vista previa del ticket" onSubmit={submit} onCancel={onCancel} error={error}><AccountCurrencyFields accounts={accounts} accountId={accountId} currency={currency} setAccountId={setAccountId} setCurrency={setCurrency} /><label>Comercio<input required value={merchant} onChange={(event) => setMerchant(event.target.value)} /></label><label>Fecha<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Productos, uno por línea: descripción | cantidad | precio unitario | total<textarea required rows={5} value={lines} onChange={(event) => setLines(event.target.value)} placeholder="Yerba 1kg | 1 | 3200.00 | 3200.00" /></label><div className="finance-form-row"><label>Subtotal<input readOnly value={subtotal} /></label><label>Descuento<input inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} /></label><label>Impuestos<input inputMode="decimal" value={tax} onChange={(event) => setTax(event.target.value)} /></label><label>Total<input required inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} /></label></div><p className={validation?.valid ? "finance-success" : "finance-warning"} role="status">Calculado: {validation?.calculatedTotal ?? "—"} · diferencia: {validation?.discrepancy ?? "—"}</p><label>Ruta del archivo original<input value={reference} onChange={(event) => setReference(event.target.value)} /></label><button type="button" disabled={!reference.trim() || extracting} onClick={() => void extract()}>{extracting ? "Extrayendo…" : "Extraer con LlamaCloud"}</button>{rawExtraction && <details><summary>Respuesta cruda preservada</summary><pre className="finance-raw-extraction">{rawExtraction}</pre></details>}<label>Estado<select value={status} onChange={(event) => setStatus(event.target.value as "pending" | "confirmed")}><option value="pending">Pendiente para corregir</option><option value="confirmed">Confirmado</option></select></label></DialogForm>;
}

function SalaryForm({ library, accounts, onCancel, onSave }: FormProps<Parameters<typeof saveFinanceSalary>[1]> & { library: NotiaLibrary }) {
  const [accountId, setAccountId] = useState(""); const [currency, setCurrency] = useState<FinanceCurrency>("ARS"); const [period, setPeriod] = useState(today().slice(0, 7)); const [date, setDate] = useState(today()); const [employer, setEmployer] = useState(""); const [gross, setGross] = useState(""); const [deductions, setDeductions] = useState("0"); const [net, setNet] = useState(""); const [conceptsText, setConceptsText] = useState(""); const [status, setStatus] = useState<"pending" | "confirmed">("pending"); const [reference, setReference] = useState(""); const [rawExtraction, setRawExtraction] = useState<string | null>(null); const [extracting, setExtracting] = useState(false); const [error, setError] = useState<string | null>(null);
  const calculated = (Number(gross || 0) - Number(deductions || 0)).toFixed(2);
  const extract = async () => { setExtracting(true); setError(null); try { const result = await extractFinanceDocument(library, crypto.randomUUID(), reference, "salary"); const draft = parseSalaryExtraction(result.rawResult); if (draft.period) setPeriod(draft.period.slice(0, 7)); if (draft.paymentDate) setDate(draft.paymentDate.slice(0, 10)); if (draft.employer) setEmployer(draft.employer); if (draft.grossAmount) setGross(draft.grossAmount); if (draft.deductionsTotal) setDeductions(draft.deductionsTotal); if (draft.netAmount) setNet(draft.netAmount); if (draft.currency) setCurrency(draft.currency); if (draft.concepts?.length) setConceptsText(draft.concepts.map((concept) => `${concept.name} | ${concept.conceptType} | ${concept.amount}`).join("\n")); setRawExtraction(JSON.stringify(result.rawResult, null, 2)); } catch (reason) { setError(financeErrorMessage(reason)); } finally { setExtracting(false); } };
  const submit = async (event: FormEvent) => { event.preventDefault(); try { await onSave({ id: crypto.randomUUID(), period, paymentDate: date, employer, grossAmount: gross, deductionsTotal: deductions, netAmount: net, currency, accountId, status, sourceReference: reference || null, rawExtraction, concepts: conceptsText.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [name = "", type = "earning", amount = "0"] = line.split("|").map((part) => part.trim()); return { id: crypto.randomUUID(), name, conceptType: type === "deduction" ? "deduction" : "earning", amount }; }) }); } catch (reason) { setError(financeErrorMessage(reason)); } };
  return <DialogForm title="Vista previa del recibo de sueldo" onSubmit={submit} onCancel={onCancel} error={error}><AccountCurrencyFields accounts={accounts} accountId={accountId} currency={currency} setAccountId={setAccountId} setCurrency={setCurrency} /><label>Archivo original dentro de la biblioteca<input value={reference} onChange={(event) => setReference(event.target.value)} /></label><button type="button" disabled={!reference.trim() || extracting} onClick={() => void extract()}>{extracting ? "Extrayendo…" : "Extraer campos con LlamaCloud"}</button><label>Período<input required type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label><label>Fecha de cobro<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Empleador<input required value={employer} onChange={(event) => setEmployer(event.target.value)} /></label><div className="finance-form-row"><label>Bruto<input required inputMode="decimal" value={gross} onChange={(event) => setGross(event.target.value)} /></label><label>Descuentos<input required inputMode="decimal" value={deductions} onChange={(event) => setDeductions(event.target.value)} /></label><label>Neto<input required inputMode="decimal" value={net} onChange={(event) => setNet(event.target.value)} /></label></div><p className={calculated === Number(net || 0).toFixed(2) ? "finance-success" : "finance-warning"} role="status">Bruto menos descuentos: {calculated}</p><label>Conceptos: nombre | earning/deduction | importe<textarea rows={4} value={conceptsText} onChange={(event) => setConceptsText(event.target.value)} /></label>{rawExtraction && <details><summary>Respuesta cruda preservada</summary><pre className="finance-raw-extraction">{rawExtraction}</pre></details>}<label>Estado<select value={status} onChange={(event) => setStatus(event.target.value as "pending" | "confirmed")}><option value="pending">Pendiente</option><option value="confirmed">Confirmado y crear ingreso</option></select></label></DialogForm>;
}

function InstallmentForm({ accounts, onCancel, onSave }: FormProps<Parameters<typeof saveFinanceInstallmentPlan>[1]>) { const [accountId,setAccountId]=useState("");const [currency,setCurrency]=useState<FinanceCurrency>("ARS");const [merchantName,setMerchant]=useState("");const [description,setDescription]=useState("");const [purchaseDate,setDate]=useState(today());const [totalAmount,setTotal]=useState("");const [installmentCount,setCount]=useState(1);const [error,setError]=useState<string|null>(null);const submit=async(event:FormEvent)=>{event.preventDefault();try{await onSave({id:crypto.randomUUID(),accountId,merchantName,description,purchaseDate,currency,totalAmount,installmentCount});}catch(reason){setError(financeErrorMessage(reason));}};return <DialogForm title="Compra en cuotas" onSubmit={submit} onCancel={onCancel} error={error} submitLabel="Generar calendario"><AccountCurrencyFields accounts={accounts.filter((account)=>account.accountType==="credit_card"||account.accountType==="card")} accountId={accountId} currency={currency} setAccountId={setAccountId} setCurrency={setCurrency}/><label>Comercio<input required value={merchantName} onChange={(event)=>setMerchant(event.target.value)}/></label><label>Descripción<input required value={description} onChange={(event)=>setDescription(event.target.value)}/></label><label>Fecha<input required type="date" value={purchaseDate} onChange={(event)=>setDate(event.target.value)}/></label><label>Total<input required inputMode="decimal" value={totalAmount} onChange={(event)=>setTotal(event.target.value)}/></label><label>Cuotas<input required type="number" min={1} max={120} value={installmentCount} onChange={(event)=>setCount(Number(event.target.value))}/></label></DialogForm>; }

function InvestmentForm({ accounts,onCancel,onSave }:FormProps<Parameters<typeof saveFinanceInvestment>[1]>){const [accountId,setAccountId]=useState("");const [currency,setCurrency]=useState<FinanceCurrency>("ARS");const [name,setName]=useState("");const [assetType,setType]=useState<"asset"|"debt"|"cash"|"security">("asset");const [valuationDate,setDate]=useState(today());const [valuationAmount,setAmount]=useState("");const [error,setError]=useState<string|null>(null);const submit=async(event:FormEvent)=>{event.preventDefault();try{await onSave({id:crypto.randomUUID(),accountId:accountId||null,name,assetType,currency,active:true,valuationDate,valuationAmount});}catch(reason){setError(financeErrorMessage(reason));}};return <DialogForm title="Valuación patrimonial" onSubmit={submit} onCancel={onCancel} error={error}><AccountCurrencyFields accounts={accounts} accountId={accountId} currency={currency} setAccountId={setAccountId} setCurrency={setCurrency}/><label>Nombre<input required value={name} onChange={(event)=>setName(event.target.value)}/></label><label>Tipo<select value={assetType} onChange={(event)=>setType(event.target.value as typeof assetType)}><option value="asset">Activo</option><option value="debt">Deuda</option><option value="cash">Efectivo</option><option value="security">Inversión</option></select></label><label>Fecha<input required type="date" value={valuationDate} onChange={(event)=>setDate(event.target.value)}/></label><label>Valuación<input required inputMode="decimal" value={valuationAmount} onChange={(event)=>setAmount(event.target.value)}/></label></DialogForm>;}
