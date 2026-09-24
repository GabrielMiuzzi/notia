import { useLayoutEffect, useState, type MouseEvent, type RefObject } from 'react'
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, Code, Highlighter, Link2, RemoveFormatting } from 'lucide-react'
import { NotiaButton } from '../../../common/NotiaButton'
import { RICH_TEXT_COLORS, type BlockAlignment, type RichTextColor } from '../../../../engines/markdown/richTextMarkdown'
import { BLOCK_KINDS, type BlockKind, type ColorMarkName, type ToggleMarkName } from './formatCommands'
import type { FormatToolbarState } from './formatToolbarPlugin'
import { HIGHLIGHT_MARK, TEXT_COLOR_MARK, UNDERLINE_MARK } from './richTextMarks'

/** Room between the toolbar and the text it formats. */
const TOOLBAR_GAP = 10
/** Keeps the toolbar inside the editor on narrow screens. */
const TOOLBAR_EDGE_MARGIN = 8
/** In the canvas the toolbar starts 4px left of the column, which is 2px left of the text. */
const TOOLBAR_BLOCK_INSET = 6

const RICH_TEXT_COLOR_LABELS: Record<RichTextColor, string> = {
  gray: 'Gris',
  teal: 'Teal',
  blue: 'Azul',
  violet: 'Violeta',
  red: 'Rojo',
  orange: 'Naranja',
  yellow: 'Amarillo',
}

const MARK_BUTTONS: ReadonlyArray<{ name: ToggleMarkName; label: string; glyph: string; className: string }> = [
  { name: 'strong', label: 'Negrita', glyph: 'B', className: 'is-bold' },
  { name: 'emphasis', label: 'Cursiva', glyph: 'I', className: 'is-italic' },
  { name: UNDERLINE_MARK, label: 'Subrayado', glyph: 'U', className: 'is-underline' },
  { name: 'strike_through', label: 'Tachado', glyph: 'S', className: 'is-strike' },
]

const ALIGN_BUTTONS: ReadonlyArray<{ align: BlockAlignment; label: string; Icon: typeof AlignLeft }> = [
  { align: 'left', label: 'Alinear a la izquierda', Icon: AlignLeft },
  { align: 'center', label: 'Centrar', Icon: AlignCenter },
  { align: 'right', label: 'Alinear a la derecha', Icon: AlignRight },
]

export interface MarkdownFormatToolbarActions {
  onBlockKind: (kind: BlockKind) => void
  onToggleMark: (name: ToggleMarkName) => void
  onColor: (name: ColorMarkName, color: RichTextColor | null) => void
  onAlign: (align: BlockAlignment) => void
  onLink: () => void
  onClear: () => void
}

interface MarkdownFormatToolbarProps extends MarkdownFormatToolbarActions {
  state: FormatToolbarState | null
  hostRef: RefObject<HTMLElement | null>
  toolbarRef: RefObject<HTMLDivElement | null>
}

type OpenMenu = 'kind' | 'color' | null

/** Buttons keep the editor focused, so the selection they format stays in place. */
const keepEditorFocus = (event: MouseEvent) => event.preventDefault()

function isCoarsePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}

