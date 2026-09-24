import { callBackend } from '../../../services/transport'
import type { NotiaLibrary } from '../../../types/notia'
import type { FinanceAccount, FinanceCategory, FinanceDashboard, FinanceTransaction, FinanceContext, FinanceSavingsReserve, FinanceSavingsMovement, FinanceSavingsExchange, FinanceSavedSavingsExchange, FinancePurchaseRecord, FinanceSavedPurchase, FinancePurchaseSummary, FinancePriceObservation, FinanceSalaryReceipt, FinanceSalaryReceiptInput, FinanceSalaryEvolution, FinanceCreditCardStatement, FinanceCreditCardStatementInput, FinanceSavedCreditCardStatement, FinanceInstallmentPlan, FinanceInstallment, FinanceInvestment, FinanceNetWorth, FinanceNetWorthHistoryPoint, FinanceExtractionResult, FinanceDevQueryResult, FinanceDevTable, FinanceService, FinanceServiceOccurrence, FinanceServiceOccurrenceVersion, FinanceServiceInvoice, FinanceAuditRun, FinanceAuditProposal, FinanceCardServiceResolution, FinanceRelationRepair, FinanceRelationRepairType } from '../types/financeTypes'
import { financeContext } from '../types/financeTypes'
import type { FinanceDailySummary, FinanceDateRange, FinanceRelationAudit, SalaryExtractionDraft } from '../types/financeViews'
import type { FinanceCardServiceReconciliation, FinancePurchaseValidation } from '../types/financeTypes'
import { notifyFinanceDataChanged } from './financeDataEvents'

export type FinanceActor = string | { libraryUserId?: string; source?: FinanceContext['source'] } | undefined
const context = (library: NotiaLibrary, actor?: FinanceActor) => (
  typeof actor === 'object' && actor !== null
    ? financeContext(library, actor.libraryUserId, actor.source)
    : financeContext(library, actor)
)

export function getFinanceDashboard(library: NotiaLibrary, month: string, actorLibraryUserId?: FinanceActor): Promise<FinanceDashboard> {
  return callBackend<FinanceDashboard>('finance_get_dashboard', { context: context(library, actorLibraryUserId), month })
}

export function getFinanceTransaction(library: NotiaLibrary, id: string, actor?: FinanceActor): Promise<FinanceTransaction> {
  return callBackend<FinanceTransaction>('finance_get_transaction', { payload: { context: context(library, actor), id } })
}

