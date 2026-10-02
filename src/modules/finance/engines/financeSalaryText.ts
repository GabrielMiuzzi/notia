// Wording of the Sueldo y ahorro tab, shared by the wide and the phone
// layouts. Presentation only; Rust decides every value.

import type { FinanceSalarySavings } from '../types/financeScreen'
import { formatAmount } from './financeFormat'

/** How each kind of savings movement is named: in the totals and in a row. */
export const RESERVE_MOVEMENT_TYPES: Record<string, { total: string; row: string }> = {
  contribution: { total: 'Aportes', row: 'Aporte' },
  withdrawal: { total: 'Retiros', row: 'Retiro' },
  return: { total: 'Rendimientos', row: 'Rendimiento' },
  loss: { total: 'Pérdidas', row: 'Pérdida' },
  adjustment: { total: 'Ajustes', row: 'Ajuste' },
}

/** Whether a savings movement adds to the reserve. */
export function reserveMovementAdds(movementType: string): boolean {
  return movementType === 'contribution' || movementType === 'return'
}

/** The kinds of movement a reserve did not have this month, lower case. */
export function missingReserveMovements(totals: Array<{ kind: string }>): string[] {
  return Object.keys(RESERVE_MOVEMENT_TYPES)
    .filter((kind) => !totals.some((total) => total.kind === kind))
    .map((kind) => RESERVE_MOVEMENT_TYPES[kind].total.toLowerCase())
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** `a, b ni c`. */
export function joinSpanish(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ni ${items[items.length - 1]}`
}

type LastPurchase = NonNullable<FinanceSalarySavings['lastPurchase']>

/** `$ 10 menos que el oficial venta de hoy` (or more, or the same). */
export function describeQuoteDifference(difference: number, against: string): string {
  return difference === 0
    ? `lo mismo que ${against}`
    : `${formatAmount(Math.abs(difference), 'ARS', 0)} ${difference < 0 ? 'menos' : 'más'} que ${against}`
}

export function lastPurchaseComparison(purchase: LastPurchase): string {
  const parts = [
    purchase.vsOfficial !== null ? describeQuoteDifference(purchase.vsOfficial, 'el oficial venta de hoy') : null,
    purchase.vsBlue !== null ? describeQuoteDifference(purchase.vsBlue, 'el blue') : null,
  ].filter(Boolean)
  return parts.length === 0 ? 'Sin cotizaciones de hoy para comparar.' : `${capitalize(parts.join(' y '))}.`
}
