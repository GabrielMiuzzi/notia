import { useEffect, useState, type InputHTMLAttributes } from 'react'

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
