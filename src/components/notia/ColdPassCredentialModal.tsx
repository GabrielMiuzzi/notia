import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Copy, Eye, EyeOff, X } from 'lucide-react'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaSubmenuPanel } from './NotiaSubmenuPanel'
import { NotiaButton } from '../common/NotiaButton'
import type { ColdPassEntry } from '../../types/coldpass'
import { useSubmenuEngine } from '../../hooks/useSubmenuEngine'
import { ColdPassPasswordGeneratorPopover } from './ColdPassPasswordGeneratorPopover'
import {
  generateColdPassPassword,
  type ColdPassPasswordOptions,
} from '../../services/coldpass/passwordGenerator'

interface ColdPassCredentialModalProps {
  open: boolean
  mode?: 'create' | 'edit'
  initialEntry?: ColdPassEntry | null
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

const DEFAULT_PASSWORD_OPTIONS: ColdPassPasswordOptions = {
  length: 16,
  includeNumbers: true,
  includeSpecialCharacters: true,
}

interface CredentialInputFieldProps {
  label: string
  value: string
  autoFocus?: boolean
  type?: 'text' | 'password'
  className?: string
  copied: boolean
  copyTitle: string
  actionClassName?: string
  trailingAction?: ReactNode
  onCopy: () => void
  onChange: (value: string) => void
}

function CredentialInputField({
  label,
  value,
  autoFocus = false,
  type = 'text',
  className,
  copied,
  copyTitle,
  actionClassName,
  trailingAction,
  onCopy,
  onChange,
}: CredentialInputFieldProps) {
  return (
    <label className={`notia-coldpass-credential-field ${className ?? ''}`.trim()}>
      <span>{label}</span>
      <div className="notia-coldpass-credential-input-field">
        <input
          autoFocus={autoFocus}
          className={`notia-settings-input notia-coldpass-credential-input ${
            trailingAction ? 'notia-coldpass-credential-input--with-trailing-action' : ''
          }`.trim()}
          type={type}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
        <div className={`notia-coldpass-credential-input-actions ${actionClassName ?? ''}`.trim()}>
          <NotiaButton
            type="button"
            size="icon"
            variant="ghost"
            className="notia-coldpass-credential-input-action"
            title={copyTitle}
            onClick={onCopy}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </NotiaButton>
          {trailingAction}
        </div>
      </div>
    </label>
  )
}

export function ColdPassCredentialModal({
  open,
  mode = 'create',
  initialEntry = null,
  isSubmitting = false,
  errorMessage,
  onSubmit,
  onClose,
}: ColdPassCredentialModalProps) {
  const [draft, setDraft] = useState<ColdPassEntry>(EMPTY_ENTRY)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [isPasswordGeneratorOpen, setIsPasswordGeneratorOpen] = useState(false)
  const [passwordOptions, setPasswordOptions] = useState<ColdPassPasswordOptions>(DEFAULT_PASSWORD_OPTIONS)
  const [generatedPassword, setGeneratedPassword] = useState(() => generateColdPassPassword(DEFAULT_PASSWORD_OPTIONS))
  const { triggerRef: passwordGeneratorTriggerRef, panelRef: passwordGeneratorPanelRef } = useSubmenuEngine<
    HTMLButtonElement,
    HTMLDivElement
  >({
    open: isPasswordGeneratorOpen,
    onClose: () => {
      setIsPasswordGeneratorOpen(false)
    },
  })

  useEffect(() => {
    if (!open) {
      setIsPasswordVisible(false)
      setCopiedField(null)
      setIsPasswordGeneratorOpen(false)
      setPasswordOptions(DEFAULT_PASSWORD_OPTIONS)
      setGeneratedPassword(generateColdPassPassword(DEFAULT_PASSWORD_OPTIONS))
      return
    }

    setDraft(initialEntry ?? EMPTY_ENTRY)
    setIsPasswordVisible(false)
    setCopiedField(null)
    setIsPasswordGeneratorOpen(false)
  }, [initialEntry, open])

  useEffect(() => {
    setGeneratedPassword(generateColdPassPassword(passwordOptions))
  }, [passwordOptions])

  if (!open) {
    return null
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
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

  const handleCopyField = async (fieldId: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopiedField(fieldId)
    window.setTimeout(() => {
      setCopiedField((current) => (current === fieldId ? null : current))
    }, 1200)
  }

  return (
    <NotiaModalShell open={open} onClose={onClose} size="md" panelClassName="notia-coldpass-credential-modal">
      <form className="notia-coldpass-credential-form" onSubmit={handleSubmit}>
        <div className="notia-coldpass-credential-header">
          <h2>{mode === 'edit' ? 'Editar credencial' : 'Nueva credencial'}</h2>
          <NotiaButton size="icon" variant="ghost" className="notia-settings-close" title="Cerrar" onClick={onClose}>
            <X size={16} />
          </NotiaButton>
        </div>
        <div className="notia-coldpass-credential-body">
          <div className="notia-coldpass-credential-grid">
            <CredentialInputField
              label="name"
              value={draft.name}
              autoFocus
              copied={copiedField === 'name'}
              copyTitle="Copiar name"
              onCopy={() => {
                void handleCopyField('name', draft.name)
              }}
              onChange={(value) => {
                setDraft((current) => ({ ...current, name: value }))
              }}
            />
            <CredentialInputField
              label="website"
              value={draft.website}
              copied={copiedField === 'website'}
              copyTitle="Copiar website"
              onCopy={() => {
                void handleCopyField('website', draft.website)
              }}
              onChange={(value) => {
                setDraft((current) => ({ ...current, website: value }))
              }}
            />
            <CredentialInputField
              label="username"
              value={draft.username}
              copied={copiedField === 'username'}
              copyTitle="Copiar username"
              onCopy={() => {
                void handleCopyField('username', draft.username)
              }}
              onChange={(value) => {
                setDraft((current) => ({ ...current, username: value }))
              }}
            />
            <CredentialInputField
              label="secondary_username"
              value={draft.secondaryUsername}
              copied={copiedField === 'secondaryUsername'}
              copyTitle="Copiar secondary username"
              onCopy={() => {
                void handleCopyField('secondaryUsername', draft.secondaryUsername)
              }}
              onChange={(value) => {
                setDraft((current) => ({ ...current, secondaryUsername: value }))
              }}
            />
            <div className="notia-coldpass-credential-password-block">
              <CredentialInputField
                label="password"
                className="notia-coldpass-credential-field--full"
                value={draft.password}
                type={isPasswordVisible ? 'text' : 'password'}
                copied={copiedField === 'password'}
                copyTitle="Copiar password"
                actionClassName="notia-coldpass-credential-input-actions--password"
                trailingAction={
                  <NotiaButton
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="notia-coldpass-credential-input-action"
                    title={isPasswordVisible ? 'Ocultar password' : 'Mostrar password'}
                    onClick={() => {
                      setIsPasswordVisible((current) => !current)
                    }}
                  >
                    {isPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </NotiaButton>
                }
                onCopy={() => {
                  void handleCopyField('password', draft.password)
                }}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, password: value }))
                }}
              />
              <div className="notia-coldpass-credential-password-tools">
                <div className="notia-coldpass-password-popover-wrap">
                  <NotiaButton
                    ref={passwordGeneratorTriggerRef}
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setIsPasswordGeneratorOpen((current) => !current)
                    }}
                  >
                    Generar password
                  </NotiaButton>
                </div>
              </div>
              {isPasswordGeneratorOpen ? (
                <NotiaSubmenuPanel ref={passwordGeneratorPanelRef} className="notia-coldpass-password-popover-panel">
                  <ColdPassPasswordGeneratorPopover
                    password={generatedPassword}
                    options={passwordOptions}
                    onOptionsChange={setPasswordOptions}
                    onRefresh={() => {
                      setGeneratedPassword(generateColdPassPassword(passwordOptions))
                    }}
                    onUsePassword={() => {
                      setDraft((current) => ({ ...current, password: generatedPassword }))
                      setIsPasswordGeneratorOpen(false)
                    }}
                  />
                </NotiaSubmenuPanel>
              ) : null}
            </div>
            <label className="notia-coldpass-credential-field notia-coldpass-credential-field--full">
              <span>notes</span>
              <textarea
                className="notia-settings-input notia-coldpass-credential-textarea"
                value={draft.notes}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, notes: event.target.value }))
                }}
                rows={5}
              />
            </label>
          </div>
          {errorMessage ? (
            <div className="notia-coldpass-credential-error">{errorMessage}</div>
          ) : null}
        </div>
        <div className="notia-coldpass-credential-actions">
          <NotiaButton variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </NotiaButton>
          <NotiaButton variant="primary" type="submit" disabled={!draft.name.trim() || isSubmitting}>
            {isSubmitting ? 'Guardando...' : mode === 'edit' ? 'Guardar cambios' : 'Guardar credencial'}
          </NotiaButton>
        </div>
      </form>
    </NotiaModalShell>
  )
}
