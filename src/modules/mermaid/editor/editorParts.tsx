import type { ReactNode } from 'react'
import { MousePointer2, X } from 'lucide-react'

/* Small pieces shared by the panels of the Mermaid editor. */

export function Glyph({ d, width = 24, height = 12, strokeWidth = 1.75, dash }: { d: string; width?: number; height?: number; strokeWidth?: number; dash?: string }) {
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', strokeDasharray: dash }}>
      <path d={d} />
    </svg>
  )
}

export function PathIcon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', flexShrink: 0 }}>
      <path d={d} />
    </svg>
  )
}

export function InspectorHeader({ title, onClear }: { title: string; onClear?: () => void }) {
  return (
    <div className="mmd-inspector-head">
      <h2 className="mmd-eyebrow">{title}</h2>
      {onClear ? (
        <button type="button" className="mmd-icon-button" aria-label="Quitar selección" onClick={onClear}>
          <X size={13} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

export function Section({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mmd-section">
      {title ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 className="mmd-eyebrow" style={{ margin: 0 }}>{title}</h3>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="mmd-field">
      <span className="mmd-field-label">{label}</span>
      {children}
    </div>
  )
}

interface CommitInputProps {
  value: string
  label: string
  placeholder?: string
  onCommit: (value: string) => void
  className?: string
  mono?: boolean
}

/** A text input that sends its value when the person leaves it or presses Enter. */
export function CommitInput({ value, label, placeholder, onCommit, className = 'mmd-input', mono = false }: CommitInputProps) {
  return (
    <input
      key={value}
      className={className}
      style={mono ? { fontFamily: 'var(--mmd-mono)' } : undefined}
      defaultValue={value}
      aria-label={label}
      placeholder={placeholder}
      onBlur={(event) => {
        if (event.target.value !== value) onCommit(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        if (event.key === 'Escape') {
          ;(event.target as HTMLInputElement).value = value
          ;(event.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ id: T; name: string }>; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div className="mmd-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" aria-pressed={option.id === value} onClick={() => option.id !== value && onChange(option.id)}>
          {option.name}
        </button>
      ))}
    </div>
  )
}

export function Swatches({ swatches, value, onChange }: { swatches: Array<{ name: string; color: string }>; value: string | undefined; onChange: (color: string) => void }) {
  return (
    <div className="mmd-swatches">
      {swatches.map((swatch, index) => {
        const selected = value ? value.toUpperCase() === swatch.color.toUpperCase() : index === 0
        return (
          <button
            key={swatch.color}
            type="button"
            aria-label={swatch.name}
            title={swatch.name}
            aria-pressed={selected}
            style={{ background: swatch.color }}
            onClick={() => onChange(swatch.color)}
          />
        )
      })}
    </div>
  )
}

export function SyntaxBox({ text }: { text: string }) {
  return <div className="mmd-syntax" aria-label="Sintaxis">{text}</div>
}

export function EmptyInspector({ text, counts }: { text: string; counts: Array<{ label: string; value: number }> }) {
  return (
    <section className="mmd-section" style={{ gap: 22, padding: '28px 22px' }}>
      <div className="mmd-empty-state">
        <span className="mmd-title-badge" style={{ width: 44, height: 44, borderRadius: 12, color: 'var(--color-muted-text)' }}>
          <MousePointer2 size={20} aria-hidden="true" />
        </span>
        <strong>Nada seleccionado</strong>
        <span>{text}</span>
      </div>
      <div className="mmd-stat-cards">
        {counts.map((count) => (
          <div key={count.label}>
            <strong>{count.value}</strong>
            <span>{count.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
