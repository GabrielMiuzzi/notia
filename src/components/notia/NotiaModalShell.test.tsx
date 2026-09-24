// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NotiaModalShell } from './NotiaModalShell'

describe('NotiaModalShell', () => {
  afterEach(cleanup)

  it('sizes the panel to its content unless the modal asks to fill the screen', () => {
    render(<NotiaModalShell open onClose={() => {}} size="sm"><p>Error</p></NotiaModalShell>)
    const panel = screen.getByRole('dialog')
    expect(panel.classList.contains('notia-modal-engine-panel--sm')).toBe(true)
    expect(panel.classList.contains('notia-modal-engine-panel--viewport')).toBe(false)
    cleanup()

    render(<NotiaModalShell open onClose={() => {}} size="xl" fill><p>Configuraciones</p></NotiaModalShell>)
    expect(screen.getByRole('dialog').classList.contains('notia-modal-engine-panel--viewport')).toBe(true)
  })
})
