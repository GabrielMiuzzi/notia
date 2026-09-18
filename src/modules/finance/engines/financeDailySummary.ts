import type {
  FinanceCategory,
  FinanceCurrency,
  FinanceSavingsMovement,
  FinanceSavingsReserve,
  FinanceTransaction,
} from "../types/financeTypes"
import { formatFinanceCents, parseFinanceCents } from "./financeAmounts"

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

const CURRENCIES: readonly FinanceCurrency[] = ["ARS", "USD"]
const SAVINGS_TYPES: readonly FinanceSavingsMovement["movementType"][] = ["contribution", "withdrawal", "return", "loss", "adjustment"]

function emptyCurrencyTotals(): FinanceCurrencyTotals {
  return { ARS: "0.00", USD: "0.00" }
}

function emptySavingsByType(): FinanceSavingsByType {
  return { contribution: "0.00", withdrawal: "0.00", return: "0.00", loss: "0.00", adjustment: "0.00" }
}

function isDateInRange(date: string, range: FinanceDateRange): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= range.from && date <= range.to
}

function addAmount(target: Record<string, string>, key: string, amount: string): boolean {
  try {
    target[key] = formatFinanceCents(parseFinanceCents(target[key] ?? "0") + parseFinanceCents(amount))
    return true
  } catch {
    return false
  }
}

function addSavingsAmount(target: FinanceSavingsByType, type: FinanceSavingsMovement["movementType"], amount: string): boolean {
  if (!SAVINGS_TYPES.includes(type)) return false
  try {
    target[type] = formatFinanceCents(parseFinanceCents(target[type]) + parseFinanceCents(amount))
    return true
  } catch {
    return false
  }
}

function calculateSavingsNet(values: FinanceSavingsByType): string {
  const positive = [values.contribution, values.return, values.adjustment]
  const negative = [values.withdrawal, values.loss]
  const total = positive.reduce((sum, value) => sum + parseFinanceCents(value), 0n) - negative.reduce((sum, value) => sum + parseFinanceCents(value), 0n)
  return formatFinanceCents(total)
}

function validateRange(range: FinanceDateRange): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to) || range.from > range.to) {
    throw new Error("El período financiero no es válido")
  }
}

/**
 * Pure daily projection for recorded expenses and savings. It never computes
 * account balances and only counts confirmed/corrected records used by native
 * Finance totals.
 */
