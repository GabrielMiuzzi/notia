import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, ChevronDown, Clock, Eye, EyeOff, RefreshCw, Sparkles, X } from 'lucide-react'
import { NotiaModalShell } from './NotiaModalShell'
import type { ColdPassEntry } from '../../types/coldpass'
import { generateColdPassPassword, rateColdPassPassword } from '../../services/coldpass/coldpassStorage'
import type { ColdPassPasswordOptions, ColdPassPasswordRating } from '../../services/coldpass/passwordGenerator'
import { formatAgo, formatChanged } from './views/coldpass/coldPassFormat'
import './views/coldpass/coldpassEditor.css'

interface ColdPassCredentialModalProps {
  open: boolean
  mode?: 'create' | 'edit'
  initialEntry?: ColdPassEntry | null
  /** Brings the password generator into view at once («Generar nueva»). */
  openGenerator?: boolean
  isSubmitting?: boolean
  errorMessage?: string | null
  onSubmit: (entry: ColdPassEntry) => void
  onClose: () => void
}

const EMPTY_ENTRY: ColdPassEntry = {
  id: '',
  name: '',
  website: '',
  username: '',
  secondaryUsername: '',
  password: '',
  notes: '',
  passwordHistory: [],
}

/** The fields the form edits; the rest belongs to the backend. */
const EDITED_FIELDS = ['name', 'website', 'username', 'secondaryUsername', 'password', 'notes'] as const

const DEFAULT_PASSWORD_OPTIONS: ColdPassPasswordOptions = {
  length: 20,
  includeUppercase: true,
  includeNumbers: true,
  includeSpecialCharacters: true,
  avoidAmbiguous: true,
}

type OptionKey = 'includeUppercase' | 'includeNumbers' | 'includeSpecialCharacters' | 'avoidAmbiguous'

const GENERATOR_OPTIONS: { key: OptionKey; label: string; sample: string }[] = [
  { key: 'includeUppercase', label: 'Mayúsculas', sample: 'A B C' },
  { key: 'includeNumbers', label: 'Números', sample: '1 2 3' },
  { key: 'includeSpecialCharacters', label: 'Símbolos', sample: '! # % ?' },
  { key: 'avoidAmbiguous', label: 'Sin ambiguos', sample: 'evita 0 O l 1' },
]

const NOTES_MAX = 500
const RATE_DELAY_MS = 120
const TOAST_MS = 2400
const ICON = { size: 18, strokeWidth: 1.75 } as const

