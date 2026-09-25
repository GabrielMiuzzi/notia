import { describe, expect, it } from 'vitest'
import { buildCreditCardChartData } from './creditCardEvolutionChartEngine'
import type { FinanceCreditCardStatement } from '../types/financeTypes'

function statement(id: string, accountId: string, dueDate: string, totalDue: string, currency: 'ARS' | 'USD' = 'ARS'): FinanceCreditCardStatement {
  return { id, accountId, issuer: 'Banco', period: '2026-08', closingDate: '2026-08-25', dueDate, currency, previousBalance: '0', paymentsAmount: '0', creditsAmount: '0', purchasesAmount: totalDue, feesAmount: '0', interestAmount: '0', taxesAmount: '0', totalDue, status: 'confirmed', items: [] }
}

describe('buildCreditCardChartData', () => {
  it('groups what each card paid by due month and currency without filling missing months', () => {
    const result = buildCreditCardChartData([
      { id: 'visa', name: 'Visa', accountType: 'credit_card', currency: 'ARS', active: true },
      { id: 'master', name: 'Mastercard', accountType: 'credit_card', currency: 'ARS', active: true },
      { id: 'bank', name: 'Banco', accountType: 'bank', currency: 'ARS', active: true },
    ], [
      statement('visa-aug', 'visa', '2026-09-05', '100'),
      statement('visa-sep', 'visa', '2026-10-05', '200'),
      statement('visa-usd', 'visa', '2026-10-05', '12.5', 'USD'),
      statement('master-sep', 'master', '2026-10-04', '75'),
    ])

    expect(result).toEqual({
      periods: ['2026-09', '2026-10'],
      series: [
        { key: 'visa:ARS', name: 'Visa', currency: 'ARS', values: [100, 200] },
        { key: 'visa:USD', name: 'Visa · USD', currency: 'USD', values: [null, 12.5] },
        { key: 'master:ARS', name: 'Mastercard', currency: 'ARS', values: [null, 75] },
      ],
    })
  })
})
