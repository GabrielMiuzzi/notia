import { useState, type FormEvent } from "react";
import type { NotiaLibrary } from "../../../types/notia";
import { financeErrorMessage } from "../engines/financeError";
import { extractFinanceDocument } from "../services/financeService";
import type { FinanceAccount, FinanceCreditCardStatement, FinanceCreditCardStatementItemType, FinanceCurrency } from "../types/financeTypes";

interface Props {
  library: NotiaLibrary;
  accounts: FinanceAccount[];
  onCancel: () => void;
  onSave: (statement: FinanceCreditCardStatement) => Promise<void>;
}

const today = () => new Date().toISOString().slice(0, 10);
const ITEM_TYPES: FinanceCreditCardStatementItemType[] = ["purchase", "fee", "interest", "tax", "payment", "credit"];

export function CreditCardStatementForm({ library, accounts, onCancel, onSave }: Props) {
  const cardAccounts = accounts.filter((account) => account.active && account.accountType === "credit_card");
  const [accountId, setAccountId] = useState("");
  const [currency, setCurrency] = useState<FinanceCurrency>("ARS");
  const [issuer, setIssuer] = useState("");
  const [cardLastFour, setCardLastFour] = useState("");
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [closingDate, setClosingDate] = useState(today());
  const [dueDate, setDueDate] = useState(today());
  const [amounts, setAmounts] = useState({ previousBalance: "0", paymentsAmount: "0", creditsAmount: "0", purchasesAmount: "0", feesAmount: "0", interestAmount: "0", taxesAmount: "0", totalDue: "", minimumPayment: "" });
  const [lines, setLines] = useState("");
  const [reference, setReference] = useState("");
  const [rawExtraction, setRawExtraction] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAmount = (field: keyof typeof amounts, value: string) => setAmounts((current) => ({ ...current, [field]: value }));
  const items = lines.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [purchaseDate = "", description = "", amount = "", rawType = "purchase", installment = ""] = line.split("|").map((part) => part.trim());
    const itemType: FinanceCreditCardStatementItemType = ITEM_TYPES.includes(rawType as FinanceCreditCardStatementItemType) ? rawType as FinanceCreditCardStatementItemType : "purchase";
    const [installmentNumber, installmentCount] = installment.split("/").map(Number);
    return { id: crypto.randomUUID(), purchaseDate, description, amount, currency, itemType, installmentNumber: Number.isInteger(installmentNumber) && installmentNumber > 0 ? installmentNumber : null, installmentCount: Number.isInteger(installmentCount) && installmentCount > 0 ? installmentCount : null };
  });
  const calculatedTotal = (Number(amounts.previousBalance || 0) - Number(amounts.paymentsAmount || 0) - Number(amounts.creditsAmount || 0) + Number(amounts.purchasesAmount || 0) + Number(amounts.feesAmount || 0) + Number(amounts.interestAmount || 0) + Number(amounts.taxesAmount || 0)).toFixed(2);

  const extract = async () => {
    if (!reference.trim()) return;
    setExtracting(true); setError(null);
    try {
      const result = await extractFinanceDocument(library, crypto.randomUUID(), reference, "credit_card_statement");
      setRawExtraction(JSON.stringify(result.rawResult, null, 2));
    } catch (reason) { setError(financeErrorMessage(reason)); } finally { setExtracting(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    try {
      await onSave({ id: crypto.randomUUID(), accountId, issuer, cardLastFour: cardLastFour || null, period, closingDate, dueDate, currency, ...amounts, minimumPayment: amounts.minimumPayment || null, status: "confirmed", sourceReference: reference, rawExtraction, items });
    } catch (reason) { setError(financeErrorMessage(reason)); }
  };

  return <div className="finance-modal-backdrop" role="presentation"><form className="finance-form finance-form--wide" aria-label="Vista previa del resumen de tarjeta" onSubmit={submit}><h2>Vista previa del resumen de tarjeta</h2>{cardAccounts.length === 0 && <p className="finance-warning" role="status">Creá primero una cuenta de tipo tarjeta de crédito.</p>}<label>Cuenta de tarjeta<select required value={accountId} onChange={(event) => { setAccountId(event.target.value); const account = cardAccounts.find((candidate) => candidate.id === event.target.value); if (account) setCurrency(account.currency); }}><option value="">Seleccionar</option>{cardAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><label>Archivo original dentro de la biblioteca<input required value={reference} onChange={(event) => setReference(event.target.value)} /></label><button type="button" disabled={!reference.trim() || extracting} onClick={() => void extract()}>{extracting ? "Extrayendo…" : "Extraer campos con LlamaCloud"}</button><div className="finance-form-row"><label>Emisor<input required value={issuer} onChange={(event) => setIssuer(event.target.value)} /></label><label>Últimos 4 dígitos<input inputMode="numeric" maxLength={4} value={cardLastFour} onChange={(event) => setCardLastFour(event.target.value.replace(/\D/g, ""))} /></label><label>Período<input required type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label></div><div className="finance-form-row"><label>Cierre<input required type="date" value={closingDate} onChange={(event) => setClosingDate(event.target.value)} /></label><label>Vencimiento<input required type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div><div className="finance-form-row">{([['previousBalance','Saldo anterior'],['paymentsAmount','Pagos'],['creditsAmount','Créditos'],['purchasesAmount','Compras'],['feesAmount','Cargos'],['interestAmount','Intereses'],['taxesAmount','Impuestos'],['totalDue','Total a pagar'],['minimumPayment','Pago mínimo']] as Array<[keyof typeof amounts,string]>).map(([field, label]) => <label key={field}>{label}<input required={field !== "minimumPayment"} inputMode="decimal" value={amounts[field]} onChange={(event) => setAmount(field, event.target.value)} /></label>)}</div><p className={calculatedTotal === Number(amounts.totalDue || 0).toFixed(2) ? "finance-success" : "finance-warning"} role="status">Total conciliado: {calculatedTotal}</p><label>Líneas: fecha | descripción | importe | purchase/fee/interest/tax/payment/credit | cuota/total<textarea required rows={7} value={lines} onChange={(event) => setLines(event.target.value)} placeholder="2026-08-15 | Comercio | 12000.00 | purchase | 2/6" /></label>{rawExtraction && <details><summary>Respuesta cruda preservada</summary><pre className="finance-raw-extraction">{rawExtraction}</pre></details>}<p className="finance-muted">Al guardar se concilian consumos y cargos; el total a pagar no se crea como otro gasto.</p>{error && <p className="finance-error" role="alert">{error}</p>}<div className="finance-form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button type="submit" disabled={cardAccounts.length === 0}>Guardar</button></div></form></div>;
}
