import { describe, expect, it, vi } from 'vitest'
import { notifyFinanceDataChanged, subscribeToFinanceDataChanges } from './financeDataEvents'

describe('financeDataEvents', () => {
  it('refreshes subscribed finance views and supports cleanup', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToFinanceDataChanges(listener)

    notifyFinanceDataChanged()
    unsubscribe()
    notifyFinanceDataChanged()

    expect(listener).toHaveBeenCalledTimes(1)
  })
})
