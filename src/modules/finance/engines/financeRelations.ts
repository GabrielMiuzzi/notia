import type {
  FinanceAccount,
  FinanceCategory,
  FinanceCreditCardStatement,
  FinanceInvestment,
  FinancePurchaseRecord,
  FinanceSavingsMovement,
  FinanceSavingsReserve,
  FinanceService,
  FinanceServiceInvoice,
  FinanceServiceOccurrence,
  FinanceTransaction,
} from "../types/financeTypes"

export type FinanceRelationEntity =
  | "transaction"
  | "purchase"
  | "service"
  | "statement"
  | "service-occurrence"
  | "service-invoice"
  | "savings-movement"
  | "investment"

export type FinanceRelationName =
  | "account"
  | "destination-account"
  | "category"
  | "service"
  | "source-artifact"
  | "transaction"
  | "reserve"
  | "purchase"
  | "currency"

export type FinanceRelationIssueSeverity = "warning" | "error"

export interface FinanceRelationIssue {
  entity: FinanceRelationEntity
  entityId: string
  targetId?: string
  currentTransactionId?: string | null
  relation: FinanceRelationName
  severity: FinanceRelationIssueSeverity
  code:
    | "missing-required"
    | "missing-optional"
    | "not-found"
    | "currency-mismatch"
    | "kind-mismatch"
    | "duplicate"
  message: string
}

export interface FinanceRelationAudit {
  issues: FinanceRelationIssue[]
  entityCount: number
  completeEntityCount: number
  incompleteEntityCount: number
}

export interface FinanceRelationMatrixEntry {
  relation: FinanceRelationName
  cardinality: "one" | "zero-or-one" | "one-to-many" | "many-to-one"
  sourceOfTruth: "persisted" | "derived" | "optional"
  automatic: boolean
  canBeAmbiguous: boolean
  notes: string
}

/**
 * The relation contract is kept next to the pure audit engine so UI, tools and
 * tests can use the same vocabulary without inferring accounting balances.
 */
export const FINANCE_RELATION_MATRIX: readonly FinanceRelationMatrixEntry[] = [
  { relation: "account", cardinality: "one", sourceOfTruth: "persisted", automatic: false, canBeAmbiguous: false, notes: "Origen o destino declarado; no representa un saldo conciliado." },
  { relation: "destination-account", cardinality: "zero-or-one", sourceOfTruth: "persisted", automatic: false, canBeAmbiguous: false, notes: "Solo aplica a transferencias." },
  { relation: "category", cardinality: "zero-or-one", sourceOfTruth: "persisted", automatic: false, canBeAmbiguous: true, notes: "Puede faltar en una carga rápida y debe revisarse antes del análisis por categoría." },
  { relation: "service", cardinality: "zero-or-one", sourceOfTruth: "persisted", automatic: false, canBeAmbiguous: true, notes: "Las coincidencias de servicios requieren evidencia determinista o decisión explícita." },
  { relation: "source-artifact", cardinality: "zero-or-one", sourceOfTruth: "persisted", automatic: false, canBeAmbiguous: false, notes: "Evidencia documental opcional; su ausencia no invalida un gasto manual." },
  { relation: "transaction", cardinality: "zero-or-one", sourceOfTruth: "persisted", automatic: true, canBeAmbiguous: true, notes: "Una ocurrencia, factura o línea de resumen puede reutilizar un movimiento existente." },
  { relation: "reserve", cardinality: "one", sourceOfTruth: "persisted", automatic: false, canBeAmbiguous: false, notes: "El saldo acumulado pertenece a la reserva y sus movimientos confirmados." },
  { relation: "purchase", cardinality: "zero-or-one", sourceOfTruth: "persisted", automatic: true, canBeAmbiguous: true, notes: "Un ticket puede aportar evidencia del gasto sin crear otro gasto genérico." },
  { relation: "currency", cardinality: "one", sourceOfTruth: "derived", automatic: true, canBeAmbiguous: false, notes: "Las monedas se comparan y agregan por separado; no se convierten implícitamente." },
] as const

