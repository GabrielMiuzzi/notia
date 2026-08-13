import { memo, useState, useEffect, useMemo, useRef } from 'react'
import { Icon, addCollection } from '@iconify/react'
import type { IconifyJSON } from '@iconify/types'
import { NotiaSubmenuPanel } from '../../../components/notia/NotiaSubmenuPanel'

interface IconPackModule {
  icons?: IconifyJSON
}

interface PackDef {
  prefix: string
  label: string
  loader: () => Promise<IconPackModule | null>
}

const PACKS: PackDef[] = [
  {
    prefix: 'fa',
    label: 'Font Awesome',
    loader: () => import('@iconify-json/fa').then((module) => ({ icons: module.icons })).catch(() => null),
  },
  {
    prefix: 'fa-solid',
    label: 'FA Solid',
    loader: () => import('@iconify-json/fa-solid').then((module) => ({ icons: module.icons })).catch(() => null),
  },
  {
    prefix: 'fa-brands',
    label: 'FA Brands',
    loader: () => import('@iconify-json/fa-brands').then((module) => ({ icons: module.icons })).catch(() => null),
  },
  {
    prefix: 'gcp',
    label: 'Google Cloud',
    loader: () => import('@iconify-json/gcp').then((module) => ({ icons: module.icons })).catch(() => null),
  },
  {
    prefix: 'simple-icons',
    label: 'Marcas (Simple Icons)',
    loader: () => import('@iconify-json/simple-icons').then((module) => ({ icons: module.icons })).catch(() => null),
  },
]

interface LoadedPack {
  prefix: string
  label: string
  icons: IconifyJSON
}

interface LoadedIcon {
  ref: string
  prefix: string
  label: string
}

const PAGE_SIZE = 120

interface MermaidIconsMenuProps {
  panelRef: React.RefObject<HTMLDivElement | null>
  triggerRef: React.RefObject<HTMLButtonElement | null>
  onIconSelect: (iconRef: string) => void
  onIconDragStart?: (iconRef: string, previewHtml: string, e: PointerEvent) => void
}

const DRAG_THRESHOLD_PX = 5

