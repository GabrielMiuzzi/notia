import { invoke } from '@tauri-apps/api/core'
import type { NotiaLibrary } from '../../../types/notia'
import type { FinanceAccount, FinanceCategory, FinanceDashboard, FinanceTransaction, FinanceContext, FinanceSavingsReserve, FinanceSavingsMovement, FinanceSavingsExchange, FinanceSavedSavingsExchange, FinancePurchaseRecord, FinanceSavedPurchase, FinancePurchaseSummary, FinancePriceObservation, FinanceSalaryReceipt, FinanceSalaryReceiptInput, FinanceSalaryEvolution, FinanceCreditCardStatement, FinanceCreditCardStatementInput, FinanceSavedCreditCardStatement, FinanceInstallmentPlan, FinanceInstallment, FinanceInvestment, FinanceNetWorth, FinanceNetWorthHistoryPoint, FinanceExtractionResult, FinanceDevQueryResult, FinanceDevTable, FinanceService, FinanceServiceOccurrence, FinanceServiceOccurrenceVersion, FinanceServiceInvoice, FinanceAuditRun, FinanceAuditProposal, FinanceCardServiceResolution } from '../types/financeTypes'
import { financeContext } from '../types/financeTypes'
import { notifyFinanceDataChanged } from './financeDataEvents'

export type FinanceActor = string | { libraryUserId?: string; source?: FinanceContext['source'] } | undefined
const context = (library: NotiaLibrary, actor?: FinanceActor) => (
  typeof actor === 'object' && actor !== null
    ? financeContext(library, actor.libraryUserId, actor.source)
    : financeContext(library, actor)
)

export function getFinanceDashboard(library: NotiaLibrary, month: string, actorLibraryUserId?: FinanceActor): Promise<FinanceDashboard> {
  return invoke<FinanceDashboard>('finance_get_dashboard', { context: context(library, actorLibraryUserId), month })
}

export function getFinanceTransaction(library: NotiaLibrary, id: string, actor?: FinanceActor): Promise<FinanceTransaction> {
  return invoke<FinanceTransaction>('finance_get_transaction', { payload: { context: context(library, actor), id } })
}

