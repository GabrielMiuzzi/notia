import { describe, expect, it } from 'vitest'
import { formatFinanceCents, parseFinanceCents, sumFinanceAmounts } from './financeAmounts'

describe('finance amounts', () => {
  it('sums decimal amounts without floating point rounding', () => {
    expect(sumFinanceAmounts(['0.10', '0.20', '1000.05'])).toBe('1000.35')
  })

  it('keeps two decimal places', () => {
    expect(parseFinanceCents('12.5')).toBe(1250n)
    expect(formatFinanceCents(7n)).toBe('0.07')
  })
})
