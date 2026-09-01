import { describe, expect, it } from 'vitest'
import { buildCreditCardChartData } from './creditCardEvolutionChartEngine'

describe('buildCreditCardChartData', () => {
  it('creates one series per credit-card account without filling missing statements', () => {
    const result = buildCreditCardChartData([
      { id: 'visa', name: 'Visa', accountType: 'credit_card', currency: 'ARS', openingBalance: '0', active: true, currentBalance: '0' },
      { id: 'master', name: 'Mastercard', accountType: 'credit_card', currency: 'ARS', openingBalance: '0', active: true, currentBalance: '0' },
      { id: 'bank', name: 'Banco', accountType: 'bank', currency: 'ARS', openingBalance: '0', active: true, currentBalance: '0' },
    ], [
      { id: 'visa-aug', accountId: 'visa', issuer: 'Banco', period: '2026-08', closingDate: '2026-08-25', dueDate: '2026-09-05', currency: 'ARS', previousBalance: '0', paymentsAmount: '0', creditsAmount: '0', purchasesAmount: '100', feesAmount: '0', interestAmount: '0', taxesAmount: '0', totalDue: '100', status: 'confirmed', items: [] },
      { id: 'visa-sep', accountId: 'visa', issuer: 'Banco', period: '2026-09', closingDate: '2026-09-25', dueDate: '2026-10-05', currency: 'ARS', previousBalance: '100', paymentsAmount: '100', creditsAmount: '0', purchasesAmount: '200', feesAmount: '0', interestAmount: '0', taxesAmount: '0', totalDue: '200', status: 'confirmed', items: [] },
      { id: 'master-sep', accountId: 'master', issuer: 'Banco', period: '2026-09', closingDate: '2026-09-25', dueDate: '2026-10-05', currency: 'ARS', previousBalance: '0', paymentsAmount: '0', creditsAmount: '0', purchasesAmount: '75', feesAmount: '0', interestAmount: '0', taxesAmount: '0', totalDue: '75', status: 'confirmed', items: [] },
    ])

    expect(result).toEqual({
      periods: ['2026-08', '2026-09'],
      series: [
        { accountId: 'visa', name: 'Visa', values: [100, 200] },
        { accountId: 'master', name: 'Mastercard', values: [null, 75] },
      ],
    })
  })
})
