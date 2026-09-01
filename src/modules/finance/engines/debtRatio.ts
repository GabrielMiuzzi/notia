import { parseFinanceCents } from './financeAmounts'

export function formatDebtToIncomeRatio(
  debtByCurrency: Record<string, string>,
  incomeByCurrency: Record<string, string>,
): string {
  const ratios = Object.entries(debtByCurrency)
    .map(([currency, debt]) => {
      const income = parseFinanceCents(incomeByCurrency[currency] ?? '0')
      if (income <= 0n) return null
      const percentageTenths = (parseFinanceCents(debt) * 1_000n) / income
      return { currency, percentage: Number(percentageTenths) / 10 }
    })
    .filter((ratio): ratio is { currency: string; percentage: number } => ratio !== null)

  if (ratios.length === 0) return '—'
  if (ratios.length === 1) return `${ratios[0].percentage.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`
  return ratios.map(({ currency, percentage }) => `${currency} ${percentage.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`).join(' · ')
}
