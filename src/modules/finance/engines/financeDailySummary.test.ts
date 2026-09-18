import { describe, expect, it } from "vitest"
import { buildFinanceDailySummary } from "./financeDailySummary"
import type { FinanceCategory, FinanceSavingsMovement, FinanceSavingsReserve, FinanceTransaction } from "../types/financeTypes"

const category: FinanceCategory = { id: "food", name: "Alimentación", kind: "expense", active: true }
const reserve: FinanceSavingsReserve = { id: "emergency", name: "Emergencia", currency: "ARS", openingBalance: "1000.00", objective: null, active: true, balance: "1100.00" }
const transaction = (overrides: Partial<FinanceTransaction> = {}): FinanceTransaction => ({ id: crypto.randomUUID(), transactionType: "expense", amount: "100.10", currency: "ARS", effectiveDate: "2026-09-18", accountId: "cash", categoryId: "food", description: "Compra", source: "manual", status: "confirmed", ...overrides })
const savings = (overrides: Partial<FinanceSavingsMovement> = {}): FinanceSavingsMovement => ({ id: crypto.randomUUID(), reserveId: "emergency", accountId: "cash", movementType: "contribution", amount: "20.20", currency: "ARS", effectiveDate: "2026-09-18", description: "Aporte", reason: null, source: "manual", status: "confirmed", linkedTransactionId: null, ...overrides })

describe("finance daily summary", () => {
  it("aggregates expenses by currency, category and day with exact cents", () => {
    const result = buildFinanceDailySummary({ range: { from: "2026-09-01", to: "2026-09-30" }, transactions: [transaction(), transaction({ id: "second", amount: "0.20", currency: "USD", categoryId: null, effectiveDate: "2026-09-19" }), transaction({ id: "pending", status: "pending" }), transaction({ id: "corrected", amount: "1.00", status: "corrected" }), transaction({ id: "discarded", amount: "90.00", status: "discarded" })], categories: [category], savingsMovements: [], reserves: [] })
    expect(result.expenseByCurrency).toEqual({ ARS: "101.10", USD: "0.20" })
    expect(result.expenseByCategory).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryName: "Alimentación", amount: "101.10", count: 2 }),
      expect.objectContaining({ categoryName: "Sin categoría", amount: "0.20", count: 1 }),
    ]))
    expect(result.expenseByDay).toEqual(expect.arrayContaining([expect.objectContaining({ date: "2026-09-18", count: 2 }), expect.objectContaining({ date: "2026-09-19", count: 1 })]))
    expect(result.coverage).toMatchObject({ includedExpenses: 3, pendingTransactions: 1, discardedTransactions: 1, correctedTransactions: 1, uncategorizedExpenses: 1 })
  })

  it("uses the same deterministic range contract for day, week and month views", () => {
    const rows = [transaction({ id: "before", effectiveDate: "2026-08-31" }), transaction({ id: "day", effectiveDate: "2026-09-18" }), transaction({ id: "after", effectiveDate: "2026-10-01" })]
    expect(buildFinanceDailySummary({ range: { from: "2026-09-18", to: "2026-09-18" }, transactions: rows, categories: [category], savingsMovements: [], reserves: [] }).coverage.includedExpenses).toBe(1)
    expect(buildFinanceDailySummary({ range: { from: "2026-09-14", to: "2026-09-20" }, transactions: rows, categories: [category], savingsMovements: [], reserves: [] }).coverage.includedExpenses).toBe(1)
    expect(buildFinanceDailySummary({ range: { from: "2026-09-01", to: "2026-09-30" }, transactions: rows, categories: [category], savingsMovements: [], reserves: [] }).coverage.includedExpenses).toBe(1)
  })

  it("separates savings period movements from accumulated reserve balances", () => {
    const result = buildFinanceDailySummary({ range: { from: "2026-09-01", to: "2026-09-30" }, transactions: [transaction({ id: "income", transactionType: "income", amount: "100.00", categoryId: null })], categories: [], savingsMovements: [savings(), savings({ id: "withdrawal", movementType: "withdrawal", amount: "5.20" }), savings({ id: "return", movementType: "return", amount: "1.00" }), savings({ id: "loss", movementType: "loss", amount: "0.50" })], reserves: [reserve] })
    expect(result.savings.byCurrency.ARS).toEqual({ contribution: "20.20", withdrawal: "5.20", return: "1.00", loss: "0.50", adjustment: "0.00" })
    expect(result.savings.netByCurrency.ARS).toBe("15.50")
    expect(result.savings.reserveBalancesByCurrency.ARS).toBe("1100.00")
    expect(result.savings.byReserve[0]).toMatchObject({ balance: "1100.00", netChange: "15.50" })
    expect(result.incomeByCurrency.ARS).toBe("100.00")
    expect(result.savingsRateByCurrency.ARS).toBe("20.20")
  })

  it("does not claim an expense or savings movement when data is invalid or outside the range", () => {
    const result = buildFinanceDailySummary({ range: { from: "2026-09-01", to: "2026-09-30" }, transactions: [transaction({ amount: "bad" }), transaction({ id: "outside", effectiveDate: "2026-10-01" })], categories: [category], savingsMovements: [savings({ amount: "bad" }), savings({ id: "outside-saving", effectiveDate: "2026-10-01" })], reserves: [reserve] })
    expect(result.coverage).toMatchObject({ includedExpenses: 0, invalidTransactionAmounts: 1, includedSavingsMovements: 0, invalidSavingsAmounts: 1 })
    expect(result.expenseByCurrency).toEqual({ ARS: "0.00", USD: "0.00" })
  })
})
