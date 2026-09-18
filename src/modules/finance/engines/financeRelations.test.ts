import { describe, expect, it } from "vitest"
import { auditFinanceRelations, FINANCE_RELATION_MATRIX } from "./financeRelations"
import { reconcileFinanceCardServices } from "./serviceEngine"
import type { FinanceAccount, FinanceCategory, FinanceCreditCardStatement, FinancePurchaseSummary, FinanceService, FinanceTransaction } from "../types/financeTypes"

const account: FinanceAccount = { id: "cash", name: "Efectivo", accountType: "cash", currency: "ARS", active: true }
const category: FinanceCategory = { id: "food", name: "Alimentación", kind: "expense", active: true }
const service: FinanceService = { id: "internet", name: "Internet", categoryId: "services", currency: "ARS", expectedAmount: "100.00", dueDay: 10, defaultAccountId: "cash", provider: "Proveedor", modality: "fixed", active: true }
const transaction: FinanceTransaction = { id: "expense", transactionType: "expense", amount: "100.00", currency: "ARS", effectiveDate: "2026-09-18", accountId: "cash", categoryId: "food", description: "Compra", source: "manual", status: "confirmed", serviceId: "internet" }

describe("finance relation audit", () => {
  it("publishes the relation matrix without pretending accounts have balances", () => {
    expect(FINANCE_RELATION_MATRIX.find((entry) => entry.relation === "account")).toMatchObject({ sourceOfTruth: "persisted", notes: expect.stringContaining("saldo") })
  })

  it("accepts a complete expense and reports the entity as complete", () => {
    const result = auditFinanceRelations({ accounts: [account], categories: [category], transactions: [transaction], services: [service] })
    expect(result.issues).toEqual([])
    expect(result).toMatchObject({ entityCount: 2, completeEntityCount: 2, incompleteEntityCount: 0 })
  })

  it("reports missing categories as warnings instead of invalidating a quick expense", () => {
    const result = auditFinanceRelations({ accounts: [account], categories: [], services: [service], transactions: [{ ...transaction, categoryId: null }] })
    expect(result.issues).toMatchObject([{ relation: "category", severity: "warning", code: "missing-optional" }])
  })

  it("detects missing entities, category kind errors and currency mismatches", () => {
    const result = auditFinanceRelations({
      accounts: [account],
      categories: [{ ...category, kind: "income" }],
      services: [{ ...service, currency: "USD" }],
      transactions: [{ ...transaction, accountId: "missing", categoryId: "food" }],
    })
    expect(result.issues.map((issue) => issue.code)).toEqual(["not-found", "kind-mismatch", "currency-mismatch"])
  })

  it("checks service occurrences, savings movements and invoices without inferring balances", () => {
    const result = auditFinanceRelations({
      accounts: [account],
      categories: [category],
      transactions: [transaction],
      services: [service],
      occurrences: [{ id: "occurrence", serviceId: "internet", period: "2026-09", expectedAmount: "100.00", paidAmount: "100.00", effectiveDate: "2026-09-18", status: "current", transactionId: "missing", artifactId: null, sourceReference: null, rawSource: null, actorLibraryUserId: "user-owner", source: "app" }],
      invoices: [{ id: "invoice", serviceId: "internet", period: "2026-09", dueDate: null, provider: "Proveedor", amount: "100.00", currency: "ARS", transactionId: "missing", artifactId: null, validationStatus: "pending", sourceReference: null, rawExtraction: null }],
      reserves: [{ id: "reserve", name: "Viaje", currency: "ARS", openingBalance: "0", objective: null, active: true, balance: "0" }],
      savingsMovements: [{ id: "saving", reserveId: "reserve", accountId: "cash", movementType: "withdrawal", amount: "10.00", currency: "ARS", effectiveDate: "2026-09-18", description: "Retiro", reason: "Compra", source: "manual", status: "confirmed", linkedTransactionId: "missing" }],
    })
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: "service-occurrence", relation: "transaction", code: "not-found" }),
      expect.objectContaining({ entity: "service-invoice", relation: "transaction", code: "not-found" }),
      expect.objectContaining({ entity: "savings-movement", relation: "transaction", code: "not-found" }),
    ]))
  })

  it("keeps duplicate service candidates ambiguous in a relation fixture", () => {
    const statement: FinanceCreditCardStatement = { id: "statement", accountId: "card", issuer: "Banco", cardLastFour: null, period: "2026-09", closingDate: "2026-09-15", dueDate: "2026-10-01", currency: "ARS", previousBalance: "0", paymentsAmount: "0", creditsAmount: "0", purchasesAmount: "100.00", feesAmount: "0", interestAmount: "0", taxesAmount: "0", totalDue: "100.00", minimumPayment: null, status: "confirmed", sourceReference: null, rawExtraction: null, items: [{ id: "line", purchaseDate: "2026-09-10", description: "Internet", amount: "100.00", currency: "ARS", itemType: "purchase", transactionId: "tx" }] }
    const result = reconcileFinanceCardServices(statement, [service, { ...service, id: "internet-duplicate", provider: "Otro proveedor" }], [])
    expect(result.assignments).toHaveLength(0)
    expect(result.ambiguousGroups[0]?.reason.code).toBe("multiple-service-match")
  })

  it("detects tickets without a movement and tickets sharing one movement", () => {
    const purchase = (id: string, transactionId: string | null): FinancePurchaseSummary => ({ id, accountId: "cash", transactionId: transactionId ?? "", serviceId: null, merchantName: "Tienda", observedAt: "2026-09-18", currency: "ARS", totalAmount: "10.00", status: "confirmed", itemCount: 1 })
    const result = auditFinanceRelations({ accounts: [account], categories: [category], transactions: [transaction], purchases: [purchase("ticket-1", "expense"), purchase("ticket-2", "expense"), purchase("ticket-3", null)] })
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: "purchase", entityId: "ticket-2", code: "duplicate" }),
      expect.objectContaining({ entity: "purchase", entityId: "ticket-3", code: "missing-optional" }),
    ]))
  })
})