export function listAllFinanceTransactions(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceTransaction[]> {
  return invoke<FinanceTransaction[]>('finance_list_all_transactions', { context: context(library, actor) })
}

export function listAllFinanceSavingsMovements(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceSavingsMovement[]> {
  return invoke<FinanceSavingsMovement[]>('finance_list_all_savings_movements', { context: context(library, actor) })
}

export function listFinanceServices(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceService[]> {
  return invoke<FinanceService[]>('finance_list_services', { context: context(library, actor) })
}

export async function saveFinanceService(library: NotiaLibrary, service: FinanceService, actor?: FinanceActor): Promise<FinanceService> {
  const saved = await invoke<FinanceService>('finance_save_service', { payload: { context: context(library, actor), service } })
  notifyFinanceDataChanged()
  if (!actor) { try { await queueFinanceAudit(library, new Date().toISOString().slice(0, 7), `ui:service:${service.id}`, 'Alta de servicio desde Finanzas') } catch { /* data and audit are independent */ } }
  return saved
}

export function setFinanceServiceActive(library: NotiaLibrary, id: string, active: boolean, actor?: FinanceActor): Promise<void> {
  return invoke('finance_set_service_active', { payload: { context: context(library, actor), id, active } })
}

export function listFinanceServiceOccurrences(library: NotiaLibrary, period: string, actor?: FinanceActor): Promise<FinanceServiceOccurrence[]> {
  return invoke<FinanceServiceOccurrence[]>('finance_list_service_occurrences', { context: context(library, actor), period })
}

export function listAllFinanceServiceOccurrences(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceServiceOccurrence[]> {
  return invoke<FinanceServiceOccurrence[]>('finance_list_all_service_occurrences', { context: context(library, actor) })
}

export async function saveFinanceServiceOccurrence(library: NotiaLibrary, occurrence: FinanceServiceOccurrence, reason?: string, actor?: FinanceActor): Promise<FinanceServiceOccurrence> {
  const saved = await invoke<FinanceServiceOccurrence>('finance_save_service_occurrence', { payload: { context: context(library, actor), occurrence, reason } })
  notifyFinanceDataChanged()
  if (!actor) { try { await queueFinanceAudit(library, occurrence.period, `ui:service-occurrence:${occurrence.serviceId}:${occurrence.period}`, 'Alta de ocurrencia desde Finanzas') } catch { /* data and audit are independent */ } }
  return saved
}

export function listFinanceServiceOccurrenceVersions(library: NotiaLibrary, occurrenceId: string, actor?: FinanceActor): Promise<FinanceServiceOccurrenceVersion[]> {
  return invoke<FinanceServiceOccurrenceVersion[]>('finance_list_service_occurrence_versions', { context: context(library, actor), occurrenceId })
}

export function listAllFinanceServiceOccurrenceVersions(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceServiceOccurrenceVersion[]> {
  return invoke<FinanceServiceOccurrenceVersion[]>('finance_list_all_service_occurrence_versions', { context: context(library, actor) })
}

export async function saveFinanceServiceInvoice(library: NotiaLibrary, invoice: FinanceServiceInvoice, actor?: FinanceActor): Promise<FinanceServiceInvoice> {
  const saved = await invoke<FinanceServiceInvoice>('finance_save_service_invoice', { payload: { context: context(library, actor), invoice } })
  notifyFinanceDataChanged()
  if (!actor) { try { await queueFinanceAudit(library, invoice.period, `ui:service-invoice:${invoice.id}`, 'Alta de factura de servicio desde Finanzas') } catch { /* data and audit are independent */ } }
  return saved
}

export function listFinanceServiceInvoices(library: NotiaLibrary, period?: string, actor?: FinanceActor): Promise<FinanceServiceInvoice[]> {
  return invoke<FinanceServiceInvoice[]>('finance_list_service_invoices', { context: context(library, actor), period })
}

export function saveFinanceAuditRun(library: NotiaLibrary, run: FinanceAuditRun, actor?: FinanceActor): Promise<FinanceAuditRun> {
  return invoke<FinanceAuditRun>('finance_save_audit_run', { payload: { context: context(library, actor), run } })
}

export function listFinanceAuditRuns(library: NotiaLibrary, period?: string, status?: string, actor?: FinanceActor): Promise<FinanceAuditRun[]> {
  return invoke<FinanceAuditRun[]>('finance_list_audit_runs', { context: context(library, actor), period, status })
}

export function saveFinanceAuditProposal(library: NotiaLibrary, proposal: FinanceAuditProposal, actor?: FinanceActor): Promise<FinanceAuditProposal> {
  return invoke<FinanceAuditProposal>('finance_save_audit_proposal', { payload: { context: context(library, actor), proposal } })
}

export function listFinanceAuditProposals(library: NotiaLibrary, period?: string, status?: string, actor?: FinanceActor): Promise<FinanceAuditProposal[]> {
  return invoke<FinanceAuditProposal[]>('finance_list_audit_proposals', { context: context(library, actor), period, status })
}

export function decideFinanceAuditProposal(library: NotiaLibrary, proposalId: string, decision: 'accepted' | 'rejected' | 'cancelled', actor?: FinanceActor, expectedDataFingerprint?: string, resolutionAssignments?: FinanceCardServiceResolution[]): Promise<void> {
  return invoke('finance_decide_audit_proposal', { payload: { context: context(library, actor), proposalId, decision, expectedDataFingerprint, resolutionAssignments } })
}

export function listFinanceDevTables(): Promise<FinanceDevTable[]> {
  return invoke<FinanceDevTable[]>('finance_dev_list_tables')
}

export function queryFinanceDevTable(library: NotiaLibrary, tableName: string, page: number, pageSize = 50): Promise<FinanceDevQueryResult> {
  return invoke<FinanceDevQueryResult>('finance_dev_query_table', { payload: { context: context(library), tableName, page, pageSize } })
}

export function queryFinanceDevSql(library: NotiaLibrary, sql: string, page: number, pageSize = 50): Promise<FinanceDevQueryResult> {
  return invoke<FinanceDevQueryResult>('finance_dev_query_sql', { payload: { context: context(library), sql, page, pageSize } })
}

export function seedFinanceDevData(library: NotiaLibrary): Promise<void> {
  return invoke('finance_dev_seed_demo_data', { context: context(library) })
}

export function saveFinanceAccount(library: NotiaLibrary, account: FinanceAccount, actorLibraryUserId?: FinanceActor): Promise<FinanceAccount> {
  return invoke<FinanceAccount>('finance_save_account', { payload: { context: context(library, actorLibraryUserId), account } })
}

export function saveFinanceCategory(library: NotiaLibrary, category: FinanceCategory, actorLibraryUserId?: FinanceActor): Promise<FinanceCategory> {
  return invoke<FinanceCategory>('finance_save_category', { payload: { context: context(library, actorLibraryUserId), category } })
}

export function saveFinanceTransaction(library: NotiaLibrary, transaction: FinanceTransaction, actorLibraryUserId?: FinanceActor): Promise<FinanceTransaction> {
  return invoke<FinanceTransaction>('finance_save_transaction', { payload: { context: context(library, actorLibraryUserId), transaction } })
}

/** Leaves an explicit retryable audit when a UI mutation has no chat runtime available. */
export async function queueFinanceAudit(library: NotiaLibrary, period: string, triggerFingerprint: string, reason: string, actor?: FinanceActor): Promise<FinanceAuditRun> {
  const actorLibraryUserId = typeof actor === 'string' ? actor : actor && typeof actor === 'object' ? actor.libraryUserId : undefined
  const source = typeof actor === 'object' && actor?.source ? actor.source : 'app'
  return saveFinanceAuditRun(library, { id: crypto.randomUUID(), period, triggerFingerprint, status: 'pending', actorLibraryUserId, source, reason }, actor)
}

/** Runs deterministic audit rules natively and reuses pending/failed runs by fingerprint. */
export function runFinanceAudit(library: NotiaLibrary, period: string, triggerFingerprint: string, reason?: string, actor?: FinanceActor): Promise<{ run: FinanceAuditRun; proposals: FinanceAuditProposal[] }> {
  return invoke<{ run: FinanceAuditRun; proposals: FinanceAuditProposal[] }>('finance_run_audit', {
    payload: { context: context(library, actor), period, triggerFingerprint, reason: reason ?? null },
  })
}

export function deleteFinanceTransaction(library: NotiaLibrary, id: string, actor?: FinanceActor): Promise<void> {
  return invoke('finance_delete_transaction', { payload: { context: context(library, actor), id } })
}

export function deleteFinanceAccount(library: NotiaLibrary, id: string, actor?: FinanceActor): Promise<void> {
  return invoke('finance_delete_account', { payload: { context: context(library, actor), id } })
}

export function deleteFinanceCategory(library: NotiaLibrary, id: string, actor?: FinanceActor): Promise<void> {
  return invoke('finance_delete_category', { payload: { context: context(library, actor), id } })
}

export function clearAllFinanceData(library: NotiaLibrary, actor?: FinanceActor): Promise<void> {
  return invoke('finance_clear_all_data', { context: context(library, actor) })
}

export function saveFinanceSavingsReserve(library: NotiaLibrary, reserve: FinanceSavingsReserve, actorLibraryUserId?: FinanceActor): Promise<FinanceSavingsReserve> {
  return invoke<FinanceSavingsReserve>('finance_save_savings_reserve', { payload: { context: context(library, actorLibraryUserId), reserve } })
}

export function saveFinanceSavingsMovement(library: NotiaLibrary, movement: FinanceSavingsMovement, actorLibraryUserId?: FinanceActor): Promise<FinanceSavingsMovement> {
  return invoke<FinanceSavingsMovement>('finance_save_savings_movement', { payload: { context: context(library, actorLibraryUserId), movement } })
}

export function saveFinanceSavingsExchange(library: NotiaLibrary, exchange: FinanceSavingsExchange, actorLibraryUserId?: FinanceActor): Promise<FinanceSavedSavingsExchange> {
  return invoke<FinanceSavedSavingsExchange>('finance_save_savings_exchange', { payload: { context: context(library, actorLibraryUserId), exchange } })
}

export function linkFinanceSavingsAccount(library: NotiaLibrary, reserveId: string, accountId: string, actor?: FinanceActor): Promise<void> {
  return invoke('finance_link_savings_account', { payload: { context: context(library, actor), reserveId, accountId } })
}

export interface FinanceHistoryFilters {
  from?: string
  to?: string
  merchantId?: string
  productId?: string
}

export function saveFinancePurchase(library: NotiaLibrary, purchase: FinancePurchaseRecord, actorLibraryUserId?: FinanceActor): Promise<FinanceSavedPurchase> {
  return invoke<FinanceSavedPurchase>('finance_save_purchase', { payload: { context: context(library, actorLibraryUserId), purchase } })
}

export function listFinancePurchases(library: NotiaLibrary, filters: FinanceHistoryFilters = {}, actorLibraryUserId?: FinanceActor): Promise<FinancePurchaseSummary[]> {
  return invoke<FinancePurchaseSummary[]>('finance_list_purchases', { payload: { context: context(library, actorLibraryUserId), ...filters } })
}

export function listFinancePriceHistory(library: NotiaLibrary, filters: FinanceHistoryFilters = {}, actorLibraryUserId?: FinanceActor): Promise<FinancePriceObservation[]> {
  return invoke<FinancePriceObservation[]>('finance_list_price_history', { payload: { context: context(library, actorLibraryUserId), ...filters } })
}

export function saveFinanceSalary(library: NotiaLibrary, salary: FinanceSalaryReceiptInput, actorLibraryUserId?: FinanceActor): Promise<FinanceSalaryReceipt> {
  return invoke<FinanceSalaryReceipt>('finance_save_salary', { payload: { context: context(library, actorLibraryUserId), salary } })
}

export function listFinanceSalaries(library: NotiaLibrary, filters: FinanceHistoryFilters = {}, actorLibraryUserId?: FinanceActor): Promise<FinanceSalaryEvolution[]> {
  return invoke<FinanceSalaryEvolution[]>('finance_list_salaries', { payload: { context: context(library, actorLibraryUserId), ...filters } })
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
  return invoke<FinanceSavedCreditCardStatement>('finance_save_credit_card_statement', { payload: { context: context(library, actorLibraryUserId), statement } })
}

export function listFinanceCreditCardStatements(library: NotiaLibrary, filters: FinanceHistoryFilters = {}, actorLibraryUserId?: FinanceActor): Promise<FinanceCreditCardStatement[]> {
  return invoke<FinanceCreditCardStatement[]>('finance_list_credit_card_statements', { payload: { context: context(library, actorLibraryUserId), ...filters } })
}

export function saveFinanceInstallmentPlan(library: NotiaLibrary, plan: FinanceInstallmentPlan, actor?: FinanceActor): Promise<FinanceInstallment[]> {
  return invoke<FinanceInstallment[]>('finance_save_installment_plan', { payload: { context: context(library, actor), plan } })
}

export function listFinanceInstallmentPlans(library: NotiaLibrary, actor?: FinanceActor): Promise<FinanceInstallmentPlan[]> {
  return invoke<FinanceInstallmentPlan[]>('finance_list_installment_plans', { context: context(library, actor) })
}

export function listFinanceInstallments(library: NotiaLibrary, planId?: string, actor?: FinanceActor): Promise<FinanceInstallment[]> {
  return invoke<FinanceInstallment[]>('finance_list_installments', { payload: { context: context(library, actor), planId } })
}

export function saveFinanceInvestment(library: NotiaLibrary, investment: FinanceInvestment, actor?: FinanceActor): Promise<FinanceInvestment> {
  return invoke<FinanceInvestment>('finance_save_investment', { payload: { context: context(library, actor), investment } })
}

export function listFinanceInvestments(library: NotiaLibrary, active?: boolean, actor?: FinanceActor): Promise<FinanceInvestment[]> {
  return invoke<FinanceInvestment[]>('finance_list_investments', { payload: { context: context(library, actor), active } })
}

export function getFinanceNetWorth(library: NotiaLibrary, asOf: string, actorLibraryUserId?: FinanceActor): Promise<FinanceNetWorth> {
  return invoke<FinanceNetWorth>('finance_get_net_worth', { context: context(library, actorLibraryUserId), asOf })
}

export function listFinanceNetWorthHistory(library: NotiaLibrary, actorLibraryUserId?: FinanceActor): Promise<FinanceNetWorthHistoryPoint[]> {
  return invoke<FinanceNetWorthHistoryPoint[]>('finance_list_net_worth_history', { context: context(library, actorLibraryUserId) })
}

export function extractFinanceDocument(library: NotiaLibrary, artifactId: string, filePath: string, documentType: 'ticket' | 'salary' | 'credit_card_statement' | 'service_invoice', actor?: FinanceActor): Promise<FinanceExtractionResult> {
  return invoke<FinanceExtractionResult>('extract_finance_document', { payload: { context: context(library, actor), artifactId, filePath, documentType } })
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
  return invoke<FinanceArtifactStatus[]>('list_finance_artifacts', { context: context(library, actor) })
}

export type { FinanceContext }
