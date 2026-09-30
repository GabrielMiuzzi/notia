import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { loadNoteLinkPreview, type NoteLinkPreview } from '../../../../services/markdown/noteLinkPreviewRuntime'

/*
 * The card a link between notes shows while the pointer rests on it, as in
 * the design canvas (Elementos · Medios): folders, title, the start of the
 * note and when it was edited. Touch has no hover: a tap opens the note, as
 * before. The card only reads; the pointer passes through it.
 */

const SHOW_DELAY_MS = 350
const CARD_WIDTH = 340
const ROOM_BELOW_PX = 180
const LINK_SELECTOR = '.notia-wikilink-token--resolved[data-wikilink-path]'

interface Hover {
  path: string
  left: number
  top: number
  /** Near the bottom of the window the card goes above the link. */
  above: boolean
  /** Inside the app shell, so the card gets the theme tokens. */
  host: Element
}

interface WikiLinkPreviewCardProps {
  /** Where the editor's links are. */
  rootRef: RefObject<HTMLElement | null>
  libraryId: string | null | undefined
}

export function WikiLinkPreviewCard({ rootRef, libraryId }: WikiLinkPreviewCardProps) {
  const [hover, setHover] = useState<Hover | null>(null)
  const [preview, setPreview] = useState<{ path: string; value: NoteLinkPreview } | null>(null)
  const cacheRef = useRef(new Map<string, NoteLinkPreview>())
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root || !libraryId) return
    const clear = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const link = (event.target as Element | null)?.closest<HTMLElement>(LINK_SELECTOR)
      const path = link?.dataset.wikilinkPath
      if (!link || !path) return
      clear()
      timerRef.current = window.setTimeout(() => {
        const rect = link.getBoundingClientRect()
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 8))
        const above = rect.bottom + ROOM_BELOW_PX > window.innerHeight
        const host = link.closest('.notia-app-shell') ?? document.body
        setHover({ path, left, top: above ? rect.top - 8 : rect.bottom + 8, above, host })
      }, SHOW_DELAY_MS)
    }
    const onOut = (event: PointerEvent) => {
      const link = (event.target as Element | null)?.closest(LINK_SELECTOR)
      if (!link || link.contains(event.relatedTarget as Node | null)) return
      clear()
      setHover(null)
    }
    const hide = () => {
      clear()
      setHover(null)
    }
    root.addEventListener('pointerover', onOver)
    root.addEventListener('pointerout', onOut)
    root.addEventListener('pointerdown', hide)
    window.addEventListener('scroll', hide, true)
    return () => {
      clear()
      root.removeEventListener('pointerover', onOver)
      root.removeEventListener('pointerout', onOut)
      root.removeEventListener('pointerdown', hide)
      window.removeEventListener('scroll', hide, true)
    }
  }, [libraryId, rootRef])

  useEffect(() => {
    if (!hover || !libraryId) return
    const cached = cacheRef.current.get(hover.path)
    if (cached) {
      setPreview({ path: hover.path, value: cached })
      return
    }
    let active = true
    void loadNoteLinkPreview(libraryId, hover.path)
      .then((value) => {
        cacheRef.current.set(hover.path, value)
        if (active) setPreview({ path: hover.path, value })
      })
      .catch(() => {
        if (active) setPreview(null)
      })
    return () => {
      active = false
    }
  }, [hover, libraryId])

  if (!hover || preview?.path !== hover.path) return null
  const card = preview.value
  return createPortal(
    <div className={`notia-wikilink-preview${hover.above ? ' is-above' : ''}`} role="tooltip" style={{ left: hover.left, top: hover.top, width: CARD_WIDTH }}>
      <div className="notia-wikilink-preview-folder">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 1.5h5.5l3 3v10H4z" /><path d="M9.5 1.5v3h3" /></svg>
        <span>{card.folder || 'Biblioteca'}</span>
      </div>
      <div className="notia-wikilink-preview-title">{card.title}</div>
      {card.excerpt ? <div className="notia-wikilink-preview-excerpt">{card.excerpt}</div> : null}
      <div className="notia-wikilink-preview-meta">
        {[card.edited, `${card.links} ${card.links === 1 ? 'enlace' : 'enlaces'}`].filter(Boolean).join(' · ')}
      </div>
    </div>,
    hover.host,
  )
}
