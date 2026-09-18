import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Plus, RefreshCw } from "lucide-react"
import { useConfirmationEngine } from "../../../context/confirmation/useConfirmationEngine"
import type { NotiaLibrary } from "../../../types/notia"
import { decideFinanceAuditProposal, getFinanceDashboard, listFinanceAuditProposals, listFinanceAuditRuns, listFinanceCreditCardStatements, listFinanceServiceInvoices, listFinanceServiceOccurrenceVersions, listFinanceServiceOccurrences, listFinanceServices, runFinanceAudit, saveFinanceService, saveFinanceServiceInvoice, saveFinanceServiceOccurrence, setFinanceServiceActive } from "../services/financeService"
import { formatFinanceAuditProposalPreview, type FinanceAccount, type FinanceAuditProposal, type FinanceCardServiceResolution, type FinanceCategory, type FinanceCreditCardStatement, type FinanceService, type FinanceServiceInvoice, type FinanceServiceOccurrence, type FinanceTransaction } from "../types/financeTypes"
import { financeErrorMessage } from "../engines/financeError"
import { serviceOccurrenceDifference } from "../engines/serviceEngine"
import { subscribeToFinanceDataChanges } from "../services/financeDataEvents"

function monthNow() { return new Date().toISOString().slice(0, 7) }
function amount(value: string | null | undefined, currency: string) { return value ? `${currency} ${Number(value).toLocaleString("es-AR")}` : "—" }
function proposalChange(value: string) {
  try {
    const parsed = JSON.parse(value) as { description?: unknown }
    return typeof parsed.description === "string" && parsed.description.trim() ? parsed.description : value
  } catch { return value }
}