export interface FinanceRelationAuditInput {
  accounts: readonly FinanceAccount[]
  categories: readonly FinanceCategory[]
  transactions: readonly FinanceTransaction[]
  services?: readonly FinanceService[]
  occurrences?: readonly FinanceServiceOccurrence[]
  invoices?: readonly FinanceServiceInvoice[]
  reserves?: readonly FinanceSavingsReserve[]
  savingsMovements?: readonly FinanceSavingsMovement[]
  purchases?: ReadonlyArray<Pick<FinancePurchaseRecord, "id" | "currency" | "serviceId"> & { accountId?: string | null; transactionId?: string | null }>
  statements?: readonly FinanceCreditCardStatement[]
  investments?: readonly FinanceInvestment[]
}

function addIssue(issues: FinanceRelationIssue[], issue: FinanceRelationIssue): void {
  issues.push(issue)
}

function auditTransactions(input: FinanceRelationAuditInput, issues: FinanceRelationIssue[]): void {
  const accounts = new Map(input.accounts.map((account) => [account.id, account]))
  const categories = new Map(input.categories.map((category) => [category.id, category]))
  const services = input.services ? new Map(input.services.map((service) => [service.id, service])) : null

  for (const transaction of input.transactions) {
    const account = accounts.get(transaction.accountId)
    if (!transaction.accountId) {
      addIssue(issues, { entity: "transaction", entityId: transaction.id, relation: "account", severity: "error", code: "missing-required", message: "El movimiento no declara una cuenta de origen." })
    } else if (!account) {
      addIssue(issues, { entity: "transaction", entityId: transaction.id, relation: "account", severity: "error", code: "not-found", message: "La cuenta declarada por el movimiento no existe en el snapshot." })
    } else if (account.currency !== transaction.currency) {
      addIssue(issues, { entity: "transaction", entityId: transaction.id, relation: "currency", severity: "error", code: "currency-mismatch", message: "La moneda del movimiento no coincide con la cuenta declarada." })
    }

    if ((transaction.transactionType === "income" || transaction.transactionType === "expense") && !transaction.categoryId) {
      addIssue(issues, { entity: "transaction", entityId: transaction.id, relation: "category", severity: "warning", code: "missing-optional", message: "El movimiento categorizable todavía no tiene categoría." })
    }
    const category = transaction.categoryId ? categories.get(transaction.categoryId) : undefined
    if (transaction.categoryId && !category) {
      addIssue(issues, { entity: "transaction", entityId: transaction.id, relation: "category", severity: "error", code: "not-found", message: "La categoría del movimiento no existe en el snapshot." })
    } else if (category && ((transaction.transactionType === "expense" && category.kind !== "expense") || (transaction.transactionType === "income" && category.kind !== "income"))) {
      addIssue(issues, { entity: "transaction", entityId: transaction.id, relation: "category", severity: "error", code: "kind-mismatch", message: "La categoría no corresponde al tipo del movimiento." })
    }

    if (transaction.transactionType === "transfer") {
      const destination = transaction.destinationAccountId ? accounts.get(transaction.destinationAccountId) : undefined
      if (!transaction.destinationAccountId) {
        addIssue(issues, { entity: "transaction", entityId: transaction.id, relation: "destination-account", severity: "error", code: "missing-required", message: "La transferencia no declara una cuenta destino." })
      } else if (!destination) {
        addIssue(issues, { entity: "transaction", entityId: transaction.id, relation: "destination-account", severity: "error", code: "not-found", message: "La cuenta destino de la transferencia no existe en el snapshot." })
      } else if (account && destination.currency !== account.currency) {
        addIssue(issues, { entity: "transaction", entityId: transaction.id, relation: "currency", severity: "error", code: "currency-mismatch", message: "Las cuentas de la transferencia usan monedas distintas." })
      }
    }

    if (transaction.serviceId && services) {
      const service = services.get(transaction.serviceId)
      if (!service) {
        addIssue(issues, { entity: "transaction", entityId: transaction.id, relation: "service", severity: "error", code: "not-found", message: "El servicio asociado al movimiento no existe en el snapshot." })
      } else if (service.currency !== transaction.currency) {
        addIssue(issues, { entity: "transaction", entityId: transaction.id, relation: "currency", severity: "error", code: "currency-mismatch", message: "La moneda del movimiento no coincide con la del servicio." })
      }
    }
  }
}

