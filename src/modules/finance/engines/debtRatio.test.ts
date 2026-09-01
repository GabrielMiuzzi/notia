import { describe, expect, it } from 'vitest'
import { formatDebtToIncomeRatio } from './debtRatio'

describe('formatDebtToIncomeRatio', () => {
  it('calcula la deuda contra el ingreso en la misma moneda', () => {
    expect(formatDebtToIncomeRatio({ ARS: '250000' }, { ARS: '1000000' })).toBe('25%')
  })

  it('omite monedas sin un ingreso que permita comparar', () => {
    expect(formatDebtToIncomeRatio({ ARS: '100', USD: '20' }, { ARS: '400' })).toBe('25%')
  })
})
