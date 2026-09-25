import { describe, expect, it, vi } from 'vitest'
import { subscribeBackend } from '../../../services/transport'
import { FINANCE_DATA_CHANGED_EVENT, notifyFinanceDataChanged, subscribeToFinanceDataChanges } from './financeDataEvents'

vi.mock('../../../services/transport', () => ({ subscribeBackend: vi.fn() }))

describe('financeDataEvents', () => {
  it('refreshes on local and backend changes and cleans both up', async () => {
    let backendHandler: (() => void) | null = null
    const unsubscribeBackend = vi.fn()
    vi.mocked(subscribeBackend).mockImplementation(async (_event, handler) => {
      backendHandler = handler as () => void
      return unsubscribeBackend
    })
    const listener = vi.fn()
    const unsubscribe = subscribeToFinanceDataChanges(listener)
    await vi.waitFor(() => expect(backendHandler).not.toBeNull())

    notifyFinanceDataChanged()
    backendHandler!()
    unsubscribe()
    notifyFinanceDataChanged()

    expect(subscribeBackend).toHaveBeenCalledWith(FINANCE_DATA_CHANGED_EVENT, expect.any(Function))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(unsubscribeBackend).toHaveBeenCalledTimes(1)
  })
})
