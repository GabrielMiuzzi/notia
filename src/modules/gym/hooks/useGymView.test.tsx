// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { NotiaLibrary } from '../../../types/notia'
import type { GymApplyResult, GymView } from '../types/gymTypes'
import { useGymView } from './useGymView'

type Listener = (origin: string | null) => void

const service = vi.hoisted(() => ({
  getGymView: vi.fn(),
  applyGymMutation: vi.fn(),
  getBody: vi.fn(),
  subscribeToGym: vi.fn(),
}))

vi.mock('../services/gymService', () => ({
  ...service,
  asGymError: (reason: unknown) => ({ code: 'storage', message: String(reason) }),
}))

const library = { id: 'library-1' } as NotiaLibrary
const gymView = (exerciseTotal: number) => ({ exerciseTotal, routineId: null, nowMs: 0 }) as unknown as GymView

let listener: Listener = () => undefined

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('useGymView', () => {
  beforeEach(() => {
    service.getBody.mockResolvedValue(null)
    service.subscribeToGym.mockImplementation((_library: NotiaLibrary, next: Listener) => {
      listener = next
      return Promise.resolve(() => undefined)
    })
  })

  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('keeps the view of its own change and selects the created routine', async () => {
    service.getGymView.mockResolvedValue(gymView(1))
    const applied = gymView(2)
    // Rust announces the change before the answer arrives.
    service.applyGymMutation.mockImplementation((_library: NotiaLibrary, _mutation: unknown, _query: unknown, origin: string) => {
      listener(origin)
      return Promise.resolve<GymApplyResult>({ view: applied, routineId: 'routine-new' })
    })
    const { result } = renderHook(() => useGymView(library))
    await act(async () => undefined)

    await act(async () => { await result.current.apply({ type: 'create-routine' }) })

    expect(result.current.view).toBe(applied)
    expect(result.current.query.routineId).toBe('routine-new')
    expect(service.getGymView).toHaveBeenCalledTimes(1)
  })

  it('opens on the workout in progress that Rust chose, without asking again', async () => {
    const training = { ...gymView(1), screen: 'entrenar', routineId: 'routine-1' } as GymView
    service.getGymView.mockResolvedValue(training)
    const { result } = renderHook(() => useGymView(library))
    await act(async () => undefined)

    expect(service.getGymView).toHaveBeenCalledWith(library, expect.objectContaining({ resume: true }))
    expect(result.current.query).toMatchObject({ screen: 'entrenar', routineId: 'routine-1', resume: false })
    expect(service.getGymView).toHaveBeenCalledTimes(1)

    // Later screens are the person's: Rust no longer chooses.
    await act(async () => { result.current.updateQuery({ screen: 'rutinas' }) })
    expect(service.getGymView).toHaveBeenLastCalledWith(library, expect.objectContaining({ screen: 'rutinas', resume: false }))
  })

  it('reloads when the change came from elsewhere', async () => {
    service.getGymView.mockResolvedValue(gymView(1))
    renderHook(() => useGymView(library))
    await act(async () => undefined)

    await act(async () => { listener(null) })
    await act(async () => { listener('another-window') })

    expect(service.getGymView).toHaveBeenCalledTimes(3)
  })

  it('asks once more when a newer request may have read before the change', async () => {
    const latest = gymView(4)
    service.getGymView.mockResolvedValueOnce(gymView(1)).mockResolvedValueOnce(gymView(3)).mockResolvedValueOnce(latest)
    const answer = deferred<GymApplyResult>()
    service.applyGymMutation.mockReturnValue(answer.promise)
    const { result } = renderHook(() => useGymView(library))
    await act(async () => undefined)

    let applying: Promise<unknown> = Promise.resolve()
    act(() => { applying = result.current.apply({ type: 'pause-session' }) })
    await act(async () => { result.current.updateQuery({ screen: 'rutinas' }) })
    expect(service.getGymView).toHaveBeenCalledTimes(2)

    await act(async () => {
      answer.resolve({ view: gymView(2), routineId: null })
      await applying
    })

    expect(service.getGymView).toHaveBeenCalledTimes(3)
    expect(result.current.view).toBe(latest)
  })
})
