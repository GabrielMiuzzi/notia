// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { renderMermaid } from '../engines/mermaidEngine'
import { useMermaidLazyRender } from './useMermaidLazyRender'

vi.mock('../engines/mermaidEngine', () => ({
  renderMermaid: vi.fn(async ({ theme }: { theme: string }) => ({
    svg: `<svg data-theme="${theme}"></svg>`,
    bindFunctions: undefined,
    diagramType: 'sequenceDiagram',
  })),
  isMermaidRenderCancelledError: () => false,
}))

type Observe = (entries: Array<{ isIntersecting: boolean }>) => void
let observers: Observe[] = []

beforeEach(() => {
  observers = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: Observe) {
      observers.push(callback)
    }
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(renderMermaid).mockClear()
})

function becomeVisible() {
  act(() => {
    observers.forEach((callback) => callback([{ isIntersecting: true }]))
  })
}

describe('useMermaidLazyRender', () => {
  it('renders once visible and renders again only when the theme changes', async () => {
    const containerRef = { current: document.createElement('div') }
    const { result, rerender } = renderHook(
      ({ theme }: { theme: string }) => useMermaidLazyRender({ code: 'sequenceDiagram\n  A->>B: hola', theme, containerRef }),
      { initialProps: { theme: 'dark' } },
    )
    expect(renderMermaid).not.toHaveBeenCalled()

    becomeVisible()
    await waitFor(() => expect(result.current.result?.svg).toContain('data-theme="dark"'))

    rerender({ theme: 'dark' })
    await act(async () => {
      await Promise.resolve()
    })
    expect(renderMermaid).toHaveBeenCalledTimes(1)

    rerender({ theme: 'light' })
    await waitFor(() => expect(result.current.result?.svg).toContain('data-theme="light"'))
    expect(renderMermaid).toHaveBeenCalledTimes(2)
    expect(vi.mocked(renderMermaid).mock.calls[1][0].theme).toBe('light')
  })
})
