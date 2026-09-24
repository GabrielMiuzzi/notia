import type { CSSProperties, ReactNode } from 'react'
import { NotiaButton } from '../../common/NotiaButton'

export type SettingsTone = 'idle' | 'loading' | 'success' | 'error'

export function SettingsCard({ title, tone, children }: { title?: string; tone?: 'danger'; children: ReactNode }) {
  return (
    <section className="notia-settings-card" data-tone={tone}>
      {title ? <h3 className="notia-settings-card-title">{title}</h3> : null}
      {children}
    </section>
  )
}

interface SettingsRowProps {
  label: ReactNode
  description?: ReactNode
  /** Id of the control the label names. */
  htmlFor?: string
  badge?: ReactNode
  /** Heading row of a card (bigger label). */
  emphasis?: boolean
  /** Short controls (switches, values) stay beside the label on narrow screens. */
  inline?: boolean
  children?: ReactNode
}

export function SettingsRow({ label, description, htmlFor, badge, emphasis, inline, children }: SettingsRowProps) {
  return (
    <div className="notia-settings-row" data-emphasis={emphasis || undefined} data-inline={inline || undefined}>
      <div className="notia-settings-row-text">
        <div className="notia-settings-row-label">
          {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
          {badge}
        </div>
        {description ? <div className="notia-settings-row-description">{description}</div> : null}
      </div>
      {children ? <div className="notia-settings-row-control">{children}</div> : null}
    </div>
  )
}

interface SettingsSwitchProps {
  id?: string
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

export function SettingsSwitch({ id, label, checked, disabled, onChange }: SettingsSwitchProps) {
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className="notia-settings-toggle"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

interface SettingsRangeProps {
  id: string
  label: string
  min: number
  max: number
  step: number
  value: number
  valueLabel: string
  onChange: (value: number) => void
}

export function SettingsRange({ id, label, min, max, step, value, valueLabel, onChange }: SettingsRangeProps) {
  const percent = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0
  return (
    <>
      <input
        id={id}
        type="range"
        className="notia-settings-range"
        aria-label={label}
        aria-valuetext={valueLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--settings-range-fill': `${percent}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="notia-settings-value" htmlFor={id}>{valueLabel}</output>
    </>
  )
}

/** Status line at the bottom of a card, with its actions. */
export function SettingsFooter({ tone = 'idle', message, children }: { tone?: SettingsTone; message: ReactNode; children?: ReactNode }) {
  return (
    <div className="notia-settings-card-footer">
      <span className="notia-settings-dot" data-tone={tone} aria-hidden="true" />
      <span className="notia-settings-footer-message" role={tone === 'error' ? 'alert' : 'status'}>{message}</span>
      {children ? <div className="notia-settings-footer-actions">{children}</div> : null}
    </div>
  )
}

export function SettingsBadge({ tone, icon, children }: { tone?: 'accent'; icon?: ReactNode; children: ReactNode }) {
  return <span className="notia-settings-badge" data-tone={tone}>{icon}{children}</span>
}

interface SettingsChipProps {
  pressed: boolean
  disabled?: boolean
  color?: string
  label?: string
  onClick: () => void
  children: ReactNode
}

export function SettingsChip({ pressed, disabled, color, label, onClick, children }: SettingsChipProps) {
  return (
    <NotiaButton className="notia-settings-chip" aria-pressed={pressed} aria-label={label} disabled={disabled} onClick={onClick}>
      {color ? <span className="notia-settings-chip-dot" style={{ backgroundColor: color }} aria-hidden="true" /> : null}
      {children}
    </NotiaButton>
  )
}

const AVATAR_TONES = 5

export function SettingsAvatar({ name, index, small }: { name: string; index: number; small?: boolean }) {
  return (
    <span className="notia-settings-avatar" data-tone={index % AVATAR_TONES} data-small={small || undefined} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

export function SettingsStat({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="notia-settings-stat">
      <span>{label}</span>
      <strong data-mono={mono || undefined}>{value}</strong>
    </div>
  )
}

export function SettingsNotice({ tone, children }: { tone: SettingsTone; children: ReactNode }) {
  return <div className="notia-settings-notice" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>
}