function auditOccurrences(input: FinanceRelationAuditInput, issues: FinanceRelationIssue[]): void {
  const services = new Map((input.services ?? []).map((service) => [service.id, service]))
  const transactions = new Map(input.transactions.map((transaction) => [transaction.id, transaction]))

  for (const occurrence of input.occurrences ?? []) {
    const service = services.get(occurrence.serviceId)
    if (!service) {
      addIssue(issues, { entity: "service-occurrence", entityId: occurrence.id, relation: "service", severity: "error", code: "not-found", message: "La ocurrencia no tiene un servicio existente." })
    } else if (service.currency !== (occurrence.paidAmount ? input.transactions.find((transaction) => transaction.id === occurrence.transactionId)?.currency ?? service.currency : service.currency)) {
      addIssue(issues, { entity: "service-occurrence", entityId: occurrence.id, relation: "currency", severity: "error", code: "currency-mismatch", message: "La evidencia de pago de la ocurrencia usa otra moneda." })
    }
    if (occurrence.transactionId) {
      const transaction = transactions.get(occurrence.transactionId)
      if (!transaction) {
        addIssue(issues, { entity: "service-occurrence", entityId: occurrence.id, relation: "transaction", severity: "error", code: "not-found", message: "La transacción vinculada a la ocurrencia no existe." })
      } else if (transaction.transactionType !== "expense" || transaction.status === "discarded") {
        addIssue(issues, { entity: "service-occurrence", entityId: occurrence.id, relation: "transaction", severity: "error", code: "kind-mismatch", message: "La ocurrencia está vinculada a un movimiento que no es un gasto confirmado válido." })
      }
    } else if (occurrence.paidAmount) {
      addIssue(issues, { entity: "service-occurrence", entityId: occurrence.id, relation: "transaction", severity: "warning", code: "missing-optional", message: "La ocurrencia tiene importe pagado pero no conserva un gasto vinculado." })
    }
  }
}

function auditInvoices(input: FinanceRelationAuditInput, issues: FinanceRelationIssue[]): void {
  const services = new Map((input.services ?? []).map((service) => [service.id, service]))
  const transactions = new Map(input.transactions.map((transaction) => [transaction.id, transaction]))

  for (const invoice of input.invoices ?? []) {
    const service = invoice.serviceId ? services.get(invoice.serviceId) : undefined
    if (invoice.serviceId && !service) {
      addIssue(issues, { entity: "service-invoice", entityId: invoice.id, relation: "service", severity: "error", code: "not-found", message: "La factura referencia un servicio inexistente." })
    } else if (service && service.currency !== invoice.currency) {
      addIssue(issues, { entity: "service-invoice", entityId: invoice.id, relation: "currency", severity: "error", code: "currency-mismatch", message: "La factura usa una moneda distinta de la del servicio." })
    }
    if (invoice.transactionId && !transactions.has(invoice.transactionId)) {
      addIssue(issues, { entity: "service-invoice", entityId: invoice.id, relation: "transaction", severity: "error", code: "not-found", message: "La factura referencia un gasto inexistente." })
    }
  }
}

function auditSavings(input: FinanceRelationAuditInput, issues: FinanceRelationIssue[]): void {
  const reserves = new Map((input.reserves ?? []).map((reserve) => [reserve.id, reserve]))
  const accounts = new Map(input.accounts.map((account) => [account.id, account]))
  const transactions = new Map(input.transactions.map((transaction) => [transaction.id, transaction]))

  for (const movement of input.savingsMovements ?? []) {
    const reserve = reserves.get(movement.reserveId)
    if (!reserve) {
      addIssue(issues, { entity: "savings-movement", entityId: movement.id, relation: "reserve", severity: "error", code: "not-found", message: "El movimiento de ahorro no tiene una reserva existente." })
    } else if (reserve.currency !== movement.currency) {
      addIssue(issues, { entity: "savings-movement", entityId: movement.id, relation: "currency", severity: "error", code: "currency-mismatch", message: "La moneda del movimiento no coincide con la reserva." })
    }
    if (movement.accountId) {
      const account = accounts.get(movement.accountId)
      if (!account) addIssue(issues, { entity: "savings-movement", entityId: movement.id, relation: "account", severity: "error", code: "not-found", message: "La cuenta declarada por el movimiento de ahorro no existe." })
      else if (account.currency !== movement.currency) addIssue(issues, { entity: "savings-movement", entityId: movement.id, relation: "currency", severity: "error", code: "currency-mismatch", message: "La moneda del movimiento de ahorro no coincide con la cuenta declarada." })
    }
    if (movement.linkedTransactionId) {
      const transaction = transactions.get(movement.linkedTransactionId)
      if (!transaction) addIssue(issues, { entity: "savings-movement", entityId: movement.id, targetId: movement.id, currentTransactionId: movement.linkedTransactionId, relation: "transaction", severity: "error", code: "not-found", message: "El movimiento de ahorro referencia un gasto inexistente." })
      else if (transaction.transactionType !== "expense" || transaction.currency !== movement.currency) addIssue(issues, { entity: "savings-movement", entityId: movement.id, targetId: movement.id, currentTransactionId: movement.linkedTransactionId, relation: "transaction", severity: "error", code: transaction.currency !== movement.currency ? "currency-mismatch" : "kind-mismatch", message: "El gasto vinculado al retiro de ahorro no es compatible." })
    }
  }
}

