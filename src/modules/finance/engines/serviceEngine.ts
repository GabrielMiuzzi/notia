import type { FinanceCreditCardStatement, FinanceCardServiceAmbiguousGroup, FinanceCardServiceAssignment, FinanceCardServiceReason, FinanceCardServiceReconciliation, FinanceService, FinanceServiceOccurrence } from "../types/financeTypes"

export function normalizeFinanceServiceText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/\s+/g, " ").trim()
}

export function matchFinanceServices(services: FinanceService[], name: string, provider?: string | null): FinanceService[] {
  const normalizedName = normalizeFinanceServiceText(name)
  const normalizedProvider = normalizeFinanceServiceText(provider ?? "")
  return services.filter((service) => normalizeFinanceServiceText(service.name) === normalizedName && (!normalizedProvider || normalizeFinanceServiceText(service.provider ?? "") === normalizedProvider))
}

export function serviceOccurrenceDifference(occurrence: FinanceServiceOccurrence | null | undefined): string | null {
  if (!occurrence?.paidAmount) return null
  const expected = Number(occurrence.expectedAmount)
  const paid = Number(occurrence.paidAmount)
  if (!Number.isFinite(expected) || !Number.isFinite(paid)) return null
  return (paid - expected).toFixed(2)
}

export function shouldSuggestServiceAmountReview(service: FinanceService, occurrence: FinanceServiceOccurrence): boolean {
  if (service.modality !== "fixed" || !occurrence.paidAmount) return false
  const expected = Number(occurrence.expectedAmount)
  const paid = Number(occurrence.paidAmount)
  return Number.isFinite(expected) && Number.isFinite(paid) && Math.abs(paid - expected) > Math.max(0.01, expected * 0.2)
}

function validPositiveAmount(value: string): boolean {
  return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim()) && Number(value) > 0
}

function previousPeriod(period: string): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  return month === 1 ? `${String(year - 1).padStart(4, "0")}-12` : `${match[1]}-${String(month - 1).padStart(2, "0")}`
}

function reason(code: string, message: string, lineIds: string[], candidateServiceIds: string[]): FinanceCardServiceReason {
  return { code, message, lineIds, candidateServiceIds }
}

function matchesServiceDescriptor(description: string, candidate: string): boolean {
  if (description === candidate) return true
  if (candidate.length < 3 || candidate.includes(" ")) return false
  return ` ${description} `.includes(` ${candidate} `)
}

function ambiguous(statement: FinanceCreditCardStatement, serviceId: string | null, lineIds: string[], candidateServiceIds: string[], value: FinanceCardServiceReason): FinanceCardServiceAmbiguousGroup {
  return { statementId: statement.id, serviceId, lineIds, candidateServiceIds, statementPeriod: statement.period, reason: value }
}

function assignment(statement: FinanceCreditCardStatement, line: FinanceCreditCardStatement["items"][number], service: FinanceService, period: string, status: FinanceCardServiceAssignment["assignmentStatus"]): FinanceCardServiceAssignment {
  return {
    statementId: statement.id,
    lineId: line.id,
    serviceId: service.id,
    transactionId: line.transactionId as string,
    purchaseDate: line.purchaseDate,
    period,
    amount: line.amount,
    currency: line.currency,
    assignmentStatus: status,
    evidence: {
      matching: "normalized-boundary",
      description: line.description,
      normalizedDescription: normalizeFinanceServiceText(line.description),
      serviceName: service.name,
      provider: service.provider,
      purchaseDate: line.purchaseDate,
      statementPeriod: statement.period,
    },
  }
}