export const MermaidIconsMenu = memo(function MermaidIconsMenu({
  panelRef,
  triggerRef,
  onIconSelect,
  onIconDragStart,
}: MermaidIconsMenuProps) {
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [activePack, setActivePack] = useState<string | null>(null)
  const [loadedPacks, setLoadedPacks] = useState<LoadedPack[]>([])
  const [isLoadingPacks, setIsLoadingPacks] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const onIconSelectRef = useRef(onIconSelect)
  const onIconDragStartRef = useRef(onIconDragStart)

  useEffect(() => {
    onIconSelectRef.current = onIconSelect
    onIconDragStartRef.current = onIconDragStart
  }, [onIconDragStart, onIconSelect])

  const dragRef = useRef<{
    iconRef: string
    previewHtml: string
    startX: number
    startY: number
    active: boolean
  } | null>(null)

  useEffect(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const panelWidth = 320
    const left = Math.min(
      Math.max(12, rect.left + rect.width / 2 - panelWidth / 2),
      window.innerWidth - panelWidth - 12,
    )
    setPosition({
      top: rect.bottom + 8,
      left,
    })
  }, [triggerRef])

  // Auto-focus input on open
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [])

  // Load icon packs asynchronously so they are not bundled into the main chunk.
  useEffect(() => {
    let cancelled = false
    setIsLoadingPacks(true)
    Promise.all(
      PACKS.map(async (pack) => {
        const module = await pack.loader()
        if (!module) return null
        const icons = module.icons
        if (!icons) return null
        return { prefix: pack.prefix, label: pack.label, icons }
      }),
    )
      .then((results) => {
        if (cancelled) return
        const packs = results.filter((p): p is LoadedPack => p !== null)
        for (const pack of packs) {
          addCollection(pack.icons)
        }
        setLoadedPacks(packs)
        setIsLoadingPacks(false)
      })
      .catch((error) => {
        console.warn('[MermaidIconsMenu] Failed to load icon packs:', error)
        if (!cancelled) {
          setIsLoadingPacks(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const allIcons = useMemo<LoadedIcon[]>(() => {
    const result: LoadedIcon[] = []
    for (const pack of loadedPacks) {
      const names = Object.keys(pack.icons.icons)
      for (const name of names) {
        result.push({ ref: `${pack.prefix}:${name}`, prefix: pack.prefix, label: `${pack.prefix}:${name}` })
      }
    }
    return result
  }, [loadedPacks])

  // Global drag detection: pointermove crosses threshold -> real drag
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const state = dragRef.current
      if (!state || state.active) return
      const dx = e.clientX - state.startX
      const dy = e.clientY - state.startY
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        state.active = true
        onIconDragStartRef.current?.(state.iconRef, state.previewHtml, e)
      }
    }

    const onPointerUp = () => {
      const state = dragRef.current
      if (!state) return
      if (!state.active) {
        // It was a click, not a drag
        onIconSelectRef.current(state.iconRef)
      }
      dragRef.current = null
    }

    const onPointerCancel = () => {
      dragRef.current = null
    }

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerCancel)
    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [])

  const filteredIcons = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q && !activePack) return allIcons
    let icons = allIcons
    if (activePack) {
      icons = icons.filter((i) => i.prefix === activePack)
    }
    if (q) {
      icons = icons.filter((icon) => icon.label.toLowerCase().includes(q))
    }
    return icons
  }, [search, activePack, allIcons])

  // Reset visible count when search or pack changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [search, activePack])

  // Infinite scroll: load more icons as user scrolls
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const onScroll = () => {
      if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 40) {
        setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredIcons.length))
      }
    }
    grid.addEventListener('scroll', onScroll)
    return () => grid.removeEventListener('scroll', onScroll)
  }, [filteredIcons.length])

  const visibleIcons = filteredIcons.slice(0, visibleCount)

  return (
    <NotiaSubmenuPanel
      ref={panelRef}
      className="mermaid-icons-menu"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: 320,
        maxHeight: 480,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 50,
      }}
    >
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-soft)', flexShrink: 0 }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Buscar icono..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--color-border-soft)',
            background: 'var(--color-card-bg)',
            color: 'var(--color-app-text)',
            fontSize: 13,
            outline: 'none',
          }}
        />
      </div>
      { /* Pack tabs - flex-wrap para que ocupen el ancho y se apilen */ }
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 4px',
          padding: '6px 12px',
          borderBottom: '1px solid var(--color-border-soft)',
          flexShrink: 0,
        }}
      >
        <button
          key="all"
          onClick={() => setActivePack(null)}
          style={{
            padding: '3px 8px',
            borderRadius: 4,
            border: 'none',
            background: activePack === null ? 'var(--color-accent-text)' : 'var(--color-card-bg)',
            color: activePack === null ? '#fff' : 'var(--color-app-text)',
            fontSize: 11,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Todos
        </button>
        {PACKS.map((pack) => (
          <button
            key={pack.prefix}
            onClick={() => setActivePack(pack.prefix)}
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              border: 'none',
              background: activePack === pack.prefix ? 'var(--color-accent-text)' : 'var(--color-card-bg)',
              color: activePack === pack.prefix ? '#fff' : 'var(--color-app-text)',
              fontSize: 11,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {pack.label}
          </button>
        ))}
      </div>
      <div
        ref={gridRef}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 6,
          padding: 12,
          overflowY: 'auto',
          overflowX: 'hidden',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
        }}
      >
        {isLoadingPacks && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 16, color: 'var(--color-icon-muted)', fontSize: 12 }}>
            Cargando packs de iconos...
          </div>
        )}
        {!isLoadingPacks && visibleIcons.map((icon) => (
          <button
            key={icon.ref}
            className="mermaid-icons-menu-item"
            title={icon.label}
            onPointerDown={(e) => {
              e.preventDefault()
              const iconHtml = buildInlineIconSvg(icon.ref, loadedPacks)
              dragRef.current = {
                iconRef: icon.ref,
                previewHtml: iconHtml,
                startX: e.clientX,
                startY: e.clientY,
                active: false,
              }
            }}
          >
            <Icon icon={icon.ref} width={22} height={22} />
            <span
              style={{
                fontSize: 9,
                color: 'var(--color-icon-muted)',
                marginTop: 2,
                width: '100%',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textAlign: 'center',
              }}
            >
              {icon.ref}
            </span>
          </button>
        ))}
        {search.trim() && filteredIcons.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 16, color: 'var(--color-icon-muted)', fontSize: 12 }}>
            No se encontraron iconos
          </div>
        )}
      </div>
    </NotiaSubmenuPanel>
  )
})
MermaidIconsMenu.displayName = 'MermaidIconsMenu'

function buildInlineIconSvg(iconRef: string, loadedPacks: LoadedPack[]): string {
  const [prefix, name] = iconRef.split(':')
  if (!prefix || !name) return ''

  const pack = loadedPacks.find((p) => p.prefix === prefix)
  const iconData = pack?.icons.icons[name]
  if (!iconData) return ''
  const dimensions = iconData as {
    body?: string
    width?: number
    height?: number
  }
  const body = dimensions.body ?? ''
  const w = dimensions.width ?? pack?.icons.width ?? 24
  const h = dimensions.height ?? pack?.icons.height ?? 24

  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 ${w} ${h}" style="display:block;color:var(--color-accent-text,#4dabf7)">${body}</svg>`
}
