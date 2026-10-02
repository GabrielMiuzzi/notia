// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { LibraryGraphNode } from '../../../../../types/graph/libraryGraph'
import type { GraphSearchResult } from '../../../../../hooks/useLibraryGraphData'
import { PHONE_GRAPH_PAINT, phoneNodeRadius } from '../graphCanvas'
import { DEFAULT_GRAPH_FORCES, hasCustomGraphView, type GraphPreferences } from '../useGraphPreferences'
import { GraphPhoneHeader, GraphPhoneSearchHeader } from './GraphPhoneHeader'
import { GraphPhoneSearchResults } from './GraphPhoneSearchResults'
import { GraphPhoneNoteSheet } from './GraphPhoneNoteSheet'
import { GraphPhoneViewSheet } from './GraphPhoneViewSheet'
import { GraphPhoneFitButton, GraphPhoneLocalChip } from './GraphPhoneOverlays'

const node = (path: string, label: string, degree: number, neighbors: string[] = [], folder = 'notas'): LibraryGraphNode => ({
  id: path, path, label, degree, neighbors, folder, contextTag: '#Laboral', contextColor: '#6C8EFF',
})

const hub = node('notas/hub.md', 'Motor de pagos', 2, ['notas/a.md', 'raiz.md'])
const a = node('notas/a.md', 'Alfa', 1, ['notas/hub.md'])
const root = node('raiz.md', 'Raíz', 1, ['notas/hub.md'], '')
const nodeByPath = new Map([hub, a, root].map((entry) => [entry.path, entry]))
const lookOf = () => ({ name: 'Laboral', color: '#6C8EFF' })
const defaults: GraphPreferences = { labels: 'auto', showOrphans: true, showFolders: true, forces: DEFAULT_GRAPH_FORCES }

afterEach(cleanup)

describe('phone paint and view state', () => {
  it('sizes phone nodes after the phone boards and keeps a finger-sized touch area', () => {
    expect(phoneNodeRadius(0)).toBe(3)
    expect(phoneNodeRadius(100)).toBe(10)
    expect(PHONE_GRAPH_PAINT.minHitRadius * 2).toBe(30)
  })

  it('tells when the view differs from its defaults', () => {
    expect(hasCustomGraphView(defaults)).toBe(false)
    expect(hasCustomGraphView({ ...defaults, labels: 'all' })).toBe(true)
    expect(hasCustomGraphView({ ...defaults, showOrphans: false })).toBe(true)
    expect(hasCustomGraphView({ ...defaults, forces: { ...DEFAULT_GRAPH_FORCES, cohesion: 20 } })).toBe(true)
    // Folder zones are a look, not a filter: the phone board does not mark them.
    expect(hasCustomGraphView({ ...defaults, showFolders: false })).toBe(false)
  })
})

describe('GraphPhoneHeader', () => {
  it('shows what is visible and opens the search and the view sheet', () => {
    const onOpenSearch = vi.fn()
    const onOpenView = vi.fn()
    const { rerender } = render(
      <GraphPhoneHeader visibleNotes={64} visibleLinks={1} isViewCustomized={false} onOpenSearch={onOpenSearch} onOpenView={onOpenView} />,
    )
    expect(screen.getByText('64 notas · 1 enlace')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Buscar notas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Vista y filtros' }))
    expect(onOpenSearch).toHaveBeenCalled()
    expect(onOpenView).toHaveBeenCalled()
    rerender(<GraphPhoneHeader visibleNotes={1} visibleLinks={0} isViewCustomized onOpenSearch={onOpenSearch} onOpenView={onOpenView} />)
    expect(screen.getByRole('button', { name: 'Vista y filtros (con cambios)' })).toBeTruthy()
  })

  it('searches with the field focused, clears it and closes with Escape', () => {
    const onQueryChange = vi.fn()
    const onClose = vi.fn()
    render(<GraphPhoneSearchHeader query="pago" onQueryChange={onQueryChange} onClose={onClose} />)
    const input = screen.getByRole('searchbox', { name: 'Buscar en el grafo' })
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'pagos' } })
    expect(onQueryChange).toHaveBeenCalledWith('pagos')
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }))
    expect(onQueryChange).toHaveBeenCalledWith('')
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar búsqueda' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('GraphPhoneSearchResults', () => {
  const common = { nodeByPath, libraryName: 'gaia', colorOf: () => '#6C8EFF' }

  it('lists the most connected notes before typing', () => {
    const onPick = vi.fn()
    render(<GraphPhoneSearchResults {...common} query="" results={null} topConnected={[hub, root]} onPick={onPick} />)
    expect(screen.getByText('Más conectadas')).toBeTruthy()
    expect(screen.getByText('notas · 2 enlaces')).toBeTruthy()
    // A note at the library root shows the library instead of a folder.
    expect(screen.getByText('gaia · 1 enlace')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Raíz/ }))
    expect(onPick).toHaveBeenCalledWith('raiz.md')
  })

  it('marks the match, counts every result and shows seven at most', () => {
    const results: GraphSearchResult[] = Array.from({ length: 9 }, (_, index) => ({
      path: index === 0 ? hub.path : `notas/pago-${index}.md`, label: index === 0 ? hub.label : `Pago ${index}`, folder: 'notas', preview: '', score: 1,
    }))
    render(<GraphPhoneSearchResults {...common} query="pago" results={results} topConnected={[]} onPick={vi.fn()} />)
    expect(screen.getByText('Resultados')).toBeTruthy()
    expect(screen.getByText('9 notas')).toBeTruthy()
    const region = screen.getByRole('region', { name: 'Notas que coinciden' })
    expect(within(region).getAllByRole('button')).toHaveLength(7)
    expect(region.querySelector('mark')?.textContent).toBe('pago')
  })

  it('says when nothing matches', () => {
    render(<GraphPhoneSearchResults {...common} query="zzz" results={[]} topConnected={[]} onPick={vi.fn()} />)
    expect(screen.getByText('Ninguna nota coincide con la búsqueda.')).toBeTruthy()
    expect(screen.getByText('0 notas')).toBeTruthy()
  })
})

