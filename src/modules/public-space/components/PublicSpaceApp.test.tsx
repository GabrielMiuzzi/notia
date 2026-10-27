// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PublicSpaceApp } from './PublicSpaceApp'

vi.mock('../services/articleEnhancer', () => ({ enhanceArticle: vi.fn(async () => {}) }))

const SPACE = {
  name: 'Curso',
  home: '/Curso/Indice',
  pageCount: 2,
  groups: [
    { title: null, entries: [{ url: '/Curso/Indice', title: 'Índice', children: [] }] },
    { title: 'Memoria', entries: [{ url: '/Curso/memoria/Memoria', title: 'Memoria', children: [{ url: '/Curso/memoria/stack', title: 'Stack', children: [] }] }] },
  ],
}

function page(url: string, title: string, extra: Record<string, unknown> = {}) {
  return { url, title, description: null, html: `<p>Texto de ${title}</p><h2 id="parte">Parte</h2>`, outline: [{ id: 'parte', text: 'Parte', level: 2 }], trail: [], previous: null, next: null, modifiedAt: null, ...extra }
}

const PAGES: Record<string, unknown> = {
  '/Curso/Indice': page('/Curso/Indice', 'Índice', { next: { url: '/Curso/memoria/stack', title: 'Stack' } }),
  '/Curso/memoria/stack': page('/Curso/memoria/stack', 'Stack', { trail: ['Memoria', 'Memoria'], previous: { url: '/Curso/Indice', title: 'Índice' } }),
}

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('PublicSpaceApp', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      const url = new URL(input, 'http://space')
      if (url.pathname === '/api/space') return respond(SPACE)
      if (url.pathname === '/api/page') {
        const found = PAGES[url.searchParams.get('path') ?? '']
        return found ? respond(found) : respond({ error: 'Esa página no está publicada.' }, 404)
      }
      if (url.pathname === '/api/search') return respond({ results: [{ url: '/Curso/memoria/stack', title: 'Stack', snippet: 'La pila…', trail: ['Memoria'] }] })
      return respond({}, 404)
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('opens the first page and moves with the next card and the index', async () => {
    render(<PublicSpaceApp />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Índice' })).toBeTruthy()
    expect(window.location.pathname).toBe('/Curso/Indice')
    expect(screen.getByText('Texto de Índice')).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'En esta página' })).getByText('Parte')).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Siguiente Stack/ })) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Stack' })).toBeTruthy()
    expect(window.location.pathname).toBe('/Curso/memoria/stack')
    expect(screen.getByText('Memoria / Memoria')).toBeTruthy()
    // The section holding the page opened by itself.
    expect(within(screen.getByRole('navigation', { name: 'Índice' })).getByRole('link', { name: 'Stack' }).getAttribute('aria-current')).toBe('page')

    await act(async () => { fireEvent.click(within(screen.getByRole('navigation', { name: 'Índice' })).getByRole('link', { name: 'Índice' })) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Índice' })).toBeTruthy()
  })

  it('shows a page that is not published as not found', async () => {
    window.history.replaceState(null, '', '/Curso/privada')
    render(<PublicSpaceApp />)
    expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeTruthy()
    expect(screen.getByText('Esa página no está publicada.')).toBeTruthy()
  })

  it('searches with Ctrl + K and opens a result', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<PublicSpaceApp />)
    await screen.findByRole('heading', { level: 1, name: 'Índice' })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const dialog = screen.getByRole('dialog', { name: 'Buscar' })
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'pila' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    await act(async () => { fireEvent.click(await within(dialog).findByRole('link', { name: /Stack/ })) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Stack' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    vi.useRealTimers()
  })
})
