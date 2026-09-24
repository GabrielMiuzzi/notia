import { callBackend } from '../../../services/transport'

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
  return callBackend<DollarQuote[]>('finance_dollar_quotes')
}