export function FinanceServicesView({ library }: { library: NotiaLibrary }) {
  const [month, setMonth] = useState(monthNow)
  const [services, setServices] = useState<FinanceService[]>([])
  const [occurrences, setOccurrences] = useState<FinanceServiceOccurrence[]>([])
  const [proposals, setProposals] = useState<FinanceAuditProposal[]>([])
  const [statements, setStatements] = useState<FinanceCreditCardStatement[]>([])
  const [auditRuns, setAuditRuns] = useState<import("../types/financeTypes").FinanceAuditRun[]>([])
  const [invoices, setInvoices] = useState<FinanceServiceInvoice[]>([])
  const [history, setHistory] = useState<import("../types/financeTypes").FinanceServiceOccurrenceVersion[]>([])
  const [historyTitle, setHistoryTitle] = useState<string | null>(null)
  const [categories, setCategories] = useState<FinanceCategory[]>([])
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<FinanceService | null>(null)
  const [paying, setPaying] = useState<FinanceService | null>(null)
  const [paidAmount, setPaidAmount] = useState("")
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [transactionId, setTransactionId] = useState("")
  const [invoiceAmount, setInvoiceAmount] = useState("")
  const [invoiceDueDate, setInvoiceDueDate] = useState("")
  const [expenses, setExpenses] = useState<FinanceTransaction[]>([])
  const [categoryFilter, setCategoryFilter] = useState("")
  const [currencyFilter, setCurrencyFilter] = useState("")
  const [modalityFilter, setModalityFilter] = useState("")
  const [activeFilter, setActiveFilter] = useState("active")
  const [auditStatusFilter, setAuditStatusFilter] = useState("")
  const [auditRuleFilter, setAuditRuleFilter] = useState("")
  const [auditServiceFilter, setAuditServiceFilter] = useState("")
  const { confirm } = useConfirmationEngine()

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [servicesResult, occurrencesResult, dashboardResult, auditResult, invoicesResult, runsResult, statementsResult] = await Promise.allSettled([
        listFinanceServices(library), listFinanceServiceOccurrences(library, month), getFinanceDashboard(library, month), listFinanceAuditProposals(library, month), listFinanceServiceInvoices(library, month), listFinanceAuditRuns(library, month), listFinanceCreditCardStatements(library, { from: month, to: month }),
      ])
      if (servicesResult.status === "rejected") throw servicesResult.reason
      const listed = servicesResult.value
      const current = occurrencesResult.status === "fulfilled" ? occurrencesResult.value : []
      const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null
      const audit = auditResult.status === "fulfilled" ? auditResult.value : []
      const listedInvoices = invoicesResult.status === "fulfilled" ? invoicesResult.value : []
      const runs = runsResult.status === "fulfilled" ? runsResult.value : []
      const listedStatements = statementsResult.status === "fulfilled" ? statementsResult.value : []
      setServices(listed); setOccurrences(current); setCategories(dashboard?.categories ?? []); setAccounts(dashboard?.accounts ?? []); setExpenses(dashboard?.transactions.filter((transaction) => transaction.transactionType === "expense" && transaction.status !== "discarded") ?? []); setStatements(listedStatements); setProposals(audit.map((proposal) => ({ ...proposal, currentData: formatFinanceAuditProposalPreview(proposal, listed, listedStatements) }))); setInvoices(listedInvoices); setAuditRuns(runs)
      const partialFailure = [occurrencesResult, dashboardResult, auditResult, invoicesResult, runsResult, statementsResult].find((result) => result.status === "rejected")
      if (partialFailure?.status === "rejected") setError(financeErrorMessage(partialFailure.reason, "Los servicios se cargaron parcialmente; algunas evidencias aún no están disponibles."))
    } catch (reason) { setError(financeErrorMessage(reason, "No se pudieron cargar los servicios.")) } finally { setLoading(false) }
  }, [library, month])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => subscribeToFinanceDataChanges(() => { void refresh() }), [refresh])

  const visible = useMemo(() => services.filter((service) =>
    (!activeFilter || activeFilter === "all" || (activeFilter === "active" ? service.active : !service.active))
    && (!categoryFilter || service.categoryId === categoryFilter)
    && (!currencyFilter || service.currency === currencyFilter)
    && (!modalityFilter || service.modality === modalityFilter)), [services, activeFilter, categoryFilter, currencyFilter, modalityFilter])

  function openNew() {
    setEditing({ id: crypto.randomUUID(), name: "", categoryId: categories.find((category) => category.kind === "expense" && category.active)?.id ?? "", currency: "ARS", expectedAmount: "", dueDay: null, defaultAccountId: null, provider: null, modality: "fixed", active: true })
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return
    const accepted = await confirm({ title: services.some((service) => service.id === editing.id) ? "Confirmar edición de servicio" : "Confirmar nuevo servicio", message: `Se guardará el servicio mensual “${editing.name || "sin nombre"}” por ${editing.expectedAmount || "0"} ${editing.currency}. Esta acción requiere confirmación individual reforzada.`, confirmLabel: "Confirmar", tone: "default" })
    if (!accepted) return
    const reinforced = await confirm({ title: "Confirmación reforzada", message: "Confirmá nuevamente para persistir este cambio financiero.", confirmLabel: "Confirmar cambio", tone: "danger" })
    if (!reinforced) return
    try { await saveFinanceService(library, editing); setEditing(null); await refresh() } catch (reason) { setError(financeErrorMessage(reason, "No se pudo guardar el servicio.")) }
  }
  async function toggle(service: FinanceService) {
    const accepted = await confirm({ title: `${service.active ? "Pausar" : "Activar"} servicio`, message: `Se ${service.active ? "pausará" : "activará"} “${service.name}” sin borrar su historial.`, confirmLabel: "Confirmar", tone: service.active ? "danger" : "default" })
    if (!accepted) return
    const reinforced = await confirm({ title: "Confirmación reforzada", message: "Confirmá nuevamente el cambio de estado financiero.", confirmLabel: "Confirmar cambio", tone: "danger" })
    if (!reinforced) return
    try { await setFinanceServiceActive(library, service.id, !service.active); await refresh() } catch (reason) { setError(financeErrorMessage(reason, "No se pudo cambiar el estado.")) }
  }
  function openPayment(service: FinanceService) {
    const occurrence = occurrences.find((candidate) => candidate.serviceId === service.id)
    setPaying(service); setPaidAmount(occurrence?.paidAmount ?? ""); setPaidDate(occurrence?.effectiveDate ?? new Date().toISOString().slice(0, 10)); setTransactionId(occurrence?.transactionId ?? ""); setInvoiceAmount(occurrence?.paidAmount ?? service.expectedAmount); setInvoiceDueDate("")
  }
  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!paying) return
    if (!paidAmount.trim() && transactionId.trim()) { setError("Seleccioná un importe para vincular un gasto."); return }
    const accepted = await confirm({ title: "Confirmar ocurrencia mensual", message: `Se guardará la ocurrencia de “${paying.name}” para ${month}${paidAmount.trim() ? ` por ${paidAmount} ${paying.currency}` : " sin pago"}.`, confirmLabel: "Guardar ocurrencia" })
    if (!accepted) return
    const reinforced = await confirm({ title: "Confirmación reforzada", message: "Confirmá nuevamente para guardar la ocurrencia y sus asociaciones.", confirmLabel: "Guardar", tone: "danger" })
    if (!reinforced) return
    try {
      await saveFinanceServiceOccurrence(library, { id: crypto.randomUUID(), serviceId: paying.id, period: month, expectedAmount: paying.expectedAmount, paidAmount: paidAmount.trim() || null, effectiveDate: paidDate || null, status: paidAmount.trim() ? "current" : "pending", transactionId: transactionId.trim() || null, artifactId: null, sourceReference: null, rawSource: null, actorLibraryUserId: null, source: "app" })
      setPaying(null); await refresh()
    } catch (reason) { setError(financeErrorMessage(reason, "No se pudo guardar la ocurrencia.")) }
  }
  async function saveInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!paying) return
    if (!invoiceAmount.trim()) { setError("El importe de la factura es obligatorio."); return }
    const accepted = await confirm({ title: "Confirmar factura de servicio", message: `Se registrará una factura de “${paying.name}” por ${invoiceAmount} ${paying.currency}, sin crear otro gasto.`, confirmLabel: "Guardar factura" })
    if (!accepted) return
    const reinforced = await confirm({ title: "Confirmación reforzada", message: "Confirmá nuevamente para guardar la factura y su vínculo financiero.", confirmLabel: "Guardar", tone: "danger" })
    if (!reinforced) return
    try {
      await saveFinanceServiceInvoice(library, { id: crypto.randomUUID(), serviceId: paying.id, period: month, dueDate: invoiceDueDate || null, provider: paying.provider, amount: invoiceAmount, currency: paying.currency, transactionId: transactionId.trim() || null, artifactId: null, validationStatus: "pending", sourceReference: null, rawExtraction: null })
      setPaying(null); await refresh()
    } catch (reason) { setError(financeErrorMessage(reason, "No se pudo guardar la factura.")) }
  }
  async function decide(proposal: FinanceAuditProposal, decision: "accepted" | "rejected" | "cancelled") {
    const accepted = await confirm({ title: `${decision === "accepted" ? "Confirmar" : decision === "rejected" ? "Rechazar" : "Cancelar"} propuesta`, message: `${proposal.reason}\n\n${proposalChange(proposal.suggestedChange)}`, confirmLabel: decision === "accepted" ? "Aplicar propuesta" : decision === "rejected" ? "Rechazar" : "Cancelar", tone: decision === "accepted" ? "danger" : "default" })
    if (!accepted) return
    let resolutionAssignments: FinanceCardServiceResolution[] | undefined
    if (decision === "accepted" && proposal.proposalType === "service-card-reconciliation") {
      try {
        const action = JSON.parse(proposal.suggestedChange) as { parameters?: { statementId?: string; ambiguousGroups?: Array<{ lineIds?: string[]; candidateServiceIds?: string[]; statementPeriod?: string }> } }
        const groups = action.parameters?.ambiguousGroups ?? []
        if (groups.length > 0) {
          const choices = groups.map((group) => `líneas ${(group.lineIds ?? []).join(", ")}; servicios ${(group.candidateServiceIds ?? []).join(", ")}; períodos ${group.statementPeriod ?? proposal.period} o período anterior`).join("\n")
          const raw = window.prompt(`El preview es ambiguo y no puede resolverse automáticamente. Ingresá un JSON con selecciones {lineId, serviceId, period}. Podés dejar líneas sin asignar.\n\n${choices}`, "[]")
          if (raw === null) return
          const selected = JSON.parse(raw) as Array<{ lineId?: string; serviceId?: string; period?: string }>
          if (!Array.isArray(selected)) throw new Error("La resolución debe ser una lista JSON.")
          const statement = statements.find((candidate) => candidate.id === action.parameters?.statementId)
          if (!statement) throw new Error("No se encontró el resumen de la propuesta.")
          resolutionAssignments = selected.map((selection) => {
            const line = statement.items.find((candidate) => candidate.id === selection.lineId)
            if (!line || !selection.serviceId || !selection.period || !line.transactionId) throw new Error("Cada selección debe identificar una línea con transacción, servicio y período.")
            return { statementId: statement.id, lineId: line.id, serviceId: selection.serviceId, transactionId: line.transactionId, purchaseDate: line.purchaseDate, period: selection.period, amount: line.amount, currency: line.currency, assignmentStatus: "new", evidence: { matching: "manual-user-selection" } }
          })
          if (resolutionAssignments.length === 0) throw new Error("Elegí al menos una asignación para resolver el grupo ambiguo.")
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "La resolución manual no es un JSON válido.")
        return
      }
    }
    const reinforced = await confirm({ title: "Confirmación reforzada", message: decision === "accepted" ? "La propuesta modificará únicamente el dato indicado y se volverá a validar su huella. Confirmá para aplicar." : "La decisión quedará registrada individualmente y no podrá aplicarse automáticamente después. Confirmá para continuar.", confirmLabel: decision === "accepted" ? "Aplicar cambio" : decision === "rejected" ? "Rechazar propuesta" : "Cancelar propuesta", tone: decision === "accepted" ? "danger" : "default" })
    if (!reinforced) return
    try { await decideFinanceAuditProposal(library, proposal.id, decision, undefined, proposal.dataFingerprint, resolutionAssignments); await refresh() } catch (reason) { setError(financeErrorMessage(reason, "No se pudo guardar la decisión; la propuesta puede haber quedado obsoleta.")) }
  }
  async function retryAudit(run: import("../types/financeTypes").FinanceAuditRun) {
    const accepted = await confirm({ title: "Reintentar auditoría", message: `Se volverán a leer y auditar los datos financieros de ${run.period}.`, confirmLabel: "Reintentar" })
    if (!accepted) return
    try { await runFinanceAudit(library, run.period, run.triggerFingerprint, "Reintento solicitado desde Finanzas"); await refresh() } catch (reason) { setError(financeErrorMessage(reason, "No se pudo ejecutar la auditoría.")) }
  }
  async function showHistory(service: FinanceService) {
    const occurrence = occurrenceByService.get(service.id)
    if (!occurrence) { setHistory([]); setHistoryTitle(`${service.name} · ${month}`); return }
    try { setHistory(await listFinanceServiceOccurrenceVersions(library, occurrence.id)); setHistoryTitle(`${service.name} · ${month}`) } catch (reason) { setError(financeErrorMessage(reason, "No se pudo cargar el historial.")) }
  }
  const occurrenceByService = new Map(occurrences.map((occurrence) => [occurrence.serviceId, occurrence]))
  const pendingProposalCount = proposals.filter((proposal) => proposal.status === "pending").length
  const visibleProposals = proposals.filter((proposal) => (!auditStatusFilter || proposal.status === auditStatusFilter) && (!auditRuleFilter || proposal.ruleKey.toLocaleLowerCase("es").includes(auditRuleFilter.toLocaleLowerCase("es"))) && (!auditServiceFilter || proposal.serviceId === auditServiceFilter))

  return <section className="finance-module finance-services" aria-labelledby="finance-services-title">
    <header className="finance-header finance-header--compact">
      <div><h1 id="finance-services-title">Servicios</h1><p>Ocurrencias mensuales y evidencia de pagos; no se generan obligaciones futuras.</p></div>
      <div className="finance-actions"><label>Mes <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><button type="button" onClick={openNew}><Plus size={18} /> Nuevo servicio</button><button type="button" aria-label="Actualizar servicios" onClick={() => void refresh()}><RefreshCw size={18} /></button></div>
    </header>
    {error && <div className="finance-error" role="alert">{error}</div>}
    <section className="finance-card" aria-labelledby="service-filters-title"><h2 id="service-filters-title">Filtros</h2><div className="finance-form-row">
      <label>Estado <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}><option value="active">Activos</option><option value="inactive">Inactivos</option><option value="all">Todos</option></select></label>
      <label>Categoría <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Todas</option>{categories.filter((category) => category.kind === "expense").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>Moneda <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)}><option value="">Todas</option><option>ARS</option><option>USD</option></select></label>
      <label>Modalidad <select value={modalityFilter} onChange={(event) => setModalityFilter(event.target.value)}><option value="">Todas</option><option value="fixed">Fija</option><option value="variable">Variable</option></select></label>
    </div></section>
    {loading ? <p role="status">Cargando servicios…</p> : visible.length === 0 ? <section className="finance-card" role="status">No hay servicios que coincidan con los filtros.</section> : <section className="finance-card finance-table-wrap"><table><caption className="sr-only">Servicios y ocurrencias de {month}</caption><thead><tr><th>Servicio</th><th>Esperado</th><th>Pagado</th><th>Diferencia</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{visible.map((service) => { const occurrence = occurrenceByService.get(service.id); const difference = serviceOccurrenceDifference(occurrence); return <tr key={service.id}><td><strong>{service.name}</strong><br /><small>{service.provider || "Sin proveedor"} · {service.modality === "fixed" ? "Fija" : "Variable"}</small></td><td>{amount(occurrence?.expectedAmount || service.expectedAmount, service.currency)}</td><td>{amount(occurrence?.paidAmount, service.currency)}</td><td>{difference === null ? "—" : amount(difference, service.currency)}</td><td>{occurrence?.status || "Sin ocurrencia"}</td><td><button type="button" onClick={() => setEditing(service)}>Editar</button> <button type="button" onClick={() => openPayment(service)}>Registrar pago</button> <button type="button" onClick={() => void showHistory(service)}>Historial</button> <button type="button" onClick={() => void toggle(service)}>{service.active ? "Pausar" : "Activar"}</button></td></tr> })}</tbody></table></section>}
    <section className="finance-card" aria-labelledby="service-invoices-title"><h2 id="service-invoices-title">Facturas y boletas del mes</h2>{invoices.length === 0 ? <p role="status">No hay facturas asociadas a servicios en {month}.</p> : <ul>{invoices.map((invoice) => <li key={invoice.id}>{invoice.provider || "Proveedor sin identificar"}: {amount(invoice.amount, invoice.currency)} · estado {invoice.validationStatus}{invoice.dueDate ? ` · vence ${invoice.dueDate}` : ""}</li>)}</ul>}</section>
    {historyTitle && <section className="finance-card" aria-labelledby="service-history-title"><div className="finance-section-heading"><h2 id="service-history-title">Historial: {historyTitle}</h2><button type="button" onClick={() => setHistoryTitle(null)}>Cerrar</button></div>{history.length === 0 ? <p>No hay versiones anteriores.</p> : <ul>{history.map((version) => <li key={version.id}>Versión {version.versionNumber}: esperado {version.expectedAmount}, pagado {version.paidAmount || "—"}, estado {version.status}{version.reason ? ` (${version.reason})` : ""}</li>)}</ul>}</section>}
     <section className="finance-card" aria-labelledby="finance-audit-title"><h2 id="finance-audit-title">Auditoría del mes</h2><div className="finance-form-row"><label>Estado <select value={auditStatusFilter} onChange={(event) => setAuditStatusFilter(event.target.value)}><option value="">Todos</option>{["pending", "accepted", "rejected", "cancelled", "failed", "outdated"].map((status) => <option key={status}>{status}</option>)}</select></label><label>Regla <input value={auditRuleFilter} onChange={(event) => setAuditRuleFilter(event.target.value)} placeholder="Buscar regla" /></label><label>Servicio <select value={auditServiceFilter} onChange={(event) => setAuditServiceFilter(event.target.value)}><option value="">Todos</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label></div>{pendingProposalCount > 0 ? <p className="finance-warning">{pendingProposalCount} propuesta(s) pendiente(s) de revisión individual.</p> : <p role="status">No hay propuestas pendientes. Las auditorías fallidas quedan disponibles para reintento.</p>}{auditRuns.filter((run) => run.status === "failed" || run.status === "pending").map((run) => <p key={run.id} className="finance-warning">Auditoría {run.status}: {run.reason || "sin motivo"} <button type="button" onClick={() => void retryAudit(run)}>Reintentar</button></p>)}{visibleProposals.length > 0 && <ul>{visibleProposals.map((proposal) => <li key={proposal.id}><strong>{proposal.status}</strong> · regla <code>{proposal.ruleKey}</code>{proposal.serviceId ? ` · servicio ${services.find((service) => service.id === proposal.serviceId)?.name ?? proposal.serviceId}` : ""} · período {proposal.period}: {proposal.reason}<details><summary>Ver preview y evidencia</summary><p>Datos actuales: <code>{proposal.currentData}</code></p><p>Cambio sugerido: {proposalChange(proposal.suggestedChange)}</p>{proposal.evidence && <p>Evidencia: <code>{proposal.evidence}</code></p>}</details>{proposal.status === "pending" && <span className="finance-actions"><button type="button" onClick={() => void decide(proposal, "accepted")}>Confirmar</button><button type="button" onClick={() => void decide(proposal, "rejected")}>Rechazar</button><button type="button" onClick={() => void decide(proposal, "cancelled")}>Cancelar</button></span>}</li>)}</ul>}</section>
     {paying && <div className="finance-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="service-payment-title"><form className="finance-card finance-form" onSubmit={(event) => void savePayment(event)}><h2 id="service-payment-title">Registrar pago: {paying.name}</h2><label>Importe pagado<input inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} placeholder="Dejar vacío si aún no hay pago" /></label><label>Fecha efectiva<input type="date" value={paidDate} onChange={(event) => setPaidDate(event.target.value)} /></label><label>Gasto existente<select value={transactionId} onChange={(event) => { setTransactionId(event.target.value); const selected = expenses.find((expense) => expense.id === event.target.value); if (selected) { setPaidAmount(selected.amount); setPaidDate(selected.effectiveDate) } }}><option value="">Sin gasto asociado</option>{expenses.filter((expense) => expense.currency === paying.currency).map((expense) => <option key={expense.id} value={expense.id}>{expense.effectiveDate} · {expense.description} · {amount(expense.amount, expense.currency)}</option>)}</select></label><div className="finance-form-row"><label>Importe de factura<input inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value)} /></label><label>Vencimiento de factura<input type="date" value={invoiceDueDate} onChange={(event) => setInvoiceDueDate(event.target.value)} /></label></div><div className="finance-actions"><button type="submit">Guardar ocurrencia</button><button type="button" onClick={() => void saveInvoice({ preventDefault: () => undefined } as FormEvent<HTMLFormElement>)}>Guardar como factura</button><button type="button" onClick={() => setPaying(null)}>Cancelar</button></div></form></div>}
    {editing && <div className="finance-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="service-form-title"><form className="finance-card finance-form finance-form--wide" onSubmit={(event) => void save(event)}><h2 id="service-form-title">{services.some((service) => service.id === editing.id) ? "Editar servicio" : "Nuevo servicio"}</h2><div className="finance-form-row"><label>Nombre *<input required maxLength={160} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label>Categoría *<select required value={editing.categoryId} onChange={(event) => setEditing({ ...editing, categoryId: event.target.value })}><option value="">Seleccionar</option>{categories.filter((category) => category.kind === "expense" && category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Importe esperado *<input required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={editing.expectedAmount} onChange={(event) => setEditing({ ...editing, expectedAmount: event.target.value })} /></label><label>Moneda *<select value={editing.currency} onChange={(event) => setEditing({ ...editing, currency: event.target.value as FinanceService["currency"] })}><option>ARS</option><option>USD</option></select></label><label>Vencimiento (día)<input type="number" min={1} max={31} value={editing.dueDay ?? ""} onChange={(event) => setEditing({ ...editing, dueDay: event.target.value ? Number(event.target.value) : null })} /></label><label>Cuenta habitual (opcional)<select value={editing.defaultAccountId ?? ""} onChange={(event) => setEditing({ ...editing, defaultAccountId: event.target.value || null })}><option value="">Sin predeterminada</option>{accounts.filter((account) => account.active && account.currency === editing.currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Proveedor<input maxLength={160} value={editing.provider ?? ""} onChange={(event) => setEditing({ ...editing, provider: event.target.value || null })} /></label><label>Modalidad<select value={editing.modality} onChange={(event) => setEditing({ ...editing, modality: event.target.value as FinanceService["modality"] })}><option value="fixed">Fija</option><option value="variable">Variable</option></select></label></div><div className="finance-actions"><button type="submit">Guardar</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></div></form></div>}
  </section>
}
