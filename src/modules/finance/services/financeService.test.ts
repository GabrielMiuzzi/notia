import { callBackend } from '../../../services/transport'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllFinanceData, getFinanceDashboard, getFinanceServiceMonthStatus, listFinanceCreditCardStatements, listFinanceInstallmentPlans, listFinanceProducts } from './financeService'
import type { NotiaLibrary } from '../../../types/notia'

vi.mock('../../../services/transport', () => ({ callBackend: vi.fn() }))

describe('financeService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends the library context and month through the typed Tauri command', async () => {
    vi.mocked(callBackend).mockResolvedValue({ accounts: [], categories: [], transactions: [], incomeTotal: '0', expenseTotal: '0', netTotal: '0' })
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal', androidTreeUri: 'content://personal' }

    await getFinanceDashboard(library, '2026-08')

    expect(callBackend).toHaveBeenCalledWith('finance_get_dashboard', {
      context: { libraryPath: library.path, androidDirectoryUri: library.androidTreeUri, actorLibraryUserId: 'user-owner', source: 'app' },
      month: '2026-08',
    })
  })

  it('preserves the stable actor and transport source for remote finance calls', async () => {
    vi.mocked(callBackend).mockResolvedValue({ accounts: [], categories: [], transactions: [], incomeTotal: '0', expenseTotal: '0', netTotal: '0' })
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }

    await getFinanceDashboard(library, '2026-08', { libraryUserId: 'user-telegram', source: 'telegram' })

    expect(callBackend).toHaveBeenCalledWith('finance_get_dashboard', {
      context: { libraryPath: library.path, androidDirectoryUri: undefined, actorLibraryUserId: 'user-telegram', source: 'telegram' },
      month: '2026-08',
    })
  })

  it('clears finance data only through the native command for the active library', async () => {
    vi.mocked(callBackend).mockResolvedValue(undefined)
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal', androidTreeUri: 'content://personal' }

    await clearAllFinanceData(library)

    expect(callBackend).toHaveBeenCalledWith('finance_clear_all_data', {
      context: { libraryPath: library.path, androidDirectoryUri: library.androidTreeUri, actorLibraryUserId: 'user-owner', source: 'app' },
    })
  })

  it('reads statements, plans, products and the services of a month with the active context', async () => {
    vi.mocked(callBackend).mockResolvedValue([])
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }
    const context = { libraryPath: library.path, androidDirectoryUri: undefined, actorLibraryUserId: 'user-owner', source: 'app' }

    await listFinanceCreditCardStatements(library, { from: '2026-08', to: '2026-08' })
    await listFinanceInstallmentPlans(library)
    await listFinanceProducts(library, '  leche ')
    await listFinanceProducts(library)
    await getFinanceServiceMonthStatus(library, '2026-09')

    expect(callBackend).toHaveBeenNthCalledWith(1, 'finance_list_credit_card_statements', { payload: { context, from: '2026-08', to: '2026-08' } })
    expect(callBackend).toHaveBeenNthCalledWith(2, 'finance_list_installment_plans', { context })
    expect(callBackend).toHaveBeenNthCalledWith(3, 'finance_list_products', { payload: { context, search: 'leche' } })
    expect(callBackend).toHaveBeenNthCalledWith(4, 'finance_list_products', { payload: { context, search: null } })
    expect(callBackend).toHaveBeenNthCalledWith(5, 'finance_service_month_status', { context, period: '2026-09' })
  })
})
