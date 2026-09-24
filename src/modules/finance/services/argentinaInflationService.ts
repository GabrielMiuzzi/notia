import { callBackend } from '../../../services/transport'

export interface ArgentinaInflationIndex {
  period: string
  percent: number
}

export interface ArgentinaInflationIndices {
  monthly: ArgentinaInflationIndex[]
  annual: ArgentinaInflationIndex[]
}

/** Monthly and year-on-year inflation from ArgentinaDatos, fetched and validated by the backend. */
export function getArgentinaInflationIndices(): Promise<ArgentinaInflationIndices> {
  return callBackend<ArgentinaInflationIndices>('finance_inflation_indices')
}
