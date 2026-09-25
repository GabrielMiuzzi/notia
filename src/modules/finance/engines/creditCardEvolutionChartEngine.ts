import type { FinanceAccount, FinanceCreditCardStatement, FinanceCurrency } from '../types/financeTypes'

export interface CreditCardChartSeries {
  key: string
  name: string
  currency: FinanceCurrency
  values: Array<number | null>
}

export interface CreditCardChartData {
  periods: string[]
  series: CreditCardChartSeries[]
}

/**
 * Geometry input of the card chart: what each card paid per month (the
 * month its statement is due), one series per card and currency.
 */
export function buildCreditCardChartData(
  accounts: FinanceAccount[],
  statements: FinanceCreditCardStatement[],
): CreditCardChartData {
  const cards = new Map(accounts.filter((account) => account.accountType === 'credit_card').map((account) => [account.id, account]))
  const validStatements = statements.filter((statement) => cards.has(statement.accountId) && Number.isFinite(Number(statement.totalDue)))
  const month = (statement: FinanceCreditCardStatement) => statement.dueDate.slice(0, 7)
  const periods = [...new Set(validStatements.map(month))].sort()
  const series = new Map<string, CreditCardChartSeries>()
  for (const statement of validStatements) {
    const key = `${statement.accountId}:${statement.currency}`
    const card = cards.get(statement.accountId)
    if (!card) continue
    const current = series.get(key) ?? {
      key,
      name: statement.currency === card.currency ? card.name : `${card.name} · ${statement.currency}`,
      currency: statement.currency,
      values: periods.map(() => null),
    }
    const index = periods.indexOf(month(statement))
    current.values[index] = (current.values[index] ?? 0) + Number(statement.totalDue)
    series.set(key, current)
  }
  return { periods, series: [...series.values()] }
}
