// Wording of the Productos y tickets tab, shared by the wide and the phone
// layouts. Presentation only; Rust decides every value.

import type { ProductDetail, ProductSort, TicketStatus } from '../types/financeScreen'

export const PRODUCT_SORTS: Array<{ id: ProductSort; label: string }> = [
  { id: 'recent', label: 'Recientes' },
  { id: 'rising', label: 'Más subieron' },
  { id: 'az', label: 'A–Z' },
]

export const TICKET_STATUS: Record<TicketStatus, string> = {
  'card-unpaid': 'En tarjeta, a pagar',
  'paid-in-statement': 'Pagado en resumen',
  confirmed: 'Confirmado',
  pending: 'Pendiente',
  discarded: 'Descartado',
}

/** The color of a merchant in the price chart (`finance-series--N`). */
export function seriesIndex(detail: ProductDetail, merchant: string): number {
  return Math.max(0, detail.series.findIndex((series) => series.merchant === merchant)) % 6
}
