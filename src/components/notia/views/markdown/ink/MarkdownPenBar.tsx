import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { PenColor, PenPreferences, PenSideButton } from '../../../../../services/preferences/editorPreferences'
import { INK_COLOR_TOKENS } from './inkPaths'
import type { PenBarTool } from './InkLayer'

/*
 * «Herramientas de lápiz», as in the design canvas: the tool (selector,
 * lasso, pen, highlighter, eraser), the ink color, the tip, undo and redo of
 * strokes, and «Opciones» with the pen's hardware settings. The tool lives
 * in the bar; the rest are device preferences saved by the backend.
 */

interface MarkdownPenBarProps {
  tool: PenBarTool
  onToolChange: (tool: PenBarTool) => void
  /** `null` while the device preferences load. */
  pen: PenPreferences | null
  onPenChange: (patch: Partial<PenPreferences>) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  error: string | null
}

const icon = (path: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
)

const TOOLS: Array<{ id: PenBarTool; label: string; icon: ReactNode }> = [
  { id: 'selector', label: 'Selector', icon: icon(<path d="M3.5 2.5l9.5 4.6-4.2 1.3-1.9 4.3z" />) },
  { id: 'lasso', label: 'Lazo', icon: icon(<><path d="M8 11.5c3.3 0 6-1.8 6-4.2S11.3 3 8 3 2 4.9 2 7.3c0 1.6 1.2 3 3 3.6" strokeDasharray="2 2" /><path d="M5 10.9c-.6.9-.8 1.9-.3 2.6" /></>) },
  { id: 'pen', label: 'Lápiz', icon: icon(<><path d="M11 2.5l2.5 2.5-8 8H3v-2.5z" /><path d="M9.5 4l2.5 2.5" /></>) },
  { id: 'highlighter', label: 'Resaltador', icon: icon(<><path d="M10 2.5l3.5 3.5-5.5 5.5H4.5V8z" /><path d="M2.5 13.5h5" /></>) },
  { id: 'eraser', label: 'Borrador', icon: icon(<path d="M6 13.5h7.5M2.8 9.7l6-6a1.5 1.5 0 012.1 0l2.4 2.4a1.5 1.5 0 010 2.1L8 13.5H5.5L2.8 10.8a.8.8 0 010-1.1zM6 6.5l4 4" />) },
]

const COLORS: Array<{ id: PenColor; label: string }> = [
  { id: 'ink', label: 'Tinta' },
  { id: 'teal', label: 'Verde azulado' },
  { id: 'blue', label: 'Azul' },
  { id: 'red', label: 'Rojo' },
  { id: 'orange', label: 'Naranja' },
  { id: 'yellow', label: 'Amarillo' },
]

const TIPS: Array<{ size: number; dot: number; label: string }> = [
  { size: 2, dot: 5, label: 'Punta fina' },
  { size: 4, dot: 8, label: 'Punta media' },
  { size: 8, dot: 12, label: 'Punta gruesa' },
]

const TOGGLES: Array<{ key: 'pressure' | 'palmRejection' | 'penOnly'; label: string; description: string }> = [
  { key: 'pressure', label: 'Sensibilidad a la presión', description: 'El grosor varía según la fuerza del trazo' },
  { key: 'palmRejection', label: 'Rechazo de palma', description: 'Ignora la mano apoyada sobre la pantalla' },
  { key: 'penOnly', label: 'Dibujar solo con lápiz', description: 'El dedo desplaza la página en lugar de dibujar' },
]

const SIDE_BUTTONS: Array<{ id: PenSideButton; label: string }> = [
  { id: 'eraser', label: 'Borrador' },
  { id: 'select', label: 'Selección' },
  { id: 'none', label: 'Sin acción' },
]

