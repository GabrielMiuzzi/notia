// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { subscribeBackend } from '../../../services/transport'
import { changedOpenPaths, movedOpenPaths, useAgentDocumentChanges } from './useAgentDocumentChanges'

vi.mock('../../../services/transport', () => ({
  subscribeBackend: vi.fn(),
}))

const subscribe = vi.mocked(subscribeBackend)

afterEach(() => subscribe.mockReset())

describe('agent document changes', () => {
  it('matches open tabs by the path the explorer shows or by the path inside the library', () => {
    const event = { libraryId: 'gaia', paths: ['Meetings/Reunión.md', 'Ideas/b.md'], visiblePaths: ['//?/C:/libs/gaia/Meetings/Reunión.md', '//?/C:/libs/gaia/Ideas/b.md'] }
    expect(changedOpenPaths(['C:\\libs\\gaia\\Meetings\\Reunión.md', 'C:/libs/gaia/Ideas/a.md', 'C:/otra/Ideas/b.md'], event))
      .toEqual(['C:\\libs\\gaia\\Meetings\\Reunión.md', 'C:/otra/Ideas/b.md'])
    expect(changedOpenPaths(['C:/libs/gaia/Ideas/bb.md'], event)).toEqual([])
  })

  it('moves the open tabs inside the entry the agent moved', () => {
    const event = { libraryId: 'gaia', from: 'C:/libs/gaia/Inbox', to: 'C:/libs/gaia/Proyectos/Inbox' }
    expect(movedOpenPaths(['C:\\libs\\gaia\\Inbox\\a.md', 'C:/libs/gaia/Inbox', 'C:/libs/gaia/Inbox 2/b.md', 'C:/libs/gaia/c.md'], event))
      .toEqual([
        { from: 'C:\\libs\\gaia\\Inbox\\a.md', to: 'C:/libs/gaia/Proyectos/Inbox/a.md' },
        { from: 'C:/libs/gaia/Inbox', to: 'C:/libs/gaia/Proyectos/Inbox' },
      ])
  })

  it('reports the open notes the agent wrote in the active library only', async () => {
    let handler: ((payload: unknown) => void) | undefined
    subscribe.mockImplementation(async (_event, listener) => {
      handler = listener as (payload: unknown) => void
      return () => undefined
    })
    const onChanged = vi.fn()
    renderHook(() => useAgentDocumentChanges('gaia', () => ['C:/libs/gaia/a.md'], onChanged))
    await waitFor(() => expect(handler).toBeDefined())
    handler?.({ libraryId: 'otra', paths: ['a.md'], visiblePaths: ['C:/libs/otra/a.md'] })
    handler?.({ libraryId: 'gaia', paths: ['b.md'], visiblePaths: ['C:/libs/gaia/b.md'] })
    expect(onChanged).not.toHaveBeenCalled()
    handler?.({ libraryId: 'gaia', paths: ['a.md'], visiblePaths: ['C:/libs/gaia/a.md'] })
    expect(onChanged).toHaveBeenCalledWith(['C:/libs/gaia/a.md'])
  })
})
