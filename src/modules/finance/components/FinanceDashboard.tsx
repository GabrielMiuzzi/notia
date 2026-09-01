import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Plus, RefreshCw } from "lucide-react";
import type { NotiaLibrary } from "../../../types/notia";
import {
  getFinanceDashboard,
  saveFinanceAccount,
  saveFinanceCategory,
  saveFinanceTransaction,
  saveFinanceSavingsReserve,
  saveFinanceSavingsMovement,
  linkFinanceSavingsAccount,
  deleteFinanceAccount,
  deleteFinanceCategory,
  deleteFinanceTransaction,
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
import {
  formatFinanceCents,
  parseFinanceCents,
} from "../engines/financeAmounts";
import { FinanceRecordsPanel } from "./FinanceRecordsPanel";
import { DollarQuotesCards } from "./DollarQuotesCards";
import { subscribeToFinanceDataChanges } from "../services/financeDataEvents";

interface FinanceDashboardProps {
  library: NotiaLibrary;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
function matchesTransfer(type: FinanceSavingsMovement["movementType"]) {
  return type === "contribution" || type === "withdrawal";
}
function formatAmount(value: string, currency = "ARS") {
  return `${currency} ${Number(value || 0).toLocaleString("es-AR")}`;
}
function formatTotals(totals: Record<string, string>) {
  const entries = Object.entries(totals);
  return entries.length === 0
    ? "—"
    : entries
        .map(([currency, value]) => formatAmount(value, currency))
        .join(" · ");
}

export function FinanceDashboard({ library }: FinanceDashboardProps) {
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
  const [isSavingsMovementOpen, setIsSavingsMovementOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinanceAccount | null>(null);
  const [editingCategory, setEditingCategory] = useState<FinanceCategory | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<FinanceTransaction | null>(null);
  const [transactionPage, setTransactionPage] = useState(0);

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

  const filteredTransactions = useMemo(() => data?.transactions ?? [], [data]);

  const expensesByCategory = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, bigint>();
    filteredTransactions
      .filter(
        (item) =>
          item.status === "confirmed" && item.transactionType === "expense",
      )
      .forEach((item) => {
        const key =
          data.categories.find((category) => category.id === item.categoryId)
            ?.name ?? "Sin categoría";
        totals.set(
          key,
          (totals.get(key) ?? 0n) + parseFinanceCents(item.amount),
        );
      });
    return [...totals.entries()].sort((a, b) =>
      b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0,
    );
  }, [data, filteredTransactions]);

  const savingsMovements = useMemo(() => data?.savingsMovements.filter((movement) => (!savingsReserveFilter || movement.reserveId === savingsReserveFilter) && (!savingsCurrencyFilter || movement.currency === savingsCurrencyFilter)) ?? [], [data, savingsCurrencyFilter, savingsReserveFilter]);
  const savingsBreakdown = useMemo(() => {
    const totals = new Map<string, bigint>();
    for (const movement of savingsMovements.filter((item) => item.status === "confirmed")) totals.set(movement.movementType, (totals.get(movement.movementType) ?? 0n) + parseFinanceCents(movement.amount));
    return totals;
  }, [savingsMovements]);
  const transactionPageSize = 50;
  const visibleTransactions = filteredTransactions.slice(transactionPage * transactionPageSize, (transactionPage + 1) * transactionPageSize);
  useEffect(() => setTransactionPage(0), [month]);

  async function submitTransaction(transaction: FinanceTransaction) {
    await saveFinanceTransaction(library, transaction);
    setIsFormOpen(false);
    await refresh();
  }

  if (isLoading && !data)
    return (
      <main className="finance-module" role="status">
        Cargando Finanzas…
      </main>
    );
  return (
    <main className="finance-module">
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
        <>
          <section className="finance-grid">
            <article className="finance-card finance-expenses-card">
              <h2>Gastos por categoría</h2>
              {expensesByCategory.length === 0 ? (
                <p className="finance-muted">
                  Todavía no hay gastos confirmados.
                </p>
              ) : (
                <ul className="finance-category-list">
                  {expensesByCategory.map(([name, amount]) => (
                    <li key={name}>
                      <span>{name}</span>
                      <strong>
                        {formatAmount(formatFinanceCents(amount))}
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </article>
            <article className="finance-card finance-accounts-card">
              <h2>Cuentas</h2>
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
                          <small>{account.accountType}</small>
                        </span>
                        <strong>
                          {formatAmount(
                            account.currentBalance,
                            account.currency,
                          )}
                        </strong>
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
              <span>Ingresos</span>
              <strong>{formatTotals(data.incomeByCurrency)}</strong>
            </article>
            <article>
              <span>Gastos</span>
              <strong>{formatTotals(data.expenseByCurrency)}</strong>
            </article>
            <article>
              <span>Resultado neto</span>
              <strong>{formatTotals(data.netByCurrency)}</strong>
            </article>
          </section>
          {data.transactions.some((transaction) => transaction.status === "pending") && <section className="finance-card finance-pending" role="status"><h2>Cargas pendientes</h2><p>{data.transactions.filter((transaction) => transaction.status === "pending").length} operaciones esperan revisión.</p></section>}
          <section className="finance-card">
            <h2>Movimientos recientes</h2>
            {filteredTransactions.length === 0 ? (
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
                    {visibleTransactions.map((item) => (
                      <tr key={item.id}>
                        <td>{item.effectiveDate}</td>
                        <td>{item.description || "Sin descripción"}</td>
                        <td>{item.transactionType}</td>
                        <td>{formatAmount(item.amount, item.currency)}</td>
                        <td>{item.status}</td>
                        <td>{item.source}</td>
                        <td className="finance-row-actions">
                          <button type="button" onClick={() => setEditingTransaction(item)}>Editar</button>
                          {item.status === "pending" && <button type="button" onClick={async () => { await saveFinanceTransaction(library, { ...item, status: "confirmed" }); await refresh(); }}>Confirmar</button>}
                          {item.status !== "discarded" && <button type="button" onClick={async () => { await saveFinanceTransaction(library, { ...item, status: "discarded" }); await refresh(); }}>Descartar</button>}
                          <button type="button" onClick={async () => { if (window.confirm("¿Eliminar lógicamente este movimiento?")) { await deleteFinanceTransaction(library, item.id); await refresh(); } }}>Eliminar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filteredTransactions.length > transactionPageSize && <nav className="finance-pagination" aria-label="Páginas de movimientos"><button type="button" disabled={transactionPage === 0} onClick={() => setTransactionPage((page) => Math.max(0, page - 1))}>Anterior</button><span>Página {transactionPage + 1} de {Math.ceil(filteredTransactions.length / transactionPageSize)}</span><button type="button" disabled={(transactionPage + 1) * transactionPageSize >= filteredTransactions.length} onClick={() => setTransactionPage((page) => page + 1)}>Siguiente</button></nav>}
          </section>
          <section className="finance-card" aria-labelledby="finance-balance-history"><h2 id="finance-balance-history">Evolución mensual de saldos</h2>{data.balanceHistory.length ? <div className="finance-balance-chart">{data.balanceHistory.map((snapshot) => <div key={snapshot.month}><span>{snapshot.month}</span>{Object.entries(snapshot.byCurrency).map(([currency, value]) => <strong key={currency}>{currency} {value}</strong>)}</div>)}</div> : <p className="finance-muted">Todavía no hay meses suficientes para mostrar evolución.</p>}</section>
        </>
      )}
      {data && (
        <section className="finance-card">
          <div className="finance-section-heading">
            <h2>Ahorro</h2>
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
            </ul><div className="finance-savings-breakdown" aria-label="Resumen de ahorro del mes">{["contribution", "withdrawal", "return", "loss", "adjustment"].map((kind) => <span key={kind}>{kind}: <strong>{formatFinanceCents(savingsBreakdown.get(kind) ?? 0n)}</strong></span>)}</div><div className="finance-table-wrap"><table><thead><tr><th>Fecha</th><th>Reserva</th><th>Tipo</th><th>Importe</th><th>Motivo</th></tr></thead><tbody>{savingsMovements.map((movement) => <tr key={movement.id}><td>{movement.effectiveDate}</td><td>{data.savings.find((reserve) => reserve.id === movement.reserveId)?.name}</td><td>{movement.movementType}</td><td>{movement.currency} {movement.amount}</td><td>{movement.reason || movement.description || "—"}</td></tr>)}</tbody></table></div></>
          )}
        </section>
      )}
      {data && <section className="finance-card" aria-labelledby="finance-category-settings"><div className="finance-section-heading"><h2 id="finance-category-settings">Configuración de categorías</h2><button type="button" onClick={() => setIsCategoryFormOpen(true)}>Nueva categoría</button></div><ul className="finance-category-list">{data.categories.map((category) => <li key={category.id}><span>{category.name}<small>{category.kind} · {category.active ? "activa" : "inactiva"}{category.parentId ? " · subcategoría" : ""}</small></span><span className="finance-row-actions"><button type="button" onClick={() => setEditingCategory(category)}>Editar</button>{category.active && <button type="button" onClick={async () => { if (window.confirm(`¿Desactivar ${category.name}?`)) { await deleteFinanceCategory(library, category.id); await refresh(); } }}>Desactivar</button>}</span></li>)}</ul></section>}
      {data && <FinanceRecordsPanel library={library} accounts={data.accounts} onChanged={refresh} />}
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
      {editingTransaction && <FinanceTransactionForm initial={editingTransaction} accounts={data?.accounts ?? []} categories={data?.categories ?? []} onCancel={() => setEditingTransaction(null)} onSubmit={async (transaction) => { await saveFinanceTransaction(library, { ...transaction, status: transaction.status === "pending" ? "corrected" : transaction.status }); setEditingTransaction(null); await refresh(); }} />}
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
      {isSavingsMovementOpen && (
        <FinanceSavingsMovementForm
          reserves={data?.savings ?? []}
          accounts={data?.accounts ?? []}
          onCancel={() => setIsSavingsMovementOpen(false)}
          onSubmit={async (movement) => {
            await saveFinanceSavingsMovement(library, movement);
            setIsSavingsMovementOpen(false);
            await refresh();
          }}
        />
      )}
    </main>
  );
}

function FinanceSavingsMovementForm({
  reserves,
  accounts,
  onCancel,
  onSubmit,
}: {
  reserves: FinanceSavingsReserve[];
  accounts: DashboardData["accounts"];
  onCancel: () => void;
  onSubmit: (movement: FinanceSavingsMovement) => Promise<void>;
}) {
  const firstReserve = reserves.find((reserve) => reserve.active);
  const [reserveId, setReserveId] = useState(firstReserve?.id ?? "");
  const [movementType, setMovementType] =
    useState<FinanceSavingsMovement["movementType"]>("contribution");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [accountId, setAccountId] = useState("");
  const [linkedTransactionId, setLinkedTransactionId] = useState("");
  const [saving, setSaving] = useState(false);
  const reserve = reserves.find((item) => item.id === reserveId);
  const requiresReason = movementType === "withdrawal";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reserve || !amount || (matchesTransfer(movementType) && !accountId) || (requiresReason && !reason.trim()))
      return;
    setSaving(true);
    try {
      await onSubmit({
        id: crypto.randomUUID(),
        reserveId,
        accountId,
        movementType,
        amount,
        currency: reserve.currency,
        effectiveDate: new Date().toISOString().slice(0, 10),
        description: movementType,
        reason: reason || null,
        source: "manual",
        status: "confirmed",
        linkedTransactionId: linkedTransactionId || null,
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="finance-modal-backdrop">
      <form className="finance-form" onSubmit={submit}>
        <h2>Movimiento de ahorro</h2>
        <label>
          Reserva
          <select
            required={matchesTransfer(movementType)}
            value={reserveId}
            onChange={(event) => setReserveId(event.target.value)}
          >
            {reserves
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.currency})
                </option>
              ))}
          </select>
        </label>
        <label>
          Cuenta vinculada
          <select
            required
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">Seleccionar…</option>
            {accounts
              .filter(
                (item) => item.active && item.currency === reserve?.currency,
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Tipo
          <select
            value={movementType}
            onChange={(event) =>
              setMovementType(
                event.target.value as FinanceSavingsMovement["movementType"],
              )
            }
          >
            <option value="contribution">Aporte</option>
            <option value="withdrawal">Retiro</option>
            <option value="return">Rendimiento</option>
            <option value="loss">Pérdida</option>
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
        {requiresReason && (
          <label>
            Motivo del retiro
            <input
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        )}
        {requiresReason && <label>Movimiento de gasto relacionado (opcional)<input value={linkedTransactionId} onChange={(event) => setLinkedTransactionId(event.target.value)} /></label>}
        <div className="finance-form-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" disabled={saving || !reserve || (matchesTransfer(movementType) && !accountId)}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
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
  const [openingBalance, setOpeningBalance] = useState(initial?.openingBalance ?? "0");
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
        openingBalance,
        currentBalance: initial?.currentBalance ?? openingBalance,
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
            <option value="savings">Ahorro</option>
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
        <label>
          Saldo inicial
          <input
            required
            inputMode="decimal"
            value={openingBalance}
            onChange={(event) => setOpeningBalance(event.target.value)}
          />
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
