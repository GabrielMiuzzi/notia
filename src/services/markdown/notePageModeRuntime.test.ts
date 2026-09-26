import { beforeEach, describe, expect, it, vi } from 'vitest'

const callBackend = vi.fn()
vi.mock('../transport', () => ({ callBackend: (...args: unknown[]) => callBackend(...args) }))

const { readNotePageMode, setNotePageMode } = await import('./notePageModeRuntime')

describe('notePageModeRuntime', () => {
  beforeEach(() => callBackend.mockReset())

  it('opens notes in the normal editor unless they ask for pages', () => {
    expect(readNotePageMode('# Nota\n')).toBe(false)
    expect(readNotePageMode('---\ncontexto: "#Personal"\n---\nHola\n')).toBe(false)
    expect(readNotePageMode('---\npageMode: false\n---\n')).toBe(false)
    expect(readNotePageMode('---\npageMode: true\n---\nHola\n')).toBe(true)
  })

  it('asks Rust to write the property into the note', async () => {
    callBackend.mockResolvedValue({ source: '---\npageMode: true\n---\nHola\n', pageMode: true })
    await expect(setNotePageMode('Hola\n', true)).resolves.toBe('---\npageMode: true\n---\nHola\n')
    expect(callBackend).toHaveBeenCalledWith('markdown_set_page_mode', { payload: { source: 'Hola\n', enabled: true } })
  })
})
