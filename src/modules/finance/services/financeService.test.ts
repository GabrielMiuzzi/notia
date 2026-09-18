import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { clearAllFinanceData, extractFinanceDocument, getFinanceDashboard, listAllFinanceSavingsMovements, listAllFinanceTransactions, listFinanceArtifacts, listFinanceCreditCardStatements, listFinanceInstallmentPlans, listFinanceInstallments, listFinanceInvestments, listFinanceNetWorthHistory, runFinanceAudit, saveFinanceCreditCardStatement, saveFinanceInstallmentPlan, saveFinancePurchase, saveFinanceSalary, saveVerifiedFinanceSalary } from './financeService'
import type { NotiaLibrary } from '../../../types/notia'
import { formatFinanceAuditProposalPreview, type FinanceAuditProposal } from '../types/financeTypes'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('financeService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends the library context and month through the typed Tauri command', async () => {
    vi.mocked(invoke).mockResolvedValue({ accounts: [], categories: [], transactions: [], incomeTotal: '0', expenseTotal: '0', netTotal: '0' })
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal', androidTreeUri: 'content://personal' }

    await getFinanceDashboard(library, '2026-08')

    expect(invoke).toHaveBeenCalledWith('finance_get_dashboard', {
      context: { libraryPath: library.path, androidDirectoryUri: library.androidTreeUri, actorLibraryUserId: 'user-owner', source: 'app' },
      month: '2026-08',
    })
  })

  it('preserves the stable actor and transport source for remote finance calls', async () => {
    vi.mocked(invoke).mockResolvedValue({ accounts: [], categories: [], transactions: [], incomeTotal: '0', expenseTotal: '0', netTotal: '0' })
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }

    await getFinanceDashboard(library, '2026-08', { libraryUserId: 'user-telegram', source: 'telegram' })

    expect(invoke).toHaveBeenCalledWith('finance_get_dashboard', {
      context: { libraryPath: library.path, androidDirectoryUri: undefined, actorLibraryUserId: 'user-telegram', source: 'telegram' },
      month: '2026-08',
    })
  })

  it('keeps document extraction credentials outside the frontend payload', async () => {
    vi.mocked(invoke).mockResolvedValue({ artifactId: 'a', extractor: 'llamacloud-v2', status: 'completed', rawResult: {} })
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal', androidTreeUri: 'content://personal' }
    await extractFinanceDocument(library, 'artifact-1', 'C:/personal/ticket.pdf', 'ticket')
    expect(invoke).toHaveBeenCalledWith('extract_finance_document', { payload: { context: { libraryPath: library.path, androidDirectoryUri: library.androidTreeUri, actorLibraryUserId: 'user-owner', source: 'app' }, artifactId: 'artifact-1', filePath: 'C:/personal/ticket.pdf', documentType: 'ticket' } })
    expect(vi.mocked(invoke).mock.calls[0]?.[1]).not.toHaveProperty('apiKey')
  })

  it('uses one typed command for the complete atomic purchase', async () => {
    vi.mocked(invoke).mockResolvedValue({})
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }
    const purchase = { id: 'p', accountId: 'a', merchantName: 'M', observedAt: '2026-08-29', currency: 'ARS' as const, subtotalAmount: '1.00', discountAmount: '0', taxAmount: '0', totalAmount: '1.00', status: 'confirmed' as const, items: [{ id: 'i', originalDescription: 'X', quantity: '1', unitPrice: '1.00', discountAmount: '0', lineTotal: '1.00' }] }
    await saveFinancePurchase(library, purchase)
    expect(invoke).toHaveBeenCalledWith('finance_save_purchase', { payload: { context: { libraryPath: library.path, androidDirectoryUri: undefined, actorLibraryUserId: 'user-owner', source: 'app' }, purchase } })
  })

  it('clears finance data only through the native command for the active library', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal', androidTreeUri: 'content://personal' }

    await clearAllFinanceData(library)

    expect(invoke).toHaveBeenCalledWith('finance_clear_all_data', {
      context: { libraryPath: library.path, androidDirectoryUri: library.androidTreeUri, actorLibraryUserId: 'user-owner', source: 'app' },
    })
  })

  it('keeps salary, installments and net-worth contracts aligned with Rust camelCase DTOs', async () => {
    vi.mocked(invoke).mockResolvedValue({})
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }
    const context = { libraryPath: library.path, androidDirectoryUri: undefined, actorLibraryUserId: 'user-owner', source: 'app' }
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
      payload: { context: { libraryPath: library.path, androidDirectoryUri: undefined, actorLibraryUserId: 'user-owner', source: 'app' }, from: salary.period, to: salary.period },
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
    const context = { libraryPath: library.path, androidDirectoryUri: undefined, actorLibraryUserId: 'user-owner', source: 'app' }
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

  it('exposes bounded read contracts for plans, installments, investments and artifacts', async () => {
    vi.mocked(invoke).mockResolvedValue([])
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }
    const context = { libraryPath: library.path, androidDirectoryUri: undefined, actorLibraryUserId: 'user-owner', source: 'app' }

    await listFinanceInstallmentPlans(library)
    await listFinanceInstallments(library, 'plan-1')
    await listFinanceInvestments(library, true)
    await listFinanceArtifacts(library)

    expect(invoke).toHaveBeenNthCalledWith(1, 'finance_list_installment_plans', { context })
    expect(invoke).toHaveBeenNthCalledWith(2, 'finance_list_installments', { payload: { context, planId: 'plan-1' } })
    expect(invoke).toHaveBeenNthCalledWith(3, 'finance_list_investments', { payload: { context, active: true } })
    expect(invoke).toHaveBeenNthCalledWith(4, 'list_finance_artifacts', { context })
  })

  it('exposes complete movement and savings-movement reads with the active context', async () => {
    vi.mocked(invoke).mockResolvedValue([])
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }
    const context = { libraryPath: library.path, androidDirectoryUri: undefined, actorLibraryUserId: 'user-owner', source: 'app' }

    await listAllFinanceTransactions(library)
    await listAllFinanceSavingsMovements(library)

    expect(invoke).toHaveBeenNthCalledWith(1, 'finance_list_all_transactions', { context })
    expect(invoke).toHaveBeenNthCalledWith(2, 'finance_list_all_savings_movements', { context })
  })

  it('uses the native audit command and preserves the structured period', async () => {
    vi.mocked(invoke).mockResolvedValue({ run: { period: '2026-09' }, proposals: [{ proposalType: 'service-card-reconciliation' }] })
    const library: NotiaLibrary = { id: 'library-1', name: 'Personal', path: 'C:/personal' }

    await expect(runFinanceAudit(library, '2026-09', 'audit:request-1')).resolves.toMatchObject({ run: { period: '2026-09' } })
    expect(invoke).toHaveBeenCalledWith('finance_run_audit', {
      payload: { context: { libraryPath: library.path, androidDirectoryUri: undefined, actorLibraryUserId: 'user-owner', source: 'app' }, period: '2026-09', triggerFingerprint: 'audit:request-1', reason: null },
    })
  })

  it('formats reconciliation previews with line evidence and does not hide ambiguous groups', () => {
    const proposal = {
      id: 'proposal', auditRunId: 'run', proposalType: 'service-card-reconciliation', status: 'pending', ruleKey: 'service-card-reconciliation', dataFingerprint: 'fingerprint', serviceId: 'service-1', period: '2026-09',
      reason: 'La distribución requiere decisión.', currentData: JSON.stringify({ statementId: 'statement-1', statementPeriod: '2026-09', assignments: [{ lineId: 'line-1', serviceId: 'service-1', transactionId: 'transaction-1', purchaseDate: '2026-08-28', period: '2026-08', amount: '1000', currency: 'ARS', evidence: { matching: 'normalized-exact' } }], ambiguousGroups: [{ statementId: 'statement-1', serviceId: 'service-1', lineIds: ['line-2'], candidateServiceIds: ['service-1'], statementPeriod: '2026-09', reason: { code: 'previous-period-paid', message: 'El período anterior ya tiene pago.', lineIds: ['line-2'], candidateServiceIds: ['service-1'] } }], reasons: [] }), suggestedChange: '{}', source: 'app',
    } as FinanceAuditProposal
    const preview = formatFinanceAuditProposalPreview(proposal, [{ id: 'service-1', name: 'Internet', categoryId: 'category', currency: 'ARS', expectedAmount: '1000', modality: 'fixed', active: true }], [{ id: 'statement-1', accountId: 'card', issuer: 'Banco', period: '2026-09', closingDate: '2026-09-01', dueDate: '2026-09-10', currency: 'ARS', previousBalance: '0', paymentsAmount: '0', creditsAmount: '0', purchasesAmount: '2000', feesAmount: '0', interestAmount: '0', taxesAmount: '0', totalDue: '2000', status: 'confirmed', items: [{ id: 'line-2', purchaseDate: '2026-09-01', description: 'Internet', amount: '1000', currency: 'ARS', itemType: 'purchase' }] }])

    expect(preview).toContain('compra 2026-08-28')
    expect(preview).toContain('período destino 2026-08')
    expect(preview).toContain('grupo ambiguo')
    expect(preview).toContain('No se aplicará automáticamente')
  })
})
