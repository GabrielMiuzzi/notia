import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import type { NotiaLibrary } from "../../../types/notia"
import { getFinanceServiceMonthStatus, listFinanceServiceOccurrenceVersions } from "../services/financeService"
import type { FinanceServiceMonthStatus, FinanceServiceOccurrenceVersion } from "../types/financeTypes"
import { financeErrorMessage } from "../engines/financeError"
import { subscribeToFinanceDataChanges } from "../services/financeDataEvents"

const STATUS_LABELS: Record<FinanceServiceMonthStatus["status"], string> = {
  paid: "Pagado",
  pending: "Pendiente",
  "not-applicable": "No corresponde",
}

function monthNow() { return new Date().toISOString().slice(0, 7) }
function amount(value: string | null | undefined, currency: string) { return value ? `${currency} ${Number(value).toLocaleString("es-AR")}` : "—" }

/** Services of a month as the backend classifies them; the assistant records payments. */
export function FinanceServicesView({ library }: { library: NotiaLibrary }) {
  const [month, setMonth] = useState(monthNow)
  const [services, setServices] = useState<FinanceServiceMonthStatus[]>([])
  const [history, setHistory] = useState<FinanceServiceOccurrenceVersion[]>([])
  const [historyTitle, setHistoryTitle] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try { setServices(await getFinanceServiceMonthStatus(library, month)) }
    catch (reason) { setError(financeErrorMessage(reason, "No se pudieron cargar los servicios.")) }
    finally { setLoading(false) }
  }, [library, month])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => subscribeToFinanceDataChanges(() => { void refresh() }), [refresh])

  async function showHistory(service: FinanceServiceMonthStatus) {
    const title = `${service.name} · ${month}`
    if (!service.occurrenceId) { setHistory([]); setHistoryTitle(title); return }
    try { setHistory(await listFinanceServiceOccurrenceVersions(library, service.occurrenceId)); setHistoryTitle(title) }
    catch (reason) { setError(financeErrorMessage(reason, "No se pudo cargar el historial.")) }
  }

  const pending = services.filter((service) => service.status === "pending").length

  return <section className="finance-module finance-services" aria-labelledby="finance-services-title">
    <header className="finance-header finance-header--compact">
      <div><h1 id="finance-services-title">Servicios</h1><p className="finance-muted">Los pagos se registran al enviar la factura o el resumen de tarjeta al asistente.</p></div>
      <div className="finance-actions"><label>Mes <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><button type="button" aria-label="Actualizar servicios" onClick={() => void refresh()}><RefreshCw size={18} /></button></div>
    </header>
    {error && <p className="finance-error" role="alert">{error}</p>}
    {!loading && pending > 0 && <p className="finance-muted" role="status">{pending} servicio(s) sin pago registrado en {month}.</p>}
    {loading ? <p role="status">Cargando servicios…</p> : services.length === 0 ? <section className="finance-card" role="status">No hay servicios activos. Pedile al asistente que agregue los que pagás cada mes.</section> : <section className="finance-card finance-table-wrap"><table><caption className="sr-only">Servicios de {month}</caption><thead><tr><th>Servicio</th><th>Esperado</th><th>Pagado</th><th>Estado</th><th>Historial</th></tr></thead><tbody>{services.map((service) => <tr key={service.serviceId}><td><strong>{service.name}</strong><br /><small>{service.provider || "Sin proveedor"}{service.dueDay ? ` · vence el ${service.dueDay}` : ""}</small></td><td>{amount(service.expectedAmount, service.currency)}</td><td>{amount(service.paidAmount, service.currency)}</td><td>{STATUS_LABELS[service.status]}</td><td><button type="button" onClick={() => void showHistory(service)}>Ver</button></td></tr>)}</tbody></table></section>}
    {historyTitle && <section className="finance-card" aria-labelledby="service-history-title"><div className="finance-section-heading"><h2 id="service-history-title">Historial: {historyTitle}</h2><button type="button" onClick={() => setHistoryTitle(null)}>Cerrar</button></div>{history.length === 0 ? <p>No hay versiones anteriores.</p> : <ul>{history.map((version) => <li key={version.id}>Versión {version.versionNumber}: esperado {version.expectedAmount}, pagado {version.paidAmount || "—"}, estado {version.status}{version.reason ? ` (${version.reason})` : ""}</li>)}</ul>}</section>}
  </section>
}
