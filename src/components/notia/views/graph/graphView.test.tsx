// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { convexHull, nodeRadius, withAlpha } from './graphCanvas'
import { GraphInspector } from './GraphInspector'
import { GraphDock } from './GraphDock'
import { DEFAULT_GRAPH_FORCES, type GraphPreferences } from './useGraphPreferences'
import type { LibraryGraphNode, LibraryGraphSummary } from '../../../../types/graph/libraryGraph'

const node = (path: string, label: string, degree: number, neighbors: string[] = [], contextTag?: string): LibraryGraphNode => ({
  id: path, path, label, degree, neighbors, folder: 'notas', contextTag, contextColor: contextTag ? '#6C8EFF' : undefined,
})

const hub = node('notas/hub.md', 'Hub', 2, ['notas/a.md', 'notas/b.md'], '#Laboral')
const a = node('notas/a.md', 'Alfa', 1, ['notas/hub.md'])
const b = node('notas/b.md', 'Beta', 1, ['notas/hub.md'])
const nodeByPath = new Map([hub, a, b].map((entry) => [entry.path, entry]))
const summary: LibraryGraphSummary = {
  notes: 3, links: 2, orphans: 0,
  contexts: [{ tag: null, color: null, count: 2 }, { tag: '#Laboral', color: '#6C8EFF', count: 1 }],
  topConnected: ['notas/hub.md'],
}
const lookOf = (entry: LibraryGraphNode) => ({ name: entry.contextTag?.replace('#', '') ?? 'Sin contexto', color: entry.contextColor ?? '#888' })

describe('graph canvas geometry', () => {
  it('wraps points in their convex hull and sizes nodes by their links', () => {
    const hull = convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]])
    expect(hull).toHaveLength(4)
    expect(hull).not.toContainEqual([1, 1])
    expect(nodeRadius(0)).toBe(3.5)
    expect(nodeRadius(100)).toBe(12)
    expect(withAlpha('#0f1420', 0.5)).toBe('rgba(15, 20, 32, 0.5)')
    expect(withAlpha('#abc', 1)).toBe('rgba(170, 187, 204, 1)')
  })
})

describe('GraphInspector', () => {
  afterEach(cleanup)

  it('summarizes the library and picks a connected note', () => {
    const onPick = vi.fn()
    render(
      <GraphInspector
        libraryName="gaia" selected={null} nodeByPath={nodeByPath} summary={summary} lookOf={lookOf}
        contextLooks={[{ name: 'Sin contexto', color: '#888', count: 2 }, { name: 'Laboral', color: '#6C8EFF', count: 1 }]}
        isLocal={false} onToggleLocal={vi.fn()} onClose={vi.fn()} onOpen={vi.fn()} onPick={onPick} chat={null}
      />,
    )
    expect(screen.getByText('Resumen de gaia')).toBeTruthy()
    expect(screen.getByText('huérfanas')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Hub/ }))
    expect(onPick).toHaveBeenCalledWith('notas/hub.md')
  })

  it('shows the selected note, opens it, adds it to the chat and lists its connections', () => {
    const onOpen = vi.fn()
    const onToggle = vi.fn()
    const onToggleLocal = vi.fn()
    render(
      <GraphInspector
        libraryName="gaia" selected={hub} nodeByPath={nodeByPath} summary={summary} lookOf={lookOf} contextLooks={[]}
        isLocal={false} onToggleLocal={onToggleLocal} onClose={vi.fn()} onOpen={onOpen} onPick={vi.fn()}
        chat={{ isIncluded: false, onToggle }}
      />,
    )
    expect(screen.getByText('gaia / notas')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Abrir nota/ }))
    expect(onOpen).toHaveBeenCalledWith('notas/hub.md')
    fireEvent.click(screen.getByRole('button', { name: /Sumar al chat/ }))
    expect(onToggle).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Ver grafo local/ }))
    expect(onToggleLocal).toHaveBeenCalled()
    const labels = screen.getAllByRole('button').map((button) => button.textContent)
    expect(labels.filter((label) => label?.includes('Alfa') || label?.includes('Beta'))).toHaveLength(2)
  })
})

describe('GraphDock', () => {
  afterEach(cleanup)

  it('zooms, switches names, orphans and folders and tunes the forces', () => {
    const onChange = vi.fn()
    const onZoomIn = vi.fn()
    const preferences: GraphPreferences = { labels: 'auto', showOrphans: true, showFolders: true, forces: DEFAULT_GRAPH_FORCES }
    render(
      <GraphDock zoomPercent={100} onZoomIn={onZoomIn} onZoomOut={vi.fn()} onZoomReset={vi.fn()} onFit={vi.fn()} preferences={preferences} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Acercar' }))
    expect(onZoomIn).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(onChange).toHaveBeenCalledWith({ labels: 'all' })
    fireEvent.click(screen.getByRole('switch', { name: 'Huérfanas' }))
    expect(onChange).toHaveBeenCalledWith({ showOrphans: false })
    fireEvent.click(screen.getByRole('button', { name: /Fuerzas/ }))
    const forces = screen.getByRole('group', { name: 'Fuerzas del grafo' })
    fireEvent.change(within(forces).getByRole('slider', { name: /Repulsión/ }), { target: { value: '200' } })
    expect(onChange).toHaveBeenCalledWith({ forces: { ...DEFAULT_GRAPH_FORCES, repulsion: 200 } })
  })
})
