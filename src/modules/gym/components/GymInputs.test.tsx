// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CommitInput } from './GymInputs'

describe('CommitInput', () => {
  afterEach(() => cleanup())

  it('sends what was typed when the app goes to the background', () => {
    const onCommit = vi.fn()
    render(<CommitInput aria-label="Peso" value="60" onCommit={onCommit} />)
    fireEvent.change(screen.getByLabelText('Peso'), { target: { value: '62.5' } })
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(onCommit).toHaveBeenCalledWith('62.5')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  it('sends what was typed when the screen goes away, once', () => {
    const onCommit = vi.fn()
    const { unmount } = render(<CommitInput aria-label="Repeticiones" value="10" onCommit={onCommit} />)
    fireEvent.change(screen.getByLabelText('Repeticiones'), { target: { value: '12' } })
    unmount()
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('12')
  })

  it('sends nothing when the value did not change', () => {
    const onCommit = vi.fn()
    const { unmount } = render(<CommitInput aria-label="Peso" value="60" onCommit={onCommit} />)
    unmount()
    expect(onCommit).not.toHaveBeenCalled()
  })
})
