// Wording of a movement row: its second line, amount and status, as the
// canvas writes them. Presentation only; Rust decides every value.

import type { MovementRow } from '../types/financeScreen'
import { formatAmount } from './financeFormat'

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmado',
  corrected: 'Corregido',
  pending: 'Pendiente',
  discarded: 'Descartado',
  card_unpaid: 'En tarjeta, a pagar',
}

const KIND_LABELS: Record<string, string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  exchange: 'Cambio de moneda',
  transfer: 'Transferencia',
  adjustment: 'Ajuste',
}

export function movementStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export function movementKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * `Sin categoría · Servicio Movistar · por Telegram`. With the account in
 * front (latest movements), the service stands for the category.
 */
export function movementMeta(row: MovementRow, withAccount = false): string {
  if (row.exchange) return `Cambio de moneda · ${row.exchange.intoSavings ? 'a' : 'desde'} ${row.exchange.reserveName}`
  const category = row.categoryName ?? (row.uncategorized ? 'sin categoría' : movementKindLabel(row.kind).toLowerCase())
  const parts = [
    withAccount ? row.accountName : null,
    withAccount && row.serviceName ? null : category,
    row.serviceName ? `Servicio ${row.serviceName}` : null,
    row.viaTelegram ? 'por Telegram' : null,
    row.status === 'discarded' ? 'descartado' : null,
    row.status === 'card_unpaid' ? 'en tarjeta, a pagar' : null,
    row.status === 'pending' ? 'pendiente' : null,
    row.flagged ? 'para revisar' : null,
  ].filter((part): part is string => Boolean(part))
  return capitalize(parts.join(' · '))
}

/** `$ 82.997,00`, or `+ USD 1.000,00` for what went into savings. */
export function movementAmount(row: MovementRow, decimals: 0 | 2 = 2): string {
  if (row.exchange) return `${row.exchange.intoSavings ? '+' : '−'} ${formatAmount(row.exchange.amount, row.exchange.currency, decimals)}`
  if (row.kind === 'income') return `+ ${formatAmount(row.amount, row.currency, decimals)}`
  return formatAmount(row.amount, row.currency, decimals)
}

/** Tone of the amount: struck through when it does not count, teal when it adds. The description only takes `off`. */
export function movementTone(row: MovementRow): 'off' | 'plus' | 'normal' {
  if (row.status === 'discarded') return 'off'
  if (row.exchange?.intoSavings || row.kind === 'income') return 'plus'
  return 'normal'
}
