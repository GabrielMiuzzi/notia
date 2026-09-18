import { describe, expect, it } from "vitest"
import { matchFinanceServices, normalizeFinanceServiceText, reconcileFinanceCardServices, serviceOccurrenceDifference, shouldSuggestServiceAmountReview } from "./serviceEngine"
import type { FinanceCreditCardStatement, FinanceService, FinanceServiceOccurrence } from "../types/financeTypes"

const service: FinanceService = { id: "light", name: "Luz del hogar", categoryId: "services", currency: "ARS", expectedAmount: "100.00", dueDay: null, defaultAccountId: null, provider: "Edenor", modality: "fixed", active: true }
const occurrence: FinanceServiceOccurrence = { id: "occurrence", serviceId: "light", period: "2026-09", expectedAmount: "100.00", paidAmount: "125.50", effectiveDate: "2026-09-10", status: "current", transactionId: null, artifactId: null, sourceReference: null, rawSource: null, actorLibraryUserId: "user-owner", source: "app" }
const statement: FinanceCreditCardStatement = { id: "statement", accountId: "card", issuer: "Banco", cardLastFour: "1234", period: "2026-09", closingDate: "2026-09-15", dueDate: "2026-10-01", currency: "ARS", previousBalance: "0", paymentsAmount: "0", creditsAmount: "0", purchasesAmount: "200.00", feesAmount: "0", interestAmount: "0", taxesAmount: "0", totalDue: "200.00", minimumPayment: null, status: "confirmed", sourceReference: "statement.pdf", rawExtraction: null, items: [] }

