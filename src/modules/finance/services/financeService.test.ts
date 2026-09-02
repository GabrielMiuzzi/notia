import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { clearAllFinanceData, extractFinanceDocument, getFinanceDashboard, listFinanceCreditCardStatements, listFinanceNetWorthHistory, saveFinanceCreditCardStatement, saveFinanceInstallmentPlan, saveFinancePurchase, saveFinanceSalary, saveVerifiedFinanceSalary } from './financeService'
import type { NotiaLibrary } from '../../../types/notia'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('financeService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends the library context and month through the typed Tauri command', async () => {
    vi.mocked(invoke).mockResolvedValue({ accounts: [], categories: [], transactions: [], incomeTotal: '0', expenseTotal: '0', netTotal: '0' })
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal', androidTreeUri: 'content://personal' }

    await getFinanceDashboard(library, '2026-08')

    expect(invoke).toHaveBeenCalledWith('finance_get_dashboard', {
      context: { libraryPath: library.path, androidDirectoryUri: library.androidTreeUri },
      month: '2026-08',
    })
  })

  it('keeps document extraction credentials outside the frontend payload', async () => {
    vi.mocked(invoke).mockResolvedValue({ artifactId: 'a', extractor: 'llamacloud-v2', status: 'completed', rawResult: {} })
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal', androidTreeUri: 'content://personal' }
    await extractFinanceDocument(library, 'artifact-1', 'C:/personal/ticket.pdf', 'ticket')
    expect(invoke).toHaveBeenCalledWith('extract_finance_document', { payload: { context: { libraryPath: library.path, androidDirectoryUri: library.androidTreeUri }, artifactId: 'artifact-1', filePath: 'C:/personal/ticket.pdf', documentType: 'ticket' } })
    expect(vi.mocked(invoke).mock.calls[0]?.[1]).not.toHaveProperty('apiKey')
  })

  it('uses one typed command for the complete atomic purchase', async () => {
    vi.mocked(invoke).mockResolvedValue({})
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }
    const purchase = { id: 'p', accountId: 'a', merchantName: 'M', observedAt: '2026-08-29', currency: 'ARS' as const, subtotalAmount: '1.00', discountAmount: '0', taxAmount: '0', totalAmount: '1.00', status: 'confirmed' as const, items: [{ id: 'i', originalDescription: 'X', quantity: '1', unitPrice: '1.00', discountAmount: '0', lineTotal: '1.00' }] }
    await saveFinancePurchase(library, purchase)
    expect(invoke).toHaveBeenCalledWith('finance_save_purchase', { payload: { context: { libraryPath: library.path, androidDirectoryUri: undefined }, purchase } })
  })

  it('clears finance data only through the native command for the active library', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal', androidTreeUri: 'content://personal' }

    await clearAllFinanceData(library)

    expect(invoke).toHaveBeenCalledWith('finance_clear_all_data', {
      context: { libraryPath: library.path, androidDirectoryUri: library.androidTreeUri },
    })
  })

  it('keeps salary, installments and net-worth contracts aligned with Rust camelCase DTOs', async () => {
    vi.mocked(invoke).mockResolvedValue({})
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }
    const context = { libraryPath: library.path, androidDirectoryUri: undefined }
    const salary = { id: 'salary', period: '2026-08', paymentDate: '2026-08-29', employer: 'Notia', grossAmount: '100', deductionsTotal: '10', netAmount: '90', currency: 'ARS' as const, accountId: 'account', status: 'confirmed' as const, concepts: [] }
    const plan = { id: 'plan', accountId: 'card', merchantName: 'Tienda', description: 'Compra', purchaseDate: '2026-08-29', currency: 'ARS' as const, totalAmount: '100', installmentCount: 3 }
    await saveFinanceSalary(library, salary)
    await saveFinanceInstallmentPlan(library, plan)
    await listFinanceNetWorthHistory(library)
    expect(invoke).toHaveBeenNthCalledWith(1, 'finance_save_salary', { payload: { context, salary } })
    expect(invoke).toHaveBeenNthCalledWith(2, 'finance_save_installment_plan', { payload: { context, plan } })
    expect(invoke).toHaveBeenNthCalledWith(3, 'finance_list_net_worth_history', { context })
  })

  it('reports salary success only after an independent read confirms the persisted receipt', async () => {
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }
    const salary = { id: 'salary', period: '2026-08', paymentDate: '2026-08-29', employer: 'Notia', grossAmount: '100', deductionsTotal: '10', netAmount: '90', currency: 'ARS' as const, accountId: 'account', status: 'confirmed' as const, sourceReference: 'telegram:file', rawExtraction: null, concepts: [] }
    vi.mocked(invoke)
      .mockResolvedValueOnce(salary)
      .mockResolvedValueOnce([{ salary, grossChange: '0', netChange: '0', deductionsChange: '0' }])

    await expect(saveVerifiedFinanceSalary(library, salary)).resolves.toEqual(salary)
    expect(invoke).toHaveBeenNthCalledWith(2, 'finance_list_salaries', {
      payload: { context: { libraryPath: library.path, androidDirectoryUri: undefined }, from: salary.period, to: salary.period },
    })
  })

  it('rejects a salary success when the receipt is absent from the verification read', async () => {
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }
    const salary = { id: 'salary', period: '2026-08', paymentDate: '2026-08-29', employer: 'Notia', grossAmount: '100', deductionsTotal: '10', netAmount: '90', currency: 'ARS' as const, accountId: 'account', status: 'confirmed' as const, concepts: [] }
    vi.mocked(invoke).mockResolvedValueOnce(salary).mockResolvedValueOnce([])

    await expect(saveVerifiedFinanceSalary(library, salary)).rejects.toMatchObject({ code: 'storage' })
  })

  it('uses typed commands for saving and listing complete credit-card statements', async () => {
    vi.mocked(invoke).mockResolvedValue({})
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }
    const context = { libraryPath: library.path, androidDirectoryUri: undefined }
    const statement = {
      id: 'statement', accountId: 'card', issuer: 'Banco', cardLastFour: '1234', period: '2026-08',
      closingDate: '2026-08-28', dueDate: '2026-09-08', currency: 'ARS' as const,
      previousBalance: '0', paymentsAmount: '0', creditsAmount: '0', purchasesAmount: '100', feesAmount: '0',
      interestAmount: '0', taxesAmount: '0', totalDue: '100', minimumPayment: '20', status: 'confirmed' as const,
      sourceReference: 'telegram-photo:file',
      items: [{ id: 'line', purchaseDate: '2026-08-15', description: 'Compra', amount: '100', currency: 'ARS' as const, itemType: 'purchase' as const }],
    }
    await saveFinanceCreditCardStatement(library, statement)
    await listFinanceCreditCardStatements(library, { from: '2026-08', to: '2026-08' })
    expect(invoke).toHaveBeenNthCalledWith(1, 'finance_save_credit_card_statement', { payload: { context, statement } })
    expect(invoke).toHaveBeenNthCalledWith(2, 'finance_list_credit_card_statements', { payload: { context, from: '2026-08', to: '2026-08' } })
  })
})
