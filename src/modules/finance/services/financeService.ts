import { callBackend } from '../../../services/transport'
import type { NotiaLibrary } from '../../../types/notia'
import type { FinanceContext, FinanceDevQueryResult, FinanceDevTable } from '../types/financeTypes'
import { financeContext } from '../types/financeTypes'
import type { FinanceMovements, FinanceOverview, FinanceProducts, FinanceSalarySavings, ProductSort } from '../types/financeScreen'

// The Finanzas screen only reads: every change goes through the assistant,
// in the app chat or Telegram, and its tools in the Rust backend. Rust also
// derives every figure the screen shows (`finance_screen.rs`).

export type FinanceActor = string | { libraryUserId?: string; source?: FinanceContext['source'] } | undefined
const context = (library: NotiaLibrary, actor?: FinanceActor) => (
  typeof actor === 'object' && actor !== null
    ? financeContext(library, actor.libraryUserId, actor.source)
    : financeContext(library, actor)
)

/** «Resumen»: the month's salary use, cards, services, categories and doubts. */
export function getFinanceOverview(library: NotiaLibrary, month: string, actor?: FinanceActor): Promise<FinanceOverview> {
  return callBackend<FinanceOverview>('finance_overview', { payload: { context: context(library, actor), month } })
}

/** «Movimientos»: the month's movements by account, filtered and searched by Rust. */
export function getFinanceMovements(library: NotiaLibrary, request: { month: string; filter: string; search: string }, actor?: FinanceActor): Promise<FinanceMovements> {
  return callBackend<FinanceMovements>('finance_movements', { payload: { context: context(library, actor), ...request } })
}

/** «Productos y tickets»: products with their prices per merchant, and the tickets. */
export function getFinanceProducts(library: NotiaLibrary, request: { search: string; sort: ProductSort; selectedId: string | null }, actor?: FinanceActor): Promise<FinanceProducts> {
  return callBackend<FinanceProducts>('finance_products', { payload: { context: context(library, actor), ...request } })
}

/** «Sueldo y ahorro»: salary history, shares of the salary, quotes and reserves. */
export function getFinanceSalarySavings(library: NotiaLibrary, month: string, actor?: FinanceActor): Promise<FinanceSalarySavings> {
  return callBackend<FinanceSalarySavings>('finance_salary_savings', { payload: { context: context(library, actor), month } })
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

export type { FinanceContext }