export function ColdPassCredentialModal({
  open,
  mode = 'create',
  initialEntry = null,
  openGenerator = false,
  isSubmitting = false,
  errorMessage,
  onSubmit,
  onClose,
}: ColdPassCredentialModalProps) {
  const original = initialEntry ?? EMPTY_ENTRY
  const [draft, setDraft] = useState<ColdPassEntry>(EMPTY_ENTRY)
  const [touched, setTouched] = useState(false)
  const [isRevealed, setIsRevealed] = useState(false)
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(true)
  const [options, setOptions] = useState<ColdPassPasswordOptions>(DEFAULT_PASSWORD_OPTIONS)
  const [generated, setGenerated] = useState<{ password: string; rating: ColdPassPasswordRating | null }>({ password: '', rating: null })
  const [rating, setRating] = useState<ColdPassPasswordRating | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)
  const generatorRef = useRef<HTMLDivElement | null>(null)
  // Only the latest backend answer is shown.
  const generationRef = useRef(0)
  const ratingRef = useRef(0)
  // «Cambiada hace…» is relative to when the form opened.
  const [now, setNow] = useState(() => Date.now())

  const regenerate = useCallback((next: ColdPassPasswordOptions) => {
    const request = ++generationRef.current
    void generateColdPassPassword(next)
      .then((result) => { if (request === generationRef.current) setGenerated({ password: result.password, rating: result.rating }) })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    window.clearTimeout(toastTimer.current)
    setToast('')
    if (!open) return
    setDraft(initialEntry ?? EMPTY_ENTRY)
    setTouched(false)
    setIsRevealed(false)
    setIsGeneratorOpen(true)
    setOptions(DEFAULT_PASSWORD_OPTIONS)
    setRating(null)
    setNow(Date.now())
  }, [initialEntry, open])

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  useEffect(() => {
    if (open) regenerate(options)
  }, [open, options, regenerate])

  useEffect(() => {
    if (open && openGenerator) generatorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open, openGenerator])

  const { password, name, website, username } = draft
  useEffect(() => {
    if (!open) return undefined
    const request = ++ratingRef.current
    const timer = window.setTimeout(() => {
      void rateColdPassPassword({ password, name, website, username })
        .then((next) => { if (request === ratingRef.current) setRating(next) })
        .catch(() => undefined)
    }, RATE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [open, password, name, website, username])

  if (!open) {
    return null
  }

  const flash = (message: string) => {
    window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(''), TOAST_MS)
  }

  const setField = (field: (typeof EDITED_FIELDS)[number], value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setTouched(true)
  }

  const isEdit = mode === 'edit'
  const isDirty = EDITED_FIELDS.some((field) => draft[field] !== original[field])
  const passwordChanged = isEdit && draft.password !== original.password
  const nameInvalid = touched && draft.name.trim() === ''
  const canSave = (isEdit ? isDirty : true) && draft.name.trim() !== '' && draft.password.length > 0 && !isSubmitting
  const title = isEdit ? 'Editar credencial' : 'Nueva credencial'
  const initial = (draft.name.trim() || '?').charAt(0).toUpperCase()
  const headerSub = (draft.website.trim() || 'Sin sitio') + (draft.username.trim() ? `  ·  ${draft.username.trim()}` : '')
  const level = rating?.level ?? 0
  const statusLabel = isDirty ? 'Cambios sin guardar' : isEdit ? formatChanged(original.passwordChangedAt, now) : ''
  const changedAt = original.passwordChangedAt

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSave) {
      setTouched(true)
      return
    }
    onSubmit({
      id: draft.id,
      name: draft.name.trim(),
      website: draft.website.trim(),
      username: draft.username.trim(),
      secondaryUsername: draft.secondaryUsername.trim(),
      password: draft.password,
      notes: draft.notes.trim(),
      passwordHistory: draft.passwordHistory,
    })
  }

  const applyGenerated = () => {
    if (!generated.password) return
    setDraft((current) => ({ ...current, password: generated.password }))
    setIsRevealed(true)
    setIsGeneratorOpen(false)
    setTouched(true)
    flash('Contraseña generada aplicada. Guardá para confirmar.')
  }

  return (
    <NotiaModalShell open={open} onClose={onClose} size="md" panelClassName="cpe">
      <form className="cpe-form" onSubmit={handleSubmit} aria-labelledby="cpe-title" noValidate>
        <header className="cpe-head">
          <span className="cpe-tile" aria-hidden="true">{initial}</span>
          <div className="cpe-head__text">
            <h2 id="cpe-title">{title}</h2>
            <span>{headerSub}</span>
          </div>
          <button type="button" className="cpe-icon" aria-label="Cerrar" onClick={onClose}>
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>

        <header className="cpe-phone-head">
          <button type="button" className="cpe-text-btn" onClick={onClose}>Cancelar</button>
          <h1>{title}</h1>
          <button type="submit" className="cpe-text-btn cpe-text-btn--save" disabled={!canSave}>
            {isSubmitting ? 'Guardando…' : 'Guardar'}
          </button>
        </header>

        {isDirty ? (
          <div className="cpe-phone-dirty" role="status">
            <span className="cpe-dot" aria-hidden="true" />
            Cambios sin guardar
          </div>
        ) : null}

        <div className="cpe-body">
          <section className="cpe-fields" aria-label="Datos de acceso">
            <label className="cpe-field">
              <span className="cpe-label">Nombre</span>
              <input
                className="cpe-input"
                value={draft.name}
                placeholder="Ej. Google personal"
                aria-invalid={nameInvalid}
                autoFocus={!isEdit}
                onChange={(event) => setField('name', event.target.value)}
              />
              {nameInvalid ? <span className="cpe-field__error">Poné un nombre para encontrarla después.</span> : null}
            </label>
            <label className="cpe-field">
              <span className="cpe-label">Sitio web</span>
              <input
                className="cpe-input"
                value={draft.website}
                placeholder="ejemplo.com"
                inputMode="url"
                autoCapitalize="off"
                onChange={(event) => setField('website', event.target.value)}
              />
            </label>
            <label className="cpe-field">
              <span className="cpe-label">Usuario</span>
              <input
                className="cpe-input"
                value={draft.username}
                placeholder="Usuario o email"
                autoComplete="off"
                autoCapitalize="off"
                onChange={(event) => setField('username', event.target.value)}
              />
            </label>
            <label className="cpe-field">
              <span className="cpe-label">Usuario secundario <span className="cpe-optional">(opcional)</span></span>
              <input
                className="cpe-input"
                value={draft.secondaryUsername}
                placeholder="ID de cuenta, DNI, alias…"
                autoComplete="off"
                autoCapitalize="off"
                onChange={(event) => setField('secondaryUsername', event.target.value)}
              />
            </label>
          </section>

          <section className="cpe-card" aria-label="Contraseña">
            <div className="cpe-card__main">
              <div className="cpe-pw-head">
                <label htmlFor="cpe-password" className="cpe-label">Contraseña</label>
                {passwordChanged ? (
                  <button type="button" className="cpe-small-btn" onClick={() => setField('password', original.password)}>
                    <span className="cpe-desktop-only">Deshacer cambio</span>
                    <span className="cpe-phone-only">Deshacer</span>
                  </button>
                ) : null}
              </div>
              <div className="cpe-pw-field">
                <input
                  id="cpe-password"
                  className="cpe-mono"
                  type={isRevealed ? 'text' : 'password'}
                  value={draft.password}
                  autoComplete="new-password"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(event) => setField('password', event.target.value)}
                />
                <button
                  type="button"
                  className="cpe-icon"
                  aria-label={isRevealed ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  onClick={() => setIsRevealed((current) => !current)}
                >
                  {isRevealed ? <EyeOff {...ICON} aria-hidden="true" /> : <Eye {...ICON} aria-hidden="true" />}
                </button>
              </div>
              <div className="cpe-strength" data-level={level}>
                <div className="cpe-meter" aria-hidden="true">
                  {[1, 2, 3, 4].map((step) => <span key={step} data-on={step <= level} />)}
                </div>
                {rating ? (
                  <p className="cpe-strength__text">
                    <span className="cpe-strength__label">{rating.label}</span>
                    <span className="cpe-phone-only">, </span>
                    <span className="cpe-strength__hint">{rating.hint}</span>
                  </p>
                ) : null}
              </div>
              {passwordChanged && original.password ? (
                <p className="cpe-history-note">
                  <Clock size={16} strokeWidth={1.75} aria-hidden="true" />
                  Al guardar, la contraseña actual pasa al historial.
                </p>
              ) : null}
            </div>

            <button
              type="button"
              className="cpe-gen-toggle"
              aria-expanded={isGeneratorOpen}
              aria-controls="cpe-generator"
              onClick={() => setIsGeneratorOpen((current) => !current)}
            >
              <Sparkles {...ICON} className="cpe-teal" aria-hidden="true" />
              <span>Generar contraseña segura</span>
              <ChevronDown size={16} strokeWidth={2} className="cpe-chevron" data-open={isGeneratorOpen} aria-hidden="true" />
            </button>

            {isGeneratorOpen ? (
              <div id="cpe-generator" ref={generatorRef} className="cpe-gen">
                <div className="cpe-gen__preview">
                  <span className="cpe-mono" aria-live="polite">{generated.password}</span>
                  <button type="button" className="cpe-icon" aria-label="Generar otra" title="Generar otra" onClick={() => regenerate(options)}>
                    <RefreshCw {...ICON} aria-hidden="true" />
                  </button>
                </div>
                <div className="cpe-gen__length">
                  <div className="cpe-gen__length-head">
                    <label htmlFor="cpe-length" className="cpe-label">Largo</label>
                    <span>{options.length} caracteres</span>
                  </div>
                  <input
                    id="cpe-length"
                    type="range"
                    min={8}
                    max={64}
                    step={1}
                    value={options.length}
                    onChange={(event) => setOptions((current) => ({ ...current, length: Number(event.target.value) }))}
                  />
                </div>
                <div className="cpe-gen__options">
                  {GENERATOR_OPTIONS.map((option) => (
                    <label key={option.key} className="cpe-option" data-on={options[option.key]}>
                      <input
                        type="checkbox"
                        checked={options[option.key]}
                        onChange={(event) => setOptions((current) => ({ ...current, [option.key]: event.target.checked }))}
                      />
                      <span className="cpe-option__text">
                        <span>{option.label}</span>
                        <span className="cpe-mono">{option.sample}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="cpe-gen__foot">
                  <span>{generated.rating ? `${generated.rating.label}, ${generated.rating.hint}.` : ''}</span>
                  <button type="button" className="cpe-btn cpe-btn--primary" disabled={!generated.password} onClick={applyGenerated}>
                    <Check size={16} strokeWidth={2.25} aria-hidden="true" />
                    Usar esta contraseña
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <label className="cpe-field">
            <span className="cpe-notes-head">
              <span className="cpe-label">Notas <span className="cpe-optional">(opcional)</span></span>
              <span className="cpe-count">{draft.notes.length} / {NOTES_MAX}</span>
            </span>
            <textarea
              className="cpe-input cpe-textarea"
              value={draft.notes}
              maxLength={NOTES_MAX}
              rows={3}
              placeholder="Preguntas de seguridad, códigos de recuperación, para qué es esta cuenta…"
              onChange={(event) => setField('notes', event.target.value)}
            />
          </label>

          {errorMessage ? <div className="cpe-error" role="alert">{errorMessage}</div> : null}

          {isEdit && typeof changedAt === 'number' ? (
            <p className="cpe-phone-only cpe-changed">Última modificación: {formatAgo(changedAt, now)}</p>
          ) : null}
        </div>

        <footer className="cpe-foot">
          <span className="cpe-status" data-dirty={isDirty}>
            {isDirty ? <span className="cpe-dot" aria-hidden="true" /> : null}
            {statusLabel}
          </span>
          <button type="button" className="cpe-btn cpe-btn--ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="cpe-btn cpe-btn--primary" disabled={!canSave}>
            {isSubmitting ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Guardar credencial'}
          </button>
        </footer>

        {toast ? (
          <div className="cpe-toast" role="status">
            <Check size={18} strokeWidth={2} aria-hidden="true" />
            {toast}
          </div>
        ) : null}
      </form>
    </NotiaModalShell>
  )
}