function auditInvestments(input: FinanceRelationAuditInput, issues: FinanceRelationIssue[]): void {
  const accounts = new Map(input.accounts.map((account) => [account.id, account]))
  for (const investment of input.investments ?? []) {
    if (!investment.accountId) continue
    const account = accounts.get(investment.accountId)
    if (!account) addIssue(issues, { entity: "investment", entityId: investment.id, relation: "account", severity: "warning", code: "not-found", message: "La valuación referencia una cuenta que no existe." })
    else if (account.currency !== investment.currency) addIssue(issues, { entity: "investment", entityId: investment.id, relation: "currency", severity: "error", code: "currency-mismatch", message: "La valuación usa una moneda distinta de la cuenta declarada." })
  }
}

function auditPurchasesAndStatements(input: FinanceRelationAuditInput, issues: FinanceRelationIssue[]): void {
  const accounts = new Map(input.accounts.map((account) => [account.id, account]))
  const transactions = new Map(input.transactions.map((transaction) => [transaction.id, transaction]))
  const purchaseTransactions = new Map<string, string>()
  for (const purchase of input.purchases ?? []) {
    const account = purchase.accountId ? accounts.get(purchase.accountId) : undefined
    if (!account) addIssue(issues, { entity: "purchase", entityId: purchase.id, relation: "account", severity: "error", code: "not-found", message: "La compra referencia una cuenta inexistente." })
    else if (account.currency !== purchase.currency) addIssue(issues, { entity: "purchase", entityId: purchase.id, relation: "currency", severity: "error", code: "currency-mismatch", message: "La compra usa una moneda distinta de la cuenta declarada." })
    if (!purchase.transactionId) {
      addIssue(issues, { entity: "purchase", entityId: purchase.id, targetId: purchase.id, currentTransactionId: null, relation: "transaction", severity: "warning", code: "missing-optional", message: "El ticket no tiene un movimiento de gasto asociado." })
    } else {
      const transaction = transactions.get(purchase.transactionId)
      if (!transaction) addIssue(issues, { entity: "purchase", entityId: purchase.id, targetId: purchase.id, currentTransactionId: purchase.transactionId, relation: "transaction", severity: "error", code: "not-found", message: "El ticket referencia un movimiento inexistente." })
      else if (transaction.transactionType !== "expense" || transaction.status === "discarded") addIssue(issues, { entity: "purchase", entityId: purchase.id, targetId: purchase.id, currentTransactionId: purchase.transactionId, relation: "transaction", severity: "error", code: "kind-mismatch", message: "El ticket no está asociado a un gasto válido." })
      else if (transaction.currency !== purchase.currency) addIssue(issues, { entity: "purchase", entityId: purchase.id, targetId: purchase.id, currentTransactionId: purchase.transactionId, relation: "currency", severity: "error", code: "currency-mismatch", message: "El ticket y su movimiento usan monedas distintas." })
      const previousPurchase = purchaseTransactions.get(purchase.transactionId)
      if (previousPurchase) addIssue(issues, { entity: "purchase", entityId: purchase.id, targetId: purchase.id, currentTransactionId: purchase.transactionId, relation: "transaction", severity: "error", code: "duplicate", message: `El movimiento también está asociado al ticket ${previousPurchase}.` })
      else purchaseTransactions.set(purchase.transactionId, purchase.id)
    }
  }
  for (const statement of input.statements ?? []) {
    const account = accounts.get(statement.accountId)
    if (!account) addIssue(issues, { entity: "statement", entityId: statement.id, relation: "account", severity: "error", code: "not-found", message: "El resumen referencia una cuenta inexistente." })
    else if (account.currency !== statement.currency) addIssue(issues, { entity: "statement", entityId: statement.id, relation: "currency", severity: "error", code: "currency-mismatch", message: "El resumen usa una moneda distinta de la cuenta de tarjeta." })
    const statementTransactions = new Map<string, string>()
    for (const item of statement.items) {
      if (["purchase", "fee", "interest", "tax"].includes(item.itemType)) {
        if (!item.transactionId) addIssue(issues, { entity: "statement", entityId: statement.id, targetId: item.id, currentTransactionId: null, relation: "transaction", severity: "warning", code: "missing-optional", message: `La línea “${item.description}” todavía no tiene un gasto asociado.` })
        else {
          const transaction = transactions.get(item.transactionId)
          if (!transaction) addIssue(issues, { entity: "statement", entityId: statement.id, targetId: item.id, currentTransactionId: item.transactionId, relation: "transaction", severity: "error", code: "not-found", message: `La línea “${item.description}” referencia un movimiento inexistente.` })
          else if (transaction.transactionType !== "expense" || transaction.status === "discarded") addIssue(issues, { entity: "statement", entityId: statement.id, targetId: item.id, currentTransactionId: item.transactionId, relation: "transaction", severity: "error", code: "kind-mismatch", message: `La línea “${item.description}” no está asociada a un gasto válido.` })
          else if (transaction.currency !== item.currency) addIssue(issues, { entity: "statement", entityId: statement.id, targetId: item.id, currentTransactionId: item.transactionId, relation: "currency", severity: "error", code: "currency-mismatch", message: `La línea “${item.description}” y su movimiento usan monedas distintas.` })
          const previousLine = statementTransactions.get(item.transactionId)
          if (previousLine) addIssue(issues, { entity: "statement", entityId: statement.id, targetId: item.id, currentTransactionId: item.transactionId, relation: "transaction", severity: "error", code: "duplicate", message: `Las líneas ${previousLine} y ${item.id} reutilizan el mismo gasto.` })
          else statementTransactions.set(item.transactionId, item.id)
        }
      }
    }
  }
}

