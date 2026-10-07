// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { applyMermaidEdit, readMermaidModel } from './mermaidEditorService'
import { useMermaidDocument } from './useMermaidDocument'
import type { MermaidModel } from './mermaidEditorTypes'

vi.mock('./mermaidEditorService', () => ({
  readMermaidModel: vi.fn(),
  applyMermaidEdit: vi.fn(),
}))

const read = vi.mocked(readMermaidModel)
const apply = vi.mocked(applyMermaidEdit)
const model = { kind: 'empty' } as MermaidModel

afterEach(() => {
  read.mockReset()
  apply.mockReset()
})

describe('useMermaidDocument', () => {
  it('applies the edits of the backend, selects what they create and undoes them', async () => {
    read.mockResolvedValue(model)
    apply.mockResolvedValue({ source: 'flowchart TD\n  n1["Nodo"]\n', model, selection: { kind: 'node', key: 'n1' } })
    const persist = vi.fn(async () => undefined)
    const { result } = renderHook(() => useMermaidDocument('flowchart TD\n', persist))
    await waitFor(() => expect(result.current.model).toEqual(model))

    await act(async () => {
      await result.current.edit({ diagram: 'flowchart', op: 'addNode', shape: 'rect' } as never)
    })
    expect(apply).toHaveBeenCalledWith('flowchart TD\n', { diagram: 'flowchart', op: 'addNode', shape: 'rect' })
    expect(result.current.code).toBe('flowchart TD\n  n1["Nodo"]\n')
    expect(result.current.selection).toEqual({ kind: 'node', key: 'n1' })
    expect(result.current.saved).toBe(false)

    act(() => result.current.undo())
    expect(result.current.code).toBe('flowchart TD\n')
    expect(result.current.canRedo).toBe(true)
    act(() => result.current.redo())
    expect(result.current.code).toBe('flowchart TD\n  n1["Nodo"]\n')
    await waitFor(() => expect(persist).toHaveBeenCalledWith('flowchart TD\n  n1["Nodo"]\n'))
    expect(result.current.saved).toBe(true)
  })

  it('keeps the source and shows the error when the backend rejects an edit', async () => {
    read.mockResolvedValue(model)
    apply.mockRejectedValue(new Error('El nodo no existe.'))
    const { result } = renderHook(() => useMermaidDocument('flowchart TD\n', async () => undefined))
    let applied = true
    await act(async () => {
      applied = await result.current.edit({ diagram: 'flowchart', op: 'deleteNode', id: 'x' } as never)
    })
    expect(applied).toBe(false)
    expect(result.current.code).toBe('flowchart TD\n')
    expect(result.current.error).toBe('El nodo no existe.')
    expect(result.current.canUndo).toBe(false)
  })

  it('saves pending typing when the editor closes', async () => {
    read.mockResolvedValue(model)
    const persist = vi.fn(async () => undefined)
    const { result, unmount } = renderHook(() => useMermaidDocument('flowchart TD\n', persist))
    act(() => result.current.setCode('flowchart LR\n'))
    unmount()
    expect(persist).toHaveBeenCalledWith('flowchart LR\n')
  })
})