export function buildFinanceDailySummary(input: {
  range: FinanceDateRange
  transactions: readonly FinanceTransaction[]
  categories: readonly FinanceCategory[]
  savingsMovements: readonly FinanceSavingsMovement[]
  reserves: readonly FinanceSavingsReserve[]
}): FinanceDailySummary {
  validateRange(input.range)
  const categoryNames = new Map(input.categories.map((category) => [category.id, category.name]))
  const reserveById = new Map(input.reserves.map((reserve) => [reserve.id, reserve]))
  const expenseByCurrency = emptyCurrencyTotals()
  const incomeByCurrency = emptyCurrencyTotals()
  const expenseByCategory = new Map<string, FinanceExpenseByCategory>()
  const expenseByDay = new Map<string, FinanceExpenseByDay>()
  const savingsByCurrency: Record<FinanceCurrency, FinanceSavingsByType> = { ARS: emptySavingsByType(), USD: emptySavingsByType() }
  const savingsByReserve = new Map<string, FinanceSavingsByReserve>()
  const reserveBalancesByCurrency = emptyCurrencyTotals()
  const coverage: FinanceSummaryCoverage = {
    totalTransactions: input.transactions.length,
    includedExpenses: 0,
    pendingTransactions: input.transactions.filter((transaction) => transaction.status === "pending").length,
    discardedTransactions: input.transactions.filter((transaction) => transaction.status === "discarded").length,
    correctedTransactions: input.transactions.filter((transaction) => transaction.status === "corrected").length,
    uncategorizedExpenses: 0,
    invalidTransactionAmounts: 0,
    includedIncomes: 0,
    invalidIncomeAmounts: 0,
    totalSavingsMovements: input.savingsMovements.length,
    includedSavingsMovements: 0,
    invalidSavingsAmounts: 0,
  }

  for (const reserve of input.reserves) {
    addAmount(reserveBalancesByCurrency, reserve.currency, reserve.balance)
    savingsByReserve.set(reserve.id, { reserveId: reserve.id, reserveName: reserve.name, currency: reserve.currency, balance: reserve.balance, period: emptySavingsByType(), netChange: "0.00" })
  }

  for (const transaction of input.transactions) {
    if (!["confirmed", "corrected"].includes(transaction.status) || !isDateInRange(transaction.effectiveDate.slice(0, 10), input.range)) continue
    let parsedAmount: bigint
    try { parsedAmount = parseFinanceCents(transaction.amount) } catch { coverage.invalidTransactionAmounts += 1; if (transaction.transactionType === "income") coverage.invalidIncomeAmounts += 1; continue }
    if (transaction.transactionType === "income") {
      addAmount(incomeByCurrency, transaction.currency, transaction.amount)
      coverage.includedIncomes += 1
      continue
    }
    if (transaction.transactionType !== "expense") continue
    const categoryId = transaction.categoryId ?? null
    const categoryKey = `${categoryId ?? "uncategorized"}:${transaction.currency}`
    const category = expenseByCategory.get(categoryKey) ?? { categoryId, categoryName: categoryId ? categoryNames.get(categoryId) ?? "Categoría inexistente" : "Sin categoría", currency: transaction.currency, amount: "0.00", count: 0 }
    category.amount = formatFinanceCents(parseFinanceCents(category.amount) + parsedAmount)
    category.count += 1
    expenseByCategory.set(categoryKey, category)
    addAmount(expenseByCurrency, transaction.currency, transaction.amount)
    const date = transaction.effectiveDate.slice(0, 10)
    const day = expenseByDay.get(date) ?? { date, byCurrency: emptyCurrencyTotals(), count: 0 }
    addAmount(day.byCurrency, transaction.currency, transaction.amount)
    day.count += 1
    expenseByDay.set(date, day)
    coverage.includedExpenses += 1
    if (!categoryId) coverage.uncategorizedExpenses += 1
  }

  for (const movement of input.savingsMovements) {
    if (!['confirmed', 'corrected'].includes(movement.status) || !isDateInRange(movement.effectiveDate.slice(0, 10), input.range)) continue
    const reserve = reserveById.get(movement.reserveId)
    if (!reserve || reserve.currency !== movement.currency || !SAVINGS_TYPES.includes(movement.movementType)) continue
    try { parseFinanceCents(movement.amount) } catch { coverage.invalidSavingsAmounts += 1; continue }
    if (!addSavingsAmount(savingsByCurrency[movement.currency], movement.movementType, movement.amount)) { coverage.invalidSavingsAmounts += 1; continue }
    const reserveSummary = savingsByReserve.get(reserve.id)
    if (reserveSummary && addSavingsAmount(reserveSummary.period, movement.movementType, movement.amount)) reserveSummary.netChange = calculateSavingsNet(reserveSummary.period)
    coverage.includedSavingsMovements += 1
  }

  const netByCurrency = emptyCurrencyTotals()
  const savingsRateByCurrency: FinanceNullableCurrencyTotals = { ARS: null, USD: null }
  for (const currency of CURRENCIES) netByCurrency[currency] = calculateSavingsNet(savingsByCurrency[currency])
  for (const currency of CURRENCIES) {
    const income = parseFinanceCents(incomeByCurrency[currency])
    if (income > 0n) savingsRateByCurrency[currency] = formatFinanceCents((parseFinanceCents(savingsByCurrency[currency].contribution) * 10000n) / income)
  }
  return {
    range: input.range,
    expenseByCurrency,
    expenseByCategory: [...expenseByCategory.values()].sort((left, right) => {
      const leftAmount = parseFinanceCents(left.amount)
      const rightAmount = parseFinanceCents(right.amount)
      return rightAmount > leftAmount ? 1 : rightAmount < leftAmount ? -1 : 0
    }),
    expenseByDay: [...expenseByDay.values()].sort((left, right) => left.date.localeCompare(right.date)),
    incomeByCurrency,
    savingsRateByCurrency,
    savings: {
      byCurrency: savingsByCurrency,
      netByCurrency,
      reserveBalancesByCurrency,
      byReserve: [...savingsByReserve.values()].sort((left, right) => left.reserveName.localeCompare(right.reserveName, "es")),
      movementCount: coverage.includedSavingsMovements,
    },
    coverage,
  }
}
