import { callBackend } from '../../../services/transport'
import type { NotiaLibrary } from '../../../types/notia'
import type { FinanceContext, FinanceCreditCardStatement, FinanceDashboard, FinanceDevQueryResult, FinanceDevTable, FinanceInstallmentPlanSummary, FinancePriceObservation, FinanceProductSummary, FinancePurchaseSummary, FinanceReviewItem, FinanceSalaryEvolution, FinanceSavingsMovement, FinanceServiceMonthStatus, FinanceServiceOccurrenceVersion, FinanceTransaction } from '../types/financeTypes'
import { financeContext } from '../types/financeTypes'
import type { FinanceDailySummary } from '../types/financeViews'

// The Finanzas screen only reads: every change goes through the assistant,
// in the app chat or Telegram, and its tools in the Rust backend.

export type FinanceActor = string | { libraryUserId?: string; source?: FinanceContext['source'] } | undefined
const context = (library: NotiaLibrary, actor?: FinanceActor) => (
  typeof actor === 'object' && actor !== null
    ? financeContext(library, actor.libraryUserId, actor.source)
    : financeContext(library, actor)
)

export function getFinanceDashboard(library: NotiaLibrary, month: string, actor?: FinanceActor): Promise<FinanceDashboard> {
  return callBackend<FinanceDashboard>('finance_get_dashboard', { context: context(library, actor), month })
}

/** State of each active service in a month: paid, pending or not applicable. */
export function getFinanceServiceMonthStatus(library: NotiaLibrary, period: string, actor?: FinanceActor): Promise<FinanceServiceMonthStatus[]> {
  return callBackend<FinanceServiceMonthStatus[]>('finance_service_month_status', { context: context(library, actor), period })
}

export function listFinanceServiceOccurrenceVersions(library: NotiaLibrary, occurrenceId: string, actor?: FinanceActor): Promise<FinanceServiceOccurrenceVersion[]> {
  return callBackend<FinanceServiceOccurrenceVersion[]>('finance_list_service_occurrence_versions', { context: context(library, actor), occurrenceId })
}

export function listFinanceDevTables(): Promise<FinanceDevTable[]> {
  return callBackend<FinanceDevTable[]>('finance_dev_list_tables')
}

export function queryFinanceDevTable(library: NotiaLibrary, tableName: string, page: number, pageSize = 50): Promise<FinanceDevQueryResult> {
  return callBackend<FinanceDevQueryResult>('finance_dev_query_table', { payload: { context: context(library), tableName, page, pageSize } })
}

export function queryFinanceDevSql(library: NotiaLibrary, sql: string, page: number, pageSize = 50): Promise<FinanceDevQueryResult> {
  return callBackend<FinanceDevQueryResult>('finance_dev_query_sql', { payload: { context: context(library), sql, page, pageSize } })
}

export function seedFinanceDevData(library: NotiaLibrary): Promise<void> {
  return callBackend('finance_dev_seed_demo_data', { context: context(library) })
}

export function clearAllFinanceData(library: NotiaLibrary, actor?: FinanceActor): Promise<void> {
  return callBackend('finance_clear_all_data', { context: context(library, actor) })
}

export interface FinanceHistoryFilters {
  from?: string
  to?: string
  merchantId?: string
  productId?: string
}

export function listFinancePurchases(library: NotiaLibrary, filters: FinanceHistoryFilters = {}, actor?: FinanceActor): Promise<FinancePurchaseSummary[]> {
  return callBackend<FinancePurchaseSummary[]>('finance_list_purchases', { payload: { context: context(library, actor), ...filters } })
}

export function listFinancePriceHistory(library: NotiaLibrary, filters: FinanceHistoryFilters = {}, actor?: FinanceActor): Promise<FinancePriceObservation[]> {
  return callBackend<FinancePriceObservation[]>('finance_list_price_history', { payload: { context: context(library, actor), ...filters } })
}

/** Products with the last price paid at each merchant. */
export function listFinanceProducts(library: NotiaLibrary, search = '', actor?: FinanceActor): Promise<FinanceProductSummary[]> {
  return callBackend<FinanceProductSummary[]>('finance_list_products', { payload: { context: context(library, actor), search: search.trim() || null } })
}

export function listFinanceSalaries(library: NotiaLibrary, filters: FinanceHistoryFilters = {}, actor?: FinanceActor): Promise<FinanceSalaryEvolution[]> {
  return callBackend<FinanceSalaryEvolution[]>('finance_list_salaries', { payload: { context: context(library, actor), ...filters } })
}

