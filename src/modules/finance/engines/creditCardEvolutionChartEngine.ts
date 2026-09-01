import type { FinanceAccount, FinanceCreditCardStatement } from '../types/financeTypes'

export interface CreditCardChartSeries {
  accountId: string
  name: string
  values: Array<number | null>
}

export interface CreditCardChartData {
  periods: string[]
  series: CreditCardChartSeries[]
}

export function buildCreditCardChartData(
  accounts: FinanceAccount[],
  statements: FinanceCreditCardStatement[],
): CreditCardChartData {
  const cardAccounts = accounts.filter((account) => account.accountType === 'credit_card')
  const accountIds = new Set(cardAccounts.map((account) => account.id))
  const validStatements = statements.filter((statement) => accountIds.has(statement.accountId) && Number.isFinite(Number(statement.totalDue)))
  const periods = [...new Set(validStatements.map((statement) => statement.period))].sort()
  const valuesByAccountAndPeriod = new Map(validStatements.map((statement) => [
    `${statement.accountId}:${statement.period}`,
    Number(statement.totalDue),
  ]))

  return {
    periods,
    series: cardAccounts
      .filter((account) => validStatements.some((statement) => statement.accountId === account.id))
      .map((account) => ({
        accountId: account.id,
        name: account.name,
        values: periods.map((period) => valuesByAccountAndPeriod.get(`${account.id}:${period}`) ?? null),
      })),
  }
}