export function MarkdownFormatToolbar({ state, hostRef, toolbarRef, ...actions }: MarkdownFormatToolbarProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [position, setPosition] = useState<{ top: number; left: number; placement: 'above' | 'below' } | null>(null)
  const [trackedState, setTrackedState] = useState(state)
  if (trackedState !== state) {
    // A new selection closes the menus of the previous one.
    setTrackedState(state)
    if (!state) setOpenMenu(null)
  }

  useLayoutEffect(() => {
    const host = hostRef.current
    const toolbar = toolbarRef.current
    if (!state || !host || !toolbar) return
    const hostRect = host.getBoundingClientRect()
    const width = toolbar.offsetWidth
    const height = toolbar.offsetHeight
    const above = state.selectionTop - hostRect.top + host.scrollTop - height - TOOLBAR_GAP
    const below = state.selectionBottom - hostRect.top + host.scrollTop + TOOLBAR_GAP
    // Phones show their own copy/paste bar above the selection.
    const fitsAbove = above >= host.scrollTop + TOOLBAR_EDGE_MARGIN && !isCoarsePointer()
    const maxLeft = Math.max(TOOLBAR_EDGE_MARGIN, host.clientWidth - width - TOOLBAR_EDGE_MARGIN)
    const left = state.blockLeft - hostRect.left + host.scrollLeft - TOOLBAR_BLOCK_INSET
    setPosition({
      top: fitsAbove ? above : below,
      left: Math.min(Math.max(left, TOOLBAR_EDGE_MARGIN), maxLeft),
      placement: fitsAbove ? 'above' : 'below',
    })
  }, [hostRef, state, toolbarRef])

  if (!state) return null
  const { format } = state
  const kindLabel = BLOCK_KINDS.find((item) => item.kind === format.blockKind)?.label ?? 'Bloque'
  const toggleMenu = (menu: OpenMenu) => setOpenMenu((current) => (current === menu ? null : menu))

  return (
    <div
      ref={toolbarRef}
      className="notia-format-toolbar"
      data-placement={position?.placement}
      data-target={state.target.kind}
      style={position ? { top: position.top, left: position.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      {/* The row scrolls on narrow screens; the menus stay outside it so they are not clipped. */}
      <div className="notia-format-toolbar-row" role="toolbar" aria-label="Formato del texto">
        <div className="notia-format-toolbar-group">
          <NotiaButton
            variant="ghost"
            className="notia-format-toolbar-button notia-format-toolbar-kind"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'kind'}
            disabled={!format.canChangeBlock}
            onMouseDown={keepEditorFocus}
            onClick={() => toggleMenu('kind')}
          >
            {kindLabel}
            <ChevronDown size={12} aria-hidden="true" />
          </NotiaButton>
        </div>
        <span className="notia-format-toolbar-divider" aria-hidden="true" />
        <div className="notia-format-toolbar-group">
          {MARK_BUTTONS.map((button) => (
            <NotiaButton
              key={button.name}
              variant="ghost"
              className={`notia-format-toolbar-button notia-format-toolbar-glyph ${button.className}`}
              aria-label={button.label}
              title={button.label}
              aria-pressed={format.marks[button.name]}
              onMouseDown={keepEditorFocus}
              onClick={() => actions.onToggleMark(button.name)}
            >
              {button.glyph}
            </NotiaButton>
          ))}
          <NotiaButton
            variant="ghost"
            className="notia-format-toolbar-button"
            aria-label="Código"
            title="Código"
            aria-pressed={format.marks.inlineCode}
            onMouseDown={keepEditorFocus}
            onClick={() => actions.onToggleMark('inlineCode')}
          >
            <Code size={16} aria-hidden="true" />
          </NotiaButton>
        </div>
        <span className="notia-format-toolbar-divider" aria-hidden="true" />
        <div className="notia-format-toolbar-group">
          <NotiaButton
            variant="ghost"
            className="notia-format-toolbar-button notia-format-toolbar-swatch-button"
            aria-label="Color de texto"
            title="Color de texto"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'color'}
            onMouseDown={keepEditorFocus}
            onClick={() => toggleMenu('color')}
          >
            <span className="notia-format-toolbar-letter" aria-hidden="true">A</span>
            <span className="notia-format-toolbar-bar" data-color={format.textColor ?? undefined} aria-hidden="true" />
          </NotiaButton>
          <NotiaButton
            variant="ghost"
            className="notia-format-toolbar-button notia-format-toolbar-swatch-button"
            aria-label="Resaltado"
            title="Resaltado"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'color'}
            onMouseDown={keepEditorFocus}
            onClick={() => toggleMenu('color')}
          >
            <Highlighter size={14} aria-hidden="true" />
            <span className="notia-format-toolbar-bar notia-format-toolbar-bar--highlight" data-color={format.highlight ?? undefined} aria-hidden="true" />
          </NotiaButton>
        </div>
        <span className="notia-format-toolbar-divider" aria-hidden="true" />
        <div className="notia-format-toolbar-group">
          {ALIGN_BUTTONS.map(({ align, label, Icon }) => (
            <NotiaButton
              key={align}
              variant="ghost"
              className="notia-format-toolbar-button"
              aria-label={label}
              title={format.canAlign ? label : 'Solo se alinean párrafos y títulos fuera de listas y tablas'}
              aria-pressed={format.canAlign && format.align === align}
              disabled={!format.canAlign}
              onMouseDown={keepEditorFocus}
              onClick={() => actions.onAlign(align)}
            >
              <Icon size={16} aria-hidden="true" />
            </NotiaButton>
          ))}
        </div>
        <span className="notia-format-toolbar-divider" aria-hidden="true" />
        <div className="notia-format-toolbar-group">
          <NotiaButton
            variant="ghost"
            className="notia-format-toolbar-button"
            aria-label="Enlace"
            title="Enlace"
            aria-pressed={format.marks.link}
            onMouseDown={keepEditorFocus}
            onClick={actions.onLink}
          >
            <Link2 size={16} aria-hidden="true" />
          </NotiaButton>
          <NotiaButton
            variant="ghost"
            className="notia-format-toolbar-button"
            aria-label="Quitar formato"
            title="Quitar formato"
            onMouseDown={keepEditorFocus}
            onClick={actions.onClear}
          >
            <RemoveFormatting size={16} aria-hidden="true" />
          </NotiaButton>
        </div>
      </div>

      {openMenu === 'kind' ? (
        <div className="notia-format-toolbar-menu notia-format-toolbar-kind-menu" role="menu" aria-label="Tipo de bloque">
          {BLOCK_KINDS.map((item) => (
            <NotiaButton
              key={item.kind}
              variant="ghost"
              role="menuitemradio"
              aria-checked={format.blockKind === item.kind}
              className={`notia-format-toolbar-menu-item notia-format-toolbar-menu-item--${item.kind}`}
              onMouseDown={keepEditorFocus}
              onClick={() => {
                setOpenMenu(null)
                actions.onBlockKind(item.kind)
              }}
            >
              {item.label}
            </NotiaButton>
          ))}
        </div>
      ) : null}

      {openMenu === 'color' ? (
        <div className="notia-format-toolbar-menu notia-format-toolbar-color-menu" role="menu" aria-label="Color y resaltado">
          <p className="notia-format-toolbar-menu-title">Color de texto</p>
          <div className="notia-format-toolbar-swatches">
            {[null, ...RICH_TEXT_COLORS].map((color) => (
              <NotiaButton
                key={color ?? 'default'}
                variant="ghost"
                role="menuitemradio"
                aria-checked={format.textColor === color}
                aria-label={color ? RICH_TEXT_COLOR_LABELS[color] : 'Predeterminado'}
                title={color ? RICH_TEXT_COLOR_LABELS[color] : 'Predeterminado'}
                className="notia-format-toolbar-swatch notia-format-toolbar-swatch--text"
                data-color={color ?? undefined}
                onMouseDown={keepEditorFocus}
                onClick={() => actions.onColor(TEXT_COLOR_MARK, color)}
              >
                A
              </NotiaButton>
            ))}
          </div>
          <p className="notia-format-toolbar-menu-title">Resaltado</p>
          <div className="notia-format-toolbar-swatches">
            {[null, ...RICH_TEXT_COLORS].map((color) => (
              <NotiaButton
                key={color ?? 'none'}
                variant="ghost"
                role="menuitemradio"
                aria-checked={format.highlight === color}
                aria-label={color ? RICH_TEXT_COLOR_LABELS[color] : 'Sin resaltado'}
                title={color ? RICH_TEXT_COLOR_LABELS[color] : 'Sin resaltado'}
                className="notia-format-toolbar-swatch notia-format-toolbar-swatch--highlight"
                data-color={color ?? undefined}
                onMouseDown={keepEditorFocus}
                onClick={() => actions.onColor(HIGHLIGHT_MARK, color)}
              >
                {color ? 'A' : '∅'}
              </NotiaButton>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
