import { beforeEach, describe, expect, it, vi } from 'vitest'

const callBackend = vi.fn()
vi.mock('../transport', () => ({ callBackend: (...args: unknown[]) => callBackend(...args) }))

const { addInkStroke, eraseInk, loadInk, removeInkStrokes, restoreInkStrokes } = await import('./noteInkRuntime')
const { exportNoteDiagram } = await import('./noteDiagramExport')
const { loadNoteLinkPreview } = await import('./noteLinkPreviewRuntime')

const stroke = { id: 's1', tool: 'pen' as const, color: 'teal' as const, width: 4, page: null, points: [[1, 2, 0.5]] as Array<[number, number, number]> }

describe('noteInkRuntime', () => {
  beforeEach(() => callBackend.mockReset())

  it('loads the strokes of one mode of a note', async () => {
    callBackend.mockResolvedValue({ strokes: [stroke] })
    await expect(loadInk('lib', 'C:/lib/a.md', true)).resolves.toEqual([stroke])
    expect(callBackend).toHaveBeenCalledWith('markdown_ink_load', { payload: { libraryId: 'lib', path: 'C:/lib/a.md', paged: true } })
  })

  it('sends new strokes with the smoothing for Rust to apply', async () => {
    callBackend.mockResolvedValue(stroke)
    await addInkStroke('lib', 'a.md', { ...stroke, smoothing: 40 })
    expect(callBackend).toHaveBeenCalledWith('markdown_ink_add', { payload: { libraryId: 'lib', path: 'a.md', stroke: { ...stroke, smoothing: 40 } } })
  })

  it('erases, removes and restores through Rust', async () => {
    callBackend.mockResolvedValue({ strokes: [stroke] })
    await expect(eraseInk('lib', 'a.md', 0, [[1, 2]], 10)).resolves.toEqual([stroke])
    expect(callBackend).toHaveBeenLastCalledWith('markdown_ink_erase', { payload: { libraryId: 'lib', path: 'a.md', page: 0, points: [[1, 2]], radius: 10 } })
    await removeInkStrokes('lib', 'a.md', ['s1'])
    expect(callBackend).toHaveBeenLastCalledWith('markdown_ink_remove', { payload: { libraryId: 'lib', path: 'a.md', ids: ['s1'] } })
    await restoreInkStrokes('lib', 'a.md', [stroke])
    expect(callBackend).toHaveBeenLastCalledWith('markdown_ink_restore', { payload: { libraryId: 'lib', path: 'a.md', strokes: [stroke] } })
  })

  it('exports a diagram next to the note and reads link cards', async () => {
    callBackend.mockResolvedValue({ path: 'C:/lib/a - diagrama.svg' })
    await expect(exportNoteDiagram('lib', 'C:/lib/a.md', 'svg', '<svg></svg>')).resolves.toBe('C:/lib/a - diagrama.svg')
    expect(callBackend).toHaveBeenLastCalledWith('markdown_export_diagram', { payload: { libraryId: 'lib', path: 'C:/lib/a.md', format: 'svg', data: '<svg></svg>' } })
    await loadNoteLinkPreview('lib', 'C:/lib/b.md')
    expect(callBackend).toHaveBeenLastCalledWith('markdown_note_preview', { payload: { libraryId: 'lib', path: 'C:/lib/b.md' } })
  })
})
