import { invoke } from '@tauri-apps/api/core'
import type { NotiaLibrary } from '../../../types/notia'
import type { FinanceAccount, FinanceCategory, FinanceDashboard, FinanceTransaction, FinanceContext, FinanceSavingsReserve, FinanceSavingsMovement, FinanceSavingsExchange, FinanceSavedSavingsExchange, FinancePurchaseRecord, FinanceSavedPurchase, FinancePurchaseSummary, FinancePriceObservation, FinanceSalaryReceipt, FinanceSalaryEvolution, FinanceCreditCardStatement, FinanceSavedCreditCardStatement, FinanceInstallmentPlan, FinanceInstallment, FinanceInvestment, FinanceNetWorth, FinanceNetWorthHistoryPoint, FinanceExtractionResult, FinanceDevQueryResult, FinanceDevTable } from '../types/financeTypes'
import { financeContext } from '../types/financeTypes'

export function getFinanceDashboard(library: NotiaLibrary, month: string): Promise<FinanceDashboard> {
  return invoke<FinanceDashboard>('finance_get_dashboard', { context: financeContext(library), month })
}

export function listFinanceDevTables(): Promise<FinanceDevTable[]> {
  return invoke<FinanceDevTable[]>('finance_dev_list_tables')
}

export function queryFinanceDevTable(library: NotiaLibrary, tableName: string, page: number, pageSize = 50): Promise<FinanceDevQueryResult> {
  return invoke<FinanceDevQueryResult>('finance_dev_query_table', { payload: { context: financeContext(library), tableName, page, pageSize } })
}

export function queryFinanceDevSql(library: NotiaLibrary, sql: string, page: number, pageSize = 50): Promise<FinanceDevQueryResult> {
  return invoke<FinanceDevQueryResult>('finance_dev_query_sql', { payload: { context: financeContext(library), sql, page, pageSize } })
}

export function seedFinanceDevData(library: NotiaLibrary): Promise<void> {
  return invoke('finance_dev_seed_demo_data', { context: financeContext(library) })
}

export function saveFinanceAccount(library: NotiaLibrary, account: FinanceAccount): Promise<FinanceAccount> {
  return invoke<FinanceAccount>('finance_save_account', { payload: { context: financeContext(library), account } })
}

export function saveFinanceCategory(library: NotiaLibrary, category: FinanceCategory): Promise<FinanceCategory> {
  return invoke<FinanceCategory>('finance_save_category', { payload: { context: financeContext(library), category } })
}

export function saveFinanceTransaction(library: NotiaLibrary, transaction: FinanceTransaction): Promise<FinanceTransaction> {
  return invoke<FinanceTransaction>('finance_save_transaction', { payload: { context: financeContext(library), transaction } })
}

export function deleteFinanceTransaction(library: NotiaLibrary, id: string): Promise<void> {
  return invoke('finance_delete_transaction', { payload: { context: financeContext(library), id } })
}

export function deleteFinanceAccount(library: NotiaLibrary, id: string): Promise<void> {
  return invoke('finance_delete_account', { payload: { context: financeContext(library), id } })
}

export function deleteFinanceCategory(library: NotiaLibrary, id: string): Promise<void> {
  return invoke('finance_delete_category', { payload: { context: financeContext(library), id } })
}

export function clearAllFinanceData(library: NotiaLibrary): Promise<void> {
  return invoke('finance_clear_all_data', { context: financeContext(library) })
}

export function saveFinanceSavingsReserve(library: NotiaLibrary, reserve: FinanceSavingsReserve): Promise<FinanceSavingsReserve> {
  return invoke<FinanceSavingsReserve>('finance_save_savings_reserve', { payload: { context: financeContext(library), reserve } })
}

export function saveFinanceSavingsMovement(library: NotiaLibrary, movement: FinanceSavingsMovement): Promise<FinanceSavingsMovement> {
  return invoke<FinanceSavingsMovement>('finance_save_savings_movement', { payload: { context: financeContext(library), movement } })
}

export function saveFinanceSavingsExchange(library: NotiaLibrary, exchange: FinanceSavingsExchange): Promise<FinanceSavedSavingsExchange> {
  return invoke<FinanceSavedSavingsExchange>('finance_save_savings_exchange', { payload: { context: financeContext(library), exchange } })
}

export function linkFinanceSavingsAccount(library: NotiaLibrary, reserveId: string, accountId: string): Promise<void> {
  return invoke('finance_link_savings_account', { payload: { context: financeContext(library), reserveId, accountId } })
}

