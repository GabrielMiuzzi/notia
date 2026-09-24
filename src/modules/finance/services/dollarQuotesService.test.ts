import { callBackend } from '../../../services/transport'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDollarQuotes } from './dollarQuotesService'

vi.mock('../../../services/transport', () => ({ callBackend: vi.fn() }))

// Fetching, timeout and validation of DolarApi live in Rust
// (`services::finance_external`).
describe('dollarQuotesService', () => {
  beforeEach(() => vi.resetAllMocks())

  it('reads the quotes from the backend', async () => {
    const quotes = [{ kind: 'oficial', name: 'Oficial', buy: 1320, sell: 1360, updatedAt: '2026-09-01T12:00:00Z' }]
    vi.mocked(callBackend).mockResolvedValue(quotes)
    await expect(getDollarQuotes()).resolves.toEqual(quotes)
    expect(callBackend).toHaveBeenCalledWith('finance_dollar_quotes')
  })
})
