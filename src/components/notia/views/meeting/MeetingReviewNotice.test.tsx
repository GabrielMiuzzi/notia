// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MeetingReviewNotice } from './MeetingReviewNotice'

describe('MeetingReviewNotice', () => {
  afterEach(cleanup)

  it('says which step of the review is running', () => {
    const { rerender } = render(<MeetingReviewNotice review={{ stage: 'cleanup', cleaned: false, named: 0 }} />)
    expect(screen.getByRole('status').textContent).toBe('La IA está ordenando la transcripción…')
    rerender(<MeetingReviewNotice review={{ stage: 'names', cleaned: true, named: 0 }} />)
    expect(screen.getByRole('status').textContent).toBe('La IA está buscando los nombres de los hablantes…')
  })

  it('says what the review did, or why it stopped', () => {
    const { rerender, container } = render(<MeetingReviewNotice review={{ cleaned: true, named: 2 }} />)
    expect(screen.getByRole('status').textContent).toBe('Transcripción ordenada con IA · 2 hablantes nombrados por la conversación')
    rerender(<MeetingReviewNotice review={{ cleaned: false, named: 0, error: 'Sin conexión.' }} />)
    expect(screen.getByRole('status').textContent).toBe('El repaso con IA no terminó: Sin conexión.')
    rerender(<MeetingReviewNotice review={{ cleaned: false, named: 0 }} />)
    expect(container.textContent).toBe('')
  })
})