describe("service finance engine", () => {
  it("normalizes accents and whitespace without partial matches", () => {
    expect(normalizeFinanceServiceText("  Édenor   Luz ")).toBe("edenor luz")
    expect(matchFinanceServices([service], "luz del hogar", "edenor")).toHaveLength(1)
    expect(matchFinanceServices([service], "luz del hogar")).toHaveLength(1)
    expect(matchFinanceServices([service], "luz", "edenor")).toHaveLength(0)
  })
  it("returns every exact provider candidate so the caller can ask for clarification", () => {
    expect(matchFinanceServices([service, { ...service, id: "light-2", provider: "Edesur" }], "luz del hogar")).toHaveLength(2)
  })
  it("calculates exact occurrence differences and flags fixed variations", () => {
    expect(serviceOccurrenceDifference(occurrence)).toBe("25.50")
    expect(shouldSuggestServiceAmountReview(service, occurrence)).toBe(true)
    expect(serviceOccurrenceDifference({ ...occurrence, paidAmount: null })).toBeNull()
  })
  it("uses statement period rather than purchase date and excludes payments/credits", () => {
    const result = reconcileFinanceCardServices({ ...statement, items: [
      { id: "purchase", purchaseDate: "2026-08-20", description: "Luz del hogar", amount: "100.00", currency: "ARS", itemType: "purchase", transactionId: "tx" },
      { id: "payment", purchaseDate: "2026-08-20", description: "Luz del hogar", amount: "100.00", currency: "ARS", itemType: "payment", transactionId: "payment-tx" },
    ] }, [service], [])
    expect(result.status).toBe("ready")
    expect(result.assignments).toMatchObject([{ lineId: "purchase", period: "2026-09", amount: "100.00" }])
  })
  it("matches a service inside a card merchant descriptor without allowing partial words", () => {
    const result = reconcileFinanceCardServices({ ...statement, items: [
      { id: "descriptor", purchaseDate: "2026-08-20", description: "MOVISTAR ARGENTINA 82997", amount: "100.00", currency: "ARS", itemType: "purchase", transactionId: "tx" },
      { id: "partial", purchaseDate: "2026-08-21", description: "Supermovistar", amount: "100.00", currency: "ARS", itemType: "purchase", transactionId: "tx-2" },
    ] }, [{ ...service, name: "Movistar", provider: null }], [])

    expect(result.assignments).toMatchObject([{ lineId: "descriptor", serviceId: "light" }])
    expect(result.ambiguousGroups).toMatchObject([{ lineIds: ["partial"], reason: { code: "no-service-match" } }])
  })
  it("distributes two same-service consumptions to the previous and current periods", () => {
    const result = reconcileFinanceCardServices({ ...statement, items: [
      { id: "newer", purchaseDate: "2026-09-10", description: "Luz del hogar", amount: "100.00", currency: "ARS", itemType: "purchase", transactionId: "newer-tx" },
      { id: "older", purchaseDate: "2026-08-10", description: "Luz del hogar", amount: "100.00", currency: "ARS", itemType: "purchase", transactionId: "older-tx" },
    ] }, [service], [])
    expect(result.assignments.map((assignment) => [assignment.lineId, assignment.period])).toEqual([["older", "2026-08"], ["newer", "2026-09"]])
  })
  it("leaves duplicate or already-paid period assignments ambiguous", () => {
    const result = reconcileFinanceCardServices({ ...statement, items: [
      { id: "one", purchaseDate: "2026-08-10", description: "Luz del hogar", amount: "100.00", currency: "ARS", itemType: "purchase", transactionId: "one-tx" },
      { id: "two", purchaseDate: "2026-09-10", description: "Luz del hogar", amount: "100.00", currency: "ARS", itemType: "purchase", transactionId: "two-tx" },
    ] }, [service], [{ ...occurrence, period: "2026-08", paidAmount: "100.00", transactionId: "old-tx" }])
    expect(result.status).toBe("ambiguous")
    expect(result.ambiguousGroups[0]?.reason.code).toBe("previous-period-paid")
  })

  it("returns structured reasons without assigning unsafe, missing, ambiguous, or mismatched lines", () => {
    const duplicateName = { ...service, id: "light-2", provider: "Edesur" }
    const currencyMismatch = { ...service, id: "light-usd", name: "Internet", provider: "Fibra", currency: "USD" as const }
    const result = reconcileFinanceCardServices({ ...statement, items: [
      { id: "missing", purchaseDate: "2026-09-10", description: "Agua", amount: "100.00", currency: "ARS", itemType: "purchase", transactionId: "missing-tx" },
      { id: "unsafe", purchaseDate: "2026-09-10", description: "Luz del hogar plus", amount: "100.00", currency: "ARS", itemType: "purchase", transactionId: "unsafe-tx" },
      { id: "multiple", purchaseDate: "2026-09-10", description: "Luz del hogar", amount: "100.00", currency: "ARS", itemType: "purchase", transactionId: "multiple-tx" },
      { id: "currency", purchaseDate: "2026-09-10", description: "Fibra", amount: "100.00", currency: "ARS", itemType: "purchase", transactionId: "currency-tx" },
    ] }, [service, duplicateName, currencyMismatch], [])

    expect(result.assignments).toHaveLength(0)
    expect(result.ambiguousGroups.map((group) => group.reason.code)).toEqual([
      "no-service-match",
      "no-service-match",
      "multiple-service-match",
      "currency-mismatch",
    ])
    expect(result.reasons.map((value) => value.lineIds[0])).toEqual(["missing", "unsafe", "multiple", "currency"])
  })

  it("distinguishes new, unpaid, already-reconciled, and conflicting destinations", () => {
    const makeOccurrence = (overrides: Partial<FinanceServiceOccurrence>): FinanceServiceOccurrence => ({
      ...occurrence,
      id: `occurrence-${overrides.period ?? "current"}`,
      paidAmount: null,
      transactionId: null,
      ...overrides,
    })
    const line = (id: string, transactionId: string) => ({
      id,
      purchaseDate: "2026-09-10",
      description: "Luz del hogar",
      amount: "100.00",
      currency: "ARS" as const,
      itemType: "purchase" as const,
      transactionId,
    })

    expect(reconcileFinanceCardServices({ ...statement, items: [line("new", "new-tx")] }, [service], []).assignments[0]?.assignmentStatus).toBe("new")
    expect(reconcileFinanceCardServices({ ...statement, items: [line("unpaid", "unpaid-tx")] }, [service], [makeOccurrence({})]).assignments[0]?.assignmentStatus).toBe("new")
    expect(reconcileFinanceCardServices({ ...statement, items: [line("same", "same-tx")] }, [service], [makeOccurrence({ paidAmount: "100.00", transactionId: "same-tx" })]).assignments[0]?.assignmentStatus).toBe("already-reconciled")

    const conflict = reconcileFinanceCardServices({ ...statement, items: [line("conflict", "conflict-tx")] }, [service], [makeOccurrence({ paidAmount: "100.00", transactionId: "other-tx" })])
    expect(conflict.assignments).toHaveLength(0)
    expect(conflict.ambiguousGroups[0]?.reason.code).toBe("destination-conflict")
  })
})
