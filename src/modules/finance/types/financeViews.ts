import type { FinanceCurrency } from "./financeTypes"

// Derived finance views computed by the backend (`finance_views.rs`).

export interface FinanceDateRange {
  from: string
  to: string
}

export type FinanceCurrencyTotals = Record<FinanceCurrency, string>

export interface FinanceExpenseByCategory {
  categoryId: string | null
  categoryName: string
  currency: FinanceCurrency
  amount: string
  count: number
}

export interface FinanceExpenseByDay {
  date: string
  byCurrency: FinanceCurrencyTotals
  count: number
}

export interface FinanceSavingsByType {
  contribution: string
  withdrawal: string
  return: string
  loss: string
  adjustment: string
}

export interface FinanceSavingsByReserve {
  reserveId: string
  reserveName: string
  currency: FinanceCurrency
  balance: string
  period: FinanceSavingsByType
  netChange: string
}

export interface FinanceSavingsSummary {
  byCurrency: Record<FinanceCurrency, FinanceSavingsByType>
  netByCurrency: FinanceCurrencyTotals
  reserveBalancesByCurrency: FinanceCurrencyTotals
  byReserve: FinanceSavingsByReserve[]
  movementCount: number
}

export type FinanceNullableCurrencyTotals = Record<FinanceCurrency, string | null>

export interface FinanceSummaryCoverage {
  totalTransactions: number
  includedExpenses: number
  pendingTransactions: number
  discardedTransactions: number
  correctedTransactions: number
  uncategorizedExpenses: number
  invalidTransactionAmounts: number
  includedIncomes: number
  invalidIncomeAmounts: number
  totalSavingsMovements: number
  includedSavingsMovements: number
  invalidSavingsAmounts: number
}

export interface FinanceDailySummary {
  range: FinanceDateRange
  expenseByCurrency: FinanceCurrencyTotals
  expenseByCategory: FinanceExpenseByCategory[]
  expenseByDay: FinanceExpenseByDay[]
  incomeByCurrency: FinanceCurrencyTotals
  savingsRateByCurrency: FinanceNullableCurrencyTotals
  savings: FinanceSavingsSummary
  coverage: FinanceSummaryCoverage
}
