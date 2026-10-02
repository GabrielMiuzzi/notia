import { FitIcon, LocalGraphIcon } from './graphPhoneIcons'

/** Floating chip while only the selected note and its connections are shown. */
export function GraphPhoneLocalChip({ onExit }: { onExit: () => void }) {
  return (
    <div className="notia-gv-phone-local" role="status">
      <span className="notia-gv-phone-local-icon"><LocalGraphIcon size={14} /></span>
      <span className="notia-gv-phone-local-text">Grafo local</span>
      <button type="button" className="notia-gv-phone-local-exit" onClick={onExit}>Salir</button>
    </div>
  )
}

/** Frames every visible note; it floats above the note sheet. */
export function GraphPhoneFitButton({ bottom, onFit }: { bottom: number; onFit: () => void }) {
  return (
    <button type="button" className="notia-gv-phone-fit" style={{ bottom }} aria-label="Encuadrar todo" onClick={onFit}>
      <FitIcon />
    </button>
  )
}