function auditServices(input: FinanceRelationAuditInput, issues: FinanceRelationIssue[]): void {
  if (!input.occurrences) return
  const occurrencesByService = new Set((input.occurrences ?? []).map((occurrence) => occurrence.serviceId))
  for (const service of input.services ?? []) {
    if (!occurrencesByService.has(service.id)) addIssue(issues, { entity: "service", entityId: service.id, relation: "source-artifact", severity: "warning", code: "missing-optional", message: "El servicio todavía no tiene ninguna ocurrencia registrada." })
  }
}

export function auditFinanceRelations(input: FinanceRelationAuditInput): FinanceRelationAudit {
  const issues: FinanceRelationIssue[] = []
  auditTransactions(input, issues)
  auditOccurrences(input, issues)
  auditInvoices(input, issues)
  auditSavings(input, issues)
  auditInvestments(input, issues)
  auditPurchasesAndStatements(input, issues)
  auditServices(input, issues)

  const entityIds = new Set<string>()
  const allEntities: Array<{ entity: FinanceRelationEntity; id: string }> = [
    ...input.transactions.map((item) => ({ entity: "transaction" as const, id: item.id })),
    ...(input.purchases ?? []).map((item) => ({ entity: "purchase" as const, id: item.id })),
    ...(input.services ?? []).map((item) => ({ entity: "service" as const, id: item.id })),
    ...(input.statements ?? []).map((item) => ({ entity: "statement" as const, id: item.id })),
    ...(input.occurrences ?? []).map((item) => ({ entity: "service-occurrence" as const, id: item.id })),
    ...(input.invoices ?? []).map((item) => ({ entity: "service-invoice" as const, id: item.id })),
    ...(input.savingsMovements ?? []).map((item) => ({ entity: "savings-movement" as const, id: item.id })),
    ...(input.investments ?? []).map((item) => ({ entity: "investment" as const, id: item.id })),
  ]
  for (const item of allEntities) entityIds.add(`${item.entity}:${item.id}`)
  const incompleteEntities = new Set(issues.map((issue) => `${issue.entity}:${issue.entityId}`))
  return {
    issues,
    entityCount: entityIds.size,
    completeEntityCount: entityIds.size - incompleteEntities.size,
    incompleteEntityCount: incompleteEntities.size,
  }
}