export function listFinanceCreditCardStatements(library: NotiaLibrary, filters: FinanceHistoryFilters = {}, actor?: FinanceActor): Promise<FinanceCreditCardStatement[]> {
  return callBackend<FinanceCreditCardStatement[]>('finance_list_credit_card_statements', { payload: { context: context(library, actor), ...filters } })
}

/** Installment plans with what is left to pay of each one. */
export function listFinanceInstallmentPlans(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceInstallmentPlanSummary[]> {
  return callBackend<FinanceInstallmentPlanSummary[]>('finance_list_installment_plans', { context: context(library, actor) })
}

export type { FinanceContext }

export interface FinanceSalaryComparison {
  salaryChangePercent: number
  ipcAccumulatedPercent: number | null
  ipcDifferencePercentagePoints: number | null
}

export interface FinanceSalaryInflationBenchmark {
  period: string
  ipcAccumulatedPercent: number
  annualInflationPercent: number
  arsVsIpcPercentagePoints: number
  arsVsAnnualPercentagePoints: number
  usdVsIpcPercentagePoints: number
  usdVsAnnualPercentagePoints: number
}

/** Salary evolution computed by the backend (`finance_salary_analysis`). */
export interface FinanceSalaryAnalysis {
  points: Array<{
    period: string
    ars: number
    usd: number
    arsComparison: FinanceSalaryComparison | null
    usdComparison: FinanceSalaryComparison | null
  }>
  yearSummary: {
    currentPeriod: string
    comparisonPeriod: string
    monthCount: number
    arsVariationPercent: number
    usdVariationPercent: number
    averageArs: number
    averageUsd: number
  } | null
  inflationBenchmark: FinanceSalaryInflationBenchmark | null
  inflationError: string | null
}

export function getFinanceSalaryAnalysis(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceSalaryAnalysis> {
  return callBackend<FinanceSalaryAnalysis>('finance_salary_analysis', { payload: { context: context(library, actor) } })
}

/** What went to savings in the month, by currency. */
export interface FinanceSavedThisMonth {
  contributionsByCurrency: Record<string, string>
  /** What the bought currency cost, in the currency it was paid with. */
  costByCurrency: Record<string, string>
  withdrawalsByCurrency: Record<string, string>
}

/** Figures of the dashboard, computed by the backend (`finance_dashboard_insights`). */
export interface FinanceDashboardInsights {
  summary: FinanceDailySummary | null
  /** Change of each expense category (`categoryId:currency`) against the previous month; `null` when it is new. */
  categoryVariation: Record<string, number | null>
  transactions: FinanceTransaction[]
  transactionCount: number
  page: number
  pageCount: number
  pendingCount: number
  sources: string[]
  serviceIds: string[]
  expensesByCategory: Array<{ name: string; currency: string; amount: string }>
  savingsMovements: FinanceSavingsMovement[]
  savingsBreakdown: Record<string, string>
  debtRatio: { ratios: Array<{ currency: string; percentage: number }>; period: string }
  /** Cards paid over salary per month and currency, for the evolution chart. */
  debtRatioSeries: FinanceDebtRatioSeries
  savingsToIncome: number | null
  /** Card statements due in the month: what was paid for the cards. */
  cardPaidByCurrency: Record<string, string>
  /** Card expenses no loaded statement includes yet. */
  cardUnpaidByCurrency: Record<string, string>
  cardUnpaidCount: number
  savedThisMonth: FinanceSavedThisMonth
  /** Doubts the assistant asks about in the chat or Telegram. */
  reviewItems: FinanceReviewItem[]
}

export interface FinanceDebtRatioSeries {
  periods: string[]
  series: Array<{ currency: string; values: Array<number | null> }>
}

export interface FinanceDashboardInsightsRequest {
  month: string
  summaryView: 'day' | 'week' | 'month'
  summaryDate: string
  page: number
  dollarRate: number | null
  filters: { search: string; categoryId: string; currency: string; status: string; accountId: string; source: string; serviceId: string }
  savingsFilters: { reserveId: string; currency: string }
}

export function getFinanceDashboardInsights(library: NotiaLibrary, request: FinanceDashboardInsightsRequest, actor?: FinanceActor): Promise<FinanceDashboardInsights> {
  return callBackend<FinanceDashboardInsights>('finance_dashboard_insights', { payload: { context: context(library, actor), ...request } })
}
