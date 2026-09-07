import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rebuildLibraryLinkCache } from './libraryLinkCacheRuntime'
import {
  cancelScheduledLibraryLinkCacheRebuild,
  scheduleLibraryLinkCacheRebuild,
} from './libraryLinkCacheSchedule'

vi.mock('./libraryLinkCacheRuntime', () => ({
  rebuildLibraryLinkCache: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('../runtime/notiaLogger', () => ({
  notiaLog: vi.fn(),
}))

interface FakeDocument {
  visibilityState: 'visible' | 'hidden'
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

describe('libraryLinkCacheSchedule', () => {
  let fakeDocument: FakeDocument
  let visibilityListeners: Array<() => void>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(rebuildLibraryLinkCache).mockClear()
    visibilityListeners = []
    fakeDocument = {
      visibilityState: 'visible',
      addEventListener: (_type, listener) => visibilityListeners.push(listener),
      removeEventListener: (_type, listener) => {
        visibilityListeners = visibilityListeners.filter((candidate) => candidate !== listener)
      },
    }
    Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      },
    })
  })

  afterEach(() => {
    cancelScheduledLibraryLinkCacheRebuild()
    vi.useRealTimers()
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('defers a rebuild while the app is hidden and resumes it on visibility', async () => {
    fakeDocument.visibilityState = 'hidden'
    scheduleLibraryLinkCacheRebuild({ libraryPath: 'library', treeNodes: [] })

    await vi.advanceTimersByTimeAsync(3_000)
    expect(rebuildLibraryLinkCache).not.toHaveBeenCalled()
    expect(visibilityListeners).toHaveLength(1)

    fakeDocument.visibilityState = 'visible'
    visibilityListeners[0]?.()
    await vi.advanceTimersByTimeAsync(1_500)

    expect(rebuildLibraryLinkCache).toHaveBeenCalledWith({ libraryPath: 'library', treeNodes: [] })
    expect(visibilityListeners).toHaveLength(0)
  })

  it('coalesces visible requests and keeps only the latest parameters', async () => {
    scheduleLibraryLinkCacheRebuild({ libraryPath: 'first', treeNodes: [] })
    scheduleLibraryLinkCacheRebuild({ libraryPath: 'latest', treeNodes: [] })

    await vi.advanceTimersByTimeAsync(1_500)

    expect(rebuildLibraryLinkCache).toHaveBeenCalledTimes(1)
    expect(rebuildLibraryLinkCache).toHaveBeenCalledWith({ libraryPath: 'latest', treeNodes: [] })
  })

  it('cancels deferred work and its visibility listener', async () => {
    fakeDocument.visibilityState = 'hidden'
    scheduleLibraryLinkCacheRebuild({ libraryPath: 'library', treeNodes: [] })
    cancelScheduledLibraryLinkCacheRebuild()

    fakeDocument.visibilityState = 'visible'
    visibilityListeners.forEach((listener) => listener())
    await vi.advanceTimersByTimeAsync(3_000)

    expect(rebuildLibraryLinkCache).not.toHaveBeenCalled()
    expect(visibilityListeners).toHaveLength(0)
  })
})
