import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'

/**
 * Lo escrito y todavía no mandado también se manda si la pantalla se va (otra
 * pantalla, otra pestaña) o la app pasa a segundo plano: Android puede
 * cerrarla ahí sin que el campo pierda el foco.
 */
function useCommitOnLeave(draft: string, value: string, onCommit: (value: string) => void) {
  const latest = useRef({ draft, value, onCommit })
  useEffect(() => {
    latest.current = { draft, value, onCommit }
  })
  useEffect(() => {
    const flush = () => {
      const { draft, value, onCommit } = latest.current
      if (draft === value) return
      latest.current = { ...latest.current, value: draft }
      onCommit(draft)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])
}

interface CommitInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string
  onCommit: (value: string) => void
}

/**
 * Un campo que manda su valor a Rust al salir de él o con Enter: lo que se
 * escribe mientras tanto es solo de pantalla.
 */
export function CommitInput({ value, onCommit, onBlur, onKeyDown, ...rest }: CommitInputProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  useCommitOnLeave(draft, value, onCommit)
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      {...rest}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        commit()
        onBlur?.(event)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setDraft(value)
        onKeyDown?.(event)
      }}
    />
  )
}

interface CommitTextAreaProps {
  value: string
  onCommit: (value: string) => void
  label: string
  placeholder?: string
}

export function CommitTextArea({ value, onCommit, label, placeholder }: CommitTextAreaProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  useCommitOnLeave(draft, value, onCommit)
  return (
    <textarea
      className="gym-textarea"
      aria-label={label}
      rows={2}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
    />
  )
}
