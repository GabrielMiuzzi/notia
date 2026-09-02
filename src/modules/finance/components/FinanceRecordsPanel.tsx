import { useCallback, useEffect, useState, type FormEvent } from "react";
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
} from "../services/financeService";
import type {
  FinanceAccount,
  FinanceCreditCardStatement,
  FinanceDebtRatioHistoryPoint,
  FinanceCurrency,
  FinanceNetWorth,
  FinanceNetWorthHistoryPoint,
  FinancePriceObservation,
  FinancePurchaseRecord,
  FinancePurchaseSummary,
  FinanceSalaryEvolution,
} from "../types/financeTypes";
import { validateTicketArithmetic } from "../engines/ticketValidation";
import { parseSalaryExtraction } from "../engines/salaryExtraction";
import { financeErrorMessage } from "../engines/financeError";
import { CreditCardStatementForm } from "./CreditCardStatementForm";
import { CreditCardEvolutionChart } from "./CreditCardEvolutionChart";
import { DebtRatioEvolutionChart } from "./DebtRatioEvolutionChart";
import { SalaryEvolutionChart } from "./SalaryEvolutionChart";

interface Props {
  library: NotiaLibrary;
  accounts: FinanceAccount[];
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

export function FinanceRecordsPanel({ library, accounts, debtRatioHistory, historyFrom, historyTo, onChanged }: Props) {
  const [form, setForm] = useState<FormKind>(null);
  const [purchases, setPurchases] = useState<FinancePurchaseSummary[]>([]);
  const [prices, setPrices] = useState<FinancePriceObservation[]>([]);
  const [salaries, setSalaries] = useState<FinanceSalaryEvolution[]>([]);
  const [cardStatements, setCardStatements] = useState<FinanceCreditCardStatement[]>([]);
  const [netWorth, setNetWorth] = useState<FinanceNetWorth | null>(null);
  const [netWorthHistory, setNetWorthHistory] = useState<FinanceNetWorthHistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [purchaseRows, priceRows, salaryRows, statementRows, worth, worthHistory] = await Promise.all([
        listFinancePurchases(library),
        listFinancePriceHistory(library),
        listFinanceSalaries(library),
        listFinanceCreditCardStatements(library, { from: historyFrom, to: historyTo }),
        getFinanceNetWorth(library, today()),
        listFinanceNetWorthHistory(library),
      ]);
      setPurchases(purchaseRows);
      setPrices(priceRows);
      setSalaries(salaryRows);
      setCardStatements(statementRows);
      setNetWorth(worth);
      setNetWorthHistory(worthHistory);
      setError(null);
    } catch (reason) {
      setError(financeErrorMessage(reason));
    }
  }, [historyFrom, historyTo, library]);
  useEffect(() => void load(), [load]);
  const saved = async () => {
    setForm(null);
    await Promise.all([load(), onChanged()]);
  };
  const latestSalaries = [...salaries]
    .sort((left, right) => right.salary.period.localeCompare(left.salary.period))
    .slice(0, 6);

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
          {latestSalaries.length ? <ul className="finance-category-list">{latestSalaries.map(({ salary }) => <li key={salary.id}><span>{salary.period} · {salary.employer}<small>Cobrado el {salary.paymentDate}</small></span><strong>Neto {formatSalaryNet(salary.netAmount, salary.currency)}</strong></li>)}</ul> : <p className="finance-muted">Sin recibos registrados.</p>}
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
          {cardStatements.length ? <ul className="finance-category-list">{cardStatements.slice(0, 8).map((statement) => <li key={statement.id}><span>{statement.issuer}{statement.cardLastFour ? ` · •••• ${statement.cardLastFour}` : ""}<small>{statement.period} · vence {statement.dueDate} · {statement.items.length} movimientos</small></span><strong>{statement.currency} {statement.totalDue}</strong></li>)}</ul> : <p className="finance-muted">Sin resúmenes registrados.</p>}
        </article>
        <article className="finance-card">
          <h3>Tratamiento contable</h3>
          <p className="finance-muted">Los consumos y cargos crean gastos en la cuenta de tarjeta. Pagos y créditos concilian el resumen; el total a pagar no se duplica como gasto.</p>
        </article>
      </div>
      {form === "ticket" && <TicketForm library={library} accounts={accounts} onCancel={() => setForm(null)} onSave={async (purchase) => { await saveFinancePurchase(library, purchase); await saved(); }} />}
      {form === "salary" && <SalaryForm library={library} accounts={accounts} onCancel={() => setForm(null)} onSave={async (salary) => { await saveFinanceSalary(library, salary); await saved(); }} />}
      {form === "card-statement" && <CreditCardStatementForm library={library} accounts={accounts} onCancel={() => setForm(null)} onSave={async (statement) => { await saveFinanceCreditCardStatement(library, statement); await saved(); }} />}
      {form === "installments" && <InstallmentForm accounts={accounts} onCancel={() => setForm(null)} onSave={async (plan) => { await saveFinanceInstallmentPlan(library, plan); await saved(); }} />}
      {form === "investment" && <InvestmentForm accounts={accounts} onCancel={() => setForm(null)} onSave={async (investment) => { await saveFinanceInvestment(library, investment); await saved(); }} />}
    </section>
  );
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
