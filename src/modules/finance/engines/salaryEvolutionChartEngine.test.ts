import { describe, expect, it } from 'vitest'
import { buildSalaryChartScale, salaryChartWidth } from './salaryEvolutionChartEngine'

// The salary figures are covered in Rust (`backend-core::finance_insights`).
describe('salary chart layout', () => {
  it('keeps long histories readable with horizontal spacing for every period', () => {
    expect(salaryChartWidth(1)).toBe(480)
    expect(salaryChartWidth(6)).toBe(504)
    expect(salaryChartWidth(21)).toBe(1584)
  })

  it('builds readable monetary ticks that cover every salary value', () => {
    expect(buildSalaryChartScale([3_374_902.85, 7_815_434.89])).toEqual({
      maximum: 8_000_000,
      ticks: [0, 2_000_000, 4_000_000, 6_000_000, 8_000_000],
    })
    expect(buildSalaryChartScale([3297])).toEqual({
      maximum: 4000,
      ticks: [0, 1000, 2000, 3000, 4000],
    })
  })
})