export function listAllFinanceTransactions(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceTransaction[]> {
  return callBackend<FinanceTransaction[]>('finance_list_all_transactions', { context: context(library, actor) })
}

export function listAllFinanceSavingsMovements(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceSavingsMovement[]> {
  return callBackend<FinanceSavingsMovement[]>('finance_list_all_savings_movements', { context: context(library, actor) })
}

export function listFinanceServices(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceService[]> {
  return callBackend<FinanceService[]>('finance_list_services', { context: context(library, actor) })
}


export function setFinanceServiceActive(library: NotiaLibrary, id: string, active: boolean, actor?: FinanceActor): Promise<void> {
  return callBackend('finance_set_service_active', { payload: { context: context(library, actor), id, active } })
}

export function listFinanceServiceOccurrences(library: NotiaLibrary, period: string, actor?: FinanceActor): Promise<FinanceServiceOccurrence[]> {
  return callBackend<FinanceServiceOccurrence[]>('finance_list_service_occurrences', { context: context(library, actor), period })
}

export function listAllFinanceServiceOccurrences(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceServiceOccurrence[]> {
  return callBackend<FinanceServiceOccurrence[]>('finance_list_all_service_occurrences', { context: context(library, actor) })
}


export function listFinanceServiceOccurrenceVersions(library: NotiaLibrary, occurrenceId: string, actor?: FinanceActor): Promise<FinanceServiceOccurrenceVersion[]> {
  return callBackend<FinanceServiceOccurrenceVersion[]>('finance_list_service_occurrence_versions', { context: context(library, actor), occurrenceId })
}

export function listAllFinanceServiceOccurrenceVersions(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceServiceOccurrenceVersion[]> {
  return callBackend<FinanceServiceOccurrenceVersion[]>('finance_list_all_service_occurrence_versions', { context: context(library, actor) })
}


export function listFinanceServiceInvoices(library: NotiaLibrary, period?: string, actor?: FinanceActor): Promise<FinanceServiceInvoice[]> {
  return callBackend<FinanceServiceInvoice[]>('finance_list_service_invoices', { context: context(library, actor), period })
}

export function saveFinanceAuditRun(library: NotiaLibrary, run: FinanceAuditRun, actor?: FinanceActor): Promise<FinanceAuditRun> {
  return callBackend<FinanceAuditRun>('finance_save_audit_run', { payload: { context: context(library, actor), run } })
}

export function listFinanceAuditRuns(library: NotiaLibrary, period?: string, status?: string, actor?: FinanceActor): Promise<FinanceAuditRun[]> {
  return callBackend<FinanceAuditRun[]>('finance_list_audit_runs', { context: context(library, actor), period, status })
}

export function saveFinanceAuditProposal(library: NotiaLibrary, proposal: FinanceAuditProposal, actor?: FinanceActor): Promise<FinanceAuditProposal> {
  return callBackend<FinanceAuditProposal>('finance_save_audit_proposal', { payload: { context: context(library, actor), proposal } })
}

export function listFinanceAuditProposals(library: NotiaLibrary, period?: string, status?: string, actor?: FinanceActor): Promise<FinanceAuditProposal[]> {
  return callBackend<FinanceAuditProposal[]>('finance_list_audit_proposals', { context: context(library, actor), period, status })
}

export function decideFinanceAuditProposal(library: NotiaLibrary, proposalId: string, decision: 'accepted' | 'rejected' | 'cancelled', actor?: FinanceActor, expectedDataFingerprint?: string, resolutionAssignments?: FinanceCardServiceResolution[]): Promise<void> {
  return callBackend('finance_decide_audit_proposal', { payload: { context: context(library, actor), proposalId, decision, expectedDataFingerprint, resolutionAssignments } })
}

export function repairFinanceRelation(library: NotiaLibrary, input: { operationId: string; relationType: FinanceRelationRepairType; relationId: string; newTransactionId: string | null; expectedTransactionId: string | null; reason?: string | null }, actor?: FinanceActor): Promise<FinanceRelationRepair> {
  return callBackend<FinanceRelationRepair>('finance_repair_relation', { payload: { context: context(library, actor), operationId: input.operationId, relationType: input.relationType, relationId: input.relationId, newTransactionId: input.newTransactionId, expectedTransactionId: input.expectedTransactionId, reason: input.reason ?? null } })
}

export function listFinanceRelationRepairs(library: NotiaLibrary, relationType?: FinanceRelationRepairType, relationId?: string, actor?: FinanceActor): Promise<FinanceRelationRepair[]> {
  return callBackend<FinanceRelationRepair[]>('finance_list_relation_repairs', { context: context(library, actor), relationType, relationId })
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

export function saveFinanceAccount(library: NotiaLibrary, account: FinanceAccount, actorLibraryUserId?: FinanceActor): Promise<FinanceAccount> {
  return callBackend<FinanceAccount>('finance_save_account', { payload: { context: context(library, actorLibraryUserId), account } })
}

export function saveFinanceCategory(library: NotiaLibrary, category: FinanceCategory, actorLibraryUserId?: FinanceActor): Promise<FinanceCategory> {
  return callBackend<FinanceCategory>('finance_save_category', { payload: { context: context(library, actorLibraryUserId), category } })
}

export function saveFinanceTransaction(library: NotiaLibrary, transaction: FinanceTransaction, actorLibraryUserId?: FinanceActor): Promise<FinanceTransaction> {
  return callBackend<FinanceTransaction>('finance_save_transaction', { payload: { context: context(library, actorLibraryUserId), transaction } })
}

/** A change made on the Finanzas screen. */
export type FinanceUiChange =
  | { kind: 'create-transaction'; transaction: FinanceTransaction }
  | { kind: 'edit-transaction'; transaction: FinanceTransaction }
  | { kind: 'confirm-transaction'; id: string }
  | { kind: 'discard-transaction'; id: string }
  | { kind: 'save-savings-movement'; movement: FinanceSavingsMovement }
  | { kind: 'save-purchase'; purchase: FinancePurchaseRecord }
  | { kind: 'save-salary'; salary: FinanceSalaryReceiptInput }
  | { kind: 'save-card-statement'; statement: FinanceCreditCardStatementInput }
  | { kind: 'save-service'; service: FinanceService }
  | { kind: 'save-service-occurrence'; occurrence: FinanceServiceOccurrence; reason?: string }
  | { kind: 'save-service-invoice'; invoice: FinanceServiceInvoice }

/**
 * Stores a change made on the Finanzas screen. The backend applies its rules
 * (an edited pending movement becomes corrected) and leaves the audit of its
 * period pending.
 */
export async function applyFinanceUiChange<T = unknown>(library: NotiaLibrary, change: FinanceUiChange): Promise<T> {
  const saved = await callBackend<T>('finance_apply_ui_change', { payload: { context: context(library), change } })
  notifyFinanceDataChanged()
  return saved
}

/** Runs deterministic audit rules natively and reuses pending/failed runs by fingerprint. */
export function runFinanceAudit(library: NotiaLibrary, period: string, triggerFingerprint: string, reason?: string, actor?: FinanceActor): Promise<{ run: FinanceAuditRun; proposals: FinanceAuditProposal[] }> {
  return callBackend<{ run: FinanceAuditRun; proposals: FinanceAuditProposal[] }>('finance_run_audit', {
    payload: { context: context(library, actor), period, triggerFingerprint, reason: reason ?? null },
  })
}

export function deleteFinanceTransaction(library: NotiaLibrary, id: string, actor?: FinanceActor): Promise<void> {
  return callBackend('finance_delete_transaction', { payload: { context: context(library, actor), id } })
}

export function deleteFinanceAccount(library: NotiaLibrary, id: string, actor?: FinanceActor): Promise<void> {
  return callBackend('finance_delete_account', { payload: { context: context(library, actor), id } })
}

export function deleteFinanceCategory(library: NotiaLibrary, id: string, actor?: FinanceActor): Promise<void> {
  return callBackend('finance_delete_category', { payload: { context: context(library, actor), id } })
}

export function clearAllFinanceData(library: NotiaLibrary, actor?: FinanceActor): Promise<void> {
  return callBackend('finance_clear_all_data', { context: context(library, actor) })
}

export function saveFinanceSavingsReserve(library: NotiaLibrary, reserve: FinanceSavingsReserve, actorLibraryUserId?: FinanceActor): Promise<FinanceSavingsReserve> {
  return callBackend<FinanceSavingsReserve>('finance_save_savings_reserve', { payload: { context: context(library, actorLibraryUserId), reserve } })
}

export function saveFinanceSavingsMovement(library: NotiaLibrary, movement: FinanceSavingsMovement, actorLibraryUserId?: FinanceActor): Promise<FinanceSavingsMovement> {
  return callBackend<FinanceSavingsMovement>('finance_save_savings_movement', { payload: { context: context(library, actorLibraryUserId), movement } })
}

export function saveFinanceSavingsExchange(library: NotiaLibrary, exchange: FinanceSavingsExchange, actorLibraryUserId?: FinanceActor): Promise<FinanceSavedSavingsExchange> {
  return callBackend<FinanceSavedSavingsExchange>('finance_save_savings_exchange', { payload: { context: context(library, actorLibraryUserId), exchange } })
}

export function linkFinanceSavingsAccount(library: NotiaLibrary, reserveId: string, accountId: string, actor?: FinanceActor): Promise<void> {
  return callBackend('finance_link_savings_account', { payload: { context: context(library, actor), reserveId, accountId } })
}

export interface FinanceHistoryFilters {
  from?: string
  to?: string
  merchantId?: string
  productId?: string
}

export function saveFinancePurchase(library: NotiaLibrary, purchase: FinancePurchaseRecord, actorLibraryUserId?: FinanceActor): Promise<FinanceSavedPurchase> {
  return callBackend<FinanceSavedPurchase>('finance_save_purchase', { payload: { context: context(library, actorLibraryUserId), purchase } })
}

export function listFinancePurchases(library: NotiaLibrary, filters: FinanceHistoryFilters = {}, actorLibraryUserId?: FinanceActor): Promise<FinancePurchaseSummary[]> {
  return callBackend<FinancePurchaseSummary[]>('finance_list_purchases', { payload: { context: context(library, actorLibraryUserId), ...filters } })
}

export function listFinancePriceHistory(library: NotiaLibrary, filters: FinanceHistoryFilters = {}, actorLibraryUserId?: FinanceActor): Promise<FinancePriceObservation[]> {
  return callBackend<FinancePriceObservation[]>('finance_list_price_history', { payload: { context: context(library, actorLibraryUserId), ...filters } })
}

export function saveFinanceSalary(library: NotiaLibrary, salary: FinanceSalaryReceiptInput, actorLibraryUserId?: FinanceActor): Promise<FinanceSalaryReceipt> {
  return callBackend<FinanceSalaryReceipt>('finance_save_salary', { payload: { context: context(library, actorLibraryUserId), salary } })
}

export function listFinanceSalaries(library: NotiaLibrary, filters: FinanceHistoryFilters = {}, actorLibraryUserId?: FinanceActor): Promise<FinanceSalaryEvolution[]> {
  return callBackend<FinanceSalaryEvolution[]>('finance_list_salaries', { payload: { context: context(library, actorLibraryUserId), ...filters } })
}

class FinanceSalaryPersistenceVerificationError extends Error {
  readonly code = 'storage'
}

export function matchesSavedSalary(expected: FinanceSalaryReceipt, persisted: FinanceSalaryReceipt): boolean {
  return persisted.id === expected.id
    && persisted.period === expected.period
    && persisted.paymentDate === expected.paymentDate
    && persisted.employer === expected.employer
    && persisted.grossAmount === expected.grossAmount
    && persisted.deductionsTotal === expected.deductionsTotal
    && persisted.netAmount === expected.netAmount
    && persisted.currency === expected.currency
    && persisted.accountId === expected.accountId
    && persisted.status === expected.status
    && Boolean(persisted.signedDocument) === Boolean(expected.signedDocument)
    && persisted.sourceReference === expected.sourceReference
    && persisted.concepts.length === expected.concepts.length
    && expected.concepts.every((concept) => persisted.concepts.some((candidate) =>
      candidate.id === concept.id
      && candidate.name === concept.name
      && candidate.conceptType === concept.conceptType
      && candidate.amount === concept.amount))
}

/** Re-reads a salary from native SQLite and rejects success without the complete persisted record. */
export async function verifyFinanceSalaryPersistence(library: NotiaLibrary, salary: FinanceSalaryReceipt, actorLibraryUserId?: FinanceActor): Promise<void> {
  const persistedRows = await listFinanceSalaries(library, { from: salary.period, to: salary.period }, actorLibraryUserId)
  if (!persistedRows.some(({ salary: persisted }) => matchesSavedSalary(salary, persisted))) {
    throw new FinanceSalaryPersistenceVerificationError('El recibo no pudo verificarse en la base financiera después de guardarlo.')
  }
}

/** Saves a salary and confirms it through a separate native read before reporting success. */
export async function saveVerifiedFinanceSalary(library: NotiaLibrary, salary: FinanceSalaryReceipt, actorLibraryUserId?: FinanceActor): Promise<FinanceSalaryReceipt> {
  const saved = await saveFinanceSalary(library, salary, actorLibraryUserId)
  await verifyFinanceSalaryPersistence(library, saved, actorLibraryUserId)
  return saved
}

export function saveFinanceCreditCardStatement(library: NotiaLibrary, statement: FinanceCreditCardStatementInput, actorLibraryUserId?: FinanceActor): Promise<FinanceSavedCreditCardStatement> {
  return callBackend<FinanceSavedCreditCardStatement>('finance_save_credit_card_statement', { payload: { context: context(library, actorLibraryUserId), statement } })
}

export function listFinanceCreditCardStatements(library: NotiaLibrary, filters: FinanceHistoryFilters = {}, actorLibraryUserId?: FinanceActor): Promise<FinanceCreditCardStatement[]> {
  return callBackend<FinanceCreditCardStatement[]>('finance_list_credit_card_statements', { payload: { context: context(library, actorLibraryUserId), ...filters } })
}

export function saveFinanceInstallmentPlan(library: NotiaLibrary, plan: FinanceInstallmentPlan, actor?: FinanceActor): Promise<FinanceInstallment[]> {
  return callBackend<FinanceInstallment[]>('finance_save_installment_plan', { payload: { context: context(library, actor), plan } })
}

export function listFinanceInstallmentPlans(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceInstallmentPlan[]> {
  return callBackend<FinanceInstallmentPlan[]>('finance_list_installment_plans', { context: context(library, actor) })
}

export function listFinanceInstallments(library: NotiaLibrary, planId?: string, actor?: FinanceActor): Promise<FinanceInstallment[]> {
  return callBackend<FinanceInstallment[]>('finance_list_installments', { payload: { context: context(library, actor), planId } })
}

export function saveFinanceInvestment(library: NotiaLibrary, investment: FinanceInvestment, actor?: FinanceActor): Promise<FinanceInvestment> {
  return callBackend<FinanceInvestment>('finance_save_investment', { payload: { context: context(library, actor), investment } })
}

export function listFinanceInvestments(library: NotiaLibrary, active?: boolean, actor?: FinanceActor): Promise<FinanceInvestment[]> {
  return callBackend<FinanceInvestment[]>('finance_list_investments', { payload: { context: context(library, actor), active } })
}

export function getFinanceNetWorth(library: NotiaLibrary, asOf: string, actorLibraryUserId?: FinanceActor): Promise<FinanceNetWorth> {
  return callBackend<FinanceNetWorth>('finance_get_net_worth', { context: context(library, actorLibraryUserId), asOf })
}

export function listFinanceNetWorthHistory(library: NotiaLibrary, actorLibraryUserId?: FinanceActor): Promise<FinanceNetWorthHistoryPoint[]> {
  return callBackend<FinanceNetWorthHistoryPoint[]>('finance_list_net_worth_history', { context: context(library, actorLibraryUserId) })
}

export async function extractFinanceDocument(library: NotiaLibrary, artifactId: string, filePath: string, documentType: 'ticket' | 'salary' | 'credit_card_statement' | 'service_invoice', actor?: FinanceActor): Promise<FinanceExtractionResult> {
  return callBackend<FinanceExtractionResult>('extract_finance_document', { payload: { context: context(library, actor), artifactId, filePath, documentType } })
}

export interface FinanceArtifactStatus {
  artifactId: string
  sourceType: string
  reference?: string | null
  contentHash?: string | null
  createdAt: string
  extraction?: FinanceExtractionResult | null
}

export function listFinanceArtifacts(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceArtifactStatus[]> {
  return callBackend<FinanceArtifactStatus[]>('list_finance_artifacts', { context: context(library, actor) })
}

export type { FinanceContext }

/** Expenses, incomes and savings of the range, computed by the backend. */
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
  expensesByCategory: Array<{ name: string; amount: string }>
  savingsMovements: FinanceSavingsMovement[]
  savingsBreakdown: Record<string, string>
  debtRatio: { ratios: Array<{ currency: string; percentage: number }>; period: string }
  /** Debt over income per month and currency, for the evolution chart. */
  debtRatioSeries: FinanceDebtRatioSeries
  savingsToIncome: number | null
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

export function getFinancePeriodSummary(library: NotiaLibrary, range: FinanceDateRange, actor?: FinanceActor): Promise<FinanceDailySummary> {
  return callBackend<FinanceDailySummary>('finance_period_summary', { payload: { context: context(library, actor), range } })
}

/** Relation audit of the dashboard month, or of every record without a month. */
export function getFinanceRelationAudit(library: NotiaLibrary, month?: string, actor?: FinanceActor): Promise<FinanceRelationAudit> {
  return callBackend<FinanceRelationAudit>('finance_relation_audit', { payload: { context: context(library, actor), month } })
}

/** Ticket arithmetic with the same rules used to save it. */
export function validateFinancePurchase(purchase: FinancePurchaseRecord): Promise<FinancePurchaseValidation> {
  return callBackend<FinancePurchaseValidation>('finance_validate_purchase', { purchase })
}

/** Service assignments a card statement would apply once saved. */
export function previewFinanceCardServices(library: NotiaLibrary, statement: FinanceCreditCardStatementInput, actor?: FinanceActor): Promise<FinanceCardServiceReconciliation> {
  return callBackend<FinanceCardServiceReconciliation>('finance_preview_card_services', { payload: { context: context(library, actor), statement } })
}

/** Salary fields found in a document extraction, to prefill the form. */
export function draftFinanceSalary(rawResult: unknown): Promise<SalaryExtractionDraft> {
  return callBackend<SalaryExtractionDraft>('finance_salary_draft', { rawResult })
}
