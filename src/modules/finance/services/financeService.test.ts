import { callBackend } from '../../../services/transport'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllFinanceData, getFinanceMovements, getFinanceOverview, getFinanceProducts, getFinanceSalarySavings } from './financeService'
import type { NotiaLibrary } from '../../../types/notia'

vi.mock('../../../services/transport', () => ({ callBackend: vi.fn() }))

describe('financeService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends the library context and month through the typed commands', async () => {
    vi.mocked(callBackend).mockResolvedValue({})
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal', androidTreeUri: 'content://personal' }
    const context = { libraryPath: library.path, androidDirectoryUri: library.androidTreeUri, actorLibraryUserId: 'user-owner', source: 'app' }

    await getFinanceOverview(library, '2026-09')
    await getFinanceMovements(library, { month: '2026-09', filter: 'uncategorized', search: 'movistar' })
    await getFinanceProducts(library, { search: 'leche', sort: 'rising', selectedId: null })
    await getFinanceSalarySavings(library, '2026-09')

    expect(callBackend).toHaveBeenNthCalledWith(1, 'finance_overview', { payload: { context, month: '2026-09' } })
    expect(callBackend).toHaveBeenNthCalledWith(2, 'finance_movements', { payload: { context, month: '2026-09', filter: 'uncategorized', search: 'movistar' } })
    expect(callBackend).toHaveBeenNthCalledWith(3, 'finance_products', { payload: { context, search: 'leche', sort: 'rising', selectedId: null } })
    expect(callBackend).toHaveBeenNthCalledWith(4, 'finance_salary_savings', { payload: { context, month: '2026-09' } })
  })

  it('preserves the stable actor and transport source for remote finance calls', async () => {
    vi.mocked(callBackend).mockResolvedValue({})
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }

    await getFinanceOverview(library, '2026-08', { libraryUserId: 'user-telegram', source: 'telegram' })

    expect(callBackend).toHaveBeenCalledWith('finance_overview', {
      payload: { context: { libraryPath: library.path, androidDirectoryUri: undefined, actorLibraryUserId: 'user-telegram', source: 'telegram' }, month: '2026-08' },
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
})
