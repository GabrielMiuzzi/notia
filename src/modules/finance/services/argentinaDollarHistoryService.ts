import { invoke } from '@tauri-apps/api/core'

export interface HistoricalDollarQuote {
  date: string
  buy: number
  sell: number
}

/** Official dollar history from ArgentinaDatos, fetched and validated by the backend. */
export function getOfficialHistoricalDollarQuotes(): Promise<HistoricalDollarQuote[]> {
  return invoke<HistoricalDollarQuote[]>('finance_historical_dollar_quotes', { from: null, to: null })
}
