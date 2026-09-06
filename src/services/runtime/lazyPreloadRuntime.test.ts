import { afterEach, describe, expect, it, vi } from 'vitest'
import { preloadLazyComponent } from './lazyPreloadRuntime'

describe('lazyPreloadRuntime', () => {
  const originalWindow = globalThis.window
  const originalNavigator = globalThis.navigator
  const originalRequestIdleCallback = globalThis.requestIdleCallback
  const originalCancelIdleCallback = globalThis.cancelIdleCallback

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator })
    Object.defineProperty(globalThis, 'requestIdleCallback', {
      configurable: true,
      value: originalRequestIdleCallback,
    })
    Object.defineProperty(globalThis, 'cancelIdleCallback', {
      configurable: true,
      value: originalCancelIdleCallback,
    })
  })

  it('waits for the configured delay before requesting idle time', async () => {
    vi.useFakeTimers()
    const idleCallbacks: Array<(deadline: { timeRemaining: () => number }) => void> = []
    const browserWindow = {
      __NOTIA_PUBLISHED_TASK_MANAGER__: true,
      setTimeout,
      clearTimeout,
      addEventListener: vi.fn(),
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: '', platform: 'win32' },
    })
    Object.defineProperty(globalThis, 'requestIdleCallback', {
      configurable: true,
      value: (callback: (deadline: { timeRemaining: () => number }) => void) => {
        idleCallbacks.push(callback)
        return idleCallbacks.length
      },
    })
    Object.defineProperty(globalThis, 'cancelIdleCallback', {
      configurable: true,
      value: vi.fn(),
    })

    const factory = vi.fn(async () => undefined)
    preloadLazyComponent('lazy-preload-delay-regression', factory, { delayMs: 150 })

    await vi.advanceTimersByTimeAsync(149)
    expect(idleCallbacks).toHaveLength(0)
    expect(factory).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(idleCallbacks).toHaveLength(1)
    expect(factory).not.toHaveBeenCalled()

    idleCallbacks[0]?.({ timeRemaining: () => 50 })
    await vi.runAllTimersAsync()
    expect(factory).toHaveBeenCalledOnce()
  })
})
