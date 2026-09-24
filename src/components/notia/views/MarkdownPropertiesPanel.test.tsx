// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FrontmatterEntry } from '../../../engines/markdown/frontmatterEngine'
import { buildWikiLinkLookup } from '../../../engines/markdown/wikiLinkEngine'
import { MarkdownPropertiesPanel } from './MarkdownPropertiesPanel'

const suggestLinkTargets = vi.fn()
vi.mock('../../../services/libraries/libraryLinkRuntime', () => ({
  suggestLinkTargets: (...args: unknown[]) => suggestLinkTargets(...args),
}))

const CREATED_AT = new Date(2026, 8, 19, 1, 43).getTime()
const ENTRIES: FrontmatterEntry[] = [
  { key: 'contexto', value: '#Personal' },
  { key: 'createdAt', value: CREATED_AT },
  { key: 'nextPage', value: 'N/A' },
  { key: 'previousPage', value: 'N/A' },
]
const lookup = buildWikiLinkLookup([])

function renderPanel(overrides: Partial<Parameters<typeof MarkdownPropertiesPanel>[0]> = {}) {
  const props = {
    entries: ENTRIES,
    wikiLinkLookup: lookup,
    libraryId: 'library-1',
    onAddProperty: vi.fn(),
    onEditProperty: vi.fn(),
    onDeleteProperty: vi.fn(),
    onOpenLinkedFile: vi.fn(),
    contexts: [{ tag: '#Personal', color: '#16A34A' }, { tag: '#Laboral', color: '#2563EB' }],
    ...overrides,
  }
  render(<MarkdownPropertiesPanel {...props} />)
  return props
}

describe('MarkdownPropertiesPanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
    suggestLinkTargets.mockReset()
    suggestLinkTargets.mockResolvedValue([])
  })
  afterEach(cleanup)

  it('folds into a summary with the context and the creation date', () => {
    renderPanel()
    const toggle = screen.getByRole('button', { name: /Propiedades/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toContain('4')
    expect(screen.getByText('createdAt')).toBeTruthy()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('createdAt')).toBeNull()
    expect(screen.getByText('Personal')).toBeTruthy()
    expect(screen.getByText('19 sep 2026')).toBeTruthy()
    expect(window.localStorage.getItem('notia.markdown.propertiesOpen')).toBe('false')
  })

  it('shows the creation date readable, next to the stored value', () => {
    renderPanel()
    expect(screen.getByText(String(CREATED_AT))).toBeTruthy()
    expect(screen.getByText('19 sep 2026, 01:43')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Quitar la propiedad createdAt' })).toBeNull()
  })

  it('changes the context from the library contexts', () => {
    const props = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Contexto: Personal. Cambiar' }))
    fireEvent.click(screen.getByRole('option', { name: 'Laboral' }))
    expect(props.onEditProperty).toHaveBeenCalledWith('contexto', '#Laboral')
  })

  it('keeps the context of a board locked', () => {
    renderPanel({ lockedContextTag: '#Personal' })
    expect(screen.queryByRole('button', { name: /Contexto/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Quitar la propiedad contexto' })).toBeNull()
  })

  it('links a note picked from the suggestions', async () => {
    suggestLinkTargets.mockResolvedValue([{
      path: 'Cursos/Ingles/Modal Verbs Pasado.md',
      name: 'Modal Verbs Pasado.md',
      title: 'Modal Verbs Pasado',
      relativePath: 'Cursos/Ingles/Modal Verbs Pasado',
      relativePathWithExtension: 'Cursos/Ingles/Modal Verbs Pasado.md',
      wikiLink: 'Cursos/Ingles/Modal Verbs Pasado',
    }])
    const props = renderPanel()
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular nota…' })[0] as HTMLElement)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Modal' } })
    const option = await screen.findByRole('option', { name: /Modal Verbs Pasado/ })
    expect(option.textContent).toContain('Cursos / Ingles')
    expect(suggestLinkTargets).toHaveBeenCalledWith('library-1', 'Modal', 8)
    fireEvent.click(option)
    expect(props.onEditProperty).toHaveBeenCalledWith('nextPage', '[[Cursos/Ingles/Modal Verbs Pasado]]')
  })

  it('creates the linked note when it does not exist', async () => {
    const onCreateLinkedNote = vi.fn().mockResolvedValue(null)
    const props = renderPanel({ onCreateLinkedNote })
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular nota…' })[1] as HTMLElement)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Clase 3' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Crear nota «Clase 3»' }))
    await waitFor(() => expect(props.onEditProperty).toHaveBeenCalledWith('previousPage', '[[Clase 3]]'))
    expect(onCreateLinkedNote).toHaveBeenCalledWith('Clase 3')
  })

  it('reports why a note could not be created', async () => {
    const props = renderPanel({ onCreateLinkedNote: vi.fn().mockResolvedValue('El nombre no es válido.') })
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular nota…' })[0] as HTMLElement)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a:b' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Crear nota «a:b»' }))
    expect((await screen.findByRole('alert')).textContent).toBe('El nombre no es válido.')
    expect(props.onEditProperty).not.toHaveBeenCalled()
  })

  it('adds a property of the chosen type', () => {
    const props = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar propiedad' }))
    fireEvent.click(screen.getByRole('button', { name: /Casilla/ }))
    expect(screen.getByRole('alert').textContent).toBe('Escribí un nombre.')

    fireEvent.change(screen.getByLabelText('Nombre de la propiedad'), { target: { value: 'contexto' } })
    fireEvent.click(screen.getByRole('button', { name: /Casilla/ }))
    expect(screen.getByRole('alert').textContent).toBe('Ya hay una propiedad con ese nombre.')

    fireEvent.change(screen.getByLabelText('Nombre de la propiedad'), { target: { value: 'leida' } })
    fireEvent.click(screen.getByRole('button', { name: /Casilla/ }))
    expect(props.onAddProperty).toHaveBeenCalledWith({ key: 'leida', value: false })
  })

  it('edits typed values in place', () => {
    const props = renderPanel({
      entries: [
        { key: 'leida', value: false },
        { key: 'tags', value: ['ingles', 'curso'] },
        { key: 'nivel', value: 'B2' },
      ],
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'leida' }))
    expect(props.onEditProperty).toHaveBeenCalledWith('leida', true)

    fireEvent.click(screen.getByRole('button', { name: 'Quitar ingles' }))
    expect(props.onEditProperty).toHaveBeenCalledWith('tags', ['curso'])

    fireEvent.click(screen.getByRole('button', { name: 'Editar nivel' }))
    const input = screen.getByDisplayValue('B2')
    fireEvent.change(input, { target: { value: 'C1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onEditProperty).toHaveBeenCalledWith('nivel', 'C1')

    fireEvent.click(screen.getByRole('button', { name: 'Quitar la propiedad nivel' }))
    expect(props.onDeleteProperty).toHaveBeenCalledWith('nivel')
  })
})
