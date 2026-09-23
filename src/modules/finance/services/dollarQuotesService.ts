import { invoke } from '@tauri-apps/api/core'

export type DollarQuoteKind = 'oficial' | 'blue' | 'tarjeta'

export interface DollarQuote {
  kind: DollarQuoteKind
  name: string
  buy: number
  sell: number
  updatedAt: string
}

/** Current quotes from DolarApi, fetched and validated by the backend. */
export function getDollarQuotes(): Promise<DollarQuote[]> {
  return invoke<DollarQuote[]>('finance_dollar_quotes')
}