function PenOptions({ pen, onPenChange, onClose }: { pen: PenPreferences; onPenChange: MarkdownPenBarProps['onPenChange']; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button, input')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div ref={panelRef} className="notia-pen-options" role="dialog" aria-label="Opciones del lápiz">
      <div className="notia-pen-options-toggles">
        {TOGGLES.map((toggle) => (
          <div key={toggle.key} className="notia-pen-options-toggle">
            <div>
              <div className="notia-pen-options-label">{toggle.label}</div>
              <div className="notia-pen-options-description">{toggle.description}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={pen[toggle.key]}
              aria-label={toggle.label}
              className="notia-pen-switch"
              onClick={() => onPenChange({ [toggle.key]: !pen[toggle.key] })}
            >
              <span aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <label className="notia-pen-options-range">
        <span><span>Suavizado del trazo</span><span className="notia-pen-options-value">{pen.smoothing}%</span></span>
        <input type="range" min={0} max={100} value={pen.smoothing} onChange={(event) => onPenChange({ smoothing: Number(event.target.value) })} />
      </label>
      <div>
        <div className="notia-pen-options-heading">Botón lateral del lápiz</div>
        <div className="notia-pen-segmented" role="radiogroup" aria-label="Botón lateral del lápiz">
          {SIDE_BUTTONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={pen.sideButton === option.id}
              onClick={() => onPenChange({ sideButton: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function MarkdownPenBar({ tool, onToolChange, pen, onPenChange, canUndo, canRedo, onUndo, onRedo, error }: MarkdownPenBarProps) {
  const [optionsOpen, setOptionsOpen] = useState(false)
  const closeOptions = useCallback(() => setOptionsOpen(false), [])
  const barRef = useRef<HTMLDivElement | null>(null)
  const inking = tool === 'pen' || tool === 'highlighter'

  useEffect(() => {
    if (!optionsOpen) return
    const onOutside = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setOptionsOpen(false)
    }
    document.addEventListener('pointerdown', onOutside, true)
    return () => document.removeEventListener('pointerdown', onOutside, true)
  }, [optionsOpen])

  return (
    <div ref={barRef} className="notia-pen-bar" role="toolbar" aria-label="Herramientas de lápiz">
      <div className="notia-pen-bar-scroll">
        <div className="notia-pen-tools" role="radiogroup" aria-label="Herramienta">
          {TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={tool === item.id}
              aria-label={item.label}
              title={item.label}
              className="notia-pen-tool"
              onClick={() => onToolChange(item.id)}
            >
              {item.icon}
              <span className="notia-pen-tool-label">{item.label}</span>
            </button>
          ))}
        </div>
        <span className="notia-pen-divider" aria-hidden="true" />
        <div className="notia-pen-ink" data-active={inking} aria-disabled={!inking || !pen}>
          {COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              aria-label={color.label}
              aria-pressed={pen?.color === color.id}
              title={color.label}
              className={`notia-pen-swatch${tool === 'highlighter' ? ' is-highlighter' : ''}`}
              disabled={!pen}
              onClick={() => onPenChange({ color: color.id })}
            >
              <span style={{ background: INK_COLOR_TOKENS[color.id] }} />
            </button>
          ))}
          <span className="notia-pen-divider" aria-hidden="true" />
          <span className="notia-pen-tip-label">Punta</span>
          {TIPS.map((tip) => (
            <button
              key={tip.size}
              type="button"
              aria-label={tip.label}
              aria-pressed={pen?.thickness === tip.size}
              title={tip.label}
              className="notia-pen-tip"
              disabled={!pen}
              onClick={() => onPenChange({ thickness: tip.size })}
            >
              <span style={{ width: tip.dot, height: tip.dot }} />
            </button>
          ))}
          <input
            type="range"
            min={1}
            max={16}
            value={pen?.thickness ?? 4}
            disabled={!pen}
            aria-label="Tamaño de la punta"
            className="notia-pen-size"
            onChange={(event) => onPenChange({ thickness: Number(event.target.value) })}
          />
          <span className="notia-pen-size-value">{pen?.thickness ?? 4} px</span>
        </div>
        <span className="notia-pen-divider" aria-hidden="true" />
        <button type="button" className="notia-pen-icon-button" aria-label="Deshacer trazo" title="Deshacer trazo" disabled={!canUndo} onClick={onUndo}>
          {icon(<path d="M4.5 6.5h6a3 3 0 010 6H7M6.5 4L4 6.5 6.5 9" />)}
        </button>
        <button type="button" className="notia-pen-icon-button" aria-label="Rehacer trazo" title="Rehacer trazo" disabled={!canRedo} onClick={onRedo}>
          {icon(<path d="M11.5 6.5h-6a3 3 0 000 6H9M9.5 4L12 6.5 9.5 9" />)}
        </button>
        <span className="notia-pen-spacer" />
        {error ? <span className="notia-pen-status is-error" role="alert">{error}</span> : null}
        {!error && inking ? (
          <span className="notia-pen-status" role="status"><span aria-hidden="true" />Dibujando sobre la nota</span>
        ) : null}
      </div>
      <button
        type="button"
        className="notia-pen-options-button"
        aria-haspopup="dialog"
        aria-expanded={optionsOpen}
        disabled={!pen}
        onClick={() => setOptionsOpen((open) => !open)}
      >
        {icon(<><path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7" /><circle cx="11" cy="4.5" r="1.5" /><circle cx="5" cy="11.5" r="1.5" /></>)}
        <span className="notia-pen-tool-label">Opciones</span>
      </button>
      {optionsOpen && pen ? <PenOptions pen={pen} onPenChange={onPenChange} onClose={closeOptions} /> : null}
    </div>
  )
}