/** Pure, deterministic projection shared by previews and tests. Persistence revalidates it natively. */
export function reconcileFinanceCardServices(statement: FinanceCreditCardStatement, services: FinanceService[], occurrences: FinanceServiceOccurrence[]): FinanceCardServiceReconciliation {
  const assignments: FinanceCardServiceAssignment[] = []
  const ambiguousGroups: FinanceCardServiceAmbiguousGroup[] = []
  const reasons: FinanceCardServiceReason[] = []
  const groups = new Map<string, { service: FinanceService; lines: FinanceCreditCardStatement["items"] }>()

  for (const line of statement.items) {
    if (line.itemType !== "purchase") continue
    const valid = Boolean(line.transactionId) && Boolean(line.description.trim()) && validPositiveAmount(line.amount) && line.currency === statement.currency && /^\d{4}-\d{2}-\d{2}$/.test(line.purchaseDate)
    if (!valid) {
      const value = reason("invalid-purchase-line", "La línea purchase no tiene transacción, descripción, importe, moneda o fecha válidos.", [line.id], [])
      reasons.push(value)
      continue
    }
    const normalized = normalizeFinanceServiceText(line.description)
    const candidates = services.filter((service) => matchesServiceDescriptor(normalized, normalizeFinanceServiceText(service.name)) || (!!service.provider && matchesServiceDescriptor(normalized, normalizeFinanceServiceText(service.provider))))
    if (candidates.length !== 1) {
      const value = reason(candidates.length ? "multiple-service-match" : "no-service-match", candidates.length ? "La descripción coincide con varios servicios; la asignación es ambigua." : "La descripción no coincide exactamente con el nombre o proveedor de un servicio.", [line.id], candidates.map((service) => service.id))
      reasons.push(value)
      ambiguousGroups.push(ambiguous(statement, null, [line.id], candidates.map((service) => service.id), value))
      continue
    }
    const service = candidates[0]
    if (service.currency !== line.currency) {
      const value = reason("currency-mismatch", "La moneda del consumo no coincide con la moneda del servicio.", [line.id], [service.id])
      reasons.push(value)
      ambiguousGroups.push(ambiguous(statement, service.id, [line.id], [service.id], value))
      continue
    }
    const group = groups.get(service.id) ?? { service, lines: [] }
    group.lines.push(line)
    groups.set(service.id, group)
  }

  for (const { service, lines } of groups.values()) {
    const ordered = [...lines].sort((left, right) => `${left.purchaseDate}:${left.id}`.localeCompare(`${right.purchaseDate}:${right.id}`))
    if (ordered.length > 2) {
      const value = reason("more-than-two-consumptions", "Hay más de dos consumos del mismo servicio en el resumen; no se asigna automáticamente.", ordered.map((line) => line.id), [service.id])
      reasons.push(value)
      ambiguousGroups.push(ambiguous(statement, service.id, ordered.map((line) => line.id), [service.id], value))
      continue
    }
    const periods = ordered.length === 1 ? [statement.period] : [previousPeriod(statement.period), statement.period]
    if (periods.some((period): period is null => period === null)) continue
    const existing = periods.map((period) => occurrences.find((occurrence) => occurrence.serviceId === service.id && occurrence.period === period))
    const alreadyReconciled = ordered.every((line, index) => {
      const occurrence = existing[index]
      return Boolean(occurrence?.paidAmount && occurrence.transactionId === line.transactionId && occurrence.paidAmount === line.amount)
    })
    if (alreadyReconciled) {
      ordered.forEach((line, index) => assignments.push(assignment(statement, line, service, periods[index] as string, "already-reconciled")))
      continue
    }
    if (ordered.length === 2 && existing[0]?.paidAmount) {
      const value = reason("previous-period-paid", "El período anterior ya tiene un pago; la distribución de dos consumos requiere decisión.", ordered.map((line) => line.id), [service.id])
      reasons.push(value)
      ambiguousGroups.push(ambiguous(statement, service.id, ordered.map((line) => line.id), [service.id], value))
      continue
    }
    const proposed = ordered.map((line, index) => ({ line, period: periods[index] as string, occurrence: existing[index] }))
    const conflict = proposed.find(({ line, occurrence }) => occurrence?.paidAmount || occurrence?.transactionId && occurrence.transactionId !== line.transactionId)
    if (conflict) {
      const value = reason("destination-conflict", "El destino o la transacción ya están vinculados de forma incompatible; no se modifica nada.", ordered.map((line) => line.id), [service.id])
      reasons.push(value)
      ambiguousGroups.push(ambiguous(statement, service.id, ordered.map((line) => line.id), [service.id], value))
      continue
    }
    for (const { line, period } of proposed) assignments.push(assignment(statement, line, service, period, "new"))
  }

  const status: FinanceCardServiceReconciliation["status"] = ambiguousGroups.length === 0 ? assignments.length ? "ready" : "no-matches" : assignments.length ? "partial" : "ambiguous"
  return { status, assignments, ambiguousGroups, reasons }
}
