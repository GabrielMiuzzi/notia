import { RefreshCw } from 'lucide-react'
import { NotiaButton } from '../common/NotiaButton'
import {
  estimateColdPassBruteForceSeconds,
  formatColdPassBruteForceEstimate,
  type ColdPassPasswordOptions,
} from '../../services/coldpass/passwordGenerator'

interface ColdPassPasswordGeneratorPopoverProps {
  password: string
  options: ColdPassPasswordOptions
  onOptionsChange: (options: ColdPassPasswordOptions) => void
  onRefresh: () => void
  onUsePassword: () => void
}

export function ColdPassPasswordGeneratorPopover({
  password,
  options,
  onOptionsChange,
  onRefresh,
  onUsePassword,
}: ColdPassPasswordGeneratorPopoverProps) {
  const bruteForceEstimate = formatColdPassBruteForceEstimate(
    estimateColdPassBruteForceSeconds(options),
  )

  return (
    <div className="notia-coldpass-password-popover">
      <div className="notia-coldpass-password-popover-title">Generador de password</div>
      <label className="notia-coldpass-password-popover-field">
        <span>Largo: {options.length}</span>
        <input
          type="range"
          min={8}
          max={64}
          step={1}
          value={options.length}
          onChange={(event) => {
            onOptionsChange({
              ...options,
              length: Number(event.target.value),
            })
          }}
        />
      </label>
      <label className="notia-coldpass-password-popover-check">
        <input
          type="checkbox"
          checked={options.includeNumbers}
          onChange={(event) => {
            onOptionsChange({
              ...options,
              includeNumbers: event.target.checked,
            })
          }}
        />
        <span>Incluir numeros</span>
      </label>
      <label className="notia-coldpass-password-popover-check">
        <input
          type="checkbox"
          checked={options.includeSpecialCharacters}
          onChange={(event) => {
            onOptionsChange({
              ...options,
              includeSpecialCharacters: event.target.checked,
            })
          }}
        />
        <span>Incluir caracteres especiales</span>
      </label>
      <div className="notia-coldpass-password-popover-preview">
        <div className="notia-coldpass-password-popover-label">Preview</div>
        <div className="notia-coldpass-password-popover-value">{password}</div>
      </div>
      <div className="notia-coldpass-password-popover-meta">
        Fuerza bruta estimada: {bruteForceEstimate}
      </div>
      <div className="notia-coldpass-password-popover-actions">
        <NotiaButton type="button" variant="secondary" onClick={onRefresh}>
          <RefreshCw size={14} />
          <span>Refresh</span>
        </NotiaButton>
        <NotiaButton type="button" variant="primary" onClick={onUsePassword}>
          Usar contraseña
        </NotiaButton>
      </div>
    </div>
  )
}