export interface FinanceHistoryFilters {
  from?: string
  to?: string
  merchantId?: string
  productId?: string
}

export function saveFinancePurchase(library: NotiaLibrary, purchase: FinancePurchaseRecord): Promise<FinanceSavedPurchase> {
  return invoke<FinanceSavedPurchase>('finance_save_purchase', { payload: { context: financeContext(library), purchase } })
}

export function listFinancePurchases(library: NotiaLibrary, filters: FinanceHistoryFilters = {}): Promise<FinancePurchaseSummary[]> {
  return invoke<FinancePurchaseSummary[]>('finance_list_purchases', { payload: { context: financeContext(library), ...filters } })
}

export function listFinancePriceHistory(library: NotiaLibrary, filters: FinanceHistoryFilters = {}): Promise<FinancePriceObservation[]> {
  return invoke<FinancePriceObservation[]>('finance_list_price_history', { payload: { context: financeContext(library), ...filters } })
}

export function saveFinanceSalary(library: NotiaLibrary, salary: FinanceSalaryReceipt): Promise<FinanceSalaryReceipt> {
  return invoke<FinanceSalaryReceipt>('finance_save_salary', { payload: { context: financeContext(library), salary } })
}

export function listFinanceSalaries(library: NotiaLibrary, filters: FinanceHistoryFilters = {}): Promise<FinanceSalaryEvolution[]> {
  return invoke<FinanceSalaryEvolution[]>('finance_list_salaries', { payload: { context: financeContext(library), ...filters } })
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
export async function verifyFinanceSalaryPersistence(library: NotiaLibrary, salary: FinanceSalaryReceipt): Promise<void> {
  const persistedRows = await listFinanceSalaries(library, { from: salary.period, to: salary.period })
  if (!persistedRows.some(({ salary: persisted }) => matchesSavedSalary(salary, persisted))) {
    throw new FinanceSalaryPersistenceVerificationError('El recibo no pudo verificarse en la base financiera después de guardarlo.')
  }
}

/** Saves a salary and confirms it through a separate native read before reporting success. */
export async function saveVerifiedFinanceSalary(library: NotiaLibrary, salary: FinanceSalaryReceipt): Promise<FinanceSalaryReceipt> {
  const saved = await saveFinanceSalary(library, salary)
  await verifyFinanceSalaryPersistence(library, saved)
  return saved
}

export function saveFinanceCreditCardStatement(library: NotiaLibrary, statement: FinanceCreditCardStatement): Promise<FinanceSavedCreditCardStatement> {
  return invoke<FinanceSavedCreditCardStatement>('finance_save_credit_card_statement', { payload: { context: financeContext(library), statement } })
}

export function listFinanceCreditCardStatements(library: NotiaLibrary, filters: FinanceHistoryFilters = {}): Promise<FinanceCreditCardStatement[]> {
  return invoke<FinanceCreditCardStatement[]>('finance_list_credit_card_statements', { payload: { context: financeContext(library), ...filters } })
}

export function saveFinanceInstallmentPlan(library: NotiaLibrary, plan: FinanceInstallmentPlan): Promise<FinanceInstallment[]> {
  return invoke<FinanceInstallment[]>('finance_save_installment_plan', { payload: { context: financeContext(library), plan } })
}

export function saveFinanceInvestment(library: NotiaLibrary, investment: FinanceInvestment): Promise<FinanceInvestment> {
  return invoke<FinanceInvestment>('finance_save_investment', { payload: { context: financeContext(library), investment } })
}

export function getFinanceNetWorth(library: NotiaLibrary, asOf: string): Promise<FinanceNetWorth> {
  return invoke<FinanceNetWorth>('finance_get_net_worth', { context: financeContext(library), asOf })
}

export function listFinanceNetWorthHistory(library: NotiaLibrary): Promise<FinanceNetWorthHistoryPoint[]> {
  return invoke<FinanceNetWorthHistoryPoint[]>('finance_list_net_worth_history', { context: financeContext(library) })
}

export function extractFinanceDocument(library: NotiaLibrary, artifactId: string, filePath: string, documentType: 'ticket' | 'salary' | 'credit_card_statement'): Promise<FinanceExtractionResult> {
  return invoke<FinanceExtractionResult>('extract_finance_document', { payload: { context: financeContext(library), artifactId, filePath, documentType } })
}

export type { FinanceContext }