describe('GraphPhoneNoteSheet', () => {
  const renderSheet = (overrides: Partial<Parameters<typeof GraphPhoneNoteSheet>[0]> = {}) => {
    const props = {
      libraryName: 'gaia', selected: hub, look: lookOf(), connections: [a, root], lookOf, height: 212,
      isExpanded: false, onExpandedChange: vi.fn(), isLocal: false, onToggleLocal: vi.fn(), onClose: vi.fn(),
      onOpen: vi.fn(), onPick: vi.fn(), chat: { isIncluded: false, onToggle: vi.fn() }, ...overrides,
    }
    render(<GraphPhoneNoteSheet {...props} />)
    return props
  }

  it('shows the note and its actions', () => {
    const props = renderSheet()
    expect(screen.getByRole('heading', { name: 'Motor de pagos' })).toBeTruthy()
    expect(screen.getByText('gaia / notas · 2 enlaces')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Abrir nota/ }))
    expect(props.onOpen).toHaveBeenCalledWith('notas/hub.md')
    fireEvent.click(screen.getByRole('button', { name: /Grafo local/ }))
    expect(props.onToggleLocal).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Sumar al chat' }))
    expect(props.chat?.onToggle).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar detalle' }))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('expands with its handle or a swipe up, and picks a connection', () => {
    const props = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Expandir detalle' }))
    expect(props.onExpandedChange).toHaveBeenLastCalledWith(true)
    const open = screen.getByRole('button', { name: /Abrir nota/ })
    fireEvent.pointerDown(open, { pointerId: 1, clientY: 700 })
    fireEvent.pointerUp(open, { pointerId: 1, clientY: 640 })
    // The swipe started on «Abrir nota» but does not open the note.
    fireEvent.click(open)
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(props.onExpandedChange).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: /Alfa/ }))
    expect(props.onPick).toHaveBeenCalledWith('notas/a.md')
  })

  it('shrinks with a swipe down when expanded and says when there are no links', () => {
    const props = renderSheet({ isExpanded: true, isLocal: true, connections: [], selected: { ...a, degree: 0, neighbors: [] }, chat: null })
    expect(screen.getByRole('button', { name: 'Achicar detalle' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Ver global/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Sumar al chat' })).toBeNull()
    expect(screen.getByText('Esta nota no tiene enlaces todavía.')).toBeTruthy()
    const handle = screen.getByRole('button', { name: 'Achicar detalle' })
    fireEvent.pointerDown(handle, { pointerId: 2, clientY: 300 })
    fireEvent.pointerUp(handle, { pointerId: 2, clientY: 360 })
    expect(props.onExpandedChange).toHaveBeenCalledWith(false)
  })
})

describe('GraphPhoneViewSheet', () => {
  it('toggles tags, names, orphans and folder zones, tunes the forces and closes', () => {
    const onChange = vi.fn()
    const onToggleChip = vi.fn()
    const onClose = vi.fn()
    render(
      <GraphPhoneViewSheet
        chips={[{ key: '#Laboral', name: 'Laboral', color: '#6C8EFF', count: 24, hidden: false }, { key: '', name: 'Sin contexto', color: '#888', count: 7, hidden: true }]}
        onToggleChip={onToggleChip}
        preferences={defaults}
        onChange={onChange}
        orphanCount={22}
        onClose={onClose}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Vista del grafo' })
    expect(document.activeElement).toBe(dialog)
    expect(screen.getByRole('button', { name: /Sin contexto/ }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /Laboral/ }))
    expect(onToggleChip).toHaveBeenCalledWith('#Laboral')
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(onChange).toHaveBeenCalledWith({ labels: 'all' })
    expect(screen.getByText('22 notas sin enlaces')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: /Notas huérfanas/ }))
    expect(onChange).toHaveBeenCalledWith({ showOrphans: false })
    fireEvent.click(screen.getByRole('switch', { name: /Zonas por carpeta/ }))
    expect(onChange).toHaveBeenCalledWith({ showFolders: false })
    fireEvent.change(screen.getByRole('slider', { name: /Distancia de enlace/ }), { target: { value: '80' } })
    expect(onChange).toHaveBeenCalledWith({ forces: { ...DEFAULT_GRAPH_FORCES, linkDistance: 80 } })
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer' }))
    expect(onChange).toHaveBeenCalledWith({ forces: DEFAULT_GRAPH_FORCES })
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar vista y filtros' }))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

describe('GraphPhoneOverlays', () => {
  it('leaves the local graph and frames the graph above the sheet', () => {
    const onExit = vi.fn()
    const onFit = vi.fn()
    render(<><GraphPhoneLocalChip onExit={onExit} /><GraphPhoneFitButton bottom={228} onFit={onFit} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }))
    expect(onExit).toHaveBeenCalled()
    const fit = screen.getByRole('button', { name: 'Encuadrar todo' })
    expect(fit.style.bottom).toBe('228px')
    fireEvent.click(fit)
    expect(onFit).toHaveBeenCalled()
  })
})
